import threading
import unittest
from datetime import datetime, timedelta
from unittest.mock import Mock, patch
import requests
import server as m
from guide_selection import issue_conflict, accept_conflict, proof_valid, eligible, exact_teacher


class GuideSelectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=m.ThreadingHTTPServer(('127.0.0.1',0),m.Handler)
        cls.base=f'http://127.0.0.1:{cls.server.server_port}'
        threading.Thread(target=cls.server.serve_forever,daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close()

    def setUp(self):
        self.http=requests.Session();self.http.trust_env=False
        r=self.http.get(self.base+'/api/session')
        self.headers={'Origin':self.base,'X-CSRF-Token':r.json()['csrf']}
        self.local=m.SESSIONS[self.http.cookies[f'course_sid_{self.server.server_port}']]
        self.local.official.auth=True
        date=(datetime.now()+timedelta(days=15)).date().isoformat()
        self.item=dict(name='测试实验',week=6,time='星期四下午15:55-18:10',date=date,hours=3,remaining=4)
        self.overview=dict(identity={'account':'TEST'},enrolled=[],weeks=[6,7],allowedWeeks=[6,7],currentWeek=6,rules={'weeklyHourLimit':9})
        self.local.official.overview=Mock(return_value=self.overview)
        self.local.official.availability=Mock(return_value={'slots':[self.item]})
        self.local.official.prepare_add=Mock()
        self.local.official.mutate=Mock(return_value={'overview':self.overview,'message':'测试成功'})
        self.snapshot={'events':[dict(name='普通课程',date=date,start='16:00',end='17:30')]}
        self.patcher=patch.object(m.ACADEMIC,'load',return_value=self.snapshot);self.patcher.start()

    def tearDown(self):
        self.patcher.stop();self.http.close()

    def post(self,path,**kwargs):
        return self.http.post(self.base+'/api/'+path,json=kwargs,headers=self.headers)

    def challenge(self):
        response=self.post('prepare',**self.item,action='add',guide=True)
        self.assertEqual(response.status_code,409)
        self.assertEqual(response.json()['code'],'ACADEMIC_CONFLICT')
        self.local.official.prepare_add.assert_not_called()
        return response.json()['conflictToken']

    def test_confirmed_conflict_then_final_ticket_is_one_use(self):
        token=self.challenge()
        response=self.post('prepare',**self.item,action='add',guide=True,academicConflictToken=token)
        self.assertEqual(response.status_code,200,response.text)
        ticket=response.json()['ticket']
        self.local.official.mutate.assert_not_called()
        self.assertEqual(self.post('commit',ticket=ticket).status_code,200)
        self.assertEqual(self.post('commit',ticket=ticket).status_code,400)
        self.local.official.mutate.assert_called_once()

    def test_boolean_or_wrong_token_does_not_bypass_conflict(self):
        for token in [True,'wrong']:
            r=self.post('prepare',**self.item,action='add',guide=True,academicConflictToken=token)
            self.assertEqual(r.status_code,409)
        self.local.official.prepare_add.assert_not_called()

    def test_changed_timetable_requires_new_acknowledgement(self):
        token=self.challenge()
        r=self.post('prepare',**self.item,action='add',guide=True,academicConflictToken=token)
        self.snapshot['events'][0]['name']='新的课程'
        self.assertEqual(self.post('commit',ticket=r.json()['ticket']).status_code,409)
        self.local.official.mutate.assert_not_called()

    def test_expired_proof_cannot_commit(self):
        token=self.challenge()
        r=self.post('prepare',**self.item,action='add',guide=True,academicConflictToken=token)
        ticket=r.json()['ticket'];self.local.tickets[ticket]['academicProof']['expires']=0
        self.assertEqual(self.post('commit',ticket=ticket).status_code,409)
        self.local.official.mutate.assert_not_called()

    def test_other_session_cannot_reuse_acknowledgement(self):
        token=self.challenge();proof=accept_conflict(m.LocalSession(),token,self.item,self.snapshot)
        self.assertIsNone(proof)

    def test_full_slot_rejected_after_confirmation(self):
        token=self.challenge();r=self.post('prepare',**self.item,action='add',guide=True,academicConflictToken=token)
        self.item['remaining']=0
        self.assertEqual(self.post('commit',ticket=r.json()['ticket']).status_code,409)
        self.local.official.mutate.assert_not_called()

    def test_lab_conflict_cannot_be_overridden(self):
        token=self.challenge();self.overview['enrolled']=[dict(self.item)]
        r=self.post('prepare',**self.item,action='add',guide=True,academicConflictToken=token)
        self.assertEqual(r.status_code,400);self.local.official.mutate.assert_not_called()

    def test_exact_teacher_rejects_ambiguous_schedule(self):
        rows=[dict(time=self.item['time'],firstWeek=1,lastWeek=20,teacher=n) for n in ['甲','乙']]
        self.local.official.course_details=Mock(return_value={'schedules':rows})
        self.assertFalse(exact_teacher(self.local.official,self.item,'甲'))
        self.local.official.course_details.return_value={'schedules':rows[:1]}
        self.assertTrue(exact_teacher(self.local.official,self.item,'甲'))

    def test_past_and_week_limit_rejected(self):
        item=dict(self.item,date='2000-01-01')
        self.assertIn('已经开始',eligible(item,self.overview))
        self.overview['rules']['weeklyHourLimit']=1
        self.assertIn('上限',eligible(self.item,self.overview))

    def test_audio_static_routes_and_source_boundary(self):
        self.assertEqual(self.http.get(self.base+'/audio/keyboard.ogg').status_code,200)
        config=self.http.get(self.base+'/audio/config.json')
        self.assertEqual(config.status_code,200)
        self.assertGreater(len(config.json()['defines']),20)
        self.assertEqual(self.http.get(self.base+'/guide_selection.py').status_code,404)

    def test_clear_sessions_invalidates_selection_and_academic_jobs(self):
        self.local.account='TEST'
        self.local.tickets={'ticket':{'item':self.item}}
        self.local.conflict_confirmations={'proof':{}}
        with patch.object(m.ACADEMIC,'clear') as clear,patch.object(m.BROWSER,'invalidate') as invalidate:
            result=self.post('clear-sessions')
            self.assertEqual(result.status_code,200)
            clear.assert_called_once_with('TEST');invalidate.assert_called()
        self.assertFalse(self.local.official.auth)
        self.assertEqual(self.local.account,'')
        self.assertEqual(self.local.tickets,{})
        self.assertEqual(self.local.conflict_confirmations,{})

    def test_cancel_commit_rechecks_time_and_consumes_ticket_on_rejection(self):
        item=dict(self.item,cancellable=True,officialCancellable=True)
        self.overview['enrolled']=[item]
        with patch.object(m,'cancel_reason',return_value=''):
            prepared=self.post('prepare',**item,action='cancel')
        self.assertEqual(prepared.status_code,200)
        token=prepared.json()['ticket']
        with patch.object(m,'cancel_reason',return_value='距开始不足72小时（含72小时）'):
            result=self.post('commit',ticket=token)
        self.assertEqual(result.status_code,409)
        self.local.official.mutate.assert_not_called()
        self.assertEqual(self.post('commit',ticket=token).status_code,400)

    def test_cancel_prepare_rejects_local_time_rule_even_when_school_allows(self):
        item=dict(self.item,cancellable=True,officialCancellable=True)
        self.overview['enrolled']=[item]
        with patch.object(m,'cancel_reason',return_value='已开始'):
            result=self.post('prepare',**item,action='cancel')
        self.assertEqual(result.status_code,400)
        self.assertEqual(self.local.tickets,{})


if __name__=='__main__':unittest.main()
