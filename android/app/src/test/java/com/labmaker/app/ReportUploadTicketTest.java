package com.labmaker.app;
import org.junit.Test;
import static org.junit.Assert.*;
import java.io.*;
import java.nio.file.Files;
import java.util.zip.*;
public class ReportUploadTicketTest {
 @Test public void rejectsControlCharactersAndOversizeBeforeCopying()throws Exception{File root=Files.createTempDirectory("upload-test").toFile(),source=source(root);assertThrows(IOException.class,()->new ReportUploadTicket(source,root,"a\nb\nc.docx","row",1,"abcdef123456",1,0));try(RandomAccessFile sparse=new RandomAccessFile(source,"rw")){sparse.setLength(128L*1024*1024+1);}assertThrows(IOException.class,()->new ReportUploadTicket(source,root,"报告.docx","row",1,"abcdef123456",1,0));assertEquals(1,root.list().length);source.delete();root.delete();}
 private File source(File root)throws Exception{File f=new File(root,"source.docx");try(ZipOutputStream zip=new ZipOutputStream(new FileOutputStream(f))){for(String n:new String[]{"[Content_Types].xml","word/document.xml"}){zip.putNextEntry(new ZipEntry(n));zip.write("<document>test</document>".getBytes("UTF-8"));zip.closeEntry();}}return f;}
 @Test public void stagedSnapshotDoesNotFollowChangesToOriginal()throws Exception{File root=Files.createTempDirectory("upload-test").toFile(),source=source(root);ReportUploadTicket t=new ReportUploadTicket(source,root,"实验报告.docx","row",1,"abcdef123456",1,100);try(FileOutputStream out=new FileOutputStream(source)){out.write(7);}t.consume(t.id,true,1,101);assertTrue(t.size>1);assertEquals(t.sha256,ReportUploadTicket.digest(t.file));t.delete();source.delete();root.delete();}
 @Test public void falseConfirmationDoesNotConsumeButReplayAndExactExpiryAreRejected()throws Exception{File root=Files.createTempDirectory("upload-test").toFile(),source=source(root);ReportUploadTicket t=new ReportUploadTicket(source,root,"报告.docx","row",1,"abcdef123456",1,100);assertThrows(IOException.class,()->t.consume(t.id,false,1,101));assertThrows(IOException.class,()->t.consume(t.id,true,1,120100));t.consume(t.id,true,1,102);assertThrows(IOException.class,()->t.consume(t.id,true,1,103));t.delete();source.delete();root.delete();}
 @Test public void changedStageOrSessionNeverSubmits()throws Exception{File root=Files.createTempDirectory("upload-test").toFile(),source=source(root);ReportUploadTicket t=new ReportUploadTicket(source,root,"报告.docx","row",1,"abcdef123456",1,100);assertThrows(IOException.class,()->t.consume(t.id,true,2,101));try(FileOutputStream out=new FileOutputStream(t.file)){out.write(5);}assertThrows(IOException.class,()->t.consume(t.id,true,1,101));t.delete();source.delete();root.delete();}
}
