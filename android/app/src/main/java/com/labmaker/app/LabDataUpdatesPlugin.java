package com.labmaker.app;
import com.getcapacitor.*;import com.getcapacitor.annotation.CapacitorPlugin;import okhttp3.*;import org.json.*;import java.io.IOException;import java.util.concurrent.*;import java.util.concurrent.atomic.*;

@CapacitorPlugin(name="LabDataUpdates")
public class LabDataUpdatesPlugin extends Plugin {
 private static final class Task {final String id;final MobileDataDownload.Work work=new MobileDataDownload.Work();Task(String id){this.id=id;}}
 private final AtomicReference<Task> active=new AtomicReference<>();private final ExecutorService worker=Executors.newSingleThreadExecutor();
 private final MobileDataDownload download=new MobileDataDownload(new OkHttpClient.Builder().connectTimeout(10,TimeUnit.SECONDS).readTimeout(20,TimeUnit.SECONDS).callTimeout(60,TimeUnit.SECONDS).build(),HttpUrl.get(MobileDataDownload.ORIGIN));
 @PluginMethod public void cancel(PluginCall call){Task task=active.get();if(task!=null&&task.id.equals(call.getString("id","")))task.work.cancel();call.resolve();}
 @PluginMethod public void manifest(PluginCall call){start(call,true);}
 @PluginMethod public void bundle(PluginCall call){start(call,false);}
 private void start(PluginCall call,boolean manifest){
  String id=call.getString("id","");if(!id.matches("[a-f0-9-]{36}")){call.reject("更新请求标识无效","DATA_ID");return;}
  Task task=new Task(id);if(!active.compareAndSet(null,task)){call.reject("更新下载正在进行，请稍候重试","DATA_BUSY");return;}
  worker.execute(()->{try{
   final long[] last={0};MobileDataDownload.Progress progress=(bytes,total)->{if(task.work.cancelled.get()||active.get()!=task)return;long now=android.os.SystemClock.elapsedRealtime();if(now-last[0]<80&&bytes!=total)return;last[0]=now;notifyListeners("progress",new JSObject().put("id",id).put("bytes",bytes).put("total",total));};
   JSONObject result=manifest?download.manifest(task.work,progress):download.bundle(call.getString("url",""),call.getString("version",""),call.getData().optLong("size",-1),call.getString("sha256",""),task.work,progress);
   if(task.work.cancelled.get())throw new IOException("更新下载已停止");result.put("id",id);call.resolve(JSObject.fromJSONObject(result));
  }catch(Exception error){call.reject(task.work.cancelled.get()?"更新下载已停止":error instanceof IOException&&error.getMessage()!=null&&error.getMessage().startsWith("更新")?error.getMessage():"更新服务连接失败，请检查网络后重试",task.work.cancelled.get()?"DATA_CANCELLED":"DATA_DOWNLOAD");}
   finally{active.compareAndSet(task,null);}
  });
 }
 @Override protected void handleOnDestroy(){Task task=active.get();if(task!=null)task.work.cancel();worker.shutdownNow();}
}
