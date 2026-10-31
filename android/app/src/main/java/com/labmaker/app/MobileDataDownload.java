package com.labmaker.app;
import okhttp3.*;import org.json.*;import java.io.*;import java.nio.*;import java.nio.charset.*;import java.security.MessageDigest;import java.util.*;import java.util.concurrent.atomic.*;

/** Anonymous bounded GETs only. JavaScript verifies the publisher signature before use. */
final class MobileDataDownload {
 static final String ORIGIN="https://labreport-1485394950.cos.ap-guangzhou.myqcloud.com";
 static final int MAX_PACKAGE=8*1024*1024,MAX_MANIFEST=65536;
 static final class Work {
  final AtomicBoolean cancelled=new AtomicBoolean();final AtomicReference<Call> call=new AtomicReference<>();
  void cancel(){cancelled.set(true);Call c=call.get();if(c!=null)c.cancel();}
 }
 interface Progress {void update(long bytes,long total);}
 private final OkHttpClient client;private final HttpUrl origin;
 MobileDataDownload(OkHttpClient supplied,HttpUrl origin){this.origin=origin;this.client=supplied.newBuilder().followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).cookieJar(CookieJar.NO_COOKIES).authenticator(Authenticator.NONE).proxyAuthenticator(Authenticator.NONE).build();}
 HttpUrl packageUrl(String raw,String version)throws IOException {
  if(version==null||!version.matches("(0|[1-9][0-9]{0,5})[.](0|[1-9][0-9]{0,5})[.](0|[1-9][0-9]{0,5})")||raw==null||raw.length()>1000)throw new IOException("更新包版本或地址无效");
  HttpUrl url=HttpUrl.parse(raw);
  if(url==null||!url.scheme().equals(origin.scheme())||!url.host().equals(origin.host())||url.port()!=origin.port()||!url.username().isEmpty()||!url.password().isEmpty()||url.query()!=null||url.fragment()!=null||!url.encodedPath().equals("/mobile-data/data-"+version+".json"))throw new IOException("更新包来源不正确");
  return url;
 }
 JSONObject manifest(Work work,Progress progress)throws Exception{return read(origin.resolve("/mobile-data-manifest.json"),MAX_MANIFEST,-1,null,true,work,progress);}
 JSONObject appManifest(Work work,Progress progress)throws Exception{return read(origin.resolve("/mobile-app-manifest.json"),MAX_MANIFEST,-1,null,true,work,progress);}
 JSONObject bundle(String url,String version,long size,String digest,Work work,Progress progress)throws Exception {
  if(size<1||size>MAX_PACKAGE||digest==null||!digest.matches("[a-f0-9]{64}"))throw new IOException("更新包大小或摘要无效");
  return read(packageUrl(url,version),MAX_PACKAGE,size,digest,false,work,progress);
 }
 private JSONObject read(HttpUrl url,int max,long expected,String digest,boolean manifest,Work work,Progress progress)throws Exception {
  if(work.cancelled.get())throw new IOException("更新下载已停止");
  Call call=client.newCall(new Request.Builder().url(url).get().header("Accept","application/json").header("Cache-Control","no-cache").build());work.call.set(call);if(work.cancelled.get())call.cancel();
  try(Response response=call.execute()){
   if(work.cancelled.get())throw new IOException("更新下载已停止");
   if(manifest&&response.code()==404)return new JSONObject().put("found",false);
   if(response.code()>=300&&response.code()<400)throw new IOException("更新服务发生跳转，未下载");
   if(response.code()!=200)throw new IOException("更新服务暂不可用（"+response.code()+"）");
   ResponseBody body=response.body();if(body==null)throw new IOException("更新服务响应为空");
   long length=body.contentLength();if(length>max||(expected>=0&&length>=0&&length!=expected))throw new IOException("更新包大小不匹配或过大");
   ByteArrayOutputStream out=new ByteArrayOutputStream();MessageDigest hash=MessageDigest.getInstance("SHA-256");
   try(InputStream input=body.byteStream()){
    byte[] block=new byte[32768];int n;while((n=input.read(block))!=-1){if(work.cancelled.get())throw new IOException("更新下载已停止");if((long)out.size()+n>max||(expected>=0&&(long)out.size()+n>expected))throw new IOException("更新响应超过声明大小");out.write(block,0,n);hash.update(block,0,n);progress.update(out.size(),expected>=0?expected:Math.max(0,length));}
   }
   if(work.cancelled.get())throw new IOException("更新下载已停止");
   if(out.size()<1||(expected>=0&&out.size()!=expected))throw new IOException("更新响应不完整");
   if(digest!=null){StringBuilder actual=new StringBuilder();for(byte b:hash.digest())actual.append(String.format(Locale.ROOT,"%02x",b&255));if(!actual.toString().equals(digest))throw new IOException("更新包摘要不匹配");}
   String text;try{text=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(out.toByteArray())).toString();}catch(CharacterCodingException error){throw new IOException("更新响应不是有效 UTF-8 文本");}
   return new JSONObject().put("found",true).put("body",text).put("bytes",out.size());
  }catch(IOException error){if(work.cancelled.get())throw new IOException("更新下载已停止");throw error;}
  finally{work.call.compareAndSet(call,null);}
 }
}
