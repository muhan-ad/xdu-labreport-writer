package com.labmaker.app;
import java.text.Normalizer;
import java.util.*;

/** Same product rule as desktop: any recognized 已 denotes 已上传; numeric scores require consensus. */
final class ReportStatus {
  static Double numeric(String value) {
    String s=Normalizer.normalize(value==null?"":value,Normalizer.Form.NFKC).replaceAll("\\s","").replace('·','.').replace('•','.');
    if(!s.matches("\\d{1,3}(?:\\.\\d{1,2})?分?"))return null;
    double n=Double.parseDouble(s.replace("分",""));return n>=0&&n<=100?n:null;
  }
  static String status(List<String> texts) {
    for(String s:texts)if(s.contains("已"))return "已上传";
    if(texts.size()<2)return "";
    for(String target:new String[]{"未上传","未批改"}) {
      boolean all=true;for(String s:texts)if(!s.replaceAll("\\s","").matches("(?:"+target+")+"))all=false;
      if(all)return target;
    }
    return "";
  }
  static Double agreed(List<String> texts) {
    if(texts.size()<2)return null;Double found=null;int count=0;
    for(String text:texts){String[] parts=text.trim().split("\\s+");if(parts.length<2)return null;for(String p:parts){Double n=numeric(p);if(n==null||found!=null&&!found.equals(n))return null;found=n;count++;}}
    return count>=4?found:null;
  }
}
