"""Live guide selection checks and session-bound academic-conflict acknowledgements."""
import hashlib
import json
import re
import secrets
import time
from datetime import datetime
from academic import experiment_interval


def fingerprint(snapshot):
    return hashlib.sha256(json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def item_key(item):
    return [str(item[k]) for k in ('name', 'week', 'time')]


def issue_conflict(session, item, snapshot, teacher=''):
    token = secrets.token_urlsafe(32)
    session.conflict_confirmations = {token: dict(item=item_key(item), snapshot=fingerprint(snapshot),
                                               teacher=teacher, expires=time.monotonic()+120)}
    return token


def accept_conflict(session, token, item, snapshot, teacher=''):
    proof = session.conflict_confirmations.pop(token, None) if isinstance(token, str) else None
    return proof if (proof and proof['expires'] > time.monotonic() and proof['item'] == item_key(item)
                     and proof['snapshot'] == fingerprint(snapshot) and proof['teacher'] == teacher) else None


def proof_valid(proof, item, snapshot):
    return bool(proof and proof['expires'] > time.monotonic() and proof['item'] == item_key(item)
                and proof['snapshot'] == fingerprint(snapshot))


def eligible(item, overview):
    if not isinstance(item.get('remaining'), (int, float)) or item['remaining'] <= 0:
        return '此场次已无名额，请刷新'
    if item['week'] not in overview.get('allowedWeeks', overview['weeks']) or item['week'] < overview['currentWeek']:
        return '官网当前不允许选择此周次'
    interval = experiment_interval(item, overview['enrolled'], overview.get('calendarAnchor'))
    if not interval:
        return '场次日期无法核实，请刷新'
    if datetime.fromisoformat(interval['date']+'T'+interval['start']) <= datetime.now():
        return '此场次已经开始，不能选择'
    if any(x['name'] == item['name'] for x in overview['enrolled']):
        return '你已经选过该实验，请核对我的课表'
    if any(x['week'] == item['week'] and x['time'] == item['time'] for x in overview['enrolled']):
        return '该场次与已选实验时间冲突'
    if sum(x['hours'] for x in overview['enrolled'] if x['week'] == item['week'])+item['hours'] > overview['rules']['weeklyHourLimit']:
        return '此周会超过官网每周学时上限'
    return ''


def exact_teacher(api, item, expected):
    if not expected:
        return True
    if not isinstance(expected, str) or len(expected) > 60:
        return False
    details = api.course_details(item['name'])
    norm = lambda s: re.sub(r'\s+', '', str(s)).replace('天', '日').replace('—', '-').replace('–', '-')
    names = set()
    for row in details.get('schedules', []):
        if norm(row['time']) != norm(item['time']) or not row['firstWeek'] <= item['week'] <= row['lastWeek']:
            continue
        if row.get('parity') in ('单周', '单') and item['week'] % 2 == 0:
            continue
        if row.get('parity') in ('双周', '双') and item['week'] % 2 == 1:
            continue
        names.update(n.strip() for n in re.split(r'[／、,，]', row['teacher']) if n.strip())
    return names == {expected}
