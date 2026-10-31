package com.labmaker.app;
import com.getcapacitor.*;import com.getcapacitor.annotation.CapacitorPlugin;import android.content.*;import android.content.pm.*;import android.os.Build;import android.net.Uri;import android.provider.Settings;import androidx.core.content.FileProvider;import okhttp3.*;import org.json.*;import java.io.*;import java.security.MessageDigest;import java.util.*;import java.util.concurrent.*;import java.util.concurrent.atomic.*;

@CapacitorPlugin(name="LabAppUpdates")
public class LabAppUpdatesPlugin extends Plugin {
 private final ExecutorService worker=Executors.newSingleThreadExecutor();private final AtomicReference<Task> active=new AtomicReference<>();
 private final OkHttpClient client=new OkHttpClient.Builder().connectTimeout(10,TimeUnit.SECONDS).readTimeout(20,TimeUnit.SECONDS).callTimeout(5,TimeUnit.MINUTES).build();
 private final MobileDataDownload manifest=new MobileDataDownload(client,HttpUrl.get(MobileDataDownload.ORIGIN));private final MobileAppDownload apk=new MobileAppDownload(client,HttpUrl.get(MobileDataDownload.ORIGIN));
 private static final class Task{final String id;final MobileDataDownload.Work work=new MobileDataDownload.Work();Task(String id){this.id=id;}}
 private static final class Candidate{String id,version,sha,certificate;long code,size,created;int minAndroid;File file;}
 private Candidate candidate;
 private final AtomicBoolean destroyed=new AtomicBoolean();private volatile boolean foreground=true;
 private File directory(){return new File(getContext().getCacheDir(),"app-updates");}
 private boolean owned(File file){return file.getName().matches("[a-f0-9-]{36}[.](apk|part)");}
 private boolean hasCache(){File[] files=directory().listFiles();if(files!=null)for(File file:files)if(owned(file))return true;return false;}
 private MobileAppPolicy.Info info(PackageInfo p)throws Exception{
  if(p==null||p.applicationInfo==null)throw new IOException("无法读取安装包信息");Set<String> hashes=new HashSet<>();android.content.pm.Signature[] signatures=Build.VERSION.SDK_INT>=28?(p.signingInfo==null?null:p.signingInfo.getApkContentsSigners()):p.signatures;
  if(signatures==null||signatures.length<1)throw new IOException("安装包缺少签名信息");for(android.content.pm.Signature s:signatures)hashes.add(MobileAppDownload.hex(MessageDigest.getInstance("SHA-256").digest(s.toByteArray())));
  return new MobileAppPolicy.Info(p.packageName,p.versionName,Build.VERSION.SDK_INT>=28?p.getLongVersionCode():p.versionCode,p.applicationInfo.minSdkVersion,hashes);
 }
 private int flags(){return Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;}
 private MobileAppPolicy.Info installed()throws Exception{return info(getContext().getPackageManager().getPackageInfo(getContext().getPackageName(),flags()));}
 private void validate(Candidate c)throws Exception{
  if(c==null||android.os.SystemClock.elapsedRealtime()-c.created>15*60*1000||!c.file.isFile()||c.file.length()!=c.size||!MobileAppDownload.hash(c.file).equals(c.sha))throw new IOException("安装包已过期或变化，请重新下载");
  MobileAppPolicy.validate(installed(),info(getContext().getPackageManager().getPackageArchiveInfo(c.file.getAbsolutePath(),flags())),c.version,c.code,c.minAndroid,c.certificate,Build.VERSION.SDK_INT);
 }
 @PluginMethod public void info(PluginCall call){worker.execute(()->{try{MobileAppPolicy.Info info=installed();if(info.certificates.size()!=1)throw new IOException("当前应用签名暂不支持内置更新");JSObject out=new JSObject();out.put("appId",info.id);out.put("version",info.version);out.put("versionCode",info.code);out.put("android",Build.VERSION.SDK_INT);out.put("certificateSha256",info.certificates.iterator().next());out.put("hasCache",hasCache());call.resolve(out);}catch(Exception error){call.reject(error.getMessage(),"APP_INFO");}});}
 @PluginMethod public void cancel(PluginCall call){Task t=active.get();if(t!=null&&t.id.equals(call.getString("id","")))t.work.cancel();call.resolve();}
 @PluginMethod public void manifest(PluginCall call){start(call,true);}
 @PluginMethod public void download(PluginCall call){start(call,false);}
 private void start(PluginCall call,boolean metadata){
  String id=call.getString("id","");if(!id.matches("[a-f0-9-]{36}")){call.reject("应用更新请求标识无效","APP_ID");return;}Task task=new Task(id);if(!active.compareAndSet(null,task)){call.reject("应用更新正在处理","APP_BUSY");return;}
  worker.execute(()->{File downloaded=null;try{
   long[] lastProgress={0};MobileDataDownload.Progress progress=(bytes,total)->{long now=System.nanoTime();if(bytes!=total&&now-lastProgress[0]<100000000L)return;lastProgress[0]=now;JSObject out=new JSObject();out.put("id",id);out.put("bytes",bytes);out.put("total",total);notifyListeners("progress",out);};
   if(metadata){JSONObject result=manifest.appManifest(task.work,progress);JSObject out=new JSObject(result.toString());out.put("id",id);call.resolve(out);}
   else{
    if(hasCache())throw new IOException("请先清理上次下载的应用更新缓存");
    Candidate c=new Candidate();c.id=id;c.version=call.getString("version","");c.code=call.getLong("versionCode",0L);c.minAndroid=call.getInt("minAndroid",0);c.size=call.getLong("size",0L);c.sha=call.getString("sha256","");c.certificate=call.getString("certificateSha256","");
    if(!c.certificate.matches("[a-f0-9]{64}")||c.code<1||c.minAndroid<24)throw new IOException("应用更新声明无效");
    downloaded=apk.download(call.getString("url",""),c.version,c.size,c.sha,directory(),id,task.work,progress);c.file=downloaded;c.created=android.os.SystemClock.elapsedRealtime();validate(c);if(task.work.cancelled.get())throw new IOException("应用更新下载已停止");candidate=c;JSObject out=new JSObject();out.put("id",id);out.put("candidateId",c.id);call.resolve(out);
   }
  }catch(Exception error){if(downloaded!=null)downloaded.delete();call.reject(task.work.cancelled.get()?"应用更新下载已停止":error.getMessage(),"APP_DOWNLOAD");}finally{active.compareAndSet(task,null);}});
 }
 @PluginMethod public void clear(PluginCall call){if(active.get()!=null){call.reject("请先停止下载","APP_BUSY");return;}worker.execute(()->{try{File[] files=directory().listFiles();if(files!=null)for(File file:files)if(owned(file)&&!file.delete())throw new IOException("更新缓存清理未完成");candidate=null;call.resolve();}catch(Exception error){call.reject(error.getMessage(),"APP_CLEAR");}});}
 @PluginMethod public void settings(PluginCall call){getActivity().runOnUiThread(()->{try{if(destroyed.get()||!foreground)throw new IOException("应用已离开前台");Intent intent=Build.VERSION.SDK_INT>=26?new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getContext().getPackageName())):new Intent(Settings.ACTION_SECURITY_SETTINGS);getActivity().startActivity(intent);call.resolve();}catch(Exception error){call.reject("无法打开系统安装授权页面，请返回应用后重试","APP_SETTINGS");}});}
 @PluginMethod public void install(PluginCall call){if(active.get()!=null){call.reject("请先等待下载完成","APP_BUSY");return;}String id=call.getString("candidateId","");worker.execute(()->{try{
  Candidate c=candidate;if(c==null||!c.id.equals(id)||!c.sha.equals(call.getString("sha256",""))||!c.version.equals(call.getString("version",""))||c.code!=call.getLong("versionCode",0L))throw new IOException("更新安装包已失效或与确认版本不同，请重新下载");validate(c);
  if(Build.VERSION.SDK_INT>=26&&!getContext().getPackageManager().canRequestPackageInstalls()){JSObject out=new JSObject();out.put("state","permission-required");call.resolve(out);return;}
  Uri uri=FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".fileprovider",c.file);Intent intent=new Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);intent.setClipData(ClipData.newRawUri("应用更新",uri));
  getActivity().runOnUiThread(()->{try{if(destroyed.get()||!foreground)throw new IOException("应用已离开前台");getActivity().startActivity(intent);JSObject out=new JSObject();out.put("state","opened");call.resolve(out);}catch(Exception error){call.reject("未能打开系统安装页面，请返回应用后重试","APP_INSTALL");}});
 }catch(Exception error){call.reject(error.getMessage(),"APP_INSTALL");}});}
 @Override protected void handleOnPause(){foreground=false;super.handleOnPause();}
 @Override protected void handleOnResume(){foreground=true;super.handleOnResume();}
 @Override protected void handleOnDestroy(){destroyed.set(true);foreground=false;Task t=active.get();if(t!=null)t.work.cancel();worker.shutdown();super.handleOnDestroy();}
}
