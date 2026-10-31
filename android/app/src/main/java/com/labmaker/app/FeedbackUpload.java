package com.labmaker.app;
import okhttp3.*;import org.json.*;import java.io.*;import java.nio.charset.StandardCharsets;import java.util.*;import java.util.concurrent.atomic.*;
final class FeedbackUpload {
 static final String ENDPOINT="https://1485394950-jr8mommpp1.ap-guangzhou.tencentscf.com";
 static final String DESTINATION="https://labreport-1485394950.cos.ap-guangzhou.myqcloud.com";
 static final class Work {final AtomicBoolean cancelled=new AtomicBoolean();final AtomicReference<Call> call=new AtomicReference<>();volatile boolean putStarted=false;void cancel(){cancelled.set(true);Call c=call.get();if(c!=null)c.cancel();}}
 final OkHttpClient client;final HttpUrl endpoint,destination;
 FeedbackUpload(OkHttpClient client,HttpUrl endpoint,HttpUrl destination){this.client=client;this.endpoint=endpoint;this.destination=destination;}
 static JSONObject payload(String text,String exp,String version,String id)throws Exception {
  if(text==null||text.trim().length()<5||text.length()>5000||exp==null||exp.length()>100||exp.chars().anyMatch(c->c=='/'||c==92||c<32)||version==null||!version.matches("[0-9]+[.][0-9]+[.][0-9]+")||id==null||!id.matches("[a-f0-9-]{36}"))throw new IOException("反馈内容或标识无效");
  return new JSONObject().put("kind","feedback").put("text",text.trim()).put("ts",id).put("appVersion",version).put("exp",exp).put("platform","android");
 }
 static byte[] bounded(InputStream in,int max)throws IOException {ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] block=new byte[4096];int n;while((n=in.read(block))!=-1){if(out.size()+n>max)throw new IOException("反馈服务响应过大");out.write(block,0,n);}return out.toByteArray();}
 HttpUrl ticket(JSONObject raw,String key,int size)throws Exception {
  JSONArray items=raw.optJSONArray("items");if(!raw.optBoolean("ok")||items==null||items.length()!=1)throw new IOException("反馈凭证服务协议不兼容");JSONObject item=items.getJSONObject(0);String object=item.optString("objectKey");HttpUrl url=HttpUrl.parse(item.optString("putUrl"));
  if(!key.equals(item.optString("key"))||item.optLong("size",-1)!=size||!object.matches("contributions/feedbacks/[a-f0-9-]{36}/feedback[.]json")||url==null||!url.scheme().equals(destination.scheme())||!url.host().equals(destination.host())||url.port()!=destination.port()||!url.username().isEmpty()||!url.password().isEmpty()||url.fragment()!=null||!url.encodedPath().equals("/"+object)||url.query()==null||url.toString().length()>8192)throw new IOException("反馈上传凭证无效");return url;
 }
 Response execute(Request request,Work work)throws IOException {if(work.cancelled.get())throw new IOException("已取消");Call call=client.newCall(request);work.call.set(call);if(work.cancelled.get())call.cancel();return call.execute();}
 JSONObject submit(JSONObject payload,Work work)throws Exception {
  byte[] bytes=payload.toString().getBytes(StandardCharsets.UTF_8);if(bytes.length>32768)throw new IOException("反馈内容过长");String key="contributions/feedbacks/"+payload.getString("ts")+"/feedback.json";
  try {
   JSONObject credentials=new JSONObject().put("files",new JSONArray().put(new JSONObject().put("key",key).put("size",bytes.length)));HttpUrl put;
   try(Response response=execute(new Request.Builder().url(endpoint).post(RequestBody.create(credentials.toString(),MediaType.get("application/json; charset=utf-8"))).build(),work)){
    if(!response.isSuccessful())throw new IOException("反馈服务暂不可用（"+response.code()+"）");if(response.body()==null)throw new IOException("反馈服务响应为空");put=ticket(new JSONObject(new String(bounded(response.body().byteStream(),32768),StandardCharsets.UTF_8)),key,bytes.length);
   }
   if(work.cancelled.get())return new JSONObject().put("state","cancelled");
   work.putStarted=true;
   try(Response response=execute(new Request.Builder().url(put).header("Content-Type","application/octet-stream").header("x-cos-forbid-overwrite","true").put(RequestBody.create(bytes,MediaType.get("application/octet-stream"))).build(),work)){
    if(response.isSuccessful())return new JSONObject().put("state","sent");
    return new JSONObject().put("state","unknown");
   }
  }catch(Exception error){if(work.putStarted)return new JSONObject().put("state","unknown");if(work.cancelled.get())return new JSONObject().put("state","cancelled");throw new IOException(error instanceof IOException?error.getMessage():"反馈服务响应无效");}
  finally{work.call.set(null);}
 }
}
