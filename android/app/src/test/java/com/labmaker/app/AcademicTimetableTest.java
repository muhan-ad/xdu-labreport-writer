package com.labmaker.app;
import org.json.*;import org.junit.Test;import static org.junit.Assert.*;import java.time.*;import java.util.*;
public class AcademicTimetableTest {
 private static final String ACCOUNT="12345678901";
 private JSONObject course()throws Exception{return new JSONObject().put("KCM","高等数学").put("KCH","MATH").put("KXH","01").put("XH",ACCOUNT).put("SKZC","111").put("SKXQ","4").put("KSJC","7").put("JSJC","8").put("JASMC","A101");}
 private JSONObject raw()throws Exception{return new JSONObject().put("account",ACCOUNT).put("semester","2026-2027-1").put("calendar",new JSONObject().put("XQKSRQ","2026-09-07")).put("courses",new JSONArray().put(course())).put("changes",new JSONArray()).put("notArranged",new JSONArray());}
 private AcademicTimetable.Snapshot parse(JSONObject raw)throws Exception{return AcademicTimetable.normalize(raw,ACCOUNT,100000);}
 private AcademicTimetable.Interval interval(String date,String start,String end){return new AcademicTimetable.Interval(LocalDate.parse(date),LocalTime.parse(start),LocalTime.parse(end));}
 @Test public void masksUseExactCalendarDatesAndPeriodBoundaries()throws Exception {
  AcademicTimetable.Snapshot snapshot=parse(raw());assertTrue(snapshot.complete());assertEquals(3,snapshot.events.size());assertEquals(LocalDate.of(2026,9,10),snapshot.events.get(0).date);assertEquals(LocalDate.of(2026,9,24),snapshot.events.get(2).date);assertEquals(LocalTime.of(15,55),snapshot.events.get(0).start);assertEquals(LocalTime.of(17,30),snapshot.events.get(0).end);assertEquals(LocalDate.of(2026,9,27),snapshot.end);
  assertEquals("2026-09-10",AcademicTimetable.date("2026/9/10").toString());assertEquals("2026-09-10",AcademicTimetable.date("09/10/2026").toString());assertThrows(Exception.class,()->AcademicTimetable.date("2026-02-30"));
 }
 @Test public void chainedReschedulesApplyOldestFirstAndMakeupAndStopAreDistinct()throws Exception {
  JSONObject raw=raw();raw.getJSONArray("courses").getJSONObject(0).put("SKZC","100");
  JSONObject first=course().put("TKLXDM","01").put("SKZC","100").put("XSKZC","010").put("XSKXQ","5").put("XKSJC","9").put("XJSJC","10");
  JSONObject second=new JSONObject(first.toString()).put("SKZC","010").put("SKXQ","5").put("KSJC","9").put("JSJC","10").put("XSKZC","001");
  raw.put("changes",new JSONArray().put(second).put(first));AcademicTimetable.Snapshot result=parse(raw);assertTrue(result.complete());assertEquals(1,result.events.size());assertEquals(LocalDate.of(2026,9,25),result.events.get(0).date);assertEquals(LocalTime.of(19,0),result.events.get(0).start);
  JSONObject makeup=course().put("TKLXDM","03").put("XSKZC","100").put("XSKXQ","6").put("XKSJC","1").put("XJSJC","2");raw.getJSONArray("changes").put(0,makeup);raw.put("changes",new JSONArray().put(makeup).put(second).put(first));assertEquals(2,parse(raw).events.size());
  JSONObject stop=course().put("TKLXDM","02").put("SKZC","001").put("SKXQ","5").put("KSJC","9").put("JSJC","10");raw.put("changes",new JSONArray().put(stop).put(second).put(first));assertEquals(0,parse(raw).events.size());
 }
 @Test public void invalidRowsAreIncompleteButWrongAccountIsFatal()throws Exception {
  JSONObject raw=raw();raw.getJSONArray("courses").put(course().put("KSJC","12"));assertFalse(parse(raw).complete());assertEquals(3,parse(raw).events.size());
  raw=raw();raw.getJSONArray("changes").put(course().put("TKLXDM","??"));assertFalse(parse(raw).complete());
  JSONObject mismatch=raw();mismatch.getJSONArray("courses").getJSONObject(0).put("XH","99999999999");assertThrows(Exception.class,()->parse(mismatch));
  JSONObject badCalendar=raw();badCalendar.getJSONObject("calendar").put("XQKSRQ","2026-09-08");assertThrows(Exception.class,()->parse(badCalendar));
  JSONObject badTerm=raw().put("semester","2026-2026-1");assertThrows(Exception.class,()->parse(badTerm));
 }
 @Test public void corruptRescheduleNeverRemovesOriginalBeforeReplacementValidated()throws Exception {
  JSONObject raw=raw();raw.getJSONArray("changes").put(course().put("TKLXDM","01").put("SKZC","100").put("XSKZC","010").put("XSKXQ","5").put("XKSJC","12").put("XJSJC","12"));
  AcademicTimetable.Snapshot result=parse(raw);assertFalse(result.complete());assertEquals(3,result.events.size());
  raw=raw();raw.getJSONArray("changes").put(course().put("TKLXDM","02").put("KCH","OTHER"));assertFalse(parse(raw).complete());assertEquals(3,parse(raw).events.size());
 }
 @Test public void partialUnscheduledStaleAndOutsideTermCannotClaimClear()throws Exception {
  AcademicTimetable.Snapshot complete=parse(raw());AcademicTimetable.Interval free=interval("2026-09-17","19:00","21:25");
  assertEquals("clear",AcademicTimetable.conflict(complete,ACCOUNT,"实验",free,"晚上",List.of(),true).status);
  assertEquals("unknown",AcademicTimetable.conflict(complete,ACCOUNT,"实验",free,"晚上",List.of(),false).status);
  assertEquals("unknown",AcademicTimetable.conflict(complete,"99999999999","实验",free,"晚上",List.of(),true).status);
  assertEquals("unknown",AcademicTimetable.conflict(complete,ACCOUNT,"实验",interval("2026-10-01","19:00","21:25"),"晚上",List.of(),true).status);
  JSONObject raw=raw();raw.getJSONArray("notArranged").put(new JSONObject().put("KCM","待排课程"));AcademicTimetable.Snapshot partial=parse(raw);assertTrue(partial.scheduledComplete);assertFalse(partial.complete());assertEquals("unknown",AcademicTimetable.conflict(partial,ACCOUNT,"实验",free,"晚上",List.of(),true).status);
  assertEquals("conflict",AcademicTimetable.conflict(partial,ACCOUNT,"实验",interval("2026-09-17","15:55","18:10"),"下午",List.of(),false).status);
 }
 @Test public void academicWindowsMatchDesktopAndTouchingEndpointsDoNotOverlap()throws Exception {
  JSONObject raw=raw();raw.put("courses",new JSONArray().put(course().put("KSJC","5").put("JSJC","6")));AcademicTimetable.Snapshot snapshot=parse(raw);
  assertEquals("clear",AcademicTimetable.conflict(snapshot,ACCOUNT,"实验",interval("2026-09-17","15:55","18:10"),"下午",List.of(),true).status);
  snapshot=parse(raw());assertEquals("conflict",AcademicTimetable.conflict(snapshot,ACCOUNT,"实验",interval("2026-09-17","15:55","18:10"),"下午",List.of(),true).status);
  assertEquals("clear",AcademicTimetable.conflict(snapshot,ACCOUNT,"实验",interval("2026-09-17","17:30","18:10"),"",List.of(),true).status);
  raw=raw();raw.put("courses",new JSONArray().put(course().put("KSJC","11").put("JSJC","11")));snapshot=parse(raw);
  assertEquals("conflict",AcademicTimetable.conflict(snapshot,ACCOUNT,"实验",interval("2026-09-17","18:30","20:45"),"晚上",List.of(),true).status);
 }
 @Test public void onlyExactAlreadyBookedPhysicsOccurrenceIsDeduplicated()throws Exception {
  JSONObject raw=raw();raw.put("courses",new JSONArray().put(course().put("KCM","大学物理实验")));AcademicTimetable.Snapshot snapshot=parse(raw);AcademicTimetable.Interval actual=interval("2026-09-17","15:55","18:10"),booked=interval("2026-09-17","15:55","17:30");
  assertEquals("clear",AcademicTimetable.conflict(snapshot,ACCOUNT,"新实验",actual,"下午",List.of(booked),true).status);
  assertEquals("conflict",AcademicTimetable.conflict(snapshot,ACCOUNT,"新实验",actual,"下午",List.of(actual),true).status);
  raw.getJSONArray("courses").getJSONObject(0).put("KCM","电子技术实验");assertEquals("conflict",AcademicTimetable.conflict(parse(raw),ACCOUNT,"新实验",actual,"下午",List.of(booked),true).status);
 }
 @Test public void malformedBoundsDuplicatesAndAllZeroMasksAreExplicit()throws Exception {
  JSONObject raw=raw();raw.getJSONArray("courses").put(course());assertEquals(3,parse(raw).events.size());
  raw=raw();raw.getJSONArray("courses").getJSONObject(0).put("SKZC","000");assertTrue(parse(raw).complete());assertEquals(0,parse(raw).events.size());
  JSONObject invalid=raw().put("courses",new JSONArray().put("bad"));assertThrows(Exception.class,()->parse(invalid));
  JSONObject wrongEnd=raw();wrongEnd.getJSONObject("calendar").put("XQJSRQ","2026-09-06");assertThrows(Exception.class,()->parse(wrongEnd));
  raw=raw();raw.getJSONObject("calendar").put("XQJSRQ","2026-09-10");assertFalse(parse(raw).complete());
 }
}
