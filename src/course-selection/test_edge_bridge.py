import tempfile,threading,time,unittest,copy
from academic import AcademicManager
from academic_bridge import BrowserBridge
from test_academic import raw,ACCOUNT
class EdgeBridgeTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.manager=AcademicManager(self.tmp.name);self.bridge=BrowserBridge(self.manager)
 def wait(self,job):
  for _ in range(200):
   result=self.bridge.result('owner',ACCOUNT,job['jobId'])
   if result['done']:return result
   time.sleep(.005)
  self.fail('reader did not finish')
 def test_edge_reads_into_same_validated_cache_without_extension(self):
  calls=[]
  def reader(account,profile,interactive,transport=None,on_progress=None):calls.append((account,profile.name,interactive,transport));return raw()
  self.manager.read_official=reader
  job=self.bridge.start_edge('owner',ACCOUNT,'entry');self.assertIsNone(job['connectPath']);self.assertEqual(self.wait(job)['status'],'fresh');self.assertEqual(calls,[(ACCOUNT,'edge-browser',True,'edge')])
 def test_failure_preserves_previous_and_finishes(self):
  self.manager.accept_browser(ACCOUNT,raw());previous=copy.deepcopy(self.manager.load(ACCOUNT));self.manager.read_official=lambda *a,**k:dict(ok=False,code='edge_missing')
  result=self.wait(self.bridge.start_edge('owner',ACCOUNT,'entry'));self.assertEqual(result['status'],'stale');self.assertIn('Edge',result['message']);self.assertEqual(self.manager.load(ACCOUNT),previous)
 def test_logout_during_edge_read_cannot_write_cache(self):
  started=threading.Event();release=threading.Event();finished=threading.Event()
  def reader(*a,**k):
   started.set();release.wait(2);finished.set();return raw()
  self.manager.read_official=reader;self.bridge.start_edge('owner',ACCOUNT,'entry');self.assertTrue(started.wait(1));self.bridge.invalidate('owner');release.set();self.assertTrue(finished.wait(1));time.sleep(.03);self.assertIsNone(self.manager.load(ACCOUNT))

 def test_wrong_identity_completes_without_overwriting(self):
  self.manager.accept_browser(ACCOUNT,raw());previous=copy.deepcopy(self.manager.load(ACCOUNT));bad=raw();bad['account']='99999999'
  self.manager.read_official=lambda *a,**k:bad
  result=self.wait(self.bridge.start_edge('owner',ACCOUNT,'entry'));self.assertEqual(result['status'],'stale');self.assertEqual(self.manager.load(ACCOUNT),previous)

 def test_progress_tracks_real_steps_and_is_ignored_after_logout(self):
  paused=threading.Event();release=threading.Event();callbacks=[]
  def reader(*a,on_progress=None,**k):
   callbacks.append(on_progress);on_progress(dict(stage='authenticated',step=1));on_progress(dict(stage='reading',step=3,page=2));paused.set();release.wait(2);return raw()
  self.manager.read_official=reader;job=self.bridge.start_edge('owner',ACCOUNT,'entry');self.assertTrue(paused.wait(1))
  state=self.bridge.result('owner',ACCOUNT,job['jobId']);self.assertFalse(state['done']);self.assertEqual(state['progress'],dict(stage='reading',step=3,page=2,authenticated=True))
  self.bridge.invalidate('owner');before=self.bridge.jobs[job['jobId']]['progress'].copy();callbacks[0](dict(stage='validating',step=5));self.assertEqual(self.bridge.jobs[job['jobId']]['progress'],before);release.set()

 def test_helper_progress_stream_is_delivered_before_final_result(self):
  import io,json,sys
  from unittest.mock import patch
  lines='ACADEMIC_PROGRESS:'+json.dumps(dict(stage='reading',step=3,page=2))+'\nACADEMIC_RESULT:'+json.dumps(dict(ok=False,code='cancelled'))+'\n'
  class Process:
   stdout=io.StringIO(lines)
   def __enter__(self):return self
   def __exit__(self,*args):pass
   def wait(self):return 0
   def kill(self):pass
  progress=[]
  with patch.dict('os.environ',{'LAB_COURSE_ELECTRON':sys.executable}),patch('academic.subprocess.Popen',return_value=Process()) as spawn:
   result=AcademicManager.read_official(ACCOUNT,self.manager.account_dir(ACCOUNT)/'edge-browser',True,transport='edge',on_progress=progress.append)
  self.assertEqual(progress,[dict(stage='reading',step=3,page=2)]);self.assertEqual(result['code'],'cancelled')
  self.assertIn('timetable_reader.js',spawn.call_args.kwargs['env']['LAB_COURSE_READER_CONFIG'])
