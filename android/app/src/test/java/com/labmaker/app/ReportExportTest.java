package com.labmaker.app;
import org.junit.Test;import static org.junit.Assert.*;import java.io.*;import java.util.*;import java.nio.charset.StandardCharsets;
public class ReportExportTest {
 static class Memory implements ReportExport.Destination {
  byte[] value;String created;boolean removed,corrupt,cleanup=true,failWrite;
  public Set<String> names(){return new HashSet<>(Arrays.asList("报告.docx","报告（2）.docx"));}
  public ReportExport.Target create(String name){created=name;return new ReportExport.Target("new",name);}
  public OutputStream write(ReportExport.Target t)throws Exception {if(failWrite)throw new IOException();return new ByteArrayOutputStream(){public void close(){value=toByteArray();}};}
  public InputStream read(ReportExport.Target t){return new ByteArrayInputStream(corrupt?new byte[]{9,9,9}:value);}
  public boolean remove(ReportExport.Target t){assertEquals("new",t.id);removed=true;return cleanup;}
 }
 @Test public void namesAreBoundedAndUnique()throws Exception {
  assertEquals("报告（3）.docx",ReportExport.unique("报告.docx",new Memory().names()));
  assertEquals("A（2）.docx",ReportExport.unique("A.docx",Set.of("a.DOCX")));
  assertEquals("实验报告.docx",ReportExport.filename("... "));
  assertFalse(ReportExport.filename("a/b:c.docx").contains("/"));
  assertTrue(ReportExport.filename("测".repeat(2000)).getBytes(StandardCharsets.UTF_8).length<=185);
 }
 @Test public void copyRequiresExactReadback()throws Exception {Memory d=new Memory();byte[] data={1,2,3};assertEquals("报告（3）.docx",ReportExport.save(new ByteArrayInputStream(data),3,"报告",d).name);assertArrayEquals(data,d.value);assertFalse(d.removed);}
 @Test public void sameLengthCorruptionRemovesOnlyNewCopy()throws Exception {Memory d=new Memory();d.corrupt=true;try{ReportExport.save(new ByteArrayInputStream(new byte[]{1,2,3}),3,"报告",d);fail();}catch(ReportExport.Failure e){assertFalse(e.partial);}assertTrue(d.removed);}
 @Test public void shortAndLongSourcesFail()throws Exception {for(int size:new int[]{2,4}){Memory d=new Memory();try{ReportExport.save(new ByteArrayInputStream(new byte[size]),3,"报告",d);fail();}catch(ReportExport.Failure e){assertFalse(e.partial);}assertTrue(d.removed);}}
 @Test public void writeFailureCleansNewCopy()throws Exception {Memory d=new Memory();d.failWrite=true;try{ReportExport.save(new ByteArrayInputStream(new byte[]{1}),1,"报告",d);fail();}catch(ReportExport.Failure e){assertFalse(e.partial);}assertTrue(d.removed);}
 @Test public void cleanupFailureIsExplicit()throws Exception {Memory d=new Memory();d.corrupt=true;d.cleanup=false;try{ReportExport.save(new ByteArrayInputStream(new byte[]{1}),1,"报告",d);fail();}catch(ReportExport.Failure e){assertTrue(e.partial);assertTrue(e.getMessage().contains("未完成副本"));}}
 @Test public void invalidSizeDoesNotCreateDocument()throws Exception {for(long size:new long[]{0,-1,ReportExport.MAX+1}){Memory d=new Memory();try{ReportExport.save(new ByteArrayInputStream(new byte[0]),size,"报告",d);fail();}catch(ReportExport.Failure e){assertNull(d.created);assertFalse(d.removed);}}}
}
