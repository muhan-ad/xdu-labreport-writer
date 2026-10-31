package com.labmaker.app;

import android.os.SystemClock;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.nio.charset.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.regex.*;
import okhttp3.*;
import org.json.*;
import org.jsoup.Jsoup;

/** Isolated school session, serialized reads and native one-use confirmed transactions. */
@CapacitorPlugin(name="LabPortal")
public class LabPortalPlugin extends Plugin {
    private String browserAgent;
    @Override public void load(){browserAgent=android.webkit.WebSettings.getDefaultUserAgent(getContext())+" LabMakerMobile/"+BuildConfig.VERSION_NAME;}
    private final ExecutorService queue=Executors.newSingleThreadExecutor();
    private final Object lock=new Object();
    private Session session=new Session(false);
    private static final Map<String,String> PATHS=new HashMap<>();
    private static final Set<String> READS=new HashSet<>();
    static {
        PATHS.put("loginPage","");PATHS.put("login","");PATHS.put("overview","student/student.aspx");
        PATHS.put("enrolled","student/select.aspx");PATHS.put("cancellable","student/del.aspx");PATHS.put("allowedWeeks","student/addexpe.aspx");
        PATHS.put("weekForm","student/statsel.aspx");PATHS.put("weekQuery","student/statsel.aspx");
        PATHS.put("roomsForm","student/expeinfo.aspx");PATHS.put("roomsQuery","student/expeinfo.aspx");PATHS.put("scheduleForm","student/course.aspx");PATHS.put("scheduleQuery","student/course.aspx");
        READS.addAll(PATHS.keySet());
        PATHS.put("addFormPost","student/addexpe.aspx");PATHS.put("addSubmit","student/addexpe.aspx");PATHS.put("cancelSubmit","student/del.aspx");
    }
    private static class Session {
        final boolean mock;final SchoolCookies cookies;final OkHttpClient client;
        volatile Call active;volatile boolean committing;volatile String expectedAccount;volatile Long mockNow;volatile long mockElapsedOffset;
        CourseTransactions transactions;
        Session(boolean mock){this.mock=mock;cookies=new SchoolCookies(mock?"127.0.0.1":"wlsy.xidian.edu.cn");client=new OkHttpClient.Builder().cookieJar(cookies).addNetworkInterceptor(cookies).followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).connectTimeout(15,TimeUnit.SECONDS).readTimeout(40,TimeUnit.SECONDS).callTimeout(60,TimeUnit.SECONDS).build();}
        synchronized void close(){if(active!=null)active.cancel();cookies.clear();client.connectionPool().evictAll();}
    }
    private interface Job{JSONObject run(Session current)throws Exception;}
    private void check(Session s)throws CourseTransactions.Failure{if(session!=s)throw new CourseTransactions.Failure("STALE_SESSION","会话已清除，旧任务结果已丢弃");}
    private void enqueue(PluginCall call,boolean committing,Job job){
        final Session current;synchronized(lock){current=session;}
        queue.execute(()->{
            try{
                synchronized(lock){check(current);if(committing)current.committing=true;}
                JSONObject result=job.run(current);
                synchronized(lock){check(current);call.resolve(JSObject.fromJSONObject(result));}
            }catch(CourseTransactions.Failure e){JSObject details=new JSObject();details.put("needsRefresh",e.needsRefresh);call.reject(e.getMessage(),e.code,details);}
            catch(Exception e){synchronized(lock){call.reject(session==current?"学校系统连接或响应解析失败，请核对官网状态后重试":"会话已清除，旧任务结果已丢弃",session==current?"NETWORK":"STALE_SESSION");}}
            finally{synchronized(lock){if(committing)current.committing=false;current.active=null;}}
        });
    }
    private CourseTransactions engine(Session s){AcademicAuthority.init(getContext());if(s.transactions==null)s.transactions=new CourseTransactions((operation,form,mutation)->exchange(s,operation,form,mutation),()->BuildConfig.DEBUG&&s.mock&&s.mockNow!=null?s.mockNow:System.currentTimeMillis(),()->SystemClock.elapsedRealtime()+(BuildConfig.DEBUG&&s.mock?s.mockElapsedOffset:0),()->s.expectedAccount,AcademicAuthority::check);return s.transactions;}
    @PluginMethod public void clear(PluginCall call){synchronized(lock){if(session.committing){call.reject("选退课正在提交并等待回读，请完成后再清除登录","COMMIT_BUSY");return;}Session old=session;session=new Session(old.mock);old.close();}call.resolve();}
    @PluginMethod public void sessionStatus(PluginCall call){synchronized(lock){call.resolve(new JSObject().put("active",session.expectedAccount!=null));}}
    @PluginMethod public void useMock(PluginCall call){if(!BuildConfig.DEBUG){call.reject("测试入口不可用");return;}synchronized(lock){if(session.committing){call.reject("提交处理中","COMMIT_BUSY");return;}Session old=session;session=new Session(call.getBoolean("enabled",false));old.close();}call.resolve();}
    @PluginMethod public void testClock(PluginCall call){synchronized(lock){if(!BuildConfig.DEBUG||!session.mock){call.reject("测试时钟只允许用于模拟官网");return;}Object raw=call.getData().opt("now");if(raw!=null&&raw!=org.json.JSONObject.NULL&&!(raw instanceof Number)){call.reject("测试时钟无效");return;}Double wall=raw instanceof Number?((Number)raw).doubleValue():null;if(wall!=null&&(!Double.isFinite(wall)||wall<0||wall>4102444800000L||Math.rint(wall)!=wall)){call.reject("测试时钟无效");return;}Double offset=call.getDouble("elapsedOffset",0d);if(offset==null||!Double.isFinite(offset)||offset<0||offset>86400000){call.reject("测试时间偏移无效");return;}session.mockNow=wall==null?null:wall.longValue();session.mockElapsedOffset=offset.longValue();call.resolve(new JSObject().put("now",session.mockNow));}}
    @PluginMethod public void request(PluginCall call){
        String operation=call.getString("operation","");if(!READS.contains(operation)){call.reject("不允许的学校操作","OPERATION");return;}
        String savedAccountId=call.getString("savedAccountId","");if(!savedAccountId.isEmpty()&&!operation.equals("login")){call.reject("保存账号只可用于登录","FORM");return;}
        enqueue(call,false,s->{JSObject raw=call.getObject("form");Map<String,String> form=null;
            boolean metadata=operation.equals("roomsQuery")||operation.equals("scheduleQuery");boolean post=operation.equals("login")||operation.equals("weekQuery")||metadata;
            if(post){if(raw==null||raw.length()>128)throw new CourseTransactions.Failure("FORM","学校查询表单不符合协议");form=new LinkedHashMap<>();Iterator<String> keys=raw.keys();while(keys.hasNext()){String name=keys.next();Object value=raw.get(name);if(!(value instanceof String)||name.length()>200)throw new CourseTransactions.Failure("FORM","学校查询字段格式无效");
                if(metadata){if(!name.matches("[A-Za-z0-9_$.:]+")||name.matches("(?i).*(?:btnAdd|btnDel|upload|password).*"))throw new CourseTransactions.Failure("FORM","查询不允许提交选课或密码字段");}
                else if(!(name.startsWith("__")||(operation.equals("login")?name.startsWith("login1$"):name.startsWith("Header2$")||name.startsWith("Header2_"))))throw new CourseTransactions.Failure("FORM","不允许的学校查询字段");
                form.put(name,(String)value);
            }}
            if(operation.equals("login")){if(!savedAccountId.isEmpty())try{form=SchoolSavedLogin.courseForm(SchoolAccountStorage.open(getContext()),savedAccountId,form);}catch(Exception ignored){throw new CourseTransactions.Failure("ACCOUNT","已保存账号已变化或无法读取，请在账号管理中核对");}String account=form.get("login1$StuLoginID");if(account==null||!account.matches("\\d{6,30}")||s.expectedAccount!=null)throw new CourseTransactions.Failure("AUTH","登录前请先清除旧会话");s.expectedAccount=account;}
            String html=exchange(s,operation,form,false);
            if(operation.equals("login")&&!savedAccountId.isEmpty()){
                // Do not return a password-bearing login response body to the app page.
                // The following native snapshot verifies the actual logged-in identity.
                try{return new JSONObject().put("html",SchoolSavedLogin.courseResponse(html));}catch(IOException error){throw new CourseTransactions.Failure("AUTH",error.getMessage());}
            }
            return new JSONObject().put("html",html);
        });
    }
    @PluginMethod public void snapshot(PluginCall call){enqueue(call,false,s->engine(s).snapshot().json(BuildConfig.DEBUG&&s.mock&&s.mockNow!=null?s.mockNow:System.currentTimeMillis()));}
    @PluginMethod public void prepare(PluginCall call){enqueue(call,false,s->{JSONObject item=call.getObject("item");if(item==null)throw new CourseTransactions.Failure("REQUEST","缺少实验标识");return engine(s).prepare(call.getString("action",""),item,call.getArray("expectedTeachers"));});}
    @PluginMethod public void discard(PluginCall call){enqueue(call,false,s->{engine(s).discard(call.getString("ticket",""));return new JSONObject();});}
    @PluginMethod public void commit(PluginCall call){enqueue(call,true,s->engine(s).commit(call.getString("ticket",""),call.getBoolean("confirmed",false),call.getBoolean("academicUncheckedConfirmed",false)));}
    private boolean allowed(HttpUrl url,Session s){return SchoolNetworkPolicy.allowed(url,s.mock);}
    private String exchange(Session s,String operation,Map<String,String> form,boolean mutation)throws Exception{
        if(!PATHS.containsKey(operation))throw new CourseTransactions.Failure("OPERATION","未授权学校操作");
        HttpUrl url=HttpUrl.get((s.mock?"http://127.0.0.1:58441":"http://wlsy.xidian.edu.cn")+"/phyews/"+PATHS.get(operation));RequestBody body=null;
        if(form!=null){if(form.size()>128)throw new CourseTransactions.Failure("FORM","学校表单字段过多");FormBody.Builder encoded=new FormBody.Builder(StandardCharsets.UTF_8);int length=0;for(Map.Entry<String,String> field:form.entrySet()){length+=field.getKey().length()+field.getValue().length();if(length>1024*1024)throw new CourseTransactions.Failure("FORM","学校表单过大");encoded.add(field.getKey(),field.getValue());}body=encoded.build();}
        for(int redirect=0;redirect<6;redirect++){
            if(!allowed(url,s))throw new CourseTransactions.Failure("REDIRECT",SchoolNetworkPolicy.stage(operation)+"：官网跳转地址未获授权，请在官网核对");
            Request.Builder builder=new Request.Builder().url(url).header("User-Agent",browserAgent).header("Accept-Language","zh-CN,zh;q=0.9");if(body!=null)builder.post(body);
            boolean metadata=operation.startsWith("rooms")||operation.startsWith("schedule");OkHttpClient client=metadata?s.client.newBuilder().connectTimeout(5,TimeUnit.SECONDS).readTimeout(10,TimeUnit.SECONDS).callTimeout(15,TimeUnit.SECONDS).build():s.client;
            Call request=client.newCall(builder.build());synchronized(lock){check(s);s.active=request;if(mutation&&body!=null)engine(s).beforeSend();}
            try(Response response=request.execute()){
                int code=response.code();if(Arrays.asList(301,302,303,307,308).contains(code)){
                    if(mutation&&body!=null&&(code==307||code==308))throw new CourseTransactions.Failure("MUTATION_REDIRECT","官网要求重发提交，已停止并改为回读核对",true);
                    String location=response.header("Location");HttpUrl next=location==null?null:url.resolve(location);if(next==null)throw new CourseTransactions.Failure("REDIRECT","官网跳转缺少地址");if(allowed(next,s)&&SchoolNetworkPolicy.loginEntry(next)&&!operation.equals("login")&&!operation.equals("loginPage"))throw new CourseTransactions.Failure("AUTH",SchoolNetworkPolicy.stage(operation)+"：官网返回登录页，登录未生效或会话已失效，请重新登录");url=next;if(code==301||code==302||code==303)body=null;continue;
                }
                if(!response.isSuccessful())throw new CourseTransactions.Failure("HTTP_"+code,"学校系统请求失败（HTTP "+code+"）");
                ResponseBody resource=response.body();if(resource==null)throw new IOException();ByteArrayOutputStream output=new ByteArrayOutputStream();byte[] buffer=new byte[8192];int count;
                try(InputStream input=resource.byteStream()){while((count=input.read(buffer))!=-1){if(output.size()+count>4*1024*1024)throw new CourseTransactions.Failure("FORMAT","官网响应过大，停止解析");output.write(buffer,0,count);}}
                byte[] data=output.toByteArray();Charset charset=resource.contentType()==null?null:resource.contentType().charset();if(charset==null){Matcher m=Pattern.compile("charset\\s*=\\s*[\"']?([A-Za-z0-9_-]+)",Pattern.CASE_INSENSITIVE).matcher(new String(data,0,Math.min(data.length,4096),StandardCharsets.ISO_8859_1));try{charset=m.find()?Charset.forName(m.group(1)):StandardCharsets.UTF_8;}catch(Exception ignored){charset=StandardCharsets.UTF_8;}}
                String html=new String(data,charset);synchronized(lock){check(s);}
                if(html.contains("网站暂时出现故障"))throw new CourseTransactions.Failure("SCHOOL_ERROR",SchoolNetworkPolicy.stage(operation)+"：官网返回“网站暂时出现故障”，请稍后重试");
                if(!operation.equals("loginPage")&&!operation.equals("login")&&Jsoup.parse(html).getElementsByAttributeValue("name","login1$StuPassword").first()!=null)throw new CourseTransactions.Failure("AUTH","学校登录已失效，请重新登录");return html;
            }catch(IOException e){throw new CourseTransactions.Failure(SchoolNetworkPolicy.failureCode(e),SchoolNetworkPolicy.failureMessage(operation,e));}
        }throw new CourseTransactions.Failure("REDIRECT","官网重定向过多");
    }
    @Override protected void handleOnDestroy(){synchronized(lock){session.close();}queue.shutdownNow();}
}
