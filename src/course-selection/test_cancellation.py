import unittest
from datetime import datetime, timedelta
from unittest.mock import patch
from cancellation import cancel_reason, apply_cancellation, CST


class CancellationTests(unittest.TestCase):
    def setUp(self):
        self.start=datetime(2030,1,10,15,55,tzinfo=CST)
        self.item=dict(name='实验',week=2,date='2030/1/10',time='星期四下午15:55-18:10',cancellable=True)

    def test_threshold_in_china_time(self):
        self.assertEqual(cancel_reason(self.item,now=self.start-timedelta(hours=72,seconds=1)),'')
        for now in [self.start-timedelta(hours=72),self.start-timedelta(hours=71)]:
            self.assertIn('72小时',cancel_reason(self.item,now=now))
        for now in [self.start,self.start+timedelta(days=1)]:
            self.assertEqual(cancel_reason(self.item,now=now),'已开始')
        self.assertEqual(cancel_reason(self.item,now=(self.start-timedelta(hours=73)).astimezone(__import__('datetime').timezone.utc)),'')

    def test_unknown_and_school_restrictions_are_not_bypassed(self):
        unknown=dict(self.item,date=None)
        self.assertEqual(cancel_reason(unknown,now=self.start-timedelta(days=4)),'实验时间待核实')
        invalid=dict(self.item,date='not a date')
        self.assertEqual(cancel_reason(invalid),'实验时间待核实')
        blocked=dict(self.item,cancellable=False)
        self.assertIn('官网',cancel_reason(blocked,now=self.start-timedelta(days=4)))

    def test_reapplying_preserves_official_permission(self):
        rows=[dict(self.item)]
        apply_cancellation(rows,now=self.start-timedelta(days=4));self.assertTrue(rows[0]['cancellable'])
        apply_cancellation(rows,now=self.start-timedelta(days=2));self.assertFalse(rows[0]['cancellable'])
        self.assertTrue(rows[0]['officialCancellable'])


if __name__=='__main__':unittest.main()
