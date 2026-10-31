package com.labmaker.app;
import org.junit.Test;import static org.junit.Assert.*;import org.json.*;
public class AcademicAuthorityTest {
 @Test public void recoveredCacheCanFlagKnownConflictButCannotGrantFreshOrClear()throws Exception {
  AcademicCache old=AcademicAuthority.CACHE;AcademicAuthority.SESSION.clear();try{AcademicCacheTest.Files files=new AcademicCacheTest.Files();AcademicCache cache=new AcademicCache(files,new AcademicCacheTest.Keys(),AcademicCacheTest.CODEC);AcademicAuthority.CACHE=cache;cache.save(new AcademicCacheTest().snapshot("12345678901"));
   assertFalse(AcademicAuthority.fresh("12345678901",100001));
   AcademicTimetable.Interval conflict=new AcademicTimetable.Interval(java.time.LocalDate.of(2026,9,10),java.time.LocalTime.of(15,55),java.time.LocalTime.of(18,10));assertEquals("conflict",AcademicAuthority.check("12345678901","实验",conflict,"下午",java.util.List.of(),100001).status);
   AcademicTimetable.Interval free=new AcademicTimetable.Interval(java.time.LocalDate.of(2026,9,11),java.time.LocalTime.of(15,55),java.time.LocalTime.of(18,10));assertEquals("unknown",AcademicAuthority.check("12345678901","实验",free,"下午",java.util.List.of(),100001).status);cache.clear("12345678901");assertEquals("unknown",AcademicAuthority.check("12345678901","实验",conflict,"下午",java.util.List.of(),100001).status);
  }finally{AcademicAuthority.CACHE=old;AcademicAuthority.SESSION.clear();}
 }
 @Test public void exactAgeBoundaryAndBackwardClockNeverClaimFresh()throws Exception{
  String account="12345678901";AcademicSession state=AcademicAuthority.SESSION;state.clear();try{
   long token=state.begin(account);JSONObject raw=new JSONObject().put("account",account).put("semester","2026-2027-1").put("calendar",new JSONObject().put("XQKSRQ","2026-09-07")).put("courses",new JSONArray()).put("changes",new JSONArray()).put("notArranged",new JSONArray());assertTrue(state.accept(token,raw,1000));
   assertTrue(AcademicAuthority.fresh(account,1000));assertTrue(AcademicAuthority.fresh(account,1000+AcademicAuthority.MAX_AGE-1));assertFalse(AcademicAuthority.fresh(account,1000+AcademicAuthority.MAX_AGE));assertFalse(AcademicAuthority.fresh(account,999));assertFalse(AcademicAuthority.fresh("99999999999",1000));
   state.begin(account);assertFalse(AcademicAuthority.fresh(account,1000));
  }finally{state.clear();}
 }
}
