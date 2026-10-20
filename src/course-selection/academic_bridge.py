"""Ephemeral, owner/account-bound browser bridge. No cookies or passwords cross this bridge."""
import re
import secrets
import threading
import time

class BridgeError(ValueError):
    def __init__(self,message,code='BRIDGE_INVALID_REQUEST'):
        super().__init__(message);self.code=code

def validation_reason(error):
    # Never expose raw conversion errors: they may embed upstream content.
    known={'课表账号与当前实验账号不匹配','教务学期无法识别','教务学期起始日不是周一，停止自动换算',
           '教务课表格式变化','课表数据过大','日期缺失或无法识别','教务返回了其他账号的课表'}
    return str(error) if str(error) in known else '学校课表字段格式不兼容，请查看连接诊断'

class BrowserBridge:
    def __init__(self, manager, clock=time.monotonic):
        self.manager=manager; self.clock=clock; self.condition=threading.Condition(); self.connections={}; self.jobs={};self.replaced={}

    def _prune(self):
        now=self.clock()
        self.replaced={t:expiry for t,expiry in self.replaced.items() if expiry>now}
        for token, connection in list(self.connections.items()):
            if connection['expires']<now:self.connections.pop(token,None)
        for key,job in list(self.jobs.items()):
            if job['expires']+60<now:self.jobs.pop(key,None)

    def invalidate(self, owner):
        with self.condition:
            for token,connection in list(self.connections.items()):
                if connection['owner']==owner:self.connections.pop(token,None)
            for job in self.jobs.values():
                if job['owner']==owner:job['expires']=0
            self.condition.notify_all()

    def start(self, owner, account, entry, interactive=False):
        if not re.fullmatch(r'\d{5,20}',account):raise BridgeError('学号格式无效')
        with self.condition:
            self._prune(); now=self.clock()
            if interactive:
                # Reconnecting creates a fresh lifetime; an older helper cannot compete for the new job.
                for token,c in list(self.connections.items()):
                    if c['owner']==owner and c['account']==account:
                        self.connections.pop(token);self.replaced[token]=now+7200
                        for old in self.jobs.values():
                            if old['token']==token:old['expires']=0
            connection=next((c for c in self.connections.values() if c['owner']==owner and c['account']==account),None)
            if not connection and not interactive:return dict(status='needs_browser',message='请在登录设置中连接浏览器扩展后同步课表',snapshot=self.manager.load(account))
            if connection and not interactive and now-connection['seen']>45:return dict(status='needs_browser',message='浏览器连接页未在线，请重新连接',snapshot=self.manager.load(account))
            if not connection:
                if len(self.connections)>=16:raise BridgeError('浏览器连接过多，请重新打开应用')
                token=secrets.token_urlsafe(32);connection=dict(owner=owner,account=account,token=token,expires=now+7200,seen=0)
                self.connections[token]=connection
            existing=next((j for j in self.jobs.values() if j['owner']==owner and j['account']==account and j['expires']>now and not j.get('done')),None)
            if not existing and not interactive:
                existing=next((j for j in self.jobs.values() if j['owner']==owner and j['entry']==entry and j['expires']>now),None)
            if existing:job=existing
            else:
                key=secrets.token_urlsafe(24);job=dict(id=key,owner=owner,account=account,entry=entry,token=connection['token'],interactive=interactive,expires=now+(300 if interactive else 60),phase='waiting_browser',done=False,delivered=set())
                self.jobs[key]=job
            self.condition.notify_all()
            return dict(jobId=job['id'],connectPath='/academic-connect#'+connection['token'] if interactive else None,timeoutSeconds=300 if interactive else 60)

    def start_edge(self, owner, account, entry):
        started=self.start(owner,account,entry,True)
        key=started['jobId']
        with self.condition:
            job=self.jobs[key];token=job['token'];job['progress']=dict(stage='launching',step=0,authenticated=False);job['message']='请在专用 Edge 窗口完成教务登录，登录后自动同步课表'
        def progress(value):
            if not isinstance(value,dict) or value.get('stage') not in {'launching','waiting_login','authenticated','reading','validating'}:return
            step=value.get('step',0)
            if type(step) is not int or not 0<=step<=5:return
            with self.condition:
                current=self.jobs.get(key)
                if not current or current['done'] or token not in self.connections or current['expires']<self.clock():return
                authenticated=value['stage']!='waiting_login' and (current['progress'].get('authenticated',False) or value['stage'] in {'authenticated','validating'} or step>1)
                current['progress']=dict(stage=value['stage'],step=step,page=value.get('page',1),authenticated=authenticated)
                current['message']='请在 Edge 完成教务登录' if not authenticated else '正在读取并校验教务课表'
                self.condition.notify_all()
        def read():
            try:
                profile=self.manager.browser_profile(account) if hasattr(self.manager,'browser_profile') else self.manager.account_dir(account)/'edge-browser'
                raw=self.manager.read_official(account,profile,True,transport='edge',on_progress=progress)
                self.submit(token,key,raw)
            except BridgeError:
                # A logged-out, expired or superseded job must never write the cache.
                with self.condition:
                    current=self.jobs.get(key)
                    if token in self.connections and current and current['expires']>self.clock() and not current['done']:
                        current.update(done=True,phase='stale',message='浏览器返回的课表未通过校验，保留上次课表')
                        self.condition.notify_all()
            except Exception:
                try:self.submit(token,key,dict(ok=False,code='reader_failed'))
                except BridgeError:pass
        threading.Thread(target=read,name='academic-edge-reader',daemon=True).start()
        return dict(started,connectPath=None)

    def _connection(self, token):
        if token in self.replaced:raise BridgeError('已由新连接页接管，请关闭此旧页面','CONNECTION_REPLACED')
        connection=self.connections.get(token)
        if not connection or connection['expires']<self.clock():raise BridgeError('连接已过期或应用已重启，请返回应用重新连接','CONNECTION_EXPIRED')
        return connection

    def poll(self, token, client, wait=20):
        if not isinstance(client,str) or not re.fullmatch(r'[a-zA-Z0-9-]{16,80}',client):raise BridgeError('连接标识无效')
        with self.condition:
            connection=self._connection(token);connection['seen']=self.clock()
            def find():
                return next((j for j in self.jobs.values() if j['token']==token and j['expires']>self.clock() and not j['done'] and client not in j['delivered']),None)
            job=find()
            if not job and wait:self.condition.wait(timeout=min(20,wait));self._connection(token);job=find()
            connection['seen']=self.clock()
            if not job:return None
            if len(job['delivered'])>=16:raise BridgeError('连接页过多，请返回应用重新连接','TOO_MANY_CLIENTS')
            job['delivered'].add(client)
            return {key:job[key] for key in ['id','account','interactive']}

    def submit(self, token, key, raw):
        if not isinstance(raw,dict):raise BridgeError('课表格式无效')
        with self.condition:
            connection=self._connection(token);job=self.jobs.get(key)
            if not job or job['token']!=token or job['expires']<self.clock() or job['account']!=connection['account']:raise BridgeError('同步任务已超时，请返回应用重新连接；上次课表保留','JOB_EXPIRED')
            if job['done']:return self.receipt(job,duplicate=True)
            connection['seen']=self.clock()
            if raw.get('ok') is True:
                # Only the narrow timetable protocol is accepted; never store full browser responses.
                if set(raw)-{'ok','account','semester','calendar','courses','changes','notArranged'}:raise BridgeError('课表含不支持的字段')
                if str(raw.get('account'))!=job['account']:raise BridgeError('教务账号与选课账号不一致')
                for rows in [raw.get('courses'),raw.get('changes'),raw.get('notArranged')]:
                    if not isinstance(rows,list) or len(rows)>20000:raise BridgeError('课表条目格式无效')
                allowed={'KCM','KCH','KXH','SKZC','SKXQ','KSJC','JSJC','JASMC','XH','TKLXDM','XSKZC','XSKXQ','XKSJC','XJSJC','XJASMC','SQSJ'}
                for row in raw['courses']+raw['changes']+raw['notArranged']:
                    if not isinstance(row,dict) or set(row)-allowed:raise BridgeError('课程字段格式无效')
                try:accepted=self.manager.accept_browser(job['account'],raw)
                except (ValueError,KeyError,TypeError) as error:
                    message='课表校验失败：'+validation_reason(error)
                    job.update(done=True,phase='stale',message=message)
                    raise BridgeError(message,'TIMETABLE_INVALID') from None
                if accepted is None:job.update(done=True,phase='stale',message='已排课程存在无法解析的记录，保留上次课表；请查看课表警告')
                else:job.update(done=True,phase='complete',message='已同步所有已排课程，用于课程冲突检查；未排课课程单独列出，不参与冲突判断。' if accepted.get('unscheduled') else '课表已同步到实验搭子，用于课程冲突检查。')
            else:
                codes={'edge_missing':'未找到 Microsoft Edge，请安装后重试','profile_busy':'专用 Edge 正在连接，请关闭该专用窗口后重试','cancelled':'已关闭专用 Edge，保留上次课表','login_timeout':'教务登录超时，请重新连接','edge_launch_failed':'无法启动专用 Edge，请关闭专用窗口后重试','browser_closed':'专用 Edge 已关闭，保留上次课表','browser_timeout':'浏览器响应超时，保留上次课表','unexpected_destination':'学校登录跳转到了未支持的地址，保留上次课表','reader_failed':'教务读取组件失败，保留上次课表','needs_login':'请在浏览器完成教务登录，登录后将自动同步','account_mismatch':'教务登录账号与选课账号不同，请切换为同一账号','identity_unverified':'官网未返回可核对的学号，未覆盖上次课表','rate_limited':'学校访问限流，请稍后重试','school_format_changed':'官网课表格式变化，保留上次课表','network_failed':'教务连接失败，保留上次课表'}
                code=raw.get('code');job['message']=codes.get(code,'教务读取未完成，保留上次课表')
                job['phase']='needs_login' if code=='needs_login' else 'stale';job['done']=code!='needs_login'
            self.condition.notify_all()
            return self.receipt(job)

    @staticmethod
    def receipt(job,duplicate=False):
        return dict(accepted=True,done=job['done'],duplicate=duplicate,status=job['phase'],
                    message=job.get('message','课表尚未同步'))

    def result(self, owner, account, key):
        with self.condition:
            job=self.jobs.get(key)
            if not job or job['owner']!=owner or job['account']!=account:raise BridgeError('无效的同步请求')
            if job['expires']<self.clock():return dict(done=True,status='stale',message='浏览器同步已超时，请重新连接',snapshot=self.manager.load(account))
            if job['phase']=='complete':return dict(done=True,progress=dict(stage='complete',step=6,authenticated=True),**self.manager.state(account,'fresh' if self.manager.load(account).get('complete') else 'partial','浏览器课表已同步'))
            return dict(done=job['done'],status=job['phase'],progress=job.get('progress'),message=job.get('message','等待教务浏览器连接'),snapshot=self.manager.load(account))
