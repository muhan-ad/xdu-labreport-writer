"""Read-only academic timetable synchronization and exact-date conflict checks."""
import hashlib
import json
import os
import re
import subprocess
import threading
from datetime import datetime, date, timedelta, timezone
from pathlib import Path

SHANGHAI=timezone(timedelta(hours=8))
PERIODS=[('08:30','09:15'),('09:20','10:05'),('10:25','11:10'),('11:15','12:00'),
         ('14:00','14:45'),('14:50','15:35'),('15:55','16:40'),('16:45','17:30'),
         ('19:00','19:45'),('19:50','20:35'),('20:40','21:25')]
# Verified against XDYou lib/model/time_list.dart. Missing/out-of-range periods fail closed.


def parse_date(value):
    value=str(value).strip()
    for pattern in ('%Y/%m/%d','%Y-%m-%d','%m/%d/%Y'):
        try:return datetime.strptime(value[:10],pattern).date()
        except ValueError:pass
    raise ValueError('日期缺失或无法识别')


def week_mask(value):
    mask=str(value or '')
    if not mask or len(mask)>60 or not re.fullmatch('[01]+',mask):raise ValueError('上课周次无法识别')
    return [i for i,bit in enumerate(mask) if bit=='1']


def period_range(start,stop):
    first,last=int(start),int(stop)
    if not 1<=first<=last<=len(PERIODS):raise ValueError('起止节次无法识别')
    return PERIODS[first-1][0],PERIODS[last-1][1]


def normalise(raw,account):
    if str(raw.get('account',''))!=account:raise ValueError('课表账号与当前实验账号不匹配')
    semester=str(raw.get('semester',''))
    if not re.fullmatch(r'\d{4}-\d{4}-[12]',semester):raise ValueError('教务学期无法识别')
    start=parse_date(raw['calendar']['XQKSRQ'])
    if start.weekday()!=0:raise ValueError('教务学期起始日不是周一，停止自动换算')
    courses,changes=raw.get('courses'),raw.get('changes')
    if not isinstance(courses,list) or not isinstance(changes,list):raise ValueError('教务课表格式变化')
    if len(courses)+len(changes)>20000:raise ValueError('课表数据过大')
    warnings=[];events=[];mask_length=0
    unscheduled=[dict(name=str(row.get('KCM','未命名课程')),code=str(row.get('KCH',''))) for row in raw.get('notArranged',[]) if isinstance(row,dict)]

    def make_events(row,changed=False):
        nonlocal mask_length
        if row.get('XH') is not None and str(row['XH'])!=account:raise ValueError('教务返回了其他账号的课表')
        name=str(row.get('KCM','')).strip()
        code=str(row.get('KCH','')).strip();number=str(row.get('KXH','')).strip()
        if not name or not code:raise ValueError('课程名称或标识缺失')
        if not isinstance(row,dict):raise ValueError('课程记录无法识别')
        mask=(row.get('XSKZC') or row.get('SKZC')) if changed else row.get('SKZC')
        weeks=week_mask(mask);mask_length=max(mask_length,len(str(mask)))
        day=int(row.get('XSKXQ') or row.get('SKXQ')) if changed else int(row.get('SKXQ'))
        if day not in range(1,8):raise ValueError('课程星期无法识别')
        first=row.get('XKSJC') if changed else row.get('KSJC');last=row.get('XJSJC') if changed else row.get('JSJC')
        begin,end=period_range(first,last)
        room=str((row.get('XJASMC') if changed else None) or row.get('JASMC') or '')
        return [dict(name=name,code=code,number=number,date=(start+timedelta(days=w*7+day-1)).isoformat(),start=begin,end=end,room=room) for w in weeks]

    if any(not isinstance(row,dict) for row in courses+changes):raise ValueError('课程记录格式异常')
    for row in courses:
        try:events.extend(make_events(row))
        except (ValueError,TypeError,KeyError) as error:
            if row.get('XH') is not None and str(row['XH'])!=account:raise
            warnings.append(str(error))
    # School returns latest first; apply oldest first to support chained reschedules.
    for row in reversed(changes):
        try:
            kind=str(row.get('TKLXDM',''))
            if kind not in ('01','02','03'):raise ValueError('存在无法识别的调停补课类型')
            generated=make_events(row,True) if kind in ('01','03') else []
            if kind in ('01','02'):
                old=make_events(row)
                key=lambda e:(e['code'],e['number'],e['date'],e['start'],e['end'])
                old_keys={key(e) for e in old};matched=[event for event in events if key(event) in old_keys]
                if not matched:
                    if generated and all(key(e) in {key(x) for x in events} for e in generated):continue
                    raise ValueError('调停课未匹配原课程，检查结果可能不完整')
                events=[event for event in events if key(event) not in old_keys]
            events.extend(generated)
        except (ValueError,TypeError,KeyError) as error:warnings.append(str(error))
    unique={json.dumps(event,ensure_ascii=False,sort_keys=True):event for event in events}
    events=sorted(unique.values(),key=lambda event:(event['date'],event['start'],event['name']))
    end_raw=raw['calendar'].get('XQJSRQ')
    end=parse_date(end_raw).isoformat() if end_raw else (start+timedelta(days=mask_length*7-1)).isoformat() if mask_length else None
    scheduled_complete=not warnings
    if unscheduled:warnings.append('存在尚未安排时间的课程，无法检查这些课程的冲突')
    return dict(account=account,semester=semester,termStart=start.isoformat(),termEnd=end,
                events=events,complete=not warnings,scheduledComplete=scheduled_complete,unscheduled=unscheduled,warnings=sorted(set(warnings)),
                fetchedAt=datetime.now(SHANGHAI).isoformat())


def experiment_interval(item,enrolled,calendar_anchor=None):
    match=re.search(r'星期([一二三四五六日天])(?:下午|晚上|上午)?\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})',str(item.get('time','')))
    if not match:return None
    day='一二三四五六日'.index(match[1].replace('天','日'))+1
    if item.get('date'):
        actual=parse_date(item['date'])
    else:
        anchor=next((entry for entry in [*enrolled,*([calendar_anchor] if calendar_anchor else [])] if entry.get('date') and entry.get('week') and re.search(r'星期[一二三四五六日天]',entry.get('time',''))),None)
        if not anchor:return None
        old_day='一二三四五六日'.index(re.search(r'星期([一二三四五六日天])',anchor['time'])[1].replace('天','日'))+1
        actual=parse_date(anchor['date'])+timedelta(days=(int(item['week'])-int(anchor['week']))*7+day-old_day)
    return dict(date=actual.isoformat(),start=match[2].zfill(5),end=match[3].zfill(5))


def academic_interval(item,enrolled,calendar_anchor=None):
    slot=experiment_interval(item,enrolled,calendar_anchor)
    if slot is None:return None
    label=str(item.get('time',''))
    if '下午' in label:slot.update(start='15:55',end='17:30')
    elif '晚上' in label:slot.update(start='19:00',end='21:25')
    return slot


def timetable_conflict(snapshot,item,enrolled,calendar_anchor=None):
    if not snapshot:return None
    slot=academic_interval(item,enrolled,calendar_anchor)
    if not slot:return None
    for event in snapshot.get('events',[]):
        if event['date']!=slot['date'] or event['start']>=slot['end'] or slot['start']>=event['end']:continue
        # Ignore only the exact same booked physical-lab occurrence, never all lab courses.
        if '物理实验' in event['name'] or event['name']==item['name']:
            if any((current:=experiment_interval(booked,enrolled,calendar_anchor)) and current=={k:event[k] for k in ('date','start','end')} for booked in enrolled):continue
        return event
    return None


class AcademicManager:
    def __init__(self,root=None,reader=None):
        self.root=Path(root or os.environ.get('LAB_COURSE_DATA_DIR') or Path(os.environ.get('APPDATA',str(Path.home())))/'lab-course-web'/'academic')
        self.reader=reader or self.read_official
        self.guard=threading.Lock();self.flights={};self.snapshots={};self.entries={}

    def account_dir(self,account):return self.root/hashlib.sha256(account.encode()).hexdigest()

    def browser_profile(self,account):
        target=self.account_dir(account)
        try:epoch=(target/'session-epoch').read_text(encoding='utf-8').strip()
        except OSError:epoch=''
        return target/('edge-browser-'+epoch if re.fullmatch(r'[a-f0-9]{32}',epoch) else 'edge-browser')

    def clear(self,account):
        # Rotate the dedicated browser profile so no saved school session is reused.
        # An old profile may still be owned by an open browser; never force-close it.
        import secrets
        with self.guard:
            target=self.account_dir(account);target.mkdir(parents=True,exist_ok=True)
            (target/'session-epoch').write_text(secrets.token_hex(16),encoding='utf-8')
            (target/'timetable.json').unlink(missing_ok=True)
            self.snapshots.pop(account,None)
            self.entries={key:value for key,value in self.entries.items() if key[0]!=account}

    def load(self,account):
        if account in self.snapshots:return self.snapshots[account]
        try:
            value=json.loads((self.account_dir(account)/'timetable.json').read_text(encoding='utf-8'))
            if value.get('account')==account and isinstance(value.get('events'),list):self.snapshots[account]=value;return value
        except (OSError,ValueError):pass
        return None

    def state(self,account,status='cached',message=''):
        value=self.load(account)
        return dict(status=status,message=message,snapshot=value)

    def sync(self,account,entry,interactive=False):
        if not re.fullmatch(r'\d{5,20}',account):return self.state(account,'unavailable','当前实验账号无法用于绑定课表')
        with self.guard:
            if not interactive and (account,entry) in self.entries:return self.entries[(account,entry)]
            flight=self.flights.get(account)
            owner=flight is None
            if owner:flight={'event':threading.Event()};self.flights[account]=flight
        if not owner:
            if not flight['event'].wait(270):return self.state(account,'stale','教务同步仍在处理，本次使用上次课表')
            with self.guard:self.entries[(account,entry)]=flight['result']
            return flight['result']
        try:
            raw=self.reader(account,self.account_dir(account)/'browser',interactive)
            if not raw.get('ok'):
                code=raw.get('code','network_failed')
                messages={'needs_login':'请在学校官方页面完成教务登录','cancelled':'已取消教务登录','login_timeout':'教务登录超时','rate_limited':'学校限制了访问，已停止同步','school_data_unavailable':'学校当前未发布课表或拒绝查询','school_format_changed':'教务数据格式变化，未覆盖上次课表','unexpected_destination':'学校登录跳转地址未受信任，已停止','reader_missing':'教务读取组件不可用'}
                result=self.state(account,'needs_login' if code=='needs_login' else 'stale',messages.get(code,'教务同步失败，保留上次课表'))
            else:
                snapshot=normalise(raw,account)
                # A malformed/incomplete refresh must not destroy a complete prior snapshot.
                if not snapshot['complete'] and self.load(account):
                    result=self.state(account,'stale','本次教务数据不完整，保留上次课表')
                else:
                    target=self.account_dir(account);target.mkdir(parents=True,exist_ok=True)
                    temporary=target/'timetable.tmp';temporary.write_text(json.dumps(snapshot,ensure_ascii=False),encoding='utf-8');temporary.replace(target/'timetable.json')
                    self.snapshots[account]=snapshot
                    result=self.state(account,'fresh' if snapshot['complete'] else 'partial','教务课表已同步' if snapshot['complete'] else '教务课表存在未识别记录，无法完整检查')
        except (OSError,ValueError,TypeError,KeyError,subprocess.SubprocessError):result=self.state(account,'stale','教务读取失败，保留上次课表')
        finally:
            if 'result' not in locals():result=self.state(account,'stale','教务读取失败，保留上次课表')
            with self.guard:
                flight['result']=result;self.entries[(account,entry)]=result
                if len(self.entries)>1000:self.entries.pop(next(iter(self.entries)))
                flight['event'].set();self.flights.pop(account,None)
        return result

    def accept_browser(self,account,raw):
        snapshot=normalise(raw,account)
        with self.guard:
            if not snapshot['scheduledComplete'] and self.load(account):return None
            target=self.account_dir(account);target.mkdir(parents=True,exist_ok=True)
            temporary=target/'timetable.tmp';temporary.write_text(json.dumps(snapshot,ensure_ascii=False),encoding='utf-8');temporary.replace(target/'timetable.json')
            self.snapshots[account]=snapshot
        return snapshot

    @staticmethod
    def read_official(account,profile,interactive,transport=None,on_progress=None):
        candidates=[os.environ.get('LAB_COURSE_ELECTRON',''),str(Path(__file__).parent/'reader-runtime'/'electron.exe'),r'E:\apps\labreport-writer-manager\node_modules\electron\dist\electron.exe']
        executable=next((path for path in candidates if path and Path(path).is_file()),None)
        if not executable:return dict(ok=False,code='reader_missing')
        environment=dict(os.environ);environment.pop('ELECTRON_RUN_AS_NODE',None)
        environment['LAB_COURSE_READER_CONFIG']=json.dumps(dict(account=account,profileDir=str(profile),interactive=interactive,transport=transport,readerScript=os.environ.get('LAB_COURSE_BROWSER_READER',str(Path(__file__).with_name('timetable_reader.js')))))
        with subprocess.Popen([executable,str(Path(__file__).with_name('academic_reader.cjs'))],
                text=True,encoding='utf-8',stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
                env=environment,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0)) as process:
            timer=threading.Timer(260 if interactive else 80,process.kill);timer.daemon=True;timer.start()
            result=None;size=0
            try:
                for line in process.stdout:
                    size+=len(line)
                    if size>32*1024*1024:process.kill();return dict(ok=False,code='reader_failed')
                    if line.startswith('ACADEMIC_PROGRESS:') and on_progress:
                        try:on_progress(json.loads(line.split(':',1)[1]))
                        except (ValueError,TypeError):pass
                    elif line.startswith('ACADEMIC_RESULT:'):result=json.loads(line.split(':',1)[1])
                process.wait()
            finally:timer.cancel()
            return result or dict(ok=False,code='reader_failed')
