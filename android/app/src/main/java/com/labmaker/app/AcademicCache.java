package com.labmaker.app;
import org.json.*;import java.nio.charset.StandardCharsets;import java.security.*;import java.time.*;import java.util.*;import javax.crypto.*;import javax.crypto.spec.GCMParameterSpec;

/** Per-account encrypted, complete snapshots only. Restoring never grants fresh status. */
final class AcademicCache {
 interface Store {String read(String name)throws Exception;void write(String name,String value)throws Exception;void remove(String name)throws Exception;}
 interface Keys {SecretKey get(boolean create)throws Exception;}
 interface Codec {String encode(byte[] bytes);byte[] decode(String text);}
 private final Store store;private final Keys keys;private final Codec codec;
 AcademicCache(Store store,Keys keys,Codec codec){this.store=store;this.keys=keys;this.codec=codec;}
 static String name(String account)throws Exception{if(account==null||!account.matches("\\d{5,20}"))throw new IllegalArgumentException("教务账号无效");byte[] hash=MessageDigest.getInstance("SHA-256").digest(account.getBytes(StandardCharsets.UTF_8));StringBuilder out=new StringBuilder();for(byte b:hash)out.append(String.format("%02x",b&255));return out+".json";}
 private static byte[] aad(String account){return ("lab-academic-cache:v1:"+account).getBytes(StandardCharsets.UTF_8);}
 synchronized void save(AcademicTimetable.Snapshot snapshot)throws Exception {
  if(snapshot==null||!snapshot.complete()||!snapshot.scheduledComplete||!snapshot.unscheduled.isEmpty())throw new IllegalArgumentException("不完整课表不覆盖本机缓存");AcademicTimetable.encodedSize(snapshot);String file=name(snapshot.account);byte[] plain=snapshot.json().toString().getBytes(StandardCharsets.UTF_8);
  if(plain.length>8*1024*1024)throw new IllegalArgumentException("课表缓存过大");
  try{Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,keys.get(true));cipher.updateAAD(aad(snapshot.account));byte[] encrypted=cipher.doFinal(plain);
   JSONObject envelope=new JSONObject().put("version",1).put("iv",codec.encode(cipher.getIV())).put("ciphertext",codec.encode(encrypted));store.write(file,envelope.toString());
  }finally{Arrays.fill(plain,(byte)0);}
 }
 synchronized AcademicTimetable.Snapshot load(String account)throws Exception {
  String encoded=store.read(name(account));if(encoded==null)return null;if(encoded.length()>12*1024*1024)throw new IllegalArgumentException("课表缓存过大");JSONObject envelope=new JSONObject(encoded);if(envelope.getInt("version")!=1)throw new IllegalArgumentException("课表缓存版本无法识别");
  byte[] iv=codec.decode(envelope.getString("iv")),ciphertext=codec.decode(envelope.getString("ciphertext"));if(iv.length!=12||ciphertext.length<16||ciphertext.length>8*1024*1024+16)throw new IllegalArgumentException("课表缓存格式异常");
  Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,keys.get(false),new GCMParameterSpec(128,iv));cipher.updateAAD(aad(account));byte[] plain=cipher.doFinal(ciphertext);
  try{return restore(new JSONObject(new String(plain,StandardCharsets.UTF_8)),account);}finally{Arrays.fill(plain,(byte)0);}
 }
 synchronized void clear(String account)throws Exception{store.remove(name(account));}
 private static String text(JSONObject row,String key,int max)throws Exception{Object raw=row.get(key);if(!(raw instanceof String)||((String)raw).length()>max||((String)raw).chars().anyMatch(c->c<32))throw new IllegalArgumentException("课表缓存字段异常");return (String)raw;}
 private static AcademicTimetable.Snapshot restore(JSONObject raw,String account)throws Exception {
  if(!account.equals(text(raw,"account",20))||!raw.getBoolean("complete")||!raw.getBoolean("scheduledComplete"))throw new IllegalArgumentException("课表缓存身份或完整性异常");
  String semester=text(raw,"semester",11);if(!semester.matches("\\d{4}-\\d{4}-[12]")||Integer.parseInt(semester.substring(5,9))!=Integer.parseInt(semester.substring(0,4))+1)throw new IllegalArgumentException("课表缓存学期异常");
  LocalDate start=AcademicTimetable.date(text(raw,"termStart",10)),end=raw.isNull("termEnd")?null:AcademicTimetable.date(text(raw,"termEnd",10));if(start.getDayOfWeek()!=DayOfWeek.MONDAY||end!=null&&(end.isBefore(start)||end.isAfter(start.plusDays(420))))throw new IllegalArgumentException("课表缓存校历异常");
  if(raw.getJSONArray("warnings").length()!=0||raw.getJSONArray("unscheduled").length()!=0)throw new IllegalArgumentException("课表缓存状态异常");
  long fetchedAt=Instant.parse(text(raw,"fetchedAt",40)).toEpochMilli();if(fetchedAt<0)throw new IllegalArgumentException("课表缓存时间异常");JSONArray rows=raw.getJSONArray("events");if(rows.length()>50000)throw new IllegalArgumentException("课表缓存过大");List<AcademicTimetable.Event> events=new ArrayList<>();Set<String> seen=new HashSet<>();
  for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);String name=text(row,"name",200),code=text(row,"code",100),number=text(row,"number",100),room=text(row,"room",200);LocalDate date=AcademicTimetable.date(text(row,"date",10));LocalTime begin=LocalTime.parse(text(row,"start",5)),finish=LocalTime.parse(text(row,"end",5));if(name.isEmpty()||code.isEmpty()||!begin.isBefore(finish)||date.isBefore(start)||end!=null&&date.isAfter(end))throw new IllegalArgumentException("课表缓存课程异常");AcademicTimetable.Event event=new AcademicTimetable.Event(name,code,number,room,date,begin,finish);if(!seen.add(event.unique()))throw new IllegalArgumentException("课表缓存存在重复记录");events.add(event);}
  events.sort(Comparator.comparing((AcademicTimetable.Event e)->e.date).thenComparing(e->e.start).thenComparing(e->e.name));return new AcademicTimetable.Snapshot(account,semester,start,end,events,Collections.emptyList(),Collections.emptyList(),true,fetchedAt);
 }
}
