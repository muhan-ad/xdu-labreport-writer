package com.labmaker.app;
import okhttp3.HttpUrl;

final class ReportWebPolicy {
  static boolean sameHost(String raw,boolean mock) {
    try{HttpUrl u=HttpUrl.get(raw);return u.username().isEmpty()&&u.password().isEmpty()&&
      (mock?u.scheme().equals("http")&&u.host().equals("127.0.0.1")&&u.port()==58442:
      u.host().equals("wlsy.xidian.edu.cn")&&(u.scheme().equals("http")&&u.port()==80||u.scheme().equals("https")&&u.port()==443));}catch(Exception e){return false;}
  }
  static boolean document(String raw,boolean mock){try{if(mock)return sameHost(raw,true);HttpUrl u=HttpUrl.get(raw);return u.username().isEmpty()&&u.password().isEmpty()&&(u.isHttps()||u.scheme().equals("http"));}catch(Exception e){return false;}}
  static boolean resource(String raw,String method,boolean mock){return document(raw,mock);}
}
