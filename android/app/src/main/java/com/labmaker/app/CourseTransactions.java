package com.labmaker.app;

import java.time.*;
import java.time.format.*;
import java.util.*;
import java.util.function.LongSupplier;
import java.util.regex.*;
import org.json.*;
import org.jsoup.Jsoup;
import org.jsoup.nodes.*;

/** Native authority for school operations. UI fields identify an item, never supply its eligibility. */
final class CourseTransactions {
    interface Transport { String exchange(String operation, Map<String,String> form, boolean mutation) throws Exception; }
    interface AcademicCheck {AcademicTimetable.Conflict check(String account,String name,AcademicTimetable.Interval interval,String period,List<AcademicTimetable.Interval> enrolled,long now);}
    static class Failure extends Exception {
        final String code; final boolean needsRefresh;
        Failure(String code,String message){this(code,message,false);}
        Failure(String code,String message,boolean refresh){super(message);this.code=code;needsRefresh=refresh;}
    }
    private static final ZoneOffset CST=ZoneOffset.ofHours(8);
    private static final Pattern SLOT=Pattern.compile("星期([一二三四五六日天])(?:下午|晚上|上午)?\\s*(\\d{1,2}:\\d{2})\\s*[-–—~至]\\s*(\\d{1,2}:\\d{2})");
    private final Transport transport; private final LongSupplier now,monotonic; private final java.util.function.Supplier<String> account;
    private final Map<String,Ticket> tickets=new HashMap<>();
    private Item sendingItem;private Snapshot sendingSnapshot;private String sendingAction;
    private Ticket sendingTicket;private boolean sendingAcknowledged;private final AcademicCheck academic;
    CourseTransactions(Transport transport,LongSupplier now,LongSupplier monotonic,java.util.function.Supplier<String> account){this(transport,now,monotonic,account,null);}
    CourseTransactions(Transport transport,LongSupplier now,LongSupplier monotonic,java.util.function.Supplier<String> account,AcademicCheck academic){this.transport=transport;this.now=now;this.monotonic=monotonic;this.account=account;this.academic=academic;}
    private AcademicTimetable.Conflict academicStatus(Item item,Snapshot s){
        List<AcademicTimetable.Interval> booked=new ArrayList<>();for(Item old:s.enrolled){LocalDate date=resolve(old,s);if(date!=null&&old.start!=null&&old.end!=null)booked.add(new AcademicTimetable.Interval(date,old.start,old.end));}
        AcademicTimetable.Interval interval=new AcademicTimetable.Interval(resolve(item,s),item.start,item.end);String period=item.time.contains("下午")?"下午":item.time.contains("晚上")?"晚上":"";
        return academic==null?new AcademicTimetable.Conflict("unknown","教务课表冲突尚未校验",null):academic.check(s.account,item.name,interval,period,booked,now.getAsLong());
    }
    private void verifyAcademic(Item item,Snapshot s,Ticket ticket,boolean acknowledged,String code)throws Failure{
        AcademicTimetable.Conflict result=academicStatus(item,s);
        if(result.status.equals("conflict"))throw new Failure(code,result.reason);
        if(!result.status.equals("clear")){
            if(ticket.academicChecked)throw new Failure(code,"教务状态已变化，请重新选择并确认",true);
            if(!acknowledged)throw new Failure(code,"教务冲突尚未校验，请先确认该状态");
        }
    }
    private static JSONObject json(Object...pairs)throws JSONException{JSONObject o=new JSONObject();for(int i=0;i<pairs.length;i+=2)o.put((String)pairs[i],pairs[i+1]);return o;}
    private static Matcher match(String expression,String value){Matcher m=Pattern.compile(expression).matcher(value);return m.find()?m:null;}
    private static String clean(String value){return value.replaceAll("[（(]\\s*\\d+\\s*学时[）)].*$", "").trim();}
    private static String normalizeTime(String value){return value.replaceAll("\\s+","").replace('天','日').replace('—','-').replace('–','-').replace('~','-').replace('至','-');}
    private static List<Element> cells(Element row){List<Element> result=new ArrayList<>();for(Element cell:row.children())if(cell.normalName().equals("td")||cell.normalName().equals("th"))result.add(cell);return result;}
    private static Document page(String html){Document p=Jsoup.parse(html);p.select("script,style").remove();return p;}
    private Document get(String operation)throws Exception{return page(transport.exchange(operation,null,false));}
    private static Element control(Document doc,String id)throws Failure{Element e=doc.getElementById(id);if(e==null)e=doc.getElementsByAttributeValue("name",id).first();if(e==null||e.attr("name").isEmpty())throw new Failure("FORMAT","官网控件已变化，请刷新后在官网核对");return e;}
    private static Map<String,String> form(Document page)throws Failure{
        Element root=page.selectFirst("form");if(root==null)throw new Failure("FORMAT","官网表单缺失，请重新登录");
        Map<String,String> result=new LinkedHashMap<>();
        for(Element e:root.select("input[name]")){String type=e.attr("type").toLowerCase(Locale.ROOT);if(e.hasAttr("disabled")||Arrays.asList("image","submit","button","reset","file").contains(type)||((type.equals("checkbox")||type.equals("radio"))&&!e.hasAttr("checked")))continue;result.put(e.attr("name"),e.attr("value"));}
        for(Element e:root.select("select[name]")){if(e.hasAttr("disabled"))continue;Element selected=e.selectFirst("option[selected]");if(selected==null&&!e.hasAttr("size"))selected=e.selectFirst("option");if(selected!=null)result.put(e.attr("name"),selected.hasAttr("value")?selected.attr("value"):selected.text());}
        return result;
    }
    private static Map<String,String> options(Document doc,String id)throws Failure{
        Element select=control(doc,id);if(select.hasAttr("disabled"))throw new Failure("CHANGED","官网已禁用此查询或选课控件");Map<String,String> values=new LinkedHashMap<>();
        for(Element option:select.select("option"))if(!option.hasAttr("disabled")){String key=option.hasAttr("value")?option.attr("value"):option.text();if(values.containsKey(key))throw new Failure("FORMAT","官网选项不唯一，请重新核对");values.put(key,option.text());}return values;
    }
    private Document post(String operation,Document doc,Map<String,String> changes,String event,String button,boolean mutation)throws Exception{
        Map<String,String> values=form(doc);values.putAll(changes);values.put("__EVENTTARGET",event);values.put("__EVENTARGUMENT","");
        if(button!=null){Element b=control(doc,button);if(b.hasAttr("disabled"))throw new Failure("CHANGED","官网当前不允许这项操作");String name=b.attr("name");if(b.attr("type").equalsIgnoreCase("image")){values.put(name+".x","8");values.put(name+".y","8");}else values.put(name,b.attr("value"));}
        if(mutation)beforeSend();return page(transport.exchange(operation,values,mutation));
    }
    private static LocalDate date(String raw){for(String pattern:Arrays.asList("uuuu/M/d","M/d/uuuu","uuuu-M-d"))try{return LocalDate.parse(raw.trim(),DateTimeFormatter.ofPattern(pattern,Locale.ROOT).withResolverStyle(ResolverStyle.STRICT));}catch(Exception ignored){}return null;}
    private static LocalTime clock(String raw){try{return LocalTime.parse(raw,DateTimeFormatter.ofPattern("H:mm",Locale.ROOT).withResolverStyle(ResolverStyle.STRICT));}catch(Exception e){return null;}}
    static final class Item {
        String name,time,room="",period;int week,hours,day,remaining;LocalDate date;LocalTime start,end;boolean officialCancellable;
        boolean same(Item other){return name.equals(other.name)&&week==other.week&&normalizeTime(time).equals(normalizeTime(other.time));}
        JSONObject json(Snapshot snapshot,long now)throws Exception{LocalDate d=resolve(this,snapshot);String reason=cancelReason(this,snapshot,now);return CourseTransactions.json("name",name,"week",week,"time",time,"date",d==null?"":d.toString(),"room",room,"hours",hours,"day",day,"period",period==null?"":period,"start",start==null?"":start.toString(),"end",end==null?"":end.toString(),"remaining",remaining,"officialCancellable",officialCancellable,"cancellable",reason.isEmpty(),"cancelReason",reason);}
    }
    static final class Snapshot {
        String name,account;int required,limit,selected,currentWeek;List<Item> enrolled=new ArrayList<>();Set<Integer> weeks=new LinkedHashSet<>();LocalDate semesterStart;
        JSONObject json(long now)throws Exception{JSONArray items=new JSONArray();for(Item i:enrolled)items.put(i.json(this,now));JSONObject anchor=semesterStart==null?null:CourseTransactions.json("date",semesterStart.toString(),"week",1,"day",1);return CourseTransactions.json("identity",CourseTransactions.json("name",name,"account",account),"rules",CourseTransactions.json("requiredHours",required,"weeklyHourLimit",limit,"selectedHours",selected),"currentWeek",currentWeek==0?JSONObject.NULL:currentWeek,"enrolled",items,"allowedWeeks",new JSONArray(weeks),"calendarAnchor",anchor==null?JSONObject.NULL:anchor,"fetchedAt",Instant.ofEpochMilli(now).toString());}
    }
    private static int number(String body,String expression)throws Failure{Matcher m=match(expression,body);try{if(m!=null){int n=Integer.parseInt(m.group(1));if(n>=0&&n<=10000)return n;}}catch(Exception ignored){}throw new Failure("FORMAT","官网学时信息无法识别，停止使用旧数据");}
    private static void time(Item item){Matcher m=SLOT.matcher(item.time);if(!m.find())return;item.day="一二三四五六日".indexOf(m.group(1).replace('天','日'))+1;item.start=clock(m.group(2));item.end=clock(m.group(3));}
    private List<Item> enrolled(Document doc)throws Failure{
        List<Item> items=new ArrayList<>();for(Element row:doc.select("tr")){List<Element> c=cells(row);if(c.size()!=10||!c.get(0).text().matches("\\d+"))continue;
            Item item=new Item();item.name=clean(c.get(1).text());try{item.week=Integer.parseInt(c.get(2).text());}catch(Exception e){throw new Failure("FORMAT","官网周次无法识别");}item.time=c.get(3).text();item.date=date(c.get(4).text());item.room=c.get(5).text();Matcher hours=match("(\\d+)\\s*学时",c.get(1).text());item.hours=hours==null?-1:Integer.parseInt(hours.group(1));time(item);items.add(item);
        }if(items.isEmpty()&&!doc.text().contains("实验项目"))throw new Failure("FORMAT","官网已选课表格式变化，未将空结果当作成功");return items;
    }
    private static List<Item> cancellable(Document doc)throws Failure{
        if(!doc.text().contains("取消"))throw new Failure("FORMAT","官网退课页面无法识别");List<Item> items=new ArrayList<>();
        for(Element row:doc.select("tr")){List<Element> c=cells(row);Element radio=row.selectFirst("input[type=radio]");if(c.size()!=6||radio==null||radio.hasAttr("disabled")||!c.get(0).text().matches("\\d+"))continue;Item item=new Item();item.name=clean(c.get(1).text());try{item.week=Integer.parseInt(c.get(2).text());}catch(Exception e){continue;}item.time=c.get(3).text();items.add(item);}return items;
    }
    Snapshot snapshot()throws Exception{
        if(account.get()==null)throw new Failure("AUTH","请先登录学校实验系统");
        Document main=get("overview");String body=main.text();Matcher who=match("([^\\s（）()]+)\\s*[（(](\\d+)[）)]\\s*同学",body);if(who==null)throw new Failure("FORMAT","官网账号身份无法核实");
        Snapshot s=new Snapshot();s.name=who.group(1);s.account=who.group(2);if(!s.account.equals(account.get()))throw new Failure("AUTH","官网返回的账号身份不一致，请清除会话重新登录");
        s.required=number(body,"必须完成的实验项目总学时数为\\s*(\\d+)");s.limit=number(body,"每周可选的实验项目总学时数为\\s*(\\d+)");s.selected=number(body,"已选实验项目的总学时数为\\s*(\\d+)");Matcher week=match("第\\s*(\\d+)\\s*周",body);s.currentWeek=week==null?0:Integer.parseInt(week.group(1));
        s.enrolled=enrolled(get("enrolled"));List<Item> allowed=cancellable(get("cancellable"));for(Item item:s.enrolled)item.officialCancellable=allowed.stream().anyMatch(item::same);
        for(String value:options(get("allowedWeeks"),"ExpeWeekList").keySet())if(value.matches("\\d+")){int n=Integer.parseInt(value);if(n>=1&&n<=60)s.weeks.add(n);}
        Set<LocalDate> anchors=new HashSet<>();boolean contradictory=false;
        for(Item i:s.enrolled)if(i.date!=null&&i.day>0&&i.week>0){if(i.date.getDayOfWeek().getValue()!=i.day)contradictory=true;anchors.add(i.date.minusDays((i.week-1)*7L+i.day-1));}
        Matcher calendar=match("(\\d{4})年\\s*(\\d{1,2})月\\s*(\\d{1,2})日.*?星期([一二三四五六日天])",body);
        if(calendar!=null&&s.currentWeek>0){LocalDate d=date(calendar.group(1)+"/"+calendar.group(2)+"/"+calendar.group(3));int day="一二三四五六日".indexOf(calendar.group(4).replace('天','日'))+1;if(d!=null){if(d.getDayOfWeek().getValue()!=day)contradictory=true;anchors.add(d.minusDays((s.currentWeek-1)*7L+day-1));}}
        if(!contradictory&&anchors.size()==1)s.semesterStart=anchors.iterator().next();return s;
    }
    private static LocalDate resolve(Item item,Snapshot snapshot){if(item.date!=null)return item.date;if(snapshot.semesterStart==null||item.day<1||item.week<1)return null;return snapshot.semesterStart.plusDays((item.week-1)*7L+item.day-1);}
    private static Long start(Item item,Snapshot snapshot){LocalDate d=resolve(item,snapshot);return d==null||item.start==null?null:d.atTime(item.start).toInstant(CST).toEpochMilli();}
    static String cancelReason(Item item,Snapshot s,long now){Long start=start(item,s);if(start==null)return "实验时间待核实";if(start<=now)return "已开始";if(start-now<=72*3600000L)return "距开始不足72小时（含72小时）";return item.officialCancellable?"":"官网当前不允许取消";}
    private List<Item> availability(int week)throws Exception{
        Document page=get("weekForm");if(!options(page,"Header2_ExpeWeekList").containsKey(String.valueOf(week)))throw new Failure("CHANGED","官网未提供此查询周次");String weekName=control(page,"Header2_ExpeWeekList").attr("name");
        Document result=post("weekQuery",page,Collections.singletonMap(weekName,String.valueOf(week)),"","Header2_btnSubmit",false);
        if(match("第\\s*"+week+"\\s*周可选",result.text())==null)throw new Failure("FORMAT","官网返回的查询周次不匹配");List<Item> items=new ArrayList<>();int projects=0;
        Pattern pattern=Pattern.compile("(星期([一二三四五])(下午|晚上)\\s*(\\d{2}:\\d{2})\\s*-\\s*(\\d{2}:\\d{2}))\\s*\\((\\d+)\\)");
        for(Element row:result.select("tr")){List<Element> c=cells(row);if(c.size()!=2||c.get(0).selectFirst("table")!=null)continue;Matcher hours=match("(\\d+)\\s*学时",c.get(0).text());if(hours==null)continue;projects++;Matcher m=pattern.matcher(c.get(1).text());while(m.find()){Item item=new Item();item.name=clean(c.get(0).text());item.hours=Integer.parseInt(hours.group(1));item.week=week;item.time=m.group(1).replaceAll("\\s","");item.day="一二三四五".indexOf(m.group(2))+1;item.period=m.group(3).equals("下午")?"B":"C";item.start=clock(m.group(4));item.end=clock(m.group(5));item.remaining=Integer.parseInt(m.group(6));items.add(item);}}
        if(projects==0)throw new Failure("FORMAT","官网可选场次表结构变化");return items;
    }
    private static String eligible(Item item,Snapshot s,long now){
        if(item.remaining<=0)return "此场次已无名额，请刷新";if(s.currentWeek==0)return "当前周次待核实";if(!s.weeks.contains(item.week)||item.week<s.currentWeek)return "官网当前不允许选择此周次";
        Long begin=start(item,s);if(begin==null||item.end==null||!item.start.isBefore(item.end))return "场次日期或时间待核实";if(begin<=now)return "此场次已经开始，不能选择";
        int hours=0;LocalDate d=resolve(item,s);for(Item old:s.enrolled){if(old.name.equals(item.name))return "你已经选过该实验";if(old.week!=item.week)continue;if(old.hours<0)return "已选实验学时待核实";hours+=old.hours;LocalDate oldDate=resolve(old,s);if(oldDate==null||old.start==null||old.end==null)return "已选实验时间待核实，无法校验冲突";if(d.equals(oldDate)&&item.start.isBefore(old.end)&&old.start.isBefore(item.end))return "该场次与已选实验时间冲突";}
        return item.hours<1?"实验学时待核实":hours+item.hours>s.limit?"此周会超过官网每周学时上限":"";
    }
    private static Item key(JSONObject raw)throws Failure{Item item=new Item();item.name=raw.optString("name","").trim();item.time=raw.optString("time","").trim();item.week=raw.optInt("week",-1);if(item.name.isEmpty()||item.name.length()>200||item.time.length()>100||item.week<1||item.week>60||!SLOT.matcher(item.time).find())throw new Failure("REQUEST","实验标识无效");return item;}
    private static Item unique(List<Item> items,Item key)throws Failure{List<Item> found=new ArrayList<>();for(Item i:items)if(i.same(key))found.add(i);if(found.size()!=1)throw new Failure("CHANGED","官网当前场次缺失或不唯一，请刷新重新选择");return found.get(0);}
    private Document prepareAdd(Item item)throws Exception{
        Document page=get("allowedWeeks");String week=String.valueOf(item.week),weekName=control(page,"ExpeWeekList").attr("name");if(!options(page,"ExpeWeekList").containsKey(week))throw new Failure("CHANGED","该周已不在官网可选范围");
        page=post("addFormPost",page,Collections.singletonMap(weekName,week),weekName,null,false);String timeCode=item.day+item.period,timeName=control(page,"ExpeTimeList").attr("name");if(!options(page,"ExpeTimeList").containsKey(timeCode))throw new Failure("CHANGED","该时段已不可选");
        page=post("addFormPost",page,Collections.singletonMap(timeName,timeCode),timeName,null,false);
        List<String> categories=new ArrayList<>(options(page,"ExpeClassList").keySet());if(categories.size()>40)throw new Failure("FORMAT","官网实验分类数量异常");
        String value=findExperiment(page,item.name);
        for(String category:categories){if(value!=null)break;String name=control(page,"ExpeClassList").attr("name");page=post("addFormPost",page,Collections.singletonMap(name,category),name,null,false);value=findExperiment(page,item.name);}
        if(value==null)throw new Failure("CHANGED","官网当前没有此实验选项，请刷新");String name=control(page,"ExpeNameList").attr("name");page=post("addFormPost",page,Collections.singletonMap(name,value),name,null,false);
        if(!value.equals(findExperiment(page,item.name)))throw new Failure("CHANGED","官网实验选项已变化，请重新选择");
        Map<String,String> selected=form(page);
        if(!week.equals(selected.get(control(page,"ExpeWeekList").attr("name")))||!timeCode.equals(selected.get(control(page,"ExpeTimeList").attr("name")))||!value.equals(selected.get(name)))throw new Failure("CHANGED","官网未保留所选周次、时间或实验，请重新选择");
        Element button=control(page,"btnAdd");if(button.hasAttr("disabled"))throw new Failure("CHANGED","官网当前不允许选课");return page;
    }
    private static String findExperiment(Document page,String expected)throws Failure{String result=null;for(Map.Entry<String,String> option:options(page,"ExpeNameList").entrySet())if(clean(option.getValue()).equals(expected)){if(result!=null)throw new Failure("FORMAT","官网实验选项不唯一");result=option.getKey();}return result;}
    private void verifyTeachers(Item item,List<String> expected)throws Exception{
        if(expected.isEmpty())return;Document page=get("scheduleForm");List<Element> matches=new ArrayList<>();for(Element select:page.select("select[name]"))for(Element option:select.select("option"))if(metadataKey(option.text()).equals(metadataKey(item.name)))matches.add(option);
        boolean scoped=false;if(matches.size()>1)throw new Failure("TEACHER","教师查询范围不唯一");
        if(matches.size()==1){Element option=matches.get(0),select=option.parent();Map<String,String> changes=new HashMap<>();changes.put(select.attr("name"),option.hasAttr("value")?option.attr("value"):option.text());String event="",button=null;
            List<Element> buttons=new ArrayList<>();for(Element b:page.select("input[name]"))if(Arrays.asList("submit","image").contains(b.attr("type").toLowerCase(Locale.ROOT))&&((b.attr("value")+b.attr("alt")).matches("(?s).*(?:查询|检索).*")||b.attr("name").matches("(?i).*btn(?:Submit|Query|Search)$")))buttons.add(b);
            if(buttons.size()==1)button=buttons.get(0).attr("name");else if(select.attr("name").equals("plan1$ExpeList")||select.attr("onchange").contains("__doPostBack"))event=select.attr("name");else throw new Failure("TEACHER","教师查询控件无法核实");
            page=post("scheduleQuery",page,changes,event,button,false);scoped=true;
        }
        Set<String> confirmed=null;boolean ambiguous=false;
        for(Element table:page.select("table")){List<List<String>> rows=grid(table);for(int r=0;r<rows.size();r++){
            List<String> h=rows.get(r);int teacher=column(h,"任课教师","指导教师","教师"),time=column(h,"上课时间","实验时间","时间安排","上课时段","实验时段"),first=column(h,"开始周","起始周","起止周"),last=column(h,"结束周","终止周"),name=column(h,"实验名称","实验项目","项目名称"),parity=column(h,"单双周"),active=column(h,"是否开课","开课状态");
            if(teacher<0||time<0||first<0||(name<0&&!scoped))continue;
            for(List<String> c:rows.subList(r+1,rows.size())){if(Collections.max(Arrays.asList(teacher,time,first,last,name,parity,active))>=c.size())continue;if(name>=0&&!metadataKey(c.get(name)).equals(metadataKey(item.name)))continue;if(active>=0&&Arrays.asList("否","不开课","停课").contains(c.get(active)))continue;
                Matcher slot=SLOT.matcher(c.get(time));List<Integer> begins=digits(c.get(first)),ends=last>=0?digits(c.get(last)):begins.size()>1?begins.subList(1,begins.size()):Collections.emptyList();if(!slot.find()||begins.isEmpty()||ends.isEmpty()||!normalizeTime(slot.group()).equals(normalizeTime(item.time))||item.week<begins.get(0)||item.week>ends.get(ends.size()-1))continue;
                String cycle=parity>=0?c.get(parity).trim():"";if(!Arrays.asList("","每周","全部","单周","双周","单","双").contains(cycle)||(Arrays.asList("单周","单").contains(cycle)&&item.week%2==0)||(Arrays.asList("双周","双").contains(cycle)&&item.week%2==1))continue;
                Set<String> names=new TreeSet<>();for(String n:c.get(teacher).split("[／/、,，]"))if(!n.trim().isEmpty())names.add(n.trim());if(names.isEmpty())continue;if(confirmed==null)confirmed=names;else if(!confirmed.equals(names))ambiguous=true;
            }break;
        }}
        if(ambiguous||confirmed==null||!confirmed.equals(new TreeSet<>(expected)))throw new Failure("TEACHER","教师安排已变化或无法唯一核实，请重新选择");
    }
    private static int column(List<String> values,String...labels){for(int i=0;i<values.size();i++)for(String label:labels)if(values.get(i).replaceAll("\\s+","").contains(label))return i;return -1;}
    private static String metadataKey(String value){return value.replaceAll("\\s+","").replaceAll("(?:[（(]\\d+学时[）)]|\\d+学时).*$","");}
    private static List<List<String>> grid(Element table)throws Failure{
        List<List<String>> result=new ArrayList<>();Map<Integer,Map<Integer,String>> occupied=new HashMap<>();int r=0;
        for(Element row:table.select("tr")){if(row.closest("table")!=table)continue;if(r>3000)throw new Failure("FORMAT","官网教师表过大");Map<Integer,String> values=new TreeMap<>(occupied.getOrDefault(r,Collections.emptyMap()));int c=0;
            for(Element cell:cells(row)){if(cell.selectFirst("table")!=null)continue;while(values.containsKey(c))c++;int width=1,height=1;try{if(cell.hasAttr("colspan"))width=Math.max(1,Math.min(30,Integer.parseInt(cell.attr("colspan"))));if(cell.hasAttr("rowspan"))height=Math.max(1,Math.min(200,Integer.parseInt(cell.attr("rowspan"))));}catch(Exception e){throw new Failure("FORMAT","官网教师表跨度无法核实");}if(c+width>256)throw new Failure("FORMAT","官网教师表列数异常");for(int cc=c;cc<c+width;cc++){values.put(cc,cell.text());for(int rr=r+1;rr<r+height;rr++)occupied.computeIfAbsent(rr,k->new HashMap<>()).put(cc,cell.text());}c+=width;}
            if(!values.isEmpty()){int last=Collections.max(values.keySet());List<String> line=new ArrayList<>();for(int i=0;i<=last;i++)line.add(values.getOrDefault(i,""));result.add(line);}occupied.remove(r);r++;
        }return result;
    }
    private static List<Integer> digits(String text){List<Integer> values=new ArrayList<>();Matcher m=Pattern.compile("\\d+").matcher(text);while(m.find())try{values.add(Integer.parseInt(m.group()));}catch(Exception ignored){}return values;}
    private static List<String> teachers(JSONArray raw)throws Failure{List<String> values=new ArrayList<>();if(raw==null)return values;if(raw.length()>8)throw new Failure("REQUEST","教师标识无效");for(int i=0;i<raw.length();i++){String name=raw.optString(i,"").trim();if(name.isEmpty()||name.length()>60||values.contains(name))throw new Failure("REQUEST","教师标识无效");values.add(name);}return values;}
    private static class Ticket{String action,account;Item item;List<String> teachers;long expires;boolean academicChecked;}
    JSONObject prepare(String action,JSONObject raw,JSONArray expected)throws Exception{
        if(!action.equals("add")&&!action.equals("cancel"))throw new Failure("REQUEST","选退课操作无效");Snapshot s=snapshot();Item requested=key(raw),item;List<String> names=teachers(expected);
        if(action.equals("add")){if(!s.weeks.contains(requested.week))throw new Failure("CHANGED","官网当前不允许此周次");item=unique(availability(requested.week),requested);String reason=eligible(item,s,now.getAsLong());if(!reason.isEmpty())throw new Failure("ELIGIBILITY",reason);AcademicTimetable.Conflict early=academicStatus(item,s);if(early.status.equals("conflict"))throw new Failure("ACADEMIC_CONFLICT",early.reason);verifyTeachers(item,names);prepareAdd(item);}
        else{item=unique(s.enrolled,requested);String reason=cancelReason(item,s,now.getAsLong());if(!reason.isEmpty())throw new Failure("CANCEL_POLICY",reason);}
        String token=UUID.randomUUID().toString()+UUID.randomUUID().toString();Ticket t=new Ticket();t.action=action;t.account=s.account;t.item=item;t.teachers=names;t.expires=monotonic.getAsLong()+120000;tickets.clear();tickets.put(token,t);
        AcademicTimetable.Conflict academicResult=action.equals("add")?academicStatus(item,s):null;if(academicResult!=null&&academicResult.status.equals("conflict")){tickets.remove(token);throw new Failure("ACADEMIC_CONFLICT",academicResult.reason);}t.academicChecked=academicResult!=null&&academicResult.status.equals("clear");
        return json("ticket",token,"item",item.json(s,now.getAsLong()),"action",action,"expiresIn",120,"expectedTeachers",new JSONArray(names),"academicChecked",t.academicChecked);
    }
    void discard(String token){tickets.remove(token);}
    void beforeSend()throws Failure{if(sendingItem==null)return;if(sendingTicket.expires<=monotonic.getAsLong())throw new Failure("PRE_SUBMIT_POLICY","确认已过期，请重新选择");if(sendingAction.equals("add"))verifyAcademic(sendingItem,sendingSnapshot,sendingTicket,sendingAcknowledged,"PRE_SUBMIT_POLICY");if(sendingTicket.expires<=monotonic.getAsLong())throw new Failure("PRE_SUBMIT_POLICY","确认已过期，请重新选择");String reason=sendingAction.equals("add")?eligible(sendingItem,sendingSnapshot,now.getAsLong()):cancelReason(sendingItem,sendingSnapshot,now.getAsLong());if(!reason.isEmpty())throw new Failure("PRE_SUBMIT_POLICY",reason);}
    JSONObject commit(String token,boolean confirmed,boolean academicAcknowledged)throws Exception{
        Ticket t=tickets.remove(token);if(t==null||t.expires<=monotonic.getAsLong())throw new Failure("TICKET","确认已过期或已提交，请重新选择");
        if(!confirmed)throw new Failure("CONFIRM","必须在确认框中确认后提交");
        Snapshot before=snapshot();if(!before.account.equals(t.account))throw new Failure("AUTH","账号已变化，旧确认已失效");Item item;
        if(t.action.equals("add")){if(!before.weeks.contains(t.item.week))throw new Failure("CHANGED","官网周次已变化");item=unique(availability(t.item.week),t.item);String reason=eligible(item,before,now.getAsLong());if(!reason.isEmpty())throw new Failure("ELIGIBILITY",reason);verifyAcademic(item,before,t,academicAcknowledged,"ACADEMIC_UNCHECKED");verifyTeachers(item,t.teachers);Document form=prepareAdd(item);reason=eligible(item,before,now.getAsLong());if(!reason.isEmpty())throw new Failure("ELIGIBILITY",reason);sendingAcknowledged=academicAcknowledged;return submit(t,item,before,"addSubmit",form,Collections.emptyMap(),"btnAdd");}
        item=unique(before.enrolled,t.item);String reason=cancelReason(item,before,now.getAsLong());if(!reason.isEmpty())throw new Failure("CANCEL_POLICY",reason);Document form=get("cancellable");List<Element> radios=new ArrayList<>();for(Element row:form.select("tr")){List<Element> c=cells(row);Element radio=row.selectFirst("input[type=radio]");if(c.size()==6&&radio!=null&&!radio.hasAttr("disabled")&&clean(c.get(1).text()).equals(item.name)&&c.get(2).text().equals(String.valueOf(item.week))&&normalizeTime(c.get(3).text()).equals(normalizeTime(item.time)))radios.add(radio);}
        if(radios.size()!=1)throw new Failure("CHANGED","官网已不允许取消此实验");reason=cancelReason(item,before,now.getAsLong());if(!reason.isEmpty())throw new Failure("CANCEL_POLICY",reason);Element radio=radios.get(0);return submit(t,item,before,"cancelSubmit",form,Collections.singletonMap(radio.attr("name"),radio.hasAttr("value")?radio.attr("value"):"rb"),"btnDel");
    }
    private JSONObject submit(Ticket ticket,Item item,Snapshot before,String operation,Document form,Map<String,String> changes,String button)throws Exception{
        Exception outcome=null;sendingItem=item;sendingSnapshot=before;sendingAction=ticket.action;sendingTicket=ticket;
        try{post(operation,form,changes,"",button,true);}catch(Failure e){if(e.code.equals("PRE_SUBMIT_POLICY")||e.code.equals("CHANGED")||e.code.equals("FORMAT"))throw e;outcome=e;}catch(Exception e){outcome=e;}finally{sendingItem=null;sendingSnapshot=null;sendingAction=null;sendingTicket=null;sendingAcknowledged=false;}
        Snapshot after;try{after=snapshot();}catch(Exception e){throw new Failure("OUTCOME_UNKNOWN","提交后无法回读官网，结果尚未确认。请刷新核对，不要直接重试提交",true);}
        boolean present=after.enrolled.stream().anyMatch(item::same),expected=ticket.action.equals("add");
        if(present!=expected)throw new Failure(outcome==null?"NOT_CONFIRMED":"OUTCOME_UNKNOWN",outcome==null?"官网课表未确认操作成功，请刷新核对后重新选择":"提交结果尚未确认，请刷新核对；该票据已失效，不会自动重发",true);
        return json("message",expected?"选课成功":"已取消选课","overview",after.json(now.getAsLong()),"verified",true);
    }
}
