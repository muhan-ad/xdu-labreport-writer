package com.labmaker.app;
import java.io.*;
import java.security.MessageDigest;
import java.util.Locale;

/** Stream the private staged file instead of copying large reports over the bridge. */
final class ReportStageVerifier {
 static void verify(File[] bases,String id,String generation,String name,long size,String expected)throws Exception{
  long limit="report.docx".equals(name)?24L*1024*1024:8L*1024*1024;
  if(size<1||size>limit||expected==null||!expected.matches("[a-f0-9]{64}"))throw new IOException("报告校验参数无效");
  File file=ReportFilePolicy.resolveAsset(bases,id,generation,name,limit);
  verifyContents(file,size,expected);
 }
 static void verifyPhoto(File[] bases,String id,String name,long size,String expected)throws Exception{
  if(id==null||!id.matches("[a-f0-9]{12}")||name==null||!name.matches("[a-f0-9-]{36}\\.(jpg|png|webp)")||size<1||size>8L*1024*1024||expected==null||!expected.matches("[a-f0-9]{64}"))throw new IOException("照片校验参数无效");
  for(File base:bases){File root=new File(base,"lab-maker/v1/photos").getCanonicalFile(),file=new File(root,id+"/"+name).getCanonicalFile();
   if(!file.getPath().startsWith(root.getPath()+File.separator))throw new IOException("照片路径无法核实");
   if(file.isFile()){verifyContents(file,size,expected);return;}
  }
  throw new IOException("照片文件缺失");
 }
 private static void verifyContents(File file,long size,String expected)throws Exception{
  if(file.length()!=size)throw new IOException("报告文件大小不一致");
  MessageDigest hash=MessageDigest.getInstance("SHA-256");long count=0;
  try(InputStream input=new BufferedInputStream(new FileInputStream(file))){
   byte[] buffer=new byte[65536];int n;
   while((n=input.read(buffer))!=-1){count+=n;if(count>size)throw new IOException("报告文件大小不一致");hash.update(buffer,0,n);}
  }
  StringBuilder actual=new StringBuilder();for(byte b:hash.digest())actual.append(String.format(Locale.ROOT,"%02x",b&255));
  if(count!=size||file.length()!=size||!MessageDigest.isEqual(actual.toString().getBytes(java.nio.charset.StandardCharsets.US_ASCII),expected.getBytes(java.nio.charset.StandardCharsets.US_ASCII)))throw new IOException("报告文件内容不一致");
 }
}
