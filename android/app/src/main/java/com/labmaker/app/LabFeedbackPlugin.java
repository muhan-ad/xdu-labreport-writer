package com.labmaker.app;
import com.getcapacitor.*;import com.getcapacitor.annotation.CapacitorPlugin;import okhttp3.*;import java.util.concurrent.*;import java.util.concurrent.atomic.*;
@CapacitorPlugin(name="LabFeedback")
public class LabFeedbackPlugin extends Plugin {
 private static final class Task {final String id;final FeedbackUpload.Work work=new FeedbackUpload.Work();Task(String id){this.id=id;}}
 private final AtomicReference<Task> active=new AtomicReference<>();private final ExecutorService worker=Executors.newSingleThreadExecutor();
 private final OkHttpClient client=new OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).connectTimeout(15,TimeUnit.SECONDS).readTimeout(30,TimeUnit.SECONDS).writeTimeout(30,TimeUnit.SECONDS).callTimeout(45,TimeUnit.SECONDS).build();
 @PluginMethod public void cancel(PluginCall call){Task task=active.get();if(task!=null&&task.id.equals(call.getString("id","")))task.work.cancel();call.resolve();}
 @PluginMethod public void submit(PluginCall call){Task task=new Task(call.getString("id",""));if(!task.id.matches("[a-f0-9-]{36}")){call.reject("反馈标识无效");return;}if(!active.compareAndSet(null,task)){call.reject("反馈正在提交，请稍候");return;}
  worker.execute(()->{try{String text=call.getString("text",""),exp=call.getString("experiment","");org.json.JSONObject payload=FeedbackUpload.payload(text,exp,BuildConfig.VERSION_NAME,task.id);FeedbackUpload transport=new FeedbackUpload(client,HttpUrl.get(FeedbackUpload.ENDPOINT),HttpUrl.get(FeedbackUpload.DESTINATION));call.resolve(JSObject.fromJSONObject(transport.submit(payload,task.work)));}catch(Exception error){call.reject(error.getMessage()==null?"反馈未能提交，请稍后重试":error.getMessage(),"FEEDBACK_SEND");}finally{active.compareAndSet(task,null);}});
 }
 @Override protected void handleOnDestroy(){Task task=active.get();if(task!=null)task.work.cancel();worker.shutdownNow();}
}
