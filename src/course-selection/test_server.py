import copy
import importlib.util
from pathlib import Path
import threading
import unittest
from unittest.mock import Mock
import requests

spec = importlib.util.spec_from_file_location('course_server', Path(__file__).with_name('server.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

ITEM = dict(name='测试实验', week=7, time='星期四下午15:55-18:10', hours=3, day=4, period='B')


class ParserTests(unittest.TestCase):
    def test_aspnet_id_is_not_submission_name(self):
        page = m.soup('<form><select id="Header2_ExpeWeekList" name="Header2$ExpeWeekList"><option value="7">7</option></select><input type="image" id="Header2_btnSubmit" name="Header2$btnSubmit"></form>')
        self.assertEqual(m.options(page,'Header2_ExpeWeekList')[0]['value'],'7')
        self.assertEqual(m.control_name(page,'Header2_ExpeWeekList'),'Header2$ExpeWeekList')
        self.assertEqual(m.control_name(page,'Header2_btnSubmit'),'Header2$btnSubmit')

    def test_locale_date_is_normalized(self):
        self.assertEqual(m.normalize_date('10/14/2026'),'2026/10/14')
        self.assertEqual(m.normalize_date('2026/10/14'),'2026/10/14')

    def test_form_keeps_fresh_state_and_only_checked_radios(self):
        page = m.soup('<form><input type="hidden" name="__VIEWSTATE" value="fresh">'
                      '<input type="radio" name="a" value="wrong"><input type="radio" name="a" value="right" checked>'
                      '<input type="image" name="submit"><select name="week" size="8"><option value="7">7</option></select></form>')
        self.assertEqual(m.form_data(page), {'__VIEWSTATE':'fresh', 'a':'right'})

    def test_availability_parses_week_slots_and_remaining_without_capacity_confusion(self):
        page = m.soup('第 7 周可选<table><tr><td>测试实验（3学时）(35人)</td><td>星期四下午15:55-18:10 (2) 星期五晚上18:30-20:45 (1)</td></tr></table>')
        result = m.parse_availability(page, 7)
        self.assertEqual([x['remaining'] for x in result['slots']], [2,1])
        self.assertEqual(result['slots'][0]['name'], '测试实验')
        self.assertEqual(result['slots'][1]['period'], 'C')
        with self.assertRaises(m.Problem): m.parse_availability(page, 8)

    def test_missing_table_fails_closed(self):
        with self.assertRaises(m.Problem): m.parse_availability(m.soup('第 7 周可选 出错了'),7)
        with self.assertRaises(m.Problem): m.parse_enrolled(m.soup('学校维护'))

    def test_cancellable_uses_row_radio(self):
        page = m.soup('取消<table><tr><td>1</td><td>测试实验</td><td>7</td><td>星期四下午15:55-18:10</td><td>3</td><td><input type="radio" name="MyList$ctl02$delcheck" value="rb"></td></tr></table>')
        self.assertEqual(m.parse_cancellable(page)[0]['radio'], 'MyList$ctl02$delcheck')

    def test_post_uses_native_image_coordinates_and_postback(self):
        official=m.Official()
        official.request=Mock(return_value=m.soup('ok'))
        official.post('student/addexpe.aspx',m.soup('<form><input name="__VIEWSTATE" type="hidden" value="new"></form>'), {'ExpeNameList':'B01'},button='btnAdd')
        payload=official.request.call_args.args[1]
        self.assertEqual(payload['__VIEWSTATE'],'new')
        self.assertEqual(payload['btnAdd.x'],'8')
        self.assertEqual(payload['ExpeNameList'],'B01')

    def test_add_only_succeeds_after_official_enrollment_readback(self):
        official=m.Official()
        official.prepare_add=Mock(return_value=(m.soup('<form></form>'),{}))
        official.post=Mock(return_value=m.soup('<span>选课成功</span>'))
        official.overview=Mock(side_effect=[{'enrolled':[]},{'enrolled':[ITEM]}])
        self.assertEqual(official.mutate('add',ITEM)['message'],'选课成功')
        official.overview=Mock(side_effect=[{'enrolled':[]},{'enrolled':[]}])
        with self.assertRaises(m.Problem): official.mutate('add',ITEM)

    def test_duplicate_does_not_submit(self):
        official=m.Official(); official.overview=Mock(return_value={'enrolled':[ITEM]});official.post=Mock()
        with self.assertRaises(m.Problem): official.mutate('add',ITEM)
        official.post.assert_not_called()

    def test_cancel_requires_current_eligible_record_and_readback(self):
        official=m.Official();official.overview=Mock(side_effect=[{'enrolled':[ITEM]},{'enrolled':[]}])
        official.request=Mock(return_value=m.soup('取消<table><tr><td>1</td><td>测试实验</td><td>7</td><td>星期四下午15:55-18:10</td><td>3</td><td><input type="radio" name="row" value="rb"></td></tr></table>'))
        official.post=Mock(return_value=m.soup('成功'))
        self.assertEqual(official.mutate('cancel',ITEM)['message'],'已取消选课')
        self.assertEqual(official.post.call_args.args[2],{'row':'rb'})


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=m.ThreadingHTTPServer(('127.0.0.1',0),m.Handler)
        cls.base=f'http://127.0.0.1:{cls.server.server_port}'
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
    @classmethod
    def tearDownClass(cls): cls.server.shutdown();cls.server.server_close()
    def setUp(self):
        self.http=requests.Session(); self.http.trust_env=False
        response=self.http.get(self.base+'/api/session');self.csrf=response.json()['csrf']
        self.headers={'Origin':self.base,'X-CSRF-Token':self.csrf}
        self.local=m.SESSIONS[self.http.cookies[f'course_sid_{self.server.server_port}']]
    def test_cookie_is_port_scoped(self):
        self.assertIn(f'course_sid_{self.server.server_port}',self.http.cookies)
        self.assertNotIn('course_sid',self.http.cookies)
    def test_cross_origin_and_missing_csrf_rejected(self):
        self.assertEqual(self.http.post(self.base+'/api/login',json={},headers={'Origin':'https://evil.example'}).status_code,403)
        self.assertEqual(self.http.post(self.base+'/api/login',json={},headers={'Origin':self.base}).status_code,403)
        self.assertEqual(self.http.get(self.base+'/',headers={'Host':'evil.example'}).status_code,403)
    def test_static_allowlist_blocks_data_and_source(self):
        for path in ['/server.py','/学校实验选课数据.json','/../work/course-data/enrolled.json']:
            self.assertEqual(self.http.get(self.base+path).status_code,404)
    def test_unauthenticated_query_rejected(self):
        self.assertEqual(self.http.post(self.base+'/api/week',json={'week':7},headers=self.headers).status_code,401)
    def test_ticket_is_one_use_and_timeout_is_not_success(self):
        self.local.official.auth=True
        self.local.tickets['once']={'action':'add','item':ITEM,'expires':m.time.monotonic()+60}
        self.local.official.mutate=Mock(side_effect=requests.Timeout())
        response=self.http.post(self.base+'/api/commit',json={'ticket':'once'},headers=self.headers)
        self.assertEqual(response.status_code,502);self.assertTrue(response.json()['needsRefresh'])
        again=self.http.post(self.base+'/api/commit',json={'ticket':'once'},headers=self.headers)
        self.assertEqual(again.status_code,400);self.local.official.mutate.assert_called_once()
    def test_expired_ticket_does_not_submit(self):
        self.local.official.auth=True;self.local.official.mutate=Mock()
        self.local.tickets['old']={'action':'cancel','item':ITEM,'expires':0}
        self.assertEqual(self.http.post(self.base+'/api/commit',json={'ticket':'old'},headers=self.headers).status_code,400)
        self.local.official.mutate.assert_not_called()

    def test_academic_login_required_does_not_logout_experiment_session(self):
        from unittest.mock import patch
        self.local.official.auth=True;self.local.account='12345678901'
        with patch.object(m.ACADEMIC,'sync',return_value=dict(status='needs_login',snapshot=None)):
            response=self.http.post(self.base+'/api/academic/sync',json={'entry':'test-entry-123456789'},headers=self.headers)
        self.assertEqual(response.status_code,200);self.assertTrue(self.local.official.auth)

    def test_latest_academic_conflict_blocks_commit_before_mutation(self):
        from unittest.mock import patch
        self.local.official.auth=True;self.local.official.mutate=Mock()
        self.local.tickets['clash']={'action':'add','item':dict(ITEM,date='2026/10/22'),'expires':m.time.monotonic()+60}
        snapshot={'events':[dict(name='普通课程',date='2026-10-22',start='16:00',end='17:30')]}
        with patch.object(m.ACADEMIC,'load',return_value=snapshot):
            response=self.http.post(self.base+'/api/commit',json={'ticket':'clash'},headers=self.headers)
        self.assertEqual(response.status_code,409);self.local.official.mutate.assert_not_called()

    def test_academic_sync_does_not_hold_physics_request_lock(self):
        from unittest.mock import patch
        self.local.official.auth=True;self.local.account='12345678901'
        self.local.lock.acquire()
        try:
            with patch.object(m.ACADEMIC,'sync',return_value=dict(status='fresh',snapshot=None)):
                response=self.http.post(self.base+'/api/academic/sync',json={'entry':'test-entry-123456789'},headers=self.headers)
            self.assertEqual(response.status_code,200)
        finally:self.local.lock.release()

    def test_academic_conflict_blocks_prepare_before_school_form_post(self):
        from unittest.mock import patch
        self.local.official.auth=True
        self.local.official.overview=Mock(return_value=dict(identity={'account':'12345678901'},enrolled=[],rules={'weeklyHourLimit':9}))
        item=dict(ITEM,date='2026/10/22',remaining=1)
        self.local.official.availability=Mock(return_value={'slots':[item]})
        self.local.official.prepare_add=Mock()
        snapshot={'events':[dict(name='普通课程',date='2026-10-22',start='16:00',end='17:30')]}
        with patch.object(m.ACADEMIC,'load',return_value=snapshot):
            response=self.http.post(self.base+'/api/prepare',json=dict(item,action='add'),headers=self.headers)
        self.assertEqual(response.status_code,400);self.assertIn('普通课程',response.json()['error'])
        self.local.official.prepare_add.assert_not_called()
    def test_late_evening_class_blocks_prepare_and_commit_even_after_lab_end(self):
        from unittest.mock import patch
        self.local.official.auth=True;self.local.account='12345678901'
        self.local.official.overview=Mock(return_value=dict(identity={'account':'12345678901'},enrolled=[],rules={'weeklyHourLimit':9}))
        item=dict(ITEM,date='2026/10/22',time='星期四晚上18:30-20:45')
        self.local.official.availability=Mock(return_value={'slots':[item]});self.local.official.prepare_add=Mock();self.local.official.mutate=Mock()
        self.local.tickets['late']={'action':'add','item':item,'expires':m.time.monotonic()+60}
        snapshot={'events':[dict(name='晚间课程',date='2026-10-22',start='20:50',end='21:25')]}
        with patch.object(m.ACADEMIC,'load',return_value=snapshot):
            response=self.http.post(self.base+'/api/prepare',json=dict(item,action='add'),headers=self.headers)
            self.assertEqual(response.status_code,400)
            response=self.http.post(self.base+'/api/commit',json={'ticket':'late'},headers=self.headers)
            self.assertEqual(response.status_code,409)
        self.local.official.prepare_add.assert_not_called();self.local.official.mutate.assert_not_called()


if __name__=='__main__': unittest.main()
