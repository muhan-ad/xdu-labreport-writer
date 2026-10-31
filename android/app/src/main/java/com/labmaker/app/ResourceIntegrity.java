package com.labmaker.app;
import java.io.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.*;

/** Streaming installed-resource check. Does not read or mutate user data. */
final class ResourceIntegrity {
 interface Reader { InputStream open(String path)throws IOException; }
 interface Progress { void update(int checked,int total,long bytes,String path); }
 static JSONObject check(JSONObject manifest,Reader reader,AtomicBoolean cancel,Progress progress)throws Exception {
  if(manifest.optInt("schema")!=1)throw new IOException("资源清单版本不支持");
  JSONArray files=manifest.getJSONArray("files");if(files.length()<1||files.length()>10000)throw new IOException("资源清单不完整");Set<String> seen=new HashSet<>();
  for(int i=0;i<files.length();i++){JSONObject f=files.getJSONObject(i);String path=f.getString("path");
   if(!(path.startsWith("assets/")||path.startsWith("lib/"))||path.contains("\\")||path.contains("//")||Arrays.asList(path.split("/")).contains("..")||Arrays.asList(path.split("/")).contains(".")||path.length()>1000||!seen.add(path)||!f.getString("sha256").matches("[a-f0-9]{64}")||f.getLong("bytes")<0||f.getLong("bytes")>1024L*1024*1024)throw new IOException("资源清单格式无效");
  }
  JSONArray problems=new JSONArray();int checked=0;long totalBytes=0;
  for(int i=0;i<files.length();i++){
   if(cancel.get())return result(false,true,checked,files.length(),totalBytes,problems);
   JSONObject f=files.getJSONObject(i);String path=f.getString("path"),reason="";long count=0;
   try(InputStream in=reader.open(path)){
    MessageDigest digest=MessageDigest.getInstance("SHA-256");byte[] block=new byte[65536];int n;
    while((n=in.read(block))!=-1){if(cancel.get())return result(false,true,checked,files.length(),totalBytes,problems);count+=n;totalBytes+=n;if(count>f.getLong("bytes")){reason="长度不符";break;}digest.update(block,0,n);}
    if(reason.isEmpty()){if(count!=f.getLong("bytes"))reason="长度不符";else{StringBuilder hash=new StringBuilder();for(byte b:digest.digest())hash.append(String.format(Locale.ROOT,"%02x",b&255));if(!hash.toString().equals(f.getString("sha256")))reason="校验不符";}}
   }catch(FileNotFoundException e){reason="缺失";}catch(IOException e){reason="读取失败";}
   if(!reason.isEmpty())problems.put(new JSONObject().put("path",path).put("reason",reason));
   checked++;progress.update(checked,files.length(),totalBytes,path);
  }
  return result(problems.length()==0,false,checked,files.length(),totalBytes,problems);
 }
 private static JSONObject result(boolean complete,boolean cancelled,int checked,int total,long bytes,JSONArray problems)throws JSONException{return new JSONObject().put("complete",complete).put("cancelled",cancelled).put("checked",checked).put("total",total).put("bytes",bytes).put("problems",problems);}
}
