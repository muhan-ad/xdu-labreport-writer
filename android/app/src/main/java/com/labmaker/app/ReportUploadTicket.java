package com.labmaker.app;
import java.io.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.ZipFile;

/** Immutable local snapshot, one-use monotonic ticket. No network or browser operations. */
final class ReportUploadTicket {
  final String id=UUID.randomUUID().toString(),fingerprint,fileName,sha256,experimentId;
  final File file;final int page;final long size,epoch,expires;
  private boolean consumed=false;
  ReportUploadTicket(File source,File cache,String name,String fingerprint,int page,String experimentId,long epoch,long now)throws Exception {
    if(!name.endsWith(".docx")||name.length()>100||name.matches("(?s).*[<>:\"/\\\\|?*\\p{Cntrl}].*")||!experimentId.matches("[a-f0-9]{12}")||fingerprint.isEmpty()||fingerprint.length()>1500||page<1||page>100)throw new IOException("报告标识无效");
    if(source.length()>128L*1024*1024)throw new IOException("报告超过 128 MB");
    this.fileName=name;this.fingerprint=fingerprint;this.page=page;this.epoch=epoch;this.experimentId=experimentId;
    File dir=new File(cache,id);if(!dir.mkdirs())throw new IOException("无法准备报告文件");file=new File(dir,"report.docx");
    try {
      long count=0;try(InputStream in=new FileInputStream(source);OutputStream out=new FileOutputStream(file)){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1){count+=n;if(count>128L*1024*1024)throw new IOException("报告超过 128 MB");out.write(b,0,n);}}
      if(count<1)throw new IOException("报告文件为空");
      try(ZipFile zip=new ZipFile(file)){if(zip.size()>10000||zip.getEntry("[Content_Types].xml")==null||zip.getEntry("word/document.xml")==null)throw new IOException("不是有效的 Word 报告");}
      size=count;sha256=digest(file);expires=now+120000;
    }catch(Exception e){delete();throw e;}
  }
  static String digest(File f)throws Exception{MessageDigest d=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(f)){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1)d.update(b,0,n);}StringBuilder s=new StringBuilder();for(byte b:d.digest())s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();}
  synchronized void consume(String token,boolean confirmed,long liveEpoch,long now)throws Exception {
    if(!id.equals(token)||consumed)throw new IOException("上传确认已失效，请重新准备");
    if(!confirmed)throw new IOException("需要最终确认后才能上传");
    if(epoch!=liveEpoch||now>=expires)throw new IOException("上传确认已过期，请重新准备");
    consumed=true;
    if(file.length()!=size||!sha256.equals(digest(file)))throw new IOException("待上传文件已变化，已停止提交");
  }
  void delete(){file.delete();file.getParentFile().delete();}
}
