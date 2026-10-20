import copy,json,tempfile,threading,unittest,http.client,secrets
from http.server import ThreadingHTTPServer
from unittest.mock import Mock
from academic import AcademicManager,timetable_conflict
from academic_bridge import BrowserBridge,BridgeError
from test_academic import raw,ACCOUNT,ITEM,ENROLLED
import server as service

class BridgeTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.now=100
  self.manager=AcademicManager(self.temp.name);self.bridge=BrowserBridge(self.manager,lambda:self.now)
 def start(self,owner='owner',account=ACCOUNT):
  job=self.bridge.start(owner,account,'entry-1234567890123456',True);return job,job['connectPath'].split('#')[1]
 def test_requires_interactive_connection_and_bound_owner_account(self):
  self.assertEqual(self.bridge.start('a',ACCOUNT,'entry')['status'],'needs_browser')
  job,token=self.start();task=self.bridge.poll(token,'client-12345678901',0);self.assertEqual(task['account'],ACCOUNT)
  with self.assertRaises(BridgeError):self.bridge.result('other',ACCOUNT,job['jobId'])
  with self.assertRaises(BridgeError):self.bridge.result('owner','999999',job['jobId'])
  value=raw();value['account']='999999'
  with self.assertRaises(BridgeError):self.bridge.submit(token,job['jobId'],value)
  self.assertIsNone(self.manager.load(ACCOUNT))
 def test_resume_browser_page_then_import_and_automatic_next_entry(self):
  job,token=self.start();self.assertIsNotNone(self.bridge.poll(token,'client-12345678901',0));self.assertIsNone(self.bridge.poll(token,'client-12345678901',0))
  self.assertIsNotNone(self.bridge.poll(token,'new-client-123456789',0))
  self.bridge.submit(token,job['jobId'],{'ok':False,'code':'needs_login'})
  self.assertFalse(self.bridge.result('owner',ACCOUNT,job['jobId'])['done'])
  self.bridge.submit(token,job['jobId'],raw());state=self.bridge.result('owner',ACCOUNT,job['jobId']);self.assertEqual(state['status'],'fresh')
  self.assertIsNotNone(timetable_conflict(state['snapshot'],ITEM,ENROLLED))
  previous=copy.deepcopy(self.manager.load(ACCOUNT));duplicate=self.bridge.submit(token,job['jobId'],raw());self.assertTrue(duplicate['duplicate']);self.assertEqual(self.manager.load(ACCOUNT),previous)
  nextjob=self.bridge.start('owner',ACCOUNT,'another-entry',False);self.assertIsNone(nextjob['connectPath']);self.assertNotEqual(nextjob['jobId'],job['jobId'])
 def test_invalidate_expiry_and_stale_result_keep_previous_snapshot(self):
  self.manager.accept_browser(ACCOUNT,raw());previous=copy.deepcopy(self.manager.load(ACCOUNT));job,token=self.start()
  invalid=raw();invalid['courses'][0]['KSJC']='99';self.bridge.submit(token,job['jobId'],invalid)
  self.assertEqual(self.bridge.result('owner',ACCOUNT,job['jobId'])['status'],'stale');self.assertEqual(self.manager.load(ACCOUNT),previous)
  job,token=self.start();self.now+=301;self.assertEqual(self.bridge.result('owner',ACCOUNT,job['jobId'])['status'],'stale')
  self.bridge.invalidate('owner')
  with self.assertRaises(BridgeError):self.bridge.poll(token,'client-12345678901',0)
 def test_unexpected_secret_fields_never_enter_cache(self):
  job,token=self.start();value=raw();value['cookies']='NEVER_STORE'
  with self.assertRaises(BridgeError):self.bridge.submit(token,job['jobId'],value)
  value=raw();value['courses'][0]['password']='NEVER_STORE'
  with self.assertRaises(BridgeError):self.bridge.submit(token,job['jobId'],value)
  self.assertIsNone(self.manager.load(ACCOUNT))
 def test_multiple_clients_do_not_repeatedly_steal_one_task(self):
  job,token=self.start();clients=['client-12345678901','client-12345678902']
  for client in clients:self.assertIsNotNone(self.bridge.poll(token,client,0))
  for _ in range(4):
   for client in clients:self.assertIsNone(self.bridge.poll(token,client,0))
 def test_unscheduled_courses_do_not_block_refresh_of_scheduled_weeks(self):
  first=raw();first['notArranged']=[{'KCM':'尚未安排的课程','KCH':'WAIT'}];old=self.manager.accept_browser(ACCOUNT,first)
  self.assertTrue(old['scheduledComplete']);self.assertFalse(old['complete'])
  job,token=self.start();new=copy.deepcopy(first);new['courses'][0]['JASMC']='NEW_ROOM'
  receipt=self.bridge.submit(token,job['jobId'],new);self.assertEqual(receipt['status'],'complete')
  result=self.bridge.result('owner',ACCOUNT,job['jobId']);self.assertEqual(result['status'],'partial');self.assertIn('NEW_ROOM',{e['room'] for e in result['snapshot']['events']})
  self.assertEqual(result['snapshot']['unscheduled'][0]['name'],'尚未安排的课程')
 def test_reconnect_invalidates_old_page_and_renews_job_lifetime(self):
  first,old=self.start();self.now+=299;second,token=self.start()
  self.assertNotEqual(token,old);self.assertNotEqual(first['jobId'],second['jobId'])
  with self.assertRaises(BridgeError) as error:self.bridge.poll(old,'client-12345678901',0)
  self.assertEqual(error.exception.code,'CONNECTION_REPLACED')
  self.now+=2;self.assertIsNotNone(self.bridge.poll(token,'client-12345678901',0))
 def test_validation_error_visible_to_both_pages_without_overwriting_cache(self):
  self.manager.accept_browser(ACCOUNT,raw());previous=copy.deepcopy(self.manager.load(ACCOUNT));job,token=self.start();bad=raw();bad['calendar']['XQKSRQ']='SENSITIVE_CONTENT'
  with self.assertRaises(BridgeError) as error:self.bridge.submit(token,job['jobId'],bad)
  self.assertEqual(error.exception.code,'TIMETABLE_INVALID');self.assertNotIn('SENSITIVE_CONTENT',str(error.exception))
  result=self.bridge.result('owner',ACCOUNT,job['jobId']);self.assertTrue(result['done']);self.assertIn('日期',result['message']);self.assertEqual(self.manager.load(ACCOUNT),previous)

class HTTPTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
  self.old=service.BROWSER;service.BROWSER=BrowserBridge(AcademicManager(self.temp.name));self.addCleanup(setattr,service,'BROWSER',self.old)
  self.http=ThreadingHTTPServer(('127.0.0.1',0),service.Handler);self.thread=threading.Thread(target=self.http.serve_forever,daemon=True);self.thread.start();self.addCleanup(self.http.server_close);self.addCleanup(self.http.shutdown)
  self.origin='http://127.0.0.1:'+str(self.http.server_port)
  status,headers,response=self.request('GET','/api/session');self.cookie=headers['Set-Cookie'].split(';')[0];self.csrf=response['csrf'];self.sid=self.cookie.split('=',1)[1]
  local=service.SESSIONS[self.sid];local.official.auth=True;local.account=ACCOUNT
 def request(self,method,path,data=None,headers=None):
  conn=http.client.HTTPConnection('127.0.0.1',self.http.server_port,timeout=2);conn.request(method,path,body=None if data is None else json.dumps(data),headers=headers or {});r=conn.getresponse();status=r.status;h=dict(r.getheaders());body=json.loads(r.read());conn.close();return status,h,body
 def test_edge_transport_uses_authenticated_local_job(self):
  service.BROWSER.manager.read_official=lambda *a,**k:raw()
  headers={'Origin':self.origin,'Cookie':self.cookie,'X-CSRF-Token':self.csrf,'Content-Type':'application/json'}
  status,_,job=self.request('POST','/api/academic/browser-start',{'entry':'entry-1234567890123456','interactive':True,'transport':'edge'},headers)
  self.assertEqual(status,200);self.assertIsNone(job['connectPath']);self.assertIn('jobId',job)

 def test_extension_routes_removed_and_edge_requires_origin_csrf(self):
  self.assertEqual(self.request('GET','/academic-connect')[0],404)
  for endpoint in ['/api/browser-bridge/poll','/api/browser-bridge/result']:
   status,_,body=self.request('POST',endpoint,{}, {'Origin':self.origin,'Content-Type':'application/json'})
   self.assertEqual(status,410);self.assertEqual(body['code'],'EXTENSION_REMOVED')
  headers={'Origin':self.origin,'Cookie':self.cookie,'X-CSRF-Token':self.csrf,'Content-Type':'application/json'}
  for wrong in [{**headers,'Origin':'https://evil.example'},{**headers,'X-CSRF-Token':'bad'}]:
   self.assertEqual(self.request('POST','/api/academic/browser-start',{'entry':'entry-1234567890123456'},wrong)[0],403)
  self.assertNotEqual(self.request('POST','/api/academic/browser-start',{'entry':'entry-1234567890123456','transport':'extension'},headers)[0],200)
if __name__=='__main__':unittest.main()
