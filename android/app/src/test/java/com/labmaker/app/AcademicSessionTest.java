package com.labmaker.app;
import org.json.*;import org.junit.Test;import static org.junit.Assert.*;
public class AcademicSessionTest {
 private static final String ACCOUNT="12345678901";
 private JSONObject raw(String account)throws Exception{return new JSONObject().put("account",account).put("semester","2026-2027-1").put("calendar",new JSONObject().put("XQKSRQ","2026-09-07")).put("courses",new JSONArray().put(new JSONObject().put("XH",account).put("KCM","课程").put("KCH","C").put("SKZC","111").put("SKXQ","1").put("KSJC","1").put("JSJC","2"))).put("changes",new JSONArray()).put("notArranged",new JSONArray());}
 @Test public void newerRefreshAndClearInvalidateOldCallbacks()throws Exception{
  AcademicSession state=new AcademicSession();long old=state.begin(ACCOUNT),current=state.begin(ACCOUNT);assertFalse(state.accept(old,raw(ACCOUNT),100));assertFalse(state.fail(old));assertTrue(state.accept(current,raw(ACCOUNT),200));assertTrue(state.fresh(ACCOUNT));assertFalse(state.accept(current,raw(ACCOUNT),300));assertEquals(200,state.snapshot(ACCOUNT).fetchedAt);
  state.clear();assertFalse(state.accept(current,raw(ACCOUNT),400));assertNull(state.snapshot(ACCOUNT));assertEquals("disconnected",state.status());
 }
 @Test public void partialAndFailedRefreshKeepGoodSnapshotWithoutFreshStatus()throws Exception{
  AcademicSession state=new AcademicSession();long token=state.begin(ACCOUNT);assertTrue(state.accept(token,raw(ACCOUNT),100));AcademicTimetable.Snapshot first=state.snapshot(ACCOUNT);
  token=state.begin(ACCOUNT);JSONObject partial=raw(ACCOUNT);partial.getJSONArray("notArranged").put(new JSONObject().put("KCM","未排课"));assertFalse(state.accept(token,partial,200));assertSame(first,state.snapshot(ACCOUNT));assertFalse(state.fresh(ACCOUNT));assertEquals("incomplete",state.status());
  token=state.begin(ACCOUNT);assertTrue(state.fail(token));assertSame(first,state.snapshot(ACCOUNT));assertEquals("stale",state.status());assertFalse(state.fresh(ACCOUNT));
 }
 @Test public void accountSwitchAndIdentityFailuresCannotReusePreviousOwner()throws Exception{
  AcademicSession state=new AcademicSession();long token=state.begin(ACCOUNT);assertTrue(state.accept(token,raw(ACCOUNT),100));long switched=state.begin("99999999999");assertNull(state.snapshot(ACCOUNT));assertNull(state.snapshot("99999999999"));assertFalse(state.accept(token,raw(ACCOUNT),200));assertThrows(Exception.class,()->state.accept(switched,raw(ACCOUNT),300));assertEquals("stale",state.status());assertNull(state.snapshot("99999999999"));
 }
 @Test public void initialPartialRemainsVisibleAndInputCannotMutateAcceptedSnapshot()throws Exception{
  AcademicSession state=new AcademicSession();long token=state.begin(ACCOUNT);JSONObject partial=raw(ACCOUNT);partial.getJSONArray("courses").put(new JSONObject().put("KCM","错误行"));assertFalse(state.accept(token,partial,100));assertNotNull(state.snapshot(ACCOUNT));assertFalse(state.fresh(ACCOUNT));partial.getJSONArray("courses").getJSONObject(0).put("KCM","被修改");assertEquals("课程",state.snapshot(ACCOUNT).events.get(0).name);assertThrows(UnsupportedOperationException.class,()->state.snapshot(ACCOUNT).events.clear());
 }
 @Test public void excessiveExpansionFailsAndRetainsPreviousGoodSnapshot()throws Exception{
  AcademicSession state=new AcademicSession();long token=state.begin(ACCOUNT);assertTrue(state.accept(token,raw(ACCOUNT),100));AcademicTimetable.Snapshot first=state.snapshot(ACCOUNT);JSONObject huge=raw(ACCOUNT);JSONObject row=huge.getJSONArray("courses").getJSONObject(0).put("SKZC","1".repeat(60));for(int i=0;i<900;i++)huge.getJSONArray("courses").put(row);long next=state.begin(ACCOUNT);assertThrows(Exception.class,()->state.accept(next,huge,200));assertSame(first,state.snapshot(ACCOUNT));assertFalse(state.fresh(ACCOUNT));
 }
 @Test public void prevalidatedWorkerResultCannotImportAfterNavigationOrClear()throws Exception {
  AcademicSession state=new AcademicSession();long token=state.begin(ACCOUNT);AcademicTimetable.Snapshot candidate=AcademicTimetable.normalize(raw(ACCOUNT),ACCOUNT,100);
  state.fail(token);assertFalse(state.acceptSnapshot(token,candidate));assertNull(state.snapshot(ACCOUNT));long next=state.begin(ACCOUNT);state.clear();assertFalse(state.acceptSnapshot(next,candidate));assertNull(state.snapshot(ACCOUNT));
 }
 @Test public void expandedTextSizeIsBoundedBeforeBridgeAndCacheSerialization()throws Exception{
  JSONObject huge=raw(ACCOUNT);JSONArray rows=new JSONArray();JSONObject base=huge.getJSONArray("courses").getJSONObject(0).put("KCM","课".repeat(200)).put("JASMC","室".repeat(200)).put("SKZC","1".repeat(60));for(int i=0;i<200;i++)rows.put(new JSONObject(base.toString()).put("KCH","COURSE"+i));huge.put("courses",rows);assertThrows(Exception.class,()->AcademicTimetable.normalize(huge,ACCOUNT,100));
 }
}
