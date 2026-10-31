package com.labmaker.app;
import java.util.*;
/** Shared native authority; no JavaScript-supplied eligibility or snapshot is accepted. */
final class AcademicAuthority {
 static final AcademicSession SESSION=new AcademicSession();
 static volatile AcademicCache CACHE;
 static synchronized void init(android.content.Context context){if(CACHE==null)CACHE=AcademicCacheStorage.open(context.getApplicationContext());}
 static AcademicTimetable.Snapshot cached(String account)throws Exception{return CACHE==null?null:CACHE.load(account);}
 static final long MAX_AGE=24*3600000L;
 static boolean fresh(String account,long now){synchronized(SESSION){AcademicTimetable.Snapshot s=SESSION.snapshot(account);return s!=null&&SESSION.fresh(account)&&now>=s.fetchedAt&&now-s.fetchedAt<MAX_AGE;}}
 static AcademicTimetable.Conflict check(String account,String name,AcademicTimetable.Interval interval,String period,List<AcademicTimetable.Interval> enrolled,long now){AcademicTimetable.Snapshot snapshot;boolean current;synchronized(SESSION){snapshot=SESSION.snapshot(account);current=fresh(account,now);}AcademicTimetable.Conflict result=AcademicTimetable.conflict(snapshot,account,name,interval,period,enrolled,current);if(current||result.status.equals("conflict"))return result;try{return AcademicTimetable.conflict(cached(account),account,name,interval,period,enrolled,false);}catch(Exception ignored){return result;}}
}
