package com.labmaker.app;
import java.io.IOException;import java.util.*;
final class MobileAppPolicy {
 static final class Info{final String id,version;final long code;final int minAndroid;final Set<String> certificates;Info(String id,String version,long code,int minAndroid,Set<String> certificates){this.id=id;this.version=version;this.code=code;this.minAndroid=minAndroid;this.certificates=new HashSet<>(certificates);}}
 static void validate(Info installed,Info candidate,String version,long code,int minAndroid,String certificate,int device)throws IOException{
  if(!"com.labmaker.app".equals(installed.id)||!installed.id.equals(candidate.id))throw new IOException("安装包不属于当前应用");
  if(!version.equals(candidate.version)||code!=candidate.code||minAndroid!=candidate.minAndroid||code<=installed.code||compare(version,installed.version)<=0)throw new IOException("安装包版本不匹配或不高于当前版本");
  if(minAndroid>device)throw new IOException("当前 Android 版本不支持此安装包");
  if(installed.certificates.size()!=1||!installed.certificates.equals(candidate.certificates)||!installed.certificates.contains(certificate))throw new IOException("安装包签名与当前应用不一致");
 }
 static int compare(String a,String b)throws IOException{String pattern="(0|[1-9][0-9]{0,5})[.](0|[1-9][0-9]{0,5})[.](0|[1-9][0-9]{0,5})";if(a==null||b==null||!a.matches(pattern)||!b.matches(pattern))throw new IOException("应用版本格式无效");String[] x=a.split("[.]"),y=b.split("[.]");for(int i=0;i<3;i++){int order=Integer.compare(Integer.parseInt(x[i]),Integer.parseInt(y[i]));if(order!=0)return order;}return 0;}
}
