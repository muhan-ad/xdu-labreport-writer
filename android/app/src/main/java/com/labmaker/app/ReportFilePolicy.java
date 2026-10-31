package com.labmaker.app;
import java.io.*;
final class ReportFilePolicy {
 static File resolve(File[] bases,String id,String generation)throws Exception{
  return resolveAsset(bases,id,generation,"report.docx",ReportExport.MAX);
 }
 static File resolveAsset(File[] bases,String id,String generation,String name,long limit)throws Exception{
  if(id==null||!id.matches("[a-f0-9]{12}")||generation==null||!generation.matches("[a-f0-9-]{36}"))throw new IOException("报告标识无效");
  if(name==null||(!"report.docx".equals(name)&&!name.matches("chart-(?:[1-9]|[12][0-9]|3[0-2])\\.png")))throw new IOException("报告文件名无效");
  for(File base:bases){File root=new File(base,"lab-maker/v1/reports").getCanonicalFile(),candidate=new File(root,id+"/"+generation+"/"+name).getCanonicalFile();if(!candidate.getPath().startsWith(root.getPath()+File.separator))throw new IOException("报告路径无法核实");if(candidate.isFile()&&candidate.length()>0&&candidate.length()<=limit)return candidate;}
  throw new IOException("报告文件缺失或不可用，请重新生成");
 }
}
