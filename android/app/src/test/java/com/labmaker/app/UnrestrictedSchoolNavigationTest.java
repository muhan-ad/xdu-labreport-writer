package com.labmaker.app;
import org.junit.Test;
import static org.junit.Assert.*;
import okhttp3.*;
import okhttp3.mockwebserver.*;
public class UnrestrictedSchoolNavigationTest {
 @Test public void localRedirectAcrossHostsPortsAndPathsWorks() throws Exception {
  try(MockWebServer first=new MockWebServer();MockWebServer second=new MockWebServer()){
   first.start();second.start();
   HttpUrl target=second.url("/different/path?stage=done").newBuilder().host("localhost").build();
   first.enqueue(new MockResponse().setResponseCode(302).addHeader("Location",target));second.enqueue(new MockResponse().setBody("ready"));
   HttpUrl current=first.url("/entry");OkHttpClient client=new OkHttpClient.Builder().followRedirects(false).build();
   for(int step=0;step<2;step++){
    assertTrue(SchoolNetworkPolicy.allowed(current,false));assertTrue(AcademicWebPolicy.allowed(current.toString()));assertTrue(ReportWebPolicy.document(current.toString(),false));assertTrue(ReportWebPolicy.resource(current.toString(),"GET",false));
    try(Response response=client.newCall(new Request.Builder().url(current).build()).execute()){
     if(step==0){assertEquals(302,response.code());current=current.resolve(response.header("Location"));assertNotNull(current);}else assertEquals("ready",response.body().string());
    }
   }
  }
 }
}
