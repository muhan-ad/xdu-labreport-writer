"""Local cancellation policy in China standard time, independent of host timezone."""
from datetime import datetime, timedelta, timezone
from academic import experiment_interval

CST = timezone(timedelta(hours=8))


def cancel_reason(item, enrolled=(), calendar_anchor=None, now=None):
    try:
        interval = experiment_interval(item, enrolled, calendar_anchor)
        if not interval:
            return '实验时间待核实'
        start = datetime.fromisoformat(interval['date']+'T'+interval['start']).replace(tzinfo=CST)
    except (ValueError, TypeError, KeyError):
        return '实验时间待核实'
    current = now or datetime.now(CST)
    if current.tzinfo is None:
        current = current.replace(tzinfo=CST)
    if start <= current:
        return '已开始'
    if start-current <= timedelta(hours=72):
        return '距开始不足72小时（含72小时）'
    if not item.get('officialCancellable', item.get('cancellable', False)):
        return '官网当前不允许取消'
    return ''


def apply_cancellation(items, calendar_anchor=None, now=None):
    for item in items:
        item['officialCancellable'] = item.get('officialCancellable', item.get('cancellable', False))
        item['cancelReason'] = cancel_reason(item, items, calendar_anchor, now)
        item['cancellable'] = not item['cancelReason']
    return items
