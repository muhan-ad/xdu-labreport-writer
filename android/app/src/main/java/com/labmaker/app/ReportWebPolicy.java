package com.labmaker.app;
import okhttp3.HttpUrl;

final class ReportWebPolicy {
  static boolean sameHost(String raw,boolean mock) {
    try{HttpUrl u=HttpUrl.get(raw);return u.username().isEmpty()&&u.password().isEmpty()&&
      (mock?u.scheme().equals("http")&&u.host().equals("127.0.0.1")&&u.port()==58442:
      u.host().equals("wlsy.xidian.edu.cn")&&(u.scheme().equals("http")&&u.port()==80||u.scheme().equals("https")&&u.port()==443));}catch(Exception e){return false;}
  }
  static boolean document(String raw,boolean mock){try{return sameHost(raw,mock)&&HttpUrl.get(raw).encodedPath().toLowerCase().startsWith("/wgyreport/");}catch(Exception e){return false;}}
  static boolean resource(String raw,String method,boolean mock){
    if(sameHost(raw,mock))return true;
    try{HttpUrl u=HttpUrl.get(raw);return !mock&&method.equals("GET")&&u.scheme().equals("https")&&u.port()==443&&u.username().isEmpty()&&u.password().isEmpty()&&u.host().equals("cdn.falconsistemas.com.br")&&u.encodedPath().startsWith("/falcon/")&&u.encodedPath().matches("(?i).*\\.(js|css|woff2?|ttf|png|gif|jpe?g|svg)$");}catch(Exception e){return false;}
  }
}
