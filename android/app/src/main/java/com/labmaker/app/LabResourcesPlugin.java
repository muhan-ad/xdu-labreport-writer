package com.labmaker.app;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.zip.*;
import org.json.*;

@CapacitorPlugin(name="LabResources")
public class LabResourcesPlugin extends Plugin {
 private static final class Work {final String id;final AtomicBoolean cancelled=new AtomicBoolean();Work(String id){this.id=id;}}
 private final AtomicReference<Work> active=new AtomicReference<>();
 private final ExecutorService worker=Executors.newSingleThreadExecutor();
 @PluginMethod public void cancel(PluginCall call){Work work=active.get();if(work!=null&&work.id.equals(call.getString("id","")))work.cancelled.set(true);call.resolve();}
 @PluginMethod public void check(PluginCall call){start(call,false);}
 @PluginMethod public void refresh(PluginCall call){start(call,true);}
 private void start(PluginCall call,boolean refresh){
  String id=call.getString("id","");if(!id.matches("[a-f0-9-]{36}")){call.reject("检查标识无效","RESOURCE_ID");return;}Work work=new Work(id);
  if(!active.compareAndSet(null,work)){call.reject("资源检查正在进行，请稍候","RESOURCE_BUSY");return;}
  worker.execute(()->{List<ZipFile> apks=new ArrayList<>();try{
   String[] splits=getContext().getApplicationInfo().splitSourceDirs;List<String> sources=new ArrayList<>();sources.add(getContext().getApplicationInfo().sourceDir);if(splits!=null)sources.addAll(Arrays.asList(splits));for(String source:sources)apks.add(new ZipFile(source));
   JSONObject manifest;try(InputStream in=getContext().getAssets().open("resource-integrity.json")){ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] block=new byte[8192];int n;while((n=in.read(block))!=-1){if(out.size()+n>8*1024*1024)throw new IOException();out.write(block,0,n);}manifest=new JSONObject(out.toString(StandardCharsets.UTF_8.name()));}
   if(!BuildConfig.VERSION_NAME.equals(manifest.optString("version")))throw new IOException("资源清单与应用版本不一致");
   final long[] emitted={0};JSONObject result=ResourceIntegrity.check(manifest,path->{for(ZipFile apk:apks){ZipEntry entry=apk.getEntry(path);if(entry!=null&&!entry.isDirectory())return apk.getInputStream(entry);}throw new FileNotFoundException();},work.cancelled,(checked,total,bytes,path)->{
    long now=android.os.SystemClock.elapsedRealtime();if(now-emitted[0]<80&&checked!=total)return;emitted[0]=now;
    notifyListeners("progress",new JSObject().put("id",id).put("checked",checked).put("total",total).put("bytes",bytes).put("path",path));
   });
   if(refresh && result.getBoolean("complete") && !work.cancelled.get()){
    if(getActivity()==null)throw new IOException("当前页面已关闭，缓存未刷新");
    ResourceCacheReset.run(result,work.cancelled,()->active.get()==work,task->getActivity().runOnUiThread(task),()->{
     if(getBridge()==null||getBridge().getWebView()==null)throw new IllegalStateException();
     getBridge().getWebView().clearCache(true);
    },5000);
    result.put("cacheCleared",true);
   }
   if(work.cancelled.get())result.put("cancelled",true).put("complete",false);
   result.put("id",id).put("version",BuildConfig.VERSION_NAME);call.resolve(JSObject.fromJSONObject(result));
  }catch(Exception e){call.reject(e instanceof IOException&&e.getMessage()!=null?e.getMessage():"资源清单缺失或无法读取，未能确认完整性，请重新安装完整安装包","RESOURCE_CHECK");}
  finally{for(ZipFile apk:apks)try{apk.close();}catch(Exception ignored){}active.compareAndSet(work,null);}});
 }
 @Override protected void handleOnDestroy(){Work work=active.get();if(work!=null)work.cancelled.set(true);worker.shutdownNow();}
}
