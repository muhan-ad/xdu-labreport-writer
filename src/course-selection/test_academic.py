import copy
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import Mock
from academic import AcademicManager,normalise,experiment_interval,timetable_conflict

ACCOUNT='12345678901'
COURSE=dict(KCM='高等数学',KCH='MATH',KXH='01',SKZC='111',SKXQ='4',KSJC='7',JSJC='8',JASMC='A101')
def raw():return dict(ok=True,account=ACCOUNT,semester='2026-2027-1',calendar={'XQKSRQ':'2026-09-07'},courses=[copy.deepcopy(COURSE)],changes=[],notArranged=[])
ENROLLED=[dict(name='已有实验',week=2,date='2026/9/15',time='星期二晚上18:30-20:45')]
ITEM=dict(name='新实验',week=2,time='星期四下午15:55-18:10')

class AcademicTests(unittest.TestCase):
 def test_personal_free_time_windows_and_boundaries(self):
  afternoon=dict(ITEM,date='2026/9/17');evening=dict(afternoon,time='星期四晚上18:30-20:45')
  for item,cases in [(afternoon,[('14:00','15:55',False),('15:55','16:40',True),('17:29','18:10',True),('17:30','18:10',False)]),(evening,[('18:00','19:00',False),('19:00','19:45',True),('20:50','21:25',True),('21:25','22:00',False)])]:
   for start,end,expected in cases:
    with self.subTest(time=item['time'],start=start):
     snapshot={'events':[dict(name='普通课程',date='2026-09-17',start=start,end=end)]}
     self.assertEqual(bool(timetable_conflict(snapshot,item,[])),expected)
     snapshot['events'][0]['date']='2026-09-24';self.assertIsNone(timetable_conflict(snapshot,item,[]))
 def test_mask_dates_and_periods(self):
  result=normalise(raw(),ACCOUNT)
  self.assertTrue(result['complete']);self.assertEqual([x['date'] for x in result['events']],['2026-09-10','2026-09-17','2026-09-24'])
  self.assertEqual((result['events'][0]['start'],result['events'][0]['end']),('15:55','17:30'))
 def test_reschedule_stop_makeup(self):
  data=raw();data['changes']=[dict(COURSE,TKLXDM='01',SKZC='010',XSKZC='001',XSKXQ='5',XKSJC='9',XJSJC='10'),dict(COURSE,TKLXDM='02',SKZC='100')]
  result=normalise(data,ACCOUNT);self.assertTrue(result['complete'])
  self.assertEqual([(x['date'],x['start']) for x in result['events']],[('2026-09-24','15:55'),('2026-09-25','19:00')])
  data['changes'].insert(0,dict(COURSE,TKLXDM='03',XSKZC='100',XSKXQ='6',XKSJC='1',XJSJC='2'))
  self.assertEqual(len(normalise(data,ACCOUNT)['events']),3)
 def test_chained_changes_oldest_first(self):
  data=raw();data['courses'][0]['SKZC']='100'
  first=dict(COURSE,TKLXDM='01',SKZC='100',XSKZC='010',XSKXQ='4',XKSJC='7',XJSJC='8')
  second=dict(first,SKZC='010',XSKZC='001')
  data['changes']=[second,first]
  self.assertEqual([x['date'] for x in normalise(data,ACCOUNT)['events']],['2026-09-24'])
 def test_bad_changes_and_period_are_incomplete(self):
  data=raw();data['changes']=[dict(COURSE,TKLXDM='??')]
  self.assertFalse(normalise(data,ACCOUNT)['complete'])
  data=raw();data['courses'][0]['KSJC']='12'
  self.assertFalse(normalise(data,ACCOUNT)['complete'])
 def test_wrong_identity_and_calendar_rejected(self):
  data=raw();data['courses'][0]['XH']='99999999999'
  with self.assertRaises(ValueError):normalise(data,ACCOUNT)
  data=raw();data['calendar']['XQKSRQ']='2026-09-08'
  with self.assertRaises(ValueError):normalise(data,ACCOUNT)
 def test_date_anchor_not_week_number(self):
  self.assertEqual(experiment_interval(ITEM,ENROLLED)['date'],'2026-09-17')
  self.assertEqual(experiment_interval(ITEM,[],dict(week=2,date='2026/9/16',time='星期三00:00-00:01'))['date'],'2026-09-17')
  self.assertIsNone(experiment_interval(ITEM,[]))
 def test_overlap_boundary_and_date(self):
  snapshot=normalise(raw(),ACCOUNT)
  self.assertEqual(timetable_conflict(snapshot,ITEM,ENROLLED)['name'],'高等数学')
  self.assertIsNone(timetable_conflict(snapshot,dict(ITEM,time='星期四晚上17:30-20:45'),ENROLLED))
  self.assertIsNone(timetable_conflict(snapshot,dict(ITEM,week=4),ENROLLED))
 def test_only_exact_booked_physics_is_deduplicated(self):
  event=dict(name='大学物理实验',date='2026-09-15',start='18:30',end='20:45')
  item=dict(name='新实验',week=2,time='星期二晚上18:30-20:45')
  self.assertIsNone(timetable_conflict({'events':[event]},item,ENROLLED))
  event['name']='电子技术实验';self.assertIsNotNone(timetable_conflict({'events':[event]},item,ENROLLED))
 def test_cache_restart_failure_and_account_isolation(self):
  with tempfile.TemporaryDirectory() as path:
   reader=Mock(return_value=raw());manager=AcademicManager(path,reader)
   self.assertEqual(manager.sync(ACCOUNT,'entry1')['status'],'fresh')
   manager.sync(ACCOUNT,'entry1');reader.assert_called_once()
   manager.sync(ACCOUNT,'entry2');self.assertEqual(reader.call_count,2)
   later=AcademicManager(path,Mock(return_value={'ok':False,'code':'needs_login'}))
   failed=later.sync(ACCOUNT,'entry3');self.assertEqual(failed['status'],'needs_login');self.assertEqual(len(failed['snapshot']['events']),3)
   self.assertIsNone(later.load('99999999999'))
   self.assertNotIn('password',Path(manager.account_dir(ACCOUNT)/'timetable.json').read_text(encoding='utf-8'))
 def test_clear_forgets_timetable_and_rotates_only_own_profile(self):
  with tempfile.TemporaryDirectory() as path:
   manager=AcademicManager(path,Mock(return_value=raw()))
   manager.sync(ACCOUNT,'entry1');old=manager.browser_profile(ACCOUNT)
   other=manager.browser_profile('99999999999')
   manager.clear(ACCOUNT)
   self.assertIsNone(manager.load(ACCOUNT))
   self.assertNotEqual(manager.browser_profile(ACCOUNT),old)
   self.assertEqual(AcademicManager(path).browser_profile(ACCOUNT),manager.browser_profile(ACCOUNT))
   self.assertEqual(manager.browser_profile('99999999999'),other)
   self.assertFalse(any(key[0]==ACCOUNT for key in manager.entries))
 def test_partial_refresh_preserves_good_cache(self):
  with tempfile.TemporaryDirectory() as path:
   reader=Mock(return_value=raw());manager=AcademicManager(path,reader);first=manager.sync(ACCOUNT,'one')['snapshot']
   invalid=raw();invalid['courses'][0]['KSJC']='12';reader.return_value=invalid
   result=manager.sync(ACCOUNT,'two');self.assertEqual(result['status'],'stale');self.assertEqual(result['snapshot'],first)
 def test_parallel_entries_join_one_read(self):
  with tempfile.TemporaryDirectory() as path:
   started=threading.Event();release=threading.Event()
   def read(*args):started.set();release.wait(3);return raw()
   reader=Mock(side_effect=read);manager=AcademicManager(path,reader)
   with ThreadPoolExecutor(2) as pool:
    first=pool.submit(manager.sync,ACCOUNT,'one');started.wait(2)
    second=pool.submit(manager.sync,ACCOUNT,'two');release.set()
    self.assertEqual(first.result()['snapshot'],second.result()['snapshot'])
   self.assertEqual(reader.call_count,1)

if __name__=='__main__':unittest.main()
