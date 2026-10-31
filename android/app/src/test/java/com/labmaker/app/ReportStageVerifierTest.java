package com.labmaker.app;
import org.junit.Test;import org.junit.Rule;import org.junit.rules.TemporaryFolder;import static org.junit.Assert.*;
import java.io.*;import java.nio.file.Files;import java.security.MessageDigest;
public class ReportStageVerifierTest {
 @Rule public TemporaryFolder temp=new TemporaryFolder();
 final String id="abcdef123456",generation="12345678-1234-1234-1234-123456789abc";
 String hash(byte[] bytes)throws Exception{StringBuilder value=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))value.append(String.format("%02x",b&255));return value.toString();}
 @Test public void confirmsExactContentsOfReportAndCharts()throws Exception{
  File base=temp.newFolder(),dir=new File(base,"lab-maker/v1/reports/"+id+"/"+generation);assertTrue(dir.mkdirs());
  byte[] bytes={1,2,3,4};String digest=hash(bytes);
  for(String name:new String[]{"report.docx","chart-1.png","chart-32.png"}){File file=new File(dir,name);Files.write(file.toPath(),bytes);ReportStageVerifier.verify(new File[]{base},id,generation,name,bytes.length,digest);}
 }
 @Test public void refusesChangedTruncatedMissingAndUnsafeFiles()throws Exception{
  File base=temp.newFolder(),dir=new File(base,"lab-maker/v1/reports/"+id+"/"+generation);assertTrue(dir.mkdirs());
  byte[] original={1,2,3,4};File report=new File(dir,"report.docx");Files.write(report.toPath(),new byte[]{1,2,3,5});
  for(String name:new String[]{"report.docx","chart-0.png","chart-33.png","../report.docx","chart-1.png"}){
   try{ReportStageVerifier.verify(new File[]{base},id,generation,name,original.length,hash(original));fail(name);}catch(IOException expected){}
  }
  try{ReportStageVerifier.verify(new File[]{base},id,generation,"report.docx",original.length+1,hash(original));fail();}catch(IOException expected){}
  try{ReportStageVerifier.verify(new File[]{base},id,generation,"report.docx",original.length,"bad");fail();}catch(IOException expected){}
 }
 @Test public void verifiesPhotoAndRejectsCorruptionAndUnsafeNames()throws Exception{
  File base=temp.newFolder(),dir=new File(base,"lab-maker/v1/photos/"+id);assertTrue(dir.mkdirs());
  String name=generation+".png";byte[] original={1,2,3,4};File photo=new File(dir,name);Files.write(photo.toPath(),original);
  ReportStageVerifier.verifyPhoto(new File[]{base},id,name,original.length,hash(original));
  Files.write(photo.toPath(),new byte[]{1,2,3,5});
  try{ReportStageVerifier.verifyPhoto(new File[]{base},id,name,original.length,hash(original));fail();}catch(IOException expected){}
  for(String invalid:new String[]{"../"+name,generation+".exe","missing.png"}){
   try{ReportStageVerifier.verifyPhoto(new File[]{base},id,invalid,original.length,hash(original));fail(invalid);}catch(IOException expected){}
  }
  try{ReportStageVerifier.verifyPhoto(new File[]{base},"../"+id,name,original.length,hash(original));fail();}catch(IOException expected){}
  try{ReportStageVerifier.verifyPhoto(new File[]{base},id,name,original.length+1,hash(original));fail();}catch(IOException expected){}
 }
}
