package com.labmaker.app;
import okhttp3.*;
import okhttp3.mockwebserver.*;
import org.junit.Test;
import static org.junit.Assert.*;
import java.util.*;

public class SchoolCookiesTest {
    @Test public void actualHttpRoundTripPreservesLegacyUtf8AndAuthenticationWithoutReencoding()throws Exception{
        try(MockWebServer server=new MockWebServer()){
            server.start();SchoolCookies jar=new SchoolCookies(server.getHostName());OkHttpClient client=new OkHttpClient.Builder().cookieJar(jar).addNetworkInterceptor(jar).build();
            Headers h=new Headers.Builder().addUnsafeNonAscii("Set-Cookie","PhyEws_StuName=模拟同学; Path=/phyews/; HttpOnly").add("Set-Cookie",".PhyEwsAuth=dummy; Path=/; HttpOnly").build();
            server.enqueue(new MockResponse().setHeaders(h).setBody("login"));server.enqueue(new MockResponse().setBody("timetable"));
            try(Response r=client.newCall(new Request.Builder().url(server.url("/phyews/")).build()).execute()){assertEquals(200,r.code());}
            try(Response r=client.newCall(new Request.Builder().url(server.url("/phyews/student/select.aspx")).build()).execute()){assertEquals("timetable",r.body().string());}
            server.takeRequest();String cookie=server.takeRequest().getHeader("Cookie");assertTrue(cookie.contains("PhyEws_StuName=模拟同学"));assertTrue(cookie.contains(".PhyEwsAuth=dummy"));assertFalse(cookie.contains("%"));
        }
    }
    @Test public void pathClearAndAsciiReplacementDoNotResurrectOldNames()throws Exception{
        try(MockWebServer server=new MockWebServer()){
            server.start();SchoolCookies jar=new SchoolCookies(server.getHostName());OkHttpClient c=new OkHttpClient.Builder().cookieJar(jar).addNetworkInterceptor(jar).build();
            server.enqueue(new MockResponse().setHeaders(new Headers.Builder().addUnsafeNonAscii("Set-Cookie","PhyEws_StuName=模拟同学; Path=/phyews/").build()));
            try(Response r=c.newCall(new Request.Builder().url(server.url("/phyews/")).build()).execute()){}server.takeRequest();
            server.enqueue(new MockResponse());try(Response r=c.newCall(new Request.Builder().url(server.url("/outside")).build()).execute()){}assertNull(server.takeRequest().getHeader("Cookie"));
            server.enqueue(new MockResponse().addHeader("Set-Cookie","PhyEws_StuName=ascii; Path=/phyews/"));try(Response r=c.newCall(new Request.Builder().url(server.url("/phyews/")).build()).execute()){}server.takeRequest();
            server.enqueue(new MockResponse());try(Response r=c.newCall(new Request.Builder().url(server.url("/phyews/")).build()).execute()){}assertEquals("PhyEws_StuName=ascii",server.takeRequest().getHeader("Cookie"));
            jar.clear();server.enqueue(new MockResponse());try(Response r=c.newCall(new Request.Builder().url(server.url("/phyews/")).build()).execute()){}assertNull(server.takeRequest().getHeader("Cookie"));
        }
    }
}
