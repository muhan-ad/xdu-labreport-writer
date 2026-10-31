package com.labmaker.app;

import org.junit.Test;
import static org.junit.Assert.*;
import org.json.*;
import java.util.*;
import java.time.*;
import java.io.IOException;

public class CourseTransactionsTest {
    private java.util.concurrent.atomic.AtomicReference<String> academic(School school,String initial){
        java.util.concurrent.atomic.AtomicReference<String> state=new java.util.concurrent.atomic.AtomicReference<>(initial);
        school.engine=new CourseTransactions(school,()->school.now,()->school.elapsed,()->school.account,(owner,name,interval,period,booked,now)->new AcademicTimetable.Conflict(state.get(),state.get().equals("conflict")?"与教务课程冲突":"教务课表待核实",null));return state;
    }
    @org.junit.Test public void checkedAcademicNeedsNoUnknownAcknowledgement()throws Exception{
        School school=new School();academic(school,"clear");JSONObject prepared=school.engine.prepare("add",item(),new JSONArray().put("老师甲").put("老师乙"));assertTrue(prepared.getBoolean("academicChecked"));assertTrue(school.engine.commit(prepared.getString("ticket"),true,false).getBoolean("verified"));assertEquals(1,school.sends);
    }
    @org.junit.Test public void knownConflictCannotPrepareAndUnknownRequiresAcknowledgement()throws Exception{
        School school=new School();java.util.concurrent.atomic.AtomicReference<String> status=academic(school,"conflict");fails("ACADEMIC_CONFLICT",()->school.engine.prepare("add",item(),new JSONArray()));assertEquals(0,school.sends);
        status.set("unknown");JSONObject prepared=school.engine.prepare("add",item(),new JSONArray());assertFalse(prepared.getBoolean("academicChecked"));fails("ACADEMIC_UNCHECKED",()->school.engine.commit(prepared.getString("ticket"),true,false));assertEquals(0,school.sends);
        JSONObject again=school.engine.prepare("add",item(),new JSONArray());assertTrue(school.engine.commit(again.getString("ticket"),true,true).getBoolean("verified"));assertEquals(1,school.sends);
    }
    @org.junit.Test public void clearedOrConflictingAcademicStateInvalidatesCheckedConfirmation()throws Exception{
        for(String changed:new String[]{"unknown","conflict"}){School school=new School();java.util.concurrent.atomic.AtomicReference<String> status=academic(school,"clear");JSONObject prepared=school.engine.prepare("add",item(),new JSONArray());status.set(changed);fails("ACADEMIC_UNCHECKED",()->school.engine.commit(prepared.getString("ticket"),true,true));assertEquals(0,school.sends);}
    }
    @org.junit.Test public void finalNetworkBoundaryRechecksAcademicAndNeverReportsUnknownOutcomeWithoutSend()throws Exception{
        for(String changed:new String[]{"unknown","conflict"}){School school=new School();java.util.concurrent.atomic.AtomicReference<String> status=academic(school,"clear");JSONObject prepared=school.engine.prepare("add",item(),new JSONArray());school.beforeFinal=()->status.set(changed);fails("PRE_SUBMIT_POLICY",()->school.engine.commit(prepared.getString("ticket"),true,false));assertEquals(0,school.sends);fails("TICKET",()->school.engine.commit(prepared.getString("ticket"),true,true));}
    }
    @org.junit.Test public void manualAcknowledgementCannotOverrideLateKnownConflict()throws Exception{
        School school=new School();java.util.concurrent.atomic.AtomicReference<String> status=academic(school,"unknown");JSONObject prepared=school.engine.prepare("add",item(),new JSONArray());school.beforeFinal=()->status.set("conflict");fails("PRE_SUBMIT_POLICY",()->school.engine.commit(prepared.getString("ticket"),true,true));assertEquals(0,school.sends);
    }
    @org.junit.Test public void academicConflictNeverChangesCancellationPolicy()throws Exception{
        School school=new School();school.enrolled=true;academic(school,"conflict");JSONObject prepared=school.engine.prepare("cancel",item(),new JSONArray());assertTrue(school.engine.commit(prepared.getString("ticket"),true,false).getBoolean("verified"));assertEquals(1,school.sends);
    }
    @Test public void ticketExpiringDuringFinalReadNeverSends()throws Exception{
        School school=new School();String ticket=school.prepare("add");school.beforeFinal=()->school.elapsed=120000;fails("PRE_SUBMIT_POLICY",()->school.engine.commit(ticket,true,true));assertEquals(0,school.sends);
    }
    @Test public void academicReadCannotCarryEligibilityPastExperimentStart()throws Exception{
        School school=new School();java.util.concurrent.atomic.AtomicBoolean finalRead=new java.util.concurrent.atomic.AtomicBoolean();school.engine=new CourseTransactions(school,()->school.now,()->school.elapsed,()->school.account,(owner,name,interval,period,booked,now)->{if(finalRead.get())school.now=START;return new AcademicTimetable.Conflict("unknown","待核实",null);});String ticket=school.prepare("add");school.beforeFinal=()->finalRead.set(true);fails("PRE_SUBMIT_POLICY",()->school.engine.commit(ticket,true,true));assertEquals(0,school.sends);
    }
    private static final String NAME="测试实验",TIME="星期四下午15:55-18:10";
    private static final long START=Instant.parse("2026-10-29T07:55:00Z").toEpochMilli();
    private static JSONObject item()throws Exception{return new JSONObject().put("name",NAME).put("week",7).put("time",TIME);}
    interface Action{void run()throws Exception;}
    private static CourseTransactions.Failure fails(String code,Action action)throws Exception{try{action.run();fail("Expected "+code);}catch(CourseTransactions.Failure e){assertEquals(e.getMessage(),code,e.code);return e;}throw new AssertionError();}
    private static final class School implements CourseTransactions.Transport {
        long now=START-6*86400000L,elapsed=0;int sends=0,state=0,queries=0;boolean enrolled=false,official=true,full=false,unknownDate=false,ignoreMutation=false,failAfterMutation=false,loseReadback=false,ignoreSelection=false,teacherChanged=false;
        String account="2500000000",view="",selectedWeek="7",selectedTime="0",selectedExperiment="0";
        Runnable beforeFinal=()->{};
        CourseTransactions engine=new CourseTransactions(this,()->now,()->elapsed,()->account);
        private String view(){view="state-"+(++state);return "<input type=hidden name=__VIEWSTATE value='"+view+"'>";}
        private String select(String id,String value,String...options){StringBuilder h=new StringBuilder("<select id='"+id+"' name='ctl$"+id+"'>");for(int i=0;i<options.length;i+=2)h.append("<option value='").append(options[i]).append("'").append(options[i].equals(value)?" selected":"").append(">").append(options[i+1]).append("</option>");return h+"</select>";}
        private String addForm(){return "<form>"+view()+select("ExpeWeekList",selectedWeek,"7","7","8","8")+select("ExpeTimeList",selectedTime,"0","请选择","4B",TIME)+select("ExpeClassList","1","1","力学")+select("ExpeNameList",selectedExperiment,"0","请选择","E",NAME+"（3学时）")+"<input id=btnAdd name='ctl$btnAdd' type=submit value=选课></form>";}
        private String enrolled(){if(!enrolled)return "实验项目<table></table>";return "实验项目<table><tr><td>1</td><td>"+NAME+"（3学时）</td><td>7</td><td>"+TIME+"</td><td>"+(unknownDate?"待核实":"2026/10/29")+"</td><td>F219</td><td></td><td></td><td></td><td></td></tr></table>";}
        private String cancel(){return "取消<form>"+view()+"<table>"+(enrolled&&official?"<tr><td>1</td><td>"+NAME+"（3学时）</td><td>7</td><td>"+TIME+"</td><td><input type=radio name='ctl$choice' value=ROW></td><td></td></tr>":"")+"</table><input type=submit id=btnDel name='ctl$btnDel' value=取消></form>";}
        public String exchange(String operation,Map<String,String> form,boolean mutation)throws Exception{
            if(loseReadback&&sends>0)throw new IOException("mock offline");
            switch(operation){
                case "overview":return "模拟同学（"+account+"）同学 第6周 "+(unknownDate?"":"2026年10月23日 星期五 ")+"必须完成的实验项目总学时数为24 每周可选的实验项目总学时数为9 已选实验项目的总学时数为"+(enrolled?3:0);
                case "enrolled":return enrolled();
                case "cancellable":return cancel();
                case "allowedWeeks":selectedWeek="7";selectedTime="0";selectedExperiment="0";return addForm();
                case "weekForm":return "<form>"+view()+"<select id=Header2_ExpeWeekList name='Header2$ExpeWeekList'><option value=7>7</option></select><input type=image id=Header2_btnSubmit name='Header2$btnSubmit'></form>";
                case "weekQuery":assertEquals(view,form.get("__VIEWSTATE"));queries++;return "第7周可选<table><tr><td>"+NAME+"（3学时）</td><td>"+TIME+" ("+(full?0:2)+")</td></tr></table>";
                case "addFormPost":
                    assertFalse(mutation);assertEquals(view,form.get("__VIEWSTATE"));assertFalse(form.containsKey("ctl$btnAdd"));
                    assertTrue(Arrays.asList("ctl$ExpeWeekList","ctl$ExpeTimeList","ctl$ExpeClassList","ctl$ExpeNameList").contains(form.get("__EVENTTARGET")));
                    selectedWeek=form.get("ctl$ExpeWeekList");selectedTime=form.get("ctl$ExpeTimeList");selectedExperiment=ignoreSelection?"0":form.get("ctl$ExpeNameList");return addForm();
                case "scheduleForm":return "<form>"+view()+"<select name='plan1$ExpeList'><option value=E>"+NAME+"</option></select></form>";
                case "scheduleQuery":assertEquals(view,form.get("__VIEWSTATE"));return "<table><tr><th>上课时间</th><th>教师</th><th>起始周</th><th>结束周</th><th>单双周</th></tr><tr><td>"+TIME+"</td><td>"+(teacherChanged?"别的老师":"老师甲／老师乙")+"</td><td>2</td><td>16</td><td>单周</td></tr></table>";
                case "addSubmit":case "cancelSubmit":
                    beforeFinal.run();engine.beforeSend();assertTrue(mutation);assertEquals(view,form.get("__VIEWSTATE"));sends++;
                    if(operation.equals("addSubmit")){assertEquals("7",form.get("ctl$ExpeWeekList"));assertEquals("4B",form.get("ctl$ExpeTimeList"));assertEquals("E",form.get("ctl$ExpeNameList"));assertEquals("选课",form.get("ctl$btnAdd"));}
                    else {assertEquals("ROW",form.get("ctl$choice"));assertEquals("取消",form.get("ctl$btnDel"));}
                    if(!ignoreMutation)enrolled=operation.equals("addSubmit");if(failAfterMutation)throw new IOException("mock connection lost after send");return "操作已受理";
                default:throw new AssertionError(operation);
            }
        }
        String prepare(String action)throws Exception{return engine.prepare(action,item(),new JSONArray()).getString("ticket");}
    }
    @Test public void cancelAllTimeBoundariesAndUnknownDate()throws Exception{
        for(long offset:new long[]{0,-1,1,72*3600000L,72*3600000L-1}){School s=new School();s.enrolled=true;s.now=START-offset;fails("CANCEL_POLICY",()->s.prepare("cancel"));assertEquals(0,s.sends);}
        School s=new School();s.enrolled=true;s.now=START-72*3600000L-1;String ticket=s.prepare("cancel");assertTrue(s.engine.commit(ticket,true,false).getBoolean("verified"));assertFalse(s.enrolled);assertEquals(1,s.sends);
        s=new School();s.enrolled=true;s.unknownDate=true;School unknown=s;fails("CANCEL_POLICY",()->unknown.prepare("cancel"));
        s=new School();s.enrolled=true;s.official=false;School denied=s;fails("CANCEL_POLICY",()->denied.prepare("cancel"));
    }
    @Test public void finalBoundaryGuardPreventsSendingAfterConfirmation()throws Exception{
        School s=new School();s.enrolled=true;String ticket=s.prepare("cancel");s.beforeFinal=()->s.now=START-72*3600000L;
        fails("PRE_SUBMIT_POLICY",()->s.engine.commit(ticket,true,false));assertEquals(0,s.sends);fails("TICKET",()->s.engine.commit(ticket,true,false));
    }
    @Test public void addUsesFreshFormsExplicitConfirmationAndVerifiedReadback()throws Exception{
        School s=new School();String ticket=s.engine.prepare("add",item(),new JSONArray(Arrays.asList("老师甲","老师乙"))).getString("ticket");
        assertEquals(0,s.sends);JSONObject result=s.engine.commit(ticket,true,true);assertTrue(result.getBoolean("verified"));assertTrue(s.enrolled);assertEquals(1,s.sends);assertEquals(2,s.queries);fails("TICKET",()->s.engine.commit(ticket,true,true));
    }
    @Test public void consumedExpiredDiscardedAndUnacknowledgedTicketsNeverSend()throws Exception{
        School s=new School();String t=s.prepare("add");fails("CONFIRM",()->s.engine.commit(t,false,true));fails("TICKET",()->s.engine.commit(t,true,true));
        String unack=s.prepare("add");fails("ACADEMIC_UNCHECKED",()->s.engine.commit(unack,true,false));
        String expired=s.prepare("add");s.elapsed=120000;fails("TICKET",()->s.engine.commit(expired,true,true));
        String discarded=s.prepare("add");s.engine.discard(discarded);fails("TICKET",()->s.engine.commit(discarded,true,true));
        String replaced=s.prepare("add");s.prepare("add");fails("TICKET",()->s.engine.commit(replaced,true,true));assertEquals(0,s.sends);
    }
    @Test public void changedCapacityTeacherAndSelectionAreRejected()throws Exception{
        School s=new School();String ticket=s.prepare("add");s.full=true;fails("ELIGIBILITY",()->s.engine.commit(ticket,true,true));assertEquals(0,s.sends);
        School teacher=new School();String t=teacher.engine.prepare("add",item(),new JSONArray(Arrays.asList("老师甲","老师乙"))).getString("ticket");teacher.teacherChanged=true;fails("TEACHER",()->teacher.engine.commit(t,true,true));assertEquals(0,teacher.sends);
        School changed=new School();changed.ignoreSelection=true;fails("CHANGED",()->changed.prepare("add"));assertEquals(0,changed.sends);
    }
    @Test public void networkAmbiguityDoesNotReplayAndReadbackDeterminesResult()throws Exception{
        School s=new School();String t=s.prepare("add");s.failAfterMutation=true;assertTrue(s.engine.commit(t,true,true).getBoolean("verified"));assertEquals(1,s.sends);
        School failed=new School();String f=failed.prepare("add");failed.ignoreMutation=true;failed.failAfterMutation=true;assertTrue(fails("OUTCOME_UNKNOWN",()->failed.engine.commit(f,true,true)).needsRefresh);assertEquals(1,failed.sends);fails("TICKET",()->failed.engine.commit(f,true,true));
        School unreadable=new School();String u=unreadable.prepare("add");unreadable.loseReadback=true;assertTrue(fails("OUTCOME_UNKNOWN",()->unreadable.engine.commit(u,true,true)).needsRefresh);assertEquals(1,unreadable.sends);
        School rejected=new School();String r=rejected.prepare("add");rejected.ignoreMutation=true;fails("NOT_CONFIRMED",()->rejected.engine.commit(r,true,true));assertEquals(1,rejected.sends);
    }
}
