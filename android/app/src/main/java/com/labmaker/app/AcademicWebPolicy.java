package com.labmaker.app;
import java.net.URI;import java.util.*;
final class AcademicWebPolicy {
 static final String ENTRY="https://ehall.xidian.edu.cn/appShow?appId=4770397878132218";
 static String profile(String account)throws Exception {
  if(account==null||!account.matches("\\d{5,20}"))throw new IllegalArgumentException("教务账号无效");
  byte[] digest=java.security.MessageDigest.getInstance("SHA-256").digest(account.getBytes(java.nio.charset.StandardCharsets.UTF_8));StringBuilder name=new StringBuilder("lab-academic-");for(byte b:digest)name.append(String.format("%02x",b&255));return name.toString();
 }
 static boolean allowed(String value){try{URI u=new URI(value);return "https".equals(u.getScheme())&&u.getRawUserInfo()==null&&u.getPort()==-1&&Arrays.asList("ehall.xidian.edu.cn","ids.xidian.edu.cn").contains(u.getHost());}catch(Exception e){return false;}}
}
