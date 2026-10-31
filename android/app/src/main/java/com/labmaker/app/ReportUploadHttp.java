package com.labmaker.app;
import java.io.*;
import java.nio.charset.*;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import okhttp3.*;
import org.json.*;

/** One explicitly authorized multipart send. Caller must validate the report origin before calling. */
final class ReportUploadHttp {
 static void validateTarget(JSONObject info,String trustedOrigin)throws Exception {
   HttpUrl expected=HttpUrl.get(trustedOrigin),target=HttpUrl.get(info.getString("url")),ref=HttpUrl.get(info.getString("referrer"));
   if(!trustedOrigin.equals(info.optString("origin"))||!sameOrigin(expected,target)||!sameOrigin(expected,ref)||!target.username().isEmpty()||!target.password().isEmpty()||!ref.username().isEmpty()||!ref.password().isEmpty())throw new IOException("上传地址与已登录官网不一致");
 }
 private static boolean sameOrigin(HttpUrl a,HttpUrl b){return a.scheme().equals(b.scheme())&&a.host().equals(b.host())&&a.port()==b.port();}
 static JSONObject send(HttpUrl url,JSONObject info,ReportUploadTicket ticket,String cookie,String agent)throws Exception {
   if(!info.optString("method").equals("POST"))throw new IOException("上传方法待核实");
   MultipartBody.Builder multipart=new MultipartBody.Builder().setType(MultipartBody.FORM);JSONArray fields=info.getJSONArray("fields");
   if(fields.length()>128)throw new IOException("上传字段过多");int files=0,total=0;
   for(int i=0;i<fields.length();i++){JSONObject field=fields.getJSONObject(i);String name=field.getString("name");if(name.length()>200||name.contains("\r")||name.contains("\n"))throw new IOException("上传字段无效");
     if(field.optBoolean("file")){files++;if(!field.optString("fileName").equals(ticket.fileName)||field.optLong("size")!=ticket.size)throw new IOException("官网附件与已确认报告不对应");multipart.addFormDataPart(name,ticket.fileName,RequestBody.create(MediaType.get("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),ticket.file));}
     else{String value=field.getString("value");total+=value.length();if(total>1024*1024)throw new IOException("上传表单过大");multipart.addFormDataPart(name,value);}
   }
   if(files!=1||ticket.file.length()!=ticket.size||!ticket.sha256.equals(ReportUploadTicket.digest(ticket.file)))throw new IOException("待上传附件已变化");
   Headers.Builder headers=new Headers.Builder();JSONObject supplied=info.optJSONObject("headers");
   if(supplied!=null){Iterator<String> keys=supplied.keys();int count=0;while(keys.hasNext()){String key=keys.next(),lower=key.toLowerCase(Locale.ROOT);if(++count>64)throw new IOException("上传请求头过多");if(Arrays.asList("host","cookie","content-type","content-length","connection","transfer-encoding","referer","origin","user-agent").contains(lower)||lower.startsWith("sec-"))continue;String value=supplied.getString(key);if(value.length()>32000)throw new IOException("上传请求头过大");try{headers.add(key,value);}catch(Exception e){throw new IOException("上传请求头待核实");}}}
   headers.add("User-Agent",agent).add("Origin",info.getString("origin")).add("Referer",info.getString("referrer"));
   if(cookie!=null&&!cookie.isEmpty())headers.addUnsafeNonAscii("Cookie",cookie);
   AtomicBoolean attempted=new AtomicBoolean();OkHttpClient client=new OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).connectTimeout(15,TimeUnit.SECONDS).readTimeout(60,TimeUnit.SECONDS).callTimeout(90,TimeUnit.SECONDS).addNetworkInterceptor(chain->{if(!attempted.compareAndSet(false,true))throw new IOException("已阻止重复上传请求");return chain.proceed(chain.request());}).build();
   try(Response response=client.newCall(new Request.Builder().url(url).headers(headers.build()).post(multipart.build()).build()).execute()){
     ResponseBody body=response.body();if(body==null)throw new IOException("官网没有返回上传结果");ByteArrayOutputStream out=new ByteArrayOutputStream();try(InputStream in=body.byteStream()){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){if(out.size()+n>4*1024*1024)throw new IOException("上传响应过大");out.write(b,0,n);}}
     Charset charset=body.contentType()==null?StandardCharsets.UTF_8:body.contentType().charset(StandardCharsets.UTF_8);JSONObject result=new JSONObject().put("status",response.code()).put("statusText",response.message()).put("body",out.toString(charset.name())).put("networkError",false);
     JSONObject visible=new JSONObject();for(String name:response.headers().names())if(!name.equalsIgnoreCase("Set-Cookie"))visible.put(name,response.header(name));result.put("headers",visible).put("cookies",new JSONArray(response.headers("Set-Cookie")));return result;
   }finally{client.connectionPool().evictAll();}
 }
}
