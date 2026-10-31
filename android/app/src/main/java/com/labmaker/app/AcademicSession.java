package com.labmaker.app;
import org.json.*;

/** Owner/account-bound acceptance state. No password, cookie or disk operations. */
final class AcademicSession {
 private long generation=0;private String account="";private AcademicTimetable.Snapshot snapshot;private String status="disconnected";
 synchronized long begin(String expected)throws Exception {
  if(expected==null||!expected.matches("\\d{5,20}"))throw new AcademicTimetable.Invalid("教务账号无效");
  generation++;if(!expected.equals(account))snapshot=null;account=expected;status="reading";return generation;
 }
 synchronized boolean accept(long token,JSONObject raw,long now)throws Exception {
  if(token!=generation||!status.equals("reading"))return false;
  AcademicTimetable.Snapshot candidate;
  try{candidate=AcademicTimetable.normalize(raw,account,now);}catch(Exception error){status="stale";throw error;}
  return acceptSnapshot(token,candidate);
 }
 synchronized boolean acceptSnapshot(long token,AcademicTimetable.Snapshot candidate)throws Exception {
  if(token!=generation||!status.equals("reading"))return false;
  if(candidate==null||!account.equals(candidate.account)){status="stale";throw new AcademicTimetable.Invalid("课表账号与当前实验账号不匹配");}
  if(!candidate.complete()){
   // Keep a prior complete snapshot for display; never label it freshly verified.
   if(snapshot==null)snapshot=candidate;status="incomplete";return false;
  }
  snapshot=candidate;status="fresh";return true;
 }
 synchronized boolean fail(long token){if(token!=generation||!status.equals("reading"))return false;status="stale";return true;}
 synchronized void clear(){generation++;account="";snapshot=null;status="disconnected";}
 synchronized AcademicTimetable.Snapshot snapshot(String expected){return account.equals(expected)?snapshot:null;}
 synchronized String status(){return status;}
 synchronized boolean fresh(String expected){return account.equals(expected)&&status.equals("fresh")&&snapshot!=null&&snapshot.complete();}
}
