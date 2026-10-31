package com.labmaker.app;
import org.junit.*;import static org.junit.Assert.*;import okhttp3.*;import okhttp3.mockwebserver.*;import org.json.*;import java.nio.charset.StandardCharsets;import java.security.*;import java.util.*;import java.util.concurrent.*;import java.util.concurrent.atomic.*;
public class MobileDataDownloadTest {
 private MockWebServer server;private MobileDataDownload download;
 @Before public void start()throws Exception{server=new MockWebServer();server.start();download=new MobileDataDownload(new OkHttpClient.Builder().callTimeout(2,TimeUnit.SECONDS).build(),server.url("/"));}
 @After public void stop()throws Exception{server.shutdown();}
 private String hash(String text)throws Exception{StringBuilder out=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)))out.append(String.format("%02x",b&255));return out.toString();}
 @Test public void fixedManifestIsAnonymousGetAndUtf8BodyIsNotRewritten()throws Exception{
  String text="{\"说明\":\"实验\"}";server.enqueue(new MockResponse().setBody(text).addHeader("Set-Cookie","account=never-use"));JSONObject reply=download.manifest(new MobileDataDownload.Work(),(a,b)->{});assertTrue(reply.getBoolean("found"));assertEquals(text,reply.getString("body"));RecordedRequest request=server.takeRequest();assertEquals("/mobile-data-manifest.json",request.getPath());assertEquals("GET",request.getMethod());assertEquals(0,request.getBodySize());assertNull(request.getHeader("Cookie"));assertNull(request.getHeader("Authorization"));
  server.enqueue(new MockResponse().setBody(text));download.manifest(new MobileDataDownload.Work(),(a,b)->{});assertNull(server.takeRequest().getHeader("Cookie"));
 }
 @Test public void only404MeansUnpublishedAndRedirectOrForbiddenCannotLookCurrent()throws Exception{
  server.enqueue(new MockResponse().setResponseCode(404));assertFalse(download.manifest(new MobileDataDownload.Work(),(a,b)->{}).getBoolean("found"));server.takeRequest();
  server.enqueue(new MockResponse().setResponseCode(302).addHeader("Location",server.url("/other")));assertThrows(Exception.class,()->download.manifest(new MobileDataDownload.Work(),(a,b)->{}));assertEquals(2,server.getRequestCount());server.takeRequest();
  server.enqueue(new MockResponse().setResponseCode(403));assertThrows(Exception.class,()->download.manifest(new MobileDataDownload.Work(),(a,b)->{}));assertEquals(3,server.getRequestCount());
 }
 @Test public void bundleRequiresExactOriginVersionPathSizeAndHash()throws Exception{
  String body="{\"数据\":1}",url=server.url("/mobile-data/data-1.0.1.json").toString();int size=body.getBytes(StandardCharsets.UTF_8).length;AtomicLong progress=new AtomicLong();server.enqueue(new MockResponse().setBody(body));JSONObject reply=download.bundle(url,"1.0.1",size,hash(body),new MobileDataDownload.Work(),(a,b)->{progress.set(a);assertEquals(size,b);});assertEquals(size,reply.getLong("bytes"));assertEquals(size,progress.get());assertEquals(body,reply.getString("body"));server.takeRequest();
  for(String bad:new String[]{url+"?token=x",url+"#x",url.replace("1.0.1","1.0.2"),"https://example.com/mobile-data/data-1.0.1.json",server.url("/private/report.docx").toString()})assertThrows(Exception.class,()->download.bundle(bad,"1.0.1",size,hash(body),new MobileDataDownload.Work(),(a,b)->{}));assertEquals(1,server.getRequestCount());
 }
 @Test public void alteredBytesAndWrongDeclaredLengthFailWithoutReturningPartialData()throws Exception{
  String url=server.url("/mobile-data/data-1.0.1.json").toString();server.enqueue(new MockResponse().setBody("xx"));assertThrows(Exception.class,()->download.bundle(url,"1.0.1",2,hash("{}"),new MobileDataDownload.Work(),(a,b)->{}));server.enqueue(new MockResponse().setBody("{}"));assertThrows(Exception.class,()->download.bundle(url,"1.0.1",3,hash("{}"),new MobileDataDownload.Work(),(a,b)->{}));assertThrows(Exception.class,()->download.bundle(url,"1.0.1",MobileDataDownload.MAX_PACKAGE+1L,hash("{}"),new MobileDataDownload.Work(),(a,b)->{}));
 }
 @Test public void chunkedOversizeAndInvalidUtf8AreRejected()throws Exception{
  server.enqueue(new MockResponse().setChunkedBody("x".repeat(65537),1000));assertThrows(Exception.class,()->download.manifest(new MobileDataDownload.Work(),(a,b)->{}));
  server.enqueue(new MockResponse().setBody(new okio.Buffer().write(new byte[]{(byte)255,(byte)254})));assertThrows(Exception.class,()->download.manifest(new MobileDataDownload.Work(),(a,b)->{}));
 }
 @Test public void stoppedRequestDoesNotStartAndActiveReadCanBeCancelled()throws Exception{
  MobileDataDownload.Work before=new MobileDataDownload.Work();before.cancel();assertThrows(Exception.class,()->download.manifest(before,(a,b)->{}));assertEquals(0,server.getRequestCount());
  server.enqueue(new MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE));MobileDataDownload.Work work=new MobileDataDownload.Work();ExecutorService executor=Executors.newSingleThreadExecutor();try{Future<Boolean> result=executor.submit(()->{try{download.manifest(work,(a,b)->{});return false;}catch(Exception error){return true;}});assertNotNull(server.takeRequest(1,TimeUnit.SECONDS));work.cancel();assertTrue(result.get(2,TimeUnit.SECONDS));}finally{executor.shutdownNow();}
 }
 @Test public void partialStatusAndChunkedBodyLengthNeverPassAsACompleteBundle()throws Exception{
  String url=server.url("/mobile-data/data-1.0.1.json").toString();server.enqueue(new MockResponse().setResponseCode(206).setBody("{}"));assertThrows(Exception.class,()->download.bundle(url,"1.0.1",2,hash("{}"),new MobileDataDownload.Work(),(a,b)->{}));server.enqueue(new MockResponse().setChunkedBody("{}x",1));assertThrows(Exception.class,()->download.bundle(url,"1.0.1",2,hash("{}"),new MobileDataDownload.Work(),(a,b)->{}));
 }
}
