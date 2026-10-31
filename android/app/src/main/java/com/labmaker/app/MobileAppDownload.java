package com.labmaker.app;
import okhttp3.*;import java.io.*;import java.security.MessageDigest;import java.util.*;

/** APK bytes remain on private disk, never cross the JavaScript bridge. */
final class MobileAppDownload {
 static final long MAX_APK=150L*1024*1024;
 private final OkHttpClient client;private final HttpUrl origin;
 MobileAppDownload(OkHttpClient supplied,HttpUrl origin){this.origin=origin;client=supplied.newBuilder().followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).cookieJar(CookieJar.NO_COOKIES).authenticator(Authenticator.NONE).proxyAuthenticator(Authenticator.NONE).build();}
 HttpUrl url(String raw,String version)throws IOException{
  if(version==null||!version.matches("(0|[1-9][0-9]{0,5})[.](0|[1-9][0-9]{0,5})[.](0|[1-9][0-9]{0,5})"))throw new IOException("应用更新版本无效");
  HttpUrl url=raw==null?null:HttpUrl.parse(raw);
  if(url==null||!url.scheme().equals(origin.scheme())||!url.host().equals(origin.host())||url.port()!=origin.port()||!url.username().isEmpty()||!url.password().isEmpty()||url.query()!=null||url.fragment()!=null||!url.encodedPath().equals("/mobile-app/lab-maker-app-"+version+".apk"))throw new IOException("应用安装包来源不正确");return url;
 }
 File download(String raw,String version,long size,String digest,File directory,String id,MobileDataDownload.Work work,MobileDataDownload.Progress progress)throws Exception{
  HttpUrl target=url(raw,version);if(size<1||size>MAX_APK||digest==null||!digest.matches("[a-f0-9]{64}")||id==null||!id.matches("[a-f0-9-]{36}"))throw new IOException("安装包大小、摘要或请求标识无效");
  if(work.cancelled.get())throw new IOException("应用更新下载已停止");
  if(!directory.isDirectory()&&!directory.mkdirs())throw new IOException("无法创建更新缓存");
  File part=new File(directory,id+".part"),file=new File(directory,id+".apk");if(part.exists()||file.exists())throw new IOException("更新缓存标识重复");
  Call call=client.newCall(new Request.Builder().url(target).get().header("Accept","application/vnd.android.package-archive").header("Cache-Control","no-cache").build());work.call.set(call);if(work.cancelled.get())call.cancel();boolean published=false;
  try(Response response=call.execute()){
   if(response.code()!=200)throw new IOException(response.code()>=300&&response.code()<400?"应用更新服务发生跳转，未下载":"安装包下载失败（"+response.code()+"）");
   ResponseBody body=response.body();if(body==null||body.contentLength()>MAX_APK||(body.contentLength()>=0&&body.contentLength()!=size))throw new IOException("安装包大小不匹配");
   MessageDigest hash=MessageDigest.getInstance("SHA-256");long count=0;
   try(InputStream input=body.byteStream();FileOutputStream output=new FileOutputStream(part)){
    byte[] bytes=new byte[32768];int n;while((n=input.read(bytes))!=-1){if(work.cancelled.get())throw new IOException("应用更新下载已停止");count+=n;if(count>size||count>MAX_APK)throw new IOException("安装包超过声明大小");output.write(bytes,0,n);hash.update(bytes,0,n);progress.update(count,size);}output.getFD().sync();
   }
   if(work.cancelled.get())throw new IOException("应用更新下载已停止");if(count!=size||!hex(hash.digest()).equals(digest))throw new IOException("安装包不完整或摘要不匹配");
   if(!part.renameTo(file))throw new IOException("无法保存已核对安装包");published=true;return file;
  }finally{work.call.compareAndSet(call,null);if(!published){part.delete();file.delete();}}
 }
 static String hex(byte[] bytes){StringBuilder out=new StringBuilder();for(byte b:bytes)out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();}
 static String hash(File file)throws Exception{MessageDigest digest=MessageDigest.getInstance("SHA-256");try(InputStream input=new FileInputStream(file)){byte[] bytes=new byte[32768];int n;while((n=input.read(bytes))!=-1)digest.update(bytes,0,n);}return hex(digest.digest());}
}
