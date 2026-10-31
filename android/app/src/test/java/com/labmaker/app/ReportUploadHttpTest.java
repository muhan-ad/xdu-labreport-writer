package com.labmaker.app;
import org.junit.Test;
import static org.junit.Assert.*;
import java.io.*;
import java.nio.file.Files;
import java.util.concurrent.TimeUnit;
import java.util.zip.*;
import okhttp3.mockwebserver.*;
import org.json.*;

public class ReportUploadHttpTest {
 private ReportUploadTicket ticket(File root)throws Exception{
   File source=new File(root,"source.docx");try(ZipOutputStream zip=new ZipOutputStream(new FileOutputStream(source))){for(String name:new String[]{"[Content_Types].xml","word/document.xml"}){zip.putNextEntry(new ZipEntry(name));zip.write("<document>confirmed</document>".getBytes("UTF-8"));zip.closeEntry();}}
   return new ReportUploadTicket(source,root,"报告.docx","row",1,"abcdef123456",1,0);
 }
 private JSONObject info(MockWebServer server,ReportUploadTicket t)throws Exception{
   String origin=server.url("/").toString().replaceAll("/$","");return new JSONObject().put("method","POST").put("url",server.url("/wgyreport/upload").toString()).put("origin",origin).put("referrer",origin+"/wgyreport/index").put("fields",new JSONArray().put(new JSONObject().put("name","token").put("value","one-use")).put(new JSONObject().put("name","report").put("file",true).put("fileName",t.fileName).put("size",t.size)));
 }
 @Test public void preservesMultipartAndReturnsCookiesWithoutLeakingThemToPage()throws Exception{
   File root=Files.createTempDirectory("upload-http").toFile();ReportUploadTicket t=ticket(root);
   try(MockWebServer server=new MockWebServer()){server.enqueue(new MockResponse().setBody("{\"success\":true}").addHeader("Set-Cookie","session=new; Path=/"));server.start();JSONObject info=info(server,t);ReportUploadHttp.validateTarget(info,info.getString("origin"));JSONObject response=ReportUploadHttp.send(server.url("/wgyreport/upload"),info,t,"session=old","test-agent");RecordedRequest request=server.takeRequest(2,TimeUnit.SECONDS);assertNotNull(request);assertEquals(1,server.getRequestCount());assertEquals("session=old",request.getHeader("Cookie"));assertEquals(info.getString("origin"),request.getHeader("Origin"));String body=request.getBody().readUtf8();assertTrue(body.contains("one-use"));assertTrue(body.contains("word/document.xml"));assertEquals(1,response.getJSONArray("cookies").length());assertFalse(response.getJSONObject("headers").has("Set-Cookie"));assertEquals(200,response.getInt("status"));}finally{t.delete();new File(root,"source.docx").delete();root.delete();}
 }
 @Test public void acceptedBodyWithLostResponseNeverRetries()throws Exception{
   File root=Files.createTempDirectory("upload-http").toFile();ReportUploadTicket t=ticket(root);
   try(MockWebServer server=new MockWebServer()){server.enqueue(new MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST));server.start();JSONObject info=info(server,t);assertThrows(Exception.class,()->ReportUploadHttp.send(server.url("/wgyreport/upload"),info,t,null,"test-agent"));assertNotNull(server.takeRequest(2,TimeUnit.SECONDS));assertEquals(1,server.getRequestCount());}finally{t.delete();new File(root,"source.docx").delete();root.delete();}
 }
 @Test public void redirectDoesNotSendFileAgain()throws Exception{
   File root=Files.createTempDirectory("upload-http").toFile();ReportUploadTicket t=ticket(root);
   try(MockWebServer server=new MockWebServer()){server.enqueue(new MockResponse().setResponseCode(307).addHeader("Location","/wgyreport/other").setBody("redirect"));server.start();JSONObject response=ReportUploadHttp.send(server.url("/wgyreport/upload"),info(server,t),t,null,"test-agent");assertEquals(307,response.getInt("status"));assertEquals(1,server.getRequestCount());}finally{t.delete();new File(root,"source.docx").delete();root.delete();}
 }
 @Test public void rejectsDifferentOriginsAndEmbeddedCredentials()throws Exception{
   JSONObject info=new JSONObject().put("url","http://school.test/wgyreport/upload").put("origin","http://school.test").put("referrer","http://school.test/wgyreport/index");ReportUploadHttp.validateTarget(info,"http://school.test");info.put("url","http://school.test:81/wgyreport/upload");assertThrows(Exception.class,()->ReportUploadHttp.validateTarget(info,"http://school.test"));info.put("url","http://user:secret@school.test/wgyreport/upload");assertThrows(Exception.class,()->ReportUploadHttp.validateTarget(info,"http://school.test"));info.put("url","http://school.test/wgyreport/upload").put("referrer","http://other.test/wgyreport/");assertThrows(Exception.class,()->ReportUploadHttp.validateTarget(info,"http://school.test"));
 }
}
