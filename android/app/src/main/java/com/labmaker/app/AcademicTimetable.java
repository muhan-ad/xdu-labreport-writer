package com.labmaker.app;

import org.json.*;
import java.time.*;
import java.util.*;
import java.util.regex.*;

/** Read-only timetable normalization. Week masks use the school's zero-based bit positions. */
final class AcademicTimetable {
 private static JSONObject json(Object... values){JSONObject result=new JSONObject();try{for(int i=0;i<values.length;i+=2)result.put((String)values[i],values[i+1]);return result;}catch(JSONException e){throw new IllegalStateException("课表序列化失败");}}
 static final String[][] PERIODS={{"08:30","09:15"},{"09:20","10:05"},{"10:25","11:10"},{"11:15","12:00"},{"14:00","14:45"},{"14:50","15:35"},{"15:55","16:40"},{"16:45","17:30"},{"19:00","19:45"},{"19:50","20:35"},{"20:40","21:25"}};
 static final class Invalid extends Exception {Invalid(String message){super(message);}}
 static String text(JSONObject row,String key){Object value=row.opt(key);return value==null||value==JSONObject.NULL?"":String.valueOf(value).trim();}
 static LocalDate date(String value)throws Invalid {
  Matcher m=Pattern.compile("^(\\d{4})[-/](\\d{1,2})[-/](\\d{1,2})(?:[T ].*)?$").matcher(value);
  try{if(m.matches())return LocalDate.of(Integer.parseInt(m.group(1)),Integer.parseInt(m.group(2)),Integer.parseInt(m.group(3)));
   m=Pattern.compile("^(\\d{1,2})/(\\d{1,2})/(\\d{4})$").matcher(value);if(m.matches())return LocalDate.of(Integer.parseInt(m.group(3)),Integer.parseInt(m.group(1)),Integer.parseInt(m.group(2)));
  }catch(DateTimeException|NumberFormatException ignored){}throw new Invalid("日期缺失或无法识别");
 }
 static int integer(JSONObject row,String key)throws Invalid{String value=text(row,key);if(!value.matches("\\d{1,2}"))throw new Invalid("课程节次或星期无法识别");return Integer.parseInt(value);}
 static String bounded(JSONObject row,String key,int limit)throws Invalid{String value=text(row,key);if(value.length()>limit||value.chars().anyMatch(c->c<32))throw new Invalid("课程字段过长或包含控制字符");return value;}
 static final class Event {
  final String name,code,number,room;final LocalDate date;final LocalTime start,end;
  Event(String name,String code,String number,String room,LocalDate date,LocalTime start,LocalTime end){this.name=name;this.code=code;this.number=number;this.room=room;this.date=date;this.start=start;this.end=end;}
  String occurrence(){return code+"\u0000"+number+"\u0000"+date+"\u0000"+start+"\u0000"+end;}
  String unique(){return occurrence()+"\u0000"+name+"\u0000"+room;}
  JSONObject json(){return AcademicTimetable.json("name",name,"code",code,"number",number,"room",room,"date",date.toString(),"start",start.toString(),"end",end.toString());}
 }
 static final class Snapshot {
  final String account,semester;final LocalDate start,end;final List<Event> events;final List<String> warnings;final List<String> unscheduled;final boolean scheduledComplete;final long fetchedAt;
  Snapshot(String account,String semester,LocalDate start,LocalDate end,List<Event> events,List<String> warnings,List<String> unscheduled,boolean scheduledComplete,long fetchedAt){this.account=account;this.semester=semester;this.start=start;this.end=end;this.events=Collections.unmodifiableList(new ArrayList<>(events));this.warnings=Collections.unmodifiableList(new ArrayList<>(warnings));this.unscheduled=Collections.unmodifiableList(new ArrayList<>(unscheduled));this.scheduledComplete=scheduledComplete;this.fetchedAt=fetchedAt;}
  boolean complete(){return warnings.isEmpty();}
  JSONObject json(){JSONArray rows=new JSONArray(),notes=new JSONArray(),unknown=new JSONArray();events.forEach(e->rows.put(e.json()));warnings.forEach(notes::put);unscheduled.forEach(unknown::put);return AcademicTimetable.json("account",account,"semester",semester,"termStart",start.toString(),"termEnd",end==null?JSONObject.NULL:end.toString(),"events",rows,"warnings",notes,"unscheduled",unknown,"complete",complete(),"scheduledComplete",scheduledComplete,"fetchedAt",Instant.ofEpochMilli(fetchedAt).toString());}
 }
 private static List<Event> events(JSONObject row,boolean changed,String account,LocalDate termStart,int[] longest)throws Invalid {
  String identity=text(row,"XH");if(!identity.isEmpty()&&!identity.equals(account))throw new Invalid("教务返回了其他账号的课表");
  String name=bounded(row,"KCM",200),code=bounded(row,"KCH",100),number=bounded(row,"KXH",100),room=bounded(row,changed&&!text(row,"XJASMC").isEmpty()?"XJASMC":"JASMC",200);
  if(name.isEmpty()||code.isEmpty())throw new Invalid("课程名称或标识缺失");
  String mask=text(row,changed&&!text(row,"XSKZC").isEmpty()?"XSKZC":"SKZC");
  if(!mask.matches("[01]{1,60}"))throw new Invalid("上课周次无法识别");longest[0]=Math.max(longest[0],mask.length());
  int day=integer(row,changed&&!text(row,"XSKXQ").isEmpty()?"XSKXQ":"SKXQ"),first=integer(row,changed?"XKSJC":"KSJC"),last=integer(row,changed?"XJSJC":"JSJC");
  if(day<1||day>7||first<1||first>last||last>PERIODS.length)throw new Invalid("起止节次或星期无法识别");
  List<Event> result=new ArrayList<>();for(int i=0;i<mask.length();i++)if(mask.charAt(i)=='1')result.add(new Event(name,code,number,room,termStart.plusDays(i*7L+day-1),LocalTime.parse(PERIODS[first-1][0]),LocalTime.parse(PERIODS[last-1][1])));return result;
 }
 static Snapshot normalize(JSONObject raw,String account,long now)throws Exception {
  if(account==null||!account.matches("\\d{5,20}")||!account.equals(text(raw,"account")))throw new Invalid("课表账号与当前实验账号不匹配");
  String semester=text(raw,"semester");if(!semester.matches("\\d{4}-\\d{4}-[12]"))throw new Invalid("教务学期无法识别");
  if(Integer.parseInt(semester.substring(5,9))!=Integer.parseInt(semester.substring(0,4))+1)throw new Invalid("教务学期无法识别");
  JSONObject calendar=raw.optJSONObject("calendar");if(calendar==null)throw new Invalid("教务校历缺失");LocalDate start=date(text(calendar,"XQKSRQ"));if(start.getDayOfWeek()!=DayOfWeek.MONDAY)throw new Invalid("教务学期起始日不是周一，停止自动换算");
  JSONArray courses=raw.optJSONArray("courses"),changes=raw.optJSONArray("changes"),unknown=raw.optJSONArray("notArranged");
  if(courses==null||changes==null||unknown==null)throw new Invalid("教务课表格式变化");if((long)courses.length()+changes.length()+unknown.length()>20000)throw new Invalid("课表数据过大");
  for(JSONArray rows:Arrays.asList(courses,changes,unknown))for(int i=0;i<rows.length();i++){JSONObject row=rows.optJSONObject(i);if(row==null)throw new Invalid("课程记录格式异常");String identity=text(row,"XH");if(!identity.isEmpty()&&!identity.equals(account))throw new Invalid("教务返回了其他账号的课表");}
  List<Event> result=new ArrayList<>();Set<String> warnings=new TreeSet<>();List<String> unscheduled=new ArrayList<>();int[] longest={0};
  for(int i=0;i<courses.length();i++){
   List<Event> expanded;try{expanded=events(courses.getJSONObject(i),false,account,start,longest);}catch(Invalid e){warnings.add(e.getMessage());continue;}
   if(result.size()+expanded.size()>50000)throw new Invalid("展开后的课表数据过大");result.addAll(expanded);
  }
  // Changes are supplied newest first. Each original occurrence must match before removal.
  long changeWork=0;
  for(int i=changes.length()-1;i>=0;i--){if((changeWork+=result.size()+1)>2000000)throw new Invalid("调停补课数据过大，无法完整核实");if(result.size()>49940)throw new Invalid("展开后的课表数据过大");JSONObject row=changes.getJSONObject(i);try{
   String kind=text(row,"TKLXDM");if(!Arrays.asList("01","02","03").contains(kind))throw new Invalid("存在无法识别的调停补课类型");
   List<Event> replacement=kind.equals("02")?Collections.emptyList():events(row,true,account,start,longest);
   if(!kind.equals("03")){
    Set<String> old=new HashSet<>();for(Event e:events(row,false,account,start,longest))old.add(e.occurrence());boolean matched=result.stream().anyMatch(e->old.contains(e.occurrence()));
    if(!matched){Set<String> existing=new HashSet<>();result.forEach(e->existing.add(e.occurrence()));if(!replacement.isEmpty()&&replacement.stream().allMatch(e->existing.contains(e.occurrence())))continue;throw new Invalid("调停课未匹配原课程，检查结果可能不完整");}
    result.removeIf(e->old.contains(e.occurrence()));
   }
   result.addAll(replacement);
  }catch(Invalid e){warnings.add(e.getMessage());}}
  Map<String,Event> unique=new LinkedHashMap<>();result.forEach(e->unique.put(e.unique(),e));result=new ArrayList<>(unique.values());result.sort(Comparator.comparing((Event e)->e.date).thenComparing(e->e.start).thenComparing(e->e.name));
  boolean scheduledComplete=warnings.isEmpty();for(int i=0;i<unknown.length();i++){String name=bounded(unknown.getJSONObject(i),"KCM",200);unscheduled.add(name.isEmpty()?"未命名课程":name);}if(!unscheduled.isEmpty())warnings.add("存在尚未安排时间的课程，无法检查这些课程的冲突");
  LocalDate end=text(calendar,"XQJSRQ").isEmpty()?(longest[0]==0?null:start.plusDays(longest[0]*7L-1)):date(text(calendar,"XQJSRQ"));
  if(end!=null&&(end.isBefore(start)||end.isAfter(start.plusDays(420))))throw new Invalid("教务学期结束日期无法核实");
  for(Event e:result)if(end!=null&&e.date.isAfter(end))warnings.add("课程日期超出教务校历范围");
  Snapshot snapshot=new Snapshot(account,semester,start,end,result,new ArrayList<>(warnings),unscheduled,scheduledComplete&&warnings.stream().noneMatch(w->w.equals("课程日期超出教务校历范围")),now);encodedSize(snapshot);return snapshot;
 }
 static void encodedSize(Snapshot snapshot)throws Invalid {
  long size=512;for(Event event:snapshot.events){size+=event.json().toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length+1;if(size>8*1024*1024)throw new Invalid("展开后的课表体积过大，停止导入");}
  for(String value:snapshot.unscheduled){size+=value.getBytes(java.nio.charset.StandardCharsets.UTF_8).length+8;if(size>8*1024*1024)throw new Invalid("展开后的课表体积过大，停止导入");}
 }
 static final class Interval {
  final LocalDate date;final LocalTime start,end;Interval(LocalDate date,LocalTime start,LocalTime end){this.date=date;this.start=start;this.end=end;}
  boolean same(Event event){return date.equals(event.date)&&start.equals(event.start)&&end.equals(event.end);}
 }
 static final class Conflict {
  final String status,reason;final Event event;Conflict(String status,String reason,Event event){this.status=status;this.reason=reason;this.event=event;}
 }
 static Conflict conflict(Snapshot snapshot,String account,String name,Interval actual,String period,List<Interval> enrolled,boolean fresh){
  if(snapshot==null||!snapshot.account.equals(account)||actual==null||actual.date==null||actual.start==null||actual.end==null||!actual.start.isBefore(actual.end))return new Conflict("unknown","教务课表或实验日期待核实",null);
  LocalTime begin=actual.start,end=actual.end;if("下午".equals(period)){begin=LocalTime.of(15,55);end=LocalTime.of(17,30);}else if("晚上".equals(period)){begin=LocalTime.of(19,0);end=LocalTime.of(21,25);}
  for(Event event:snapshot.events){if(!event.date.equals(actual.date)||!event.start.isBefore(end)||!begin.isBefore(event.end))continue;
   if((event.name.contains("物理实验")||event.name.equals(name))&&enrolled!=null&&enrolled.stream().anyMatch(i->i!=null&&i.same(event)))continue;
   return new Conflict("conflict","与教务课程“"+event.name+"”冲突",event);
  }
  if(!fresh||!snapshot.complete()||snapshot.end==null||actual.date.isBefore(snapshot.start)||actual.date.isAfter(snapshot.end))return new Conflict("unknown","课表未完整核实或已超出有效范围",null);
  return new Conflict("clear","",null);
 }
}
