package com.labmaker.app;
import java.io.*;import java.nio.charset.StandardCharsets;import java.security.*;import java.util.*;
/** Stream a new copy and verify it. The destination must never return an existing document. */
final class ReportExport {
 static final long MAX=128L*1024*1024;
 static final class Target {final String id,name;Target(String id,String name){this.id=id;this.name=name;}}
 interface Destination {Set<String> names()throws Exception;Target create(String name)throws Exception;OutputStream write(Target target)throws Exception;InputStream read(Target target)throws Exception;boolean remove(Target target)throws Exception;}
 static final class Failure extends Exception {final boolean partial;Failure(String message,boolean partial){super(message);this.partial=partial;}}
 static String filename(String raw){String base=raw==null?"":raw.substring(0,Math.min(raw.length(),2000)).trim();if(base.toLowerCase(Locale.ROOT).endsWith(".docx"))base=base.substring(0,base.length()-5);StringBuilder out=new StringBuilder();int bytes=0;for(int point:base.codePoints().toArray()){String text=Character.isISOControl(point)||"<>:\"/\\|?*".indexOf(point)>=0?"_":new String(Character.toChars(point));int size=text.getBytes(StandardCharsets.UTF_8).length;if(bytes+size>180)break;out.append(text);bytes+=size;}base=out.toString().replaceAll("[. ]+$","").trim();return (base.isEmpty()?"实验报告":base)+".docx";}
 static String unique(String wanted,Set<String> existing)throws Failure {String safe=filename(wanted);Set<String> folded=new HashSet<>();existing.forEach(n->folded.add(n.toLowerCase(Locale.ROOT)));if(!folded.contains(safe.toLowerCase(Locale.ROOT)))return safe;String stem=safe.substring(0,safe.length()-5);for(int i=2;i<=10000;i++){String name=stem+"（"+i+"）.docx";if(!folded.contains(name.toLowerCase(Locale.ROOT)))return name;}throw new Failure("同名报告过多，请选择其他目录",false);}
 static Target save(InputStream source,long expected,String wanted,Destination destination)throws Exception {
  if(expected<1||expected>MAX)throw new Failure("报告文件大小异常",false);Target target=null;
  try{target=destination.create(unique(wanted,destination.names()));if(target==null||target.id==null||target.name==null)throw new IOException();MessageDigest hash=MessageDigest.getInstance("SHA-256");long copied=0;byte[] block=new byte[65536];
   try(OutputStream out=destination.write(target)){int count;while((count=source.read(block))!=-1){if(count==0)continue;copied+=count;if(copied>MAX||copied>expected)throw new IOException();out.write(block,0,count);hash.update(block,0,count);}out.flush();}if(copied!=expected)throw new IOException();
   MessageDigest verify=MessageDigest.getInstance("SHA-256");long read=0;try(InputStream in=destination.read(target)){int count;while((count=in.read(block))!=-1){if(count==0)continue;read+=count;if(read>expected)throw new IOException();verify.update(block,0,count);}}
   if(read!=copied||!MessageDigest.isEqual(hash.digest(),verify.digest()))throw new IOException();return target;
  }catch(Exception error){boolean partial=error instanceof Failure&&((Failure)error).partial;if(target!=null)try{if(!destination.remove(target))partial=true;}catch(Exception cleanup){partial=true;}throw new Failure(partial?"报告未完整保存，目标目录可能留下未完成副本；本机原报告保留":error instanceof Failure?error.getMessage():"报告未能保存或回读核对，请检查目录权限后重试",partial);
  }
 }
}
