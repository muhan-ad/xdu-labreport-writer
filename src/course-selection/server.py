"""Local-only PhyEws adapter. Credentials, cookies and form state stay in memory."""
import argparse
import html
import os
import json
import re
import secrets
import threading
import time
import sys
from datetime import datetime
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import requests
from bs4 import BeautifulSoup
sys.path.insert(0, str(Path(__file__).resolve().parent))
from academic import AcademicManager, timetable_conflict
from academic_bridge import BrowserBridge, BridgeError
from cancellation import apply_cancellation, cancel_reason
from guide_selection import issue_conflict, accept_conflict, proof_valid, eligible, exact_teacher

BASE = 'http://wlsy.xidian.edu.cn/phyews/'
ROOT = Path(__file__).parent
SESSIONS = {}
STORE_LOCK = threading.Lock()
ACADEMIC = AcademicManager()
BROWSER = BrowserBridge(ACADEMIC)
BRIDGE_LOG_LOCK=threading.Lock()

def bridge_diagnostic(phase,code):
    # Only fixed phase/error codes: no URL fragments, accounts, cookies or school response bodies.
    try:
        base=os.environ.get('LAB_COURSE_DATA_DIR')
        if not base:return
        file=Path(base).parent/'browser-bridge.log';file.parent.mkdir(parents=True,exist_ok=True)
        line=json.dumps(dict(time=datetime.now().isoformat(timespec='seconds'),phase=phase,code=code))+'\n'
        with BRIDGE_LOG_LOCK:
            if file.exists() and file.stat().st_size>65536:file.write_text('',encoding='utf8')
            with file.open('a',encoding='utf8') as stream:stream.write(line)
    except OSError:pass


class Problem(Exception):
    def __init__(self, message, status=400, **details):
        super().__init__(message)
        self.status = status
        self.details = details


def soup(html):
    return BeautifulSoup(html, 'html.parser')


def text(node):
    return node.get_text(' ', strip=True) if node else ''


def cells(row):
    return row.find_all(['td', 'th'], recursive=False)


def clean_name(value):
    return re.sub(r'[（(]\d+学时[）)].*$', '', value).strip()


def options(page, name):
    select = page.find('select', attrs={'name': name}) or page.find('select', id=name)
    return [dict(value=o.get('value', text(o)), label=text(o))
            for o in select.find_all('option')] if select else []


def control_name(page, identifier):
    control = page.find(id=identifier) or page.find(attrs={'name': identifier})
    if not control or not control.get('name'):
        raise Problem('官网控件已变化，请在官网核对。', 502)
    return control['name']


def normalize_date(value):
    for pattern in ('%Y/%m/%d', '%m/%d/%Y', '%Y-%m-%d'):
        try:
            return datetime.strptime(value, pattern).strftime('%Y/%m/%d')
        except ValueError:
            continue
    return value


def form_data(page):
    form = page.find('form')
    if not form:
        raise Problem('官网表单缺失，请刷新或重新登录。', 502)
    data = {}
    for field in form.find_all('input'):
        kind = field.get('type', 'text').lower()
        if not field.get('name') or field.has_attr('disabled'):
            continue
        if kind in ('image', 'submit', 'button', 'reset', 'file'):
            continue
        if kind in ('checkbox', 'radio') and not field.has_attr('checked'):
            continue
        data[field['name']] = field.get('value', '')
    for field in form.find_all('select'):
        selected = field.find('option', selected=True)
        if selected is None and not field.has_attr('size'):
            selected = field.find('option')
        if selected and field.get('name'):
            data[field['name']] = selected.get('value', text(selected))
    return data


def parse_enrolled(page):
    result = []
    for row in page.find_all('tr'):
        c = cells(row)
        if len(c) != 10 or not text(c[0]).isdigit():
            continue
        result.append(dict(name=clean_name(text(c[1])), week=int(text(c[2])),
                           time=text(c[3]), date=normalize_date(text(c[4])), room=text(c[5]),
                           hours=int((re.search(r'(\d+)学时', text(c[1])) or [None, 3])[1])))
    if not result and '实验项目' not in text(page):
        raise Problem('官网已选课表格式变化，未将空结果当作成功。', 502)
    return result


def parse_cancellable(page):
    result = []
    for row in page.find_all('tr'):
        c = cells(row)
        radio = row.find('input', attrs={'type': 'radio'})
        if len(c) == 6 and radio and text(c[0]).isdigit():
            result.append(dict(name=clean_name(text(c[1])), week=int(text(c[2])),
                               time=text(c[3]), hours=int(text(c[4])),
                               radio=radio['name'], value=radio.get('value', 'rb')))
    if '取消' not in text(page):
        raise Problem('官网退课页面无法识别。', 502)
    return result


def parse_availability(page, week):
    heading = text(page)
    if not re.search(r'第\s*' + str(week) + r'\s*周可选', heading):
        raise Problem('官网返回的查询周次不匹配，请重新查询。', 502)
    slots, projects = [], []
    for row in page.find_all('tr'):
        c = cells(row)
        if len(c) != 2 or c[0].find('table') or not re.search(r'\d+学时', text(c[0])):
            continue
        name = clean_name(text(c[0]))
        projects.append(name)
        for m in re.finditer(r'(星期([一二三四五])((?:下午|晚上))\s*(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2}))\s*\((\d+)\)', text(c[1])):
            hours = int(re.search(r'(\d+)学时', text(c[0]))[1])
            slots.append(dict(name=name, hours=hours, week=week, time=re.sub(r'\s+', '', m[1]),
                              day='一二三四五'.index(m[2])+1,
                              period='B' if m[3] == '下午' else 'C',
                              start=m[4], end=m[5], remaining=int(m[6])))
    if not projects:
        raise Problem('官网可选场次表结构变化，无法可靠读取。', 502)
    return dict(week=week, projects=projects, slots=slots,
                fetchedAt=datetime.now().astimezone().isoformat())


def same_course(a, b):
    return all(str(a[k]) == str(b[k]) for k in ('name', 'week', 'time'))


class Official:
    def __init__(self):
        self.http = requests.Session()
        self.http.headers['User-Agent'] = 'LabCourseLocal/0.1 (personal course UI)'
        self.http.headers['Accept-Language'] = 'zh-CN,zh;q=0.9'
        self.auth = False
        self.metadata = None

    def request(self, path, data=None, authenticated=True,timeout=(10,35)):
        url = urljoin(BASE, path)
        for _ in range(6):
            u = urlsplit(url)
            if u.hostname != 'wlsy.xidian.edu.cn' or u.scheme not in ('http', 'https') or not u.path.lower().startswith('/phyews/'):
                raise Problem('官网跳转到了未授权地址，请在官网核对。', 502)
            response = self.http.request('GET' if data is None else 'POST', url,
                                         data=data, timeout=timeout, allow_redirects=False)
            if response.status_code in (301, 302, 303, 307, 308):
                url = urljoin(url, response.headers['Location'])
                if response.status_code in (301, 302, 303):
                    data = None
                continue
            response.raise_for_status()
            # ASP.NET declares its page encoding; avoid requests' ISO-8859-1 default.
            response.encoding = requests.utils.get_encoding_from_headers(response.headers)
            if not response.encoding or response.encoding.lower() == 'iso-8859-1':
                response.encoding = response.apparent_encoding
            page = soup(response.text)
            if authenticated and page.find('input', attrs={'name': 'login1$StuPassword'}):
                self.auth = False
                raise Problem('学校登录已失效，请重新登录。', 401)
            return page
        raise Problem('官网重定向过多。', 502)

    def post(self, path, page, changes=None, event='', button=None,timeout=None):
        data = form_data(page)
        data.update(changes or {})
        data['__EVENTTARGET'] = event
        data['__EVENTARGUMENT'] = ''
        if button:
            data[button + '.x'], data[button + '.y'] = '8', '8'
        return self.request(path, data,timeout=timeout) if timeout is not None else self.request(path, data)

    def login(self, account, password):
        self.auth = False
        self.metadata = None
        self.http.cookies.clear()
        page = self.request('', authenticated=False)
        data = form_data(page)
        data.update({'login1$StuLoginID': account, 'login1$StuPassword': password,
                     'login1$UserRole': 'Student', 'login1$btnLogin.x': '8', 'login1$btnLogin.y': '8'})
        response = self.request('', data, authenticated=False)
        if response.find('input', attrs={'name': 'login1$StuPassword'}):
            messages = []
            for script in response.find_all('script'):
                messages.extend(re.findall(r'''alert\(['"]([^'"\r\n]{1,160})['"]\)''', script.get_text()))
            raise Problem('学校未接受登录：' + ('；'.join(messages) or '请核对账号密码后重试。'), 401)
        # A subsequent protected page must be readable before declaring success.
        result = self.overview()
        self.auth = True
        return result

    def overview(self):
        page = self.request('student/student.aspx')
        self.navigation = page
        body = text(page)
        def number(pattern):
            found = re.search(pattern, body)
            if not found:
                raise Problem('官网学时信息无法识别，停止使用旧数据。', 502)
            return int(found[1])
        rules = dict(requiredHours=number(r'必须完成的实验项目总学时数为\s*(\d+)'),
                     weeklyHourLimit=number(r'每周可选的实验项目总学时数为\s*(\d+)'),
                     selectedHours=number(r'已选实验项目的总学时数为\s*(\d+)'))
        week = re.search(r'第\s*(\d+)\s*周', body)
        calendar_day = re.search(r'(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日.*?星期([一二三四五六日天])', body)
        calendar_anchor = (dict(date=f'{calendar_day[1]}/{calendar_day[2]}/{calendar_day[3]}',
                               week=int(week[1]), time=f'星期{calendar_day[4]}00:00-00:01')
                           if calendar_day and week else None)
        identity = re.search(r'([^\s（）()]+)\s*[（(](\d+)[）)]\s*同学', body)
        enrolled = parse_enrolled(self.request('student/select.aspx'))
        cancellable = parse_cancellable(self.request('student/del.aspx'))
        for item in enrolled:
            item['cancellable'] = any(same_course(item, r) for r in cancellable)
        apply_cancellation(enrolled, calendar_anchor)
        add = self.request('student/addexpe.aspx')
        weeks = [int(x['value']) for x in options(add, 'ExpeWeekList') if x['value'].isdigit()]
        return dict(rules=rules, currentWeek=int(week[1]) if week else None,
                    calendarAnchor=calendar_anchor,
                    identity=dict(name=identity[1], account=identity[2]) if identity else None,
                    enrolled=enrolled, allowedWeeks=weeks,
                    weeks=sorted(set(weeks + [x['week'] for x in enrolled])),
                    fetchedAt=datetime.now().astimezone().isoformat())

    def availability(self, week):
        page = self.request('student/statsel.aspx')
        if str(week) not in [x['value'] for x in options(page, 'Header2_ExpeWeekList')]:
            raise Problem('官网未提供这个周次。')
        week_name = control_name(page, 'Header2_ExpeWeekList')
        button_name = control_name(page, 'Header2_btnSubmit')
        page = self.post('student/statsel.aspx', page, {week_name: str(week)}, button=button_name)
        return parse_availability(page, week)

    def course_details(self,name):
        from course_metadata import MetadataReader
        if self.metadata is None:self.metadata=MetadataReader(self)
        return self.metadata.lookup(name)

    def prepare_add(self, item):
        page = self.request('student/addexpe.aspx')
        week = str(item['week'])
        if week not in [o['value'] for o in options(page, 'ExpeWeekList')]:
            raise Problem('该周已不在官网可选范围内。')
        page = self.post('student/addexpe.aspx', page, {'ExpeWeekList': week}, event='ExpeWeekList')
        time_code = str(item['day']) + item['period']
        if time_code not in [o['value'] for o in options(page, 'ExpeTimeList')]:
            raise Problem('该时段已不可选。')
        page = self.post('student/addexpe.aspx', page, {'ExpeTimeList': time_code}, event='ExpeTimeList')
        classes = options(page, 'ExpeClassList')
        matches = [o for o in options(page, 'ExpeNameList') if clean_name(o['label']) == item['name']]
        if not matches:
            for category in classes:
                page = self.post('student/addexpe.aspx', page, {'ExpeClassList': category['value']}, event='ExpeClassList')
                matches = [o for o in options(page, 'ExpeNameList') if clean_name(o['label']) == item['name']]
                if matches:
                    break
        if len(matches) != 1:
            raise Problem('官网当前没有此实验名额，请刷新课表。')
        selected = matches[0]
        # Selecting the experiment also performs its native AutoPostBack before submit.
        page = self.post('student/addexpe.aspx', page, {'ExpeNameList': selected['value']}, event='ExpeNameList')
        if selected['value'] not in [o['value'] for o in options(page, 'ExpeNameList')]:
            raise Problem('官网实验选项已变化，请重新选择。')
        return page, dict(ExpeWeekList=week, ExpeTimeList=time_code, ExpeNameList=selected['value'])

    def mutate(self, action, item):
        before = self.overview()
        if action == 'add':
            if any(e['name'] == item['name'] for e in before['enrolled']):
                raise Problem('你已经选过该实验，请先核对已选课表。')
            page, changes = self.prepare_add(item)
            response = self.post('student/addexpe.aspx', page, changes, button='btnAdd')
        else:
            page = self.request('student/del.aspx')
            matches = [x for x in parse_cancellable(page) if same_course(x, item)]
            if len(matches) != 1:
                raise Problem('官网已不允许取消这项实验，请刷新课表。')
            row = matches[0]
            response = self.post('student/del.aspx', page, {row['radio']: row['value']}, button='btnDel')
        after = self.overview()
        present = any(same_course(x, item) for x in after['enrolled'])
        if present != (action == 'add'):
            alerts = [text(x) for x in response.find_all(['span', 'label'])
                      if re.search(r'失败|不能|不允许|超过|已经|已满|成功', text(x)) and len(text(x)) < 160]
            raise Problem('官网未确认操作成功。' + ('；'.join(alerts[:3]) or '请核对名额、学时限制及官网提示。'), 409)
        return dict(message='选课成功' if action == 'add' else '已取消选课', overview=after)


class LocalSession:
    def __init__(self):
        self.official = Official()
        self.csrf = secrets.token_urlsafe(32)
        self.lock = threading.Lock()
        self.last = time.monotonic()
        self.tickets = {}
        self.conflict_confirmations = {}
        self.account = ''
        self.academic_lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # No request bodies, student identifiers or credentials in logs.

    def valid_host(self):
        return self.headers.get('Host') == f'127.0.0.1:{self.server.server_port}'

    def session(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get('Cookie', ''))
        except Exception:
            pass
        cookie_name = f'course_sid_{self.server.server_port}'
        sid = cookie[cookie_name].value if cookie_name in cookie else ''
        with STORE_LOCK:
            for old in list(SESSIONS):
                if time.monotonic() - SESSIONS[old].last > 7200:
                    SESSIONS.pop(old).official.http.close()
                    BROWSER.invalidate(old)
            if sid not in SESSIONS:
                sid = secrets.token_urlsafe(32)
                SESSIONS[sid] = LocalSession()
            session = SESSIONS[sid]
            session.last = time.monotonic()
        self.sid = sid
        return session

    def send(self, value, status=200, mime='application/json; charset=utf-8'):
        body = value if isinstance(value, bytes) else json.dumps(value, ensure_ascii=False).encode() if mime.startswith('application/json') else value
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'; base-uri 'none'")
        if hasattr(self, 'sid'):
            self.send_header('Set-Cookie', f'course_sid_{self.server.server_port}={self.sid}; HttpOnly; SameSite=Strict; Path=/')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self.valid_host():
            return self.send({'error': '仅接受本机访问'}, 403)
        if self.path == '/api/session':
            session = self.session()
            return self.send(dict(csrf=session.csrf, authenticated=session.official.auth))
        files = {'/shared/unified-select.js': ('../shared/unified-select.js','text/javascript; charset=utf-8'),
                 '/shared/unified-select.css': ('../shared/unified-select.css','text/css; charset=utf-8'),
                 '/shared/input-fields.css': ('../shared/input-fields.css','text/css; charset=utf-8'),
                 '/': ('index.html', 'text/html; charset=utf-8'),
                 '/app.js': ('app.js', 'text/javascript; charset=utf-8'),
                 '/guide-content.js': ('guide-content.js', 'text/javascript; charset=utf-8'),
                 '/style.css': ('style.css', 'text/css; charset=utf-8'),
                 '/guide-reviews.js': ('guide-reviews.js', 'text/javascript; charset=utf-8'),
                 '/course-filters.js': ('course-filters.js', 'text/javascript; charset=utf-8'),
                 '/filter-ui.js': ('filter-ui.js', 'text/javascript; charset=utf-8'),
                 '/guide-ui.js': ('guide-ui.js', 'text/javascript; charset=utf-8'),
                 '/guide-ui.css': ('guide-ui.css', 'text/css; charset=utf-8'),
                 '/audio/keyboard.ogg': ('audio/keyboard.ogg', 'audio/ogg'),
                 '/audio/config.json': ('audio/config.json', 'application/json')}
        if self.path not in files:
            return self.send({'error': '未找到'}, 404)
        name, mime = files[self.path]
        self.send((ROOT / name).read_bytes(), mime=mime)

    def do_POST(self):
        expected = f'http://127.0.0.1:{self.server.server_port}'
        if not self.valid_host() or self.headers.get('Origin') != expected:
            return self.send({'error': '请求来源无效'}, 403)
        if self.path.startswith('/api/browser-bridge/'):
            return self.send({'error':'扩展连接已移除，请在登录设置中使用 Edge 登录教务','code':'EXTENSION_REMOVED'},410)
        session = self.session()
        if not secrets.compare_digest(self.headers.get('X-CSRF-Token', ''), session.csrf):
            return self.send({'error': '页面已失效，请刷新'}, 403)
        operation_lock = session.academic_lock if self.path.startswith('/api/academic/') else session.lock
        if not operation_lock.acquire(blocking=False):
            return self.send({'error': '正在处理上一项操作，请稍候'}, 409)
        mutation_started = False
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length > 12000 or length < 0:
                raise Problem('请求过大')
            data = json.loads(self.rfile.read(length) or b'{}')
            api = session.official
            if self.path == '/api/login':
                account, password = str(data.get('account', '')).strip(), data.get('password', '')
                if not account or not isinstance(password, str) or not password:
                    raise Problem('请填写学校账号和密码')
                result = api.login(account, password)
                session.tickets.clear()
                session.conflict_confirmations.clear()
                session.account = str((result.get('identity') or {}).get('account') or account)
                data.clear()
            elif self.path in ('/api/logout','/api/clear-sessions'):
                if self.path == '/api/clear-sessions':
                    BROWSER.invalidate(self.sid)
                    if session.account:
                        with session.academic_lock:ACADEMIC.clear(session.account)
                api.http.close()
                session.official = Official()
                session.tickets.clear()
                session.conflict_confirmations.clear()
                session.account = ''
                BROWSER.invalidate(self.sid)
                result = {'message': '已清除本地登录会话'}
            elif not api.auth:
                raise Problem('请先登录学校账号', 401)
            elif self.path == '/api/overview':
                result = api.overview()
                session.account = str((result.get('identity') or {}).get('account') or session.account)
            elif self.path == '/api/academic/state':
                result = ACADEMIC.state(session.account, 'cached' if ACADEMIC.load(session.account) else 'not_connected')
            elif self.path == '/api/academic/browser-start':
                entry=str(data.get('entry',''))
                if not re.fullmatch(r'[A-Za-z0-9-]{16,80}',entry):raise Problem('页面同步标识无效')
                if data.get('transport','edge')!='edge':raise Problem('扩展登录已移除，请使用 Edge 登录教务')
                result=BROWSER.start_edge(self.sid,session.account,entry)
            elif self.path == '/api/academic/browser-state':
                result=BROWSER.result(self.sid,session.account,str(data.get('jobId','')))
            elif self.path == '/api/academic/sync':
                entry = str(data.get('entry', ''))
                if not re.fullmatch(r'[A-Za-z0-9-]{16,80}', entry):
                    raise Problem('页面同步标识无效')
                result = ACADEMIC.state(session.account,'needs_browser','请从登录设置连接默认浏览器后同步')
            elif self.path == '/api/week':
                result = api.availability(int(data['week']))
            elif self.path == '/api/course-details':
                name=data.get('name')
                if not isinstance(name,str) or not name.strip() or len(name)>200:raise Problem('实验名称无效')
                result=api.course_details(name)
            elif self.path == '/api/prepare':
                action = data.get('action')
                if action not in ('add', 'cancel'):
                    raise Problem('操作无效')
                overview = api.overview()
                session.account = str((overview.get('identity') or {}).get('account') or session.account)
                if action == 'add':
                    candidates = api.availability(int(data['week']))['slots']
                    item = next((x for x in candidates if same_course(x, data)), None)
                    if not item or item.get('remaining', 0) <= 0:
                        raise Problem('此场次已无名额，请刷新')
                    if any(x['name'] == item['name'] for x in overview['enrolled']):
                        raise Problem('你已经选过该实验，请核对我的课表')
                    if any(x['week'] == item['week'] and x['time'] == item['time'] for x in overview['enrolled']):
                        raise Problem('该场次与已选实验时间冲突')
                    guide = data.get('guide') is True
                    teacher = data.get('expectedTeacher', '') if guide else ''
                    proof = None
                    if guide:
                        reason = eligible(item, overview)
                        if reason:raise Problem(reason)
                        if not exact_teacher(api, item, teacher):raise Problem('此场次教师信息已变化或无法唯一核实，请刷新',409)
                    snapshot = ACADEMIC.load(session.account)
                    course = timetable_conflict(snapshot, item, overview['enrolled'], overview.get('calendarAnchor'))
                    if course:
                        if guide:
                            proof = accept_conflict(session, data.get('academicConflictToken'), item, snapshot, teacher)
                            if not proof:
                                token = issue_conflict(session, item, snapshot, teacher)
                                raise Problem(f"与教务课程「{course['name']}」{course['start']}–{course['end']} 冲突",409,
                                              code='ACADEMIC_CONFLICT',conflictToken=token,conflict=course)
                        else:raise Problem(f"与教务课程「{course['name']}」{course['start']}–{course['end']} 冲突")
                    if sum(x['hours'] for x in overview['enrolled'] if x['week'] == item['week']) + item['hours'] > overview['rules']['weeklyHourLimit']:
                        raise Problem('此周会超过官网每周学时上限')
                    api.prepare_add(item)
                else:
                    item = next((x for x in overview['enrolled'] if same_course(x, data)), None)
                    if not item:
                        raise Problem('官网当前不允许取消该项实验')
                    reason=cancel_reason(item,overview['enrolled'],overview.get('calendarAnchor'))
                    if reason:raise Problem(reason)
                token = secrets.token_urlsafe(24)
                session.tickets = {token: dict(action=action, item=item, enrolled=overview['enrolled'], calendarAnchor=overview.get('calendarAnchor'), expires=time.monotonic()+120, guide=(action=='add' and data.get('guide') is True), expectedTeacher=(teacher if action=='add' else ''), academicProof=(proof if action=='add' else None))}
                result = dict(ticket=token, item=item, action=action, expiresIn=120)
            elif self.path == '/api/commit':
                ticket = session.tickets.pop(data.get('ticket', ''), None)
                if not ticket or ticket['expires'] < time.monotonic():
                    raise Problem('确认已过期或已提交，请刷新后重新选择')
                if ticket['action'] == 'add':
                    if ticket.get('guide'):
                        latest = api.overview()
                        candidates = api.availability(int(ticket['item']['week']))['slots']
                        current = next((x for x in candidates if same_course(x,ticket['item'])),None)
                        if not current:raise Problem('此场次已无名额，请刷新',409)
                        reason = eligible(current,latest)
                        if reason:raise Problem(reason,409)
                        if not exact_teacher(api,current,ticket.get('expectedTeacher','')):raise Problem('教师安排已变化，请重新选择',409)
                        ticket['item']=current;ticket['enrolled']=latest['enrolled'];ticket['calendarAnchor']=latest.get('calendarAnchor')
                    snapshot=ACADEMIC.load(session.account)
                    course = timetable_conflict(snapshot, ticket['item'], ticket.get('enrolled', []), ticket.get('calendarAnchor'))
                    if course and not (ticket.get('guide') and proof_valid(ticket.get('academicProof'),ticket['item'],snapshot)):
                        raise Problem(f"教务课表已更新，与「{course['name']}」{course['start']}–{course['end']} 冲突，请重新选择",409)
                else:
                    latest=api.overview()
                    current=next((x for x in latest['enrolled'] if same_course(x,ticket['item'])),None)
                    if not current:raise Problem('官网已选课表已变化，请刷新',409)
                    reason=cancel_reason(current,latest['enrolled'],latest.get('calendarAnchor'))
                    if reason:raise Problem(reason,409)
                    ticket['item']=current
                mutation_started = True
                result = api.mutate(ticket['action'], ticket['item'])
            else:
                raise Problem('接口不存在', 404)
            self.send(result)
        except Problem as exc:
            self.send({'error': str(exc), 'needsRefresh': mutation_started, **exc.details}, exc.status)
        except requests.RequestException:
            self.send({'error': ('提交结果尚未确认，请刷新我的课表核对，勿重复提交。' if mutation_started else '学校服务连接失败或超时，请稍后重试。'), 'needsRefresh': mutation_started}, 502)
        except (ValueError, KeyError, TypeError):
            self.send({'error': '请求或官网数据格式异常，请刷新核对。', 'needsRefresh': mutation_started}, 400)
        except Exception:
            self.send({'error': '本地服务处理失败，请刷新核对；没有自动重试提交。', 'needsRefresh': mutation_started}, 500)
        finally:
            operation_lock.release()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8187)
    args = parser.parse_args()
    service = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'Course UI: http://127.0.0.1:{service.server_port}/', flush=True)
    service.serve_forever()
