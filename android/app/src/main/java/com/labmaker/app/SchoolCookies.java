package com.labmaker.app;

import java.io.IOException;
import java.util.*;
import okhttp3.*;

/** Memory-only school cookies, with one explicit compatibility case for its raw UTF-8 name cookie. */
final class SchoolCookies implements CookieJar, Interceptor {
    private final String host;
    private final List<Cookie> standard=new ArrayList<>();
    private final List<Legacy> legacy=new ArrayList<>();
    private static final class Legacy {final Cookie metadata;final String value;Legacy(Cookie c,String v){metadata=c;value=v;}}
    SchoolCookies(String host){this.host=host;}
    private static boolean same(Cookie a,Cookie b){return a.name().equals(b.name())&&a.domain().equals(b.domain())&&a.path().equals(b.path());}
    public synchronized void saveFromResponse(HttpUrl url,List<Cookie> incoming){
        for(Cookie c:incoming){standard.removeIf(old->same(old,c));if(c.expiresAt()>System.currentTimeMillis())standard.add(c);}
    }
    public synchronized List<Cookie> loadForRequest(HttpUrl url){
        standard.removeIf(c->c.expiresAt()<=System.currentTimeMillis());List<Cookie> result=new ArrayList<>();for(Cookie c:standard)if(c.matches(url))result.add(c);return result;
    }
    synchronized void clear(){standard.clear();legacy.clear();}
    private synchronized void capture(HttpUrl url,Headers headers){
        if(!url.host().equals(host))return;
        for(String header:headers.values("Set-Cookie")){
            int equals=header.indexOf('='),semicolon=header.indexOf(';');
            if(equals<0||!header.substring(0,equals).trim().equals("PhyEws_StuName"))continue;
            String value=header.substring(equals+1,semicolon<0?header.length():semicolon).trim();
            // Parse domain/path/secure/expiry with the normal library, replacing only the rejected value.
            Cookie metadata=Cookie.parse(url,"PhyEws_StuName=legacy"+(semicolon<0?"":header.substring(semicolon)));
            if(metadata==null)continue;
            legacy.removeIf(old->same(old.metadata,metadata));
            if(value.length()>256||value.chars().anyMatch(c->c<0x20||c==0x7f||c==';')||value.chars().allMatch(c->c<0x80)||metadata.expiresAt()<=System.currentTimeMillis())continue;
            standard.removeIf(old->same(old,metadata));
            legacy.add(new Legacy(metadata,value));
        }
    }
    private synchronized String header(HttpUrl url,String existing){
        legacy.removeIf(c->c.metadata.expiresAt()<=System.currentTimeMillis());
        StringBuilder value=new StringBuilder(existing==null?"":existing);
        if(url.host().equals(host))for(Legacy c:legacy)if(c.metadata.matches(url)){
            if(value.length()>0)value.append("; ");value.append(c.metadata.name()).append('=').append(c.value);
        }
        return value.toString();
    }
    public Response intercept(Chain chain)throws IOException{
        Request request=chain.request();String cookie=header(request.url(),request.header("Cookie"));
        if(!cookie.isEmpty()){
            // The school's response uses raw UTF-8. Percent-encoding would change what its ASP.NET code reads.
            Headers headers=request.headers().newBuilder().removeAll("Cookie").addUnsafeNonAscii("Cookie",cookie).build();
            request=request.newBuilder().headers(headers).build();
        }
        Response response=chain.proceed(request);capture(request.url(),response.headers());return response;
    }
}
