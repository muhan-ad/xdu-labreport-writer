package com.labmaker.app;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.database.Cursor;
import android.app.Activity;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.annotation.ActivityCallback;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.nio.charset.StandardCharsets;

/** Fixed private report sources; external exports only to a user-granted document tree. */
@CapacitorPlugin(name="LabReportFiles")
public class LabReportFilesPlugin extends Plugin {
 @PluginMethod public void copyText(PluginCall call){String text=call.getString("text","");if(text.trim().isEmpty()||text.length()>100000){call.reject("复制正文为空或过长");return;}if(getActivity()==null){call.reject("当前页面已关闭，未能复制");return;}getActivity().runOnUiThread(()->{try{android.content.ClipboardManager clipboard=(android.content.ClipboardManager)getContext().getSystemService(android.content.Context.CLIPBOARD_SERVICE);if(clipboard==null)throw new IllegalStateException();clipboard.setPrimaryClip(android.content.ClipData.newPlainText("实验搭子",text));call.resolve();}catch(Exception error){call.reject("未能复制，请长按正文手动复制");}});}
 private static final String MIME="application/vnd.openxmlformats-officedocument.wordprocessingml.document";
 private final ExecutorService files=Executors.newSingleThreadExecutor();private final AtomicBoolean active=new AtomicBoolean();
 private File source(String id,String generation)throws Exception{return ReportFilePolicy.resolve(new File[]{getContext().getFilesDir(),getContext().getNoBackupFilesDir()},id,generation);}
 @PluginMethod public void verifyStaged(PluginCall call){files.execute(()->{try{
  ReportStageVerifier.verify(new File[]{getContext().getFilesDir(),getContext().getNoBackupFilesDir()},call.getString("experimentId",""),call.getString("generation",""),call.getString("file",""),call.getInt("bytes",0),call.getString("sha256",""));
  call.resolve(new JSObject().put("verified",true));
 }catch(Exception e){call.reject("报告文件回读未能核实，请重试生成","REPORT_VERIFY");}});}
 @PluginMethod public void verifyPhoto(PluginCall call){files.execute(()->{try{
  ReportStageVerifier.verifyPhoto(new File[]{getContext().getFilesDir(),getContext().getNoBackupFilesDir()},call.getString("experimentId",""),call.getString("file",""),call.getInt("bytes",0),call.getString("sha256",""));
  call.resolve(new JSObject().put("verified",true));
 }catch(Exception e){call.reject("照片文件回读未能核实，请重试添加","PHOTO_VERIFY");}});}
 private android.util.AtomicFile setting(){return new android.util.AtomicFile(new File(getContext().getNoBackupFilesDir(),"report-directory-v1.json"));}
 private Uri tree()throws Exception{try(InputStream in=setting().openRead()){byte[] bytes=in.readNBytes(8193);if(bytes.length>8192)throw new IOException();org.json.JSONObject value=new org.json.JSONObject(new String(bytes,StandardCharsets.UTF_8));if(value.getInt("version")!=1)throw new IOException();Uri uri=Uri.parse(value.getString("uri"));if(!"content".equals(uri.getScheme())||!DocumentsContract.isTreeUri(uri))throw new IOException();return uri;}catch(FileNotFoundException e){return null;}}
 private void record(Uri uri)throws Exception{byte[] bytes=new org.json.JSONObject().put("version",1).put("uri",uri.toString()).toString().getBytes(StandardCharsets.UTF_8);if(bytes.length>8192)throw new IOException();FileOutputStream out=null;try{out=setting().startWrite();out.write(bytes);setting().finishWrite(out);out=null;if(!uri.equals(tree()))throw new IOException();}catch(Exception e){if(out!=null)setting().failWrite(out);throw e;}}
 private boolean permitted(Uri uri){if(uri==null)return false;for(android.content.UriPermission permission:getContext().getContentResolver().getPersistedUriPermissions())if(permission.getUri().equals(uri)&&permission.isReadPermission()&&permission.isWritePermission())return true;return false;}
 private String display(Uri document)throws Exception{try(Cursor row=getContext().getContentResolver().query(document,new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)){if(row==null||!row.moveToFirst())throw new IOException();String name=row.getString(0);if(name==null||name.isBlank()||name.length()>500)throw new IOException();return name;}}
 private JSObject state()throws Exception{return state(tree());}
 private JSObject state(Uri uri)throws Exception{if(uri==null)return new JSObject().put("configured",false).put("writable",false).put("name","");boolean writable=permitted(uri);String name="已选择的文件夹";try{Uri document=DocumentsContract.buildDocumentUriUsingTree(uri,DocumentsContract.getTreeDocumentId(uri));name=display(document);try(Cursor row=getContext().getContentResolver().query(document,new String[]{DocumentsContract.Document.COLUMN_FLAGS},null,null,null)){writable=writable&&row!=null&&row.moveToFirst()&&(row.getLong(0)&DocumentsContract.Document.FLAG_DIR_SUPPORTS_CREATE)!=0;}}catch(Exception e){writable=false;}return new JSObject().put("configured",true).put("writable",writable).put("name",name);}
 @PluginMethod public void directoryStatus(PluginCall call){files.execute(()->{try{call.resolve(state());}catch(Exception e){call.reject("保存目录设置无法读取，请重新选择文件夹","REPORT_DIRECTORY");}});}
 @PluginMethod public void chooseDirectory(PluginCall call){if(!active.compareAndSet(false,true)){call.reject("文件操作正在进行，请稍候","REPORT_BUSY");return;}getActivity().runOnUiThread(()->{try{Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION|Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);startActivityForResult(call,intent,"directoryChosen");}catch(Exception e){active.set(false);call.reject("系统文件夹选择器未能打开","REPORT_DIRECTORY");}});}
 @ActivityCallback private void directoryChosen(PluginCall call,ActivityResult result){if(call==null){active.set(false);return;}Intent data=result.getData();if(result.getResultCode()!=Activity.RESULT_OK||data==null||data.getData()==null){active.set(false);call.resolve(new JSObject().put("cancelled",true));return;}Uri uri=data.getData();int flags=data.getFlags()&(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);files.execute(()->{try{if(!"content".equals(uri.getScheme())||!DocumentsContract.isTreeUri(uri)||(flags&3)!=3)throw new IOException();getContext().getContentResolver().takePersistableUriPermission(uri,flags);if(!permitted(uri))throw new IOException();JSObject value=state(uri);if(!value.getBoolean("writable"))throw new IOException();Uri old=null;try{old=tree();}catch(Exception ignored){}record(uri);if(old!=null&&!old.equals(uri))try{getContext().getContentResolver().releasePersistableUriPermission(old,3);}catch(Exception ignored){}call.resolve(value.put("cancelled",false));}catch(Exception e){call.reject("目录未能取得长期读写授权，请重新选择文件夹","REPORT_DIRECTORY");}finally{active.set(false);}});}
 @PluginMethod public void clearDirectory(PluginCall call){if(!call.getBoolean("confirmed",false)){call.reject("请先确认清除默认目录","CONFIRM");return;}if(!active.compareAndSet(false,true)){call.reject("文件操作正在进行，请稍候","REPORT_BUSY");return;}files.execute(()->{try{Uri old=null;try{old=tree();}catch(Exception ignored){}setting().delete();if(setting().getBaseFile().exists())throw new IOException();if(old!=null)try{getContext().getContentResolver().releasePersistableUriPermission(old,3);}catch(Exception ignored){}call.resolve();}catch(Exception e){call.reject("默认目录未能清除，请重试","REPORT_DIRECTORY");}finally{active.set(false);}});}
 @PluginMethod public void saveToDirectory(PluginCall call){if(!active.compareAndSet(false,true)){call.reject("文件操作正在进行，请稍候","REPORT_BUSY");return;}files.execute(()->{try{
  File report=source(call.getString("experimentId",""),call.getString("generation",""));long size=report.length();Uri directory=tree();if(directory==null||!permitted(directory)||!state().getBoolean("writable"))throw new ReportExport.Failure("保存目录未授权或权限已失效，请重新选择文件夹",false);
  Set<String> ids=new HashSet<>(),names=new HashSet<>();Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(directory,DocumentsContract.getTreeDocumentId(directory));try(Cursor rows=getContext().getContentResolver().query(children,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)){if(rows==null)throw new IOException();while(rows.moveToNext()){if(ids.size()>=20000)throw new IOException();String id=rows.getString(0);if(id==null||id.isBlank())throw new IOException();ids.add(id);String name=rows.getString(1);if(name!=null)names.add(name);}}
  ReportExport.Destination destination=new ReportExport.Destination(){public Set<String> names(){return names;}public ReportExport.Target create(String name)throws Exception{Uri uri=DocumentsContract.createDocument(getContext().getContentResolver(),DocumentsContract.buildDocumentUriUsingTree(directory,DocumentsContract.getTreeDocumentId(directory)),MIME,name);if(uri==null||ids.contains(DocumentsContract.getDocumentId(uri)))throw new ReportExport.Failure("文件提供商未创建独立副本，已停止保存",false);try{return new ReportExport.Target(uri.toString(),display(uri));}catch(Exception e){boolean removed=false;try{removed=DocumentsContract.deleteDocument(getContext().getContentResolver(),uri);}catch(Exception ignored){}throw new ReportExport.Failure("新报告文件未能核实",!removed);}}public OutputStream write(ReportExport.Target target)throws Exception{OutputStream out=getContext().getContentResolver().openOutputStream(Uri.parse(target.id),"w");if(out==null)throw new IOException();return out;}public InputStream read(ReportExport.Target target)throws Exception{InputStream in=getContext().getContentResolver().openInputStream(Uri.parse(target.id));if(in==null)throw new IOException();return in;}public boolean remove(ReportExport.Target target)throws Exception{return DocumentsContract.deleteDocument(getContext().getContentResolver(),Uri.parse(target.id));}};
  try(InputStream in=new FileInputStream(report)){ReportExport.Target saved=ReportExport.save(in,size,call.getString("name","实验报告.docx"),destination);call.resolve(new JSObject().put("name",saved.name).put("bytes",size).put("verified",true));}
 }catch(Exception e){call.reject(e instanceof ReportExport.Failure?e.getMessage():"报告未能保存，请核对文件夹权限并重试",e instanceof ReportExport.Failure&&((ReportExport.Failure)e).partial?"REPORT_EXPORT_PARTIAL":"REPORT_EXPORT");}finally{active.set(false);}});}
 @Override protected void handleOnDestroy(){files.shutdownNow();}
 @PluginMethod public void open(PluginCall call){
   String id=call.getString("experimentId",""),generation=call.getString("generation","");
   if(!id.matches("[a-f0-9]{12}")||!generation.matches("[a-f0-9-]{36}")){call.reject("报告标识无效","REPORT_ID");return;}
   try{
     File report=null;
     for(File base:new File[]{getContext().getFilesDir(),getContext().getNoBackupFilesDir()}){
       File root=new File(base,"lab-maker/v1/reports").getCanonicalFile(),candidate=new File(root,id+"/"+generation+"/report.docx").getCanonicalFile();
       if(!candidate.getPath().startsWith(root.getPath()+File.separator))throw new IOException();
       if(candidate.isFile()&&candidate.length()>0&&candidate.length()<=128L*1024*1024){report=candidate;break;}
     }
     if(report==null){call.reject("报告文件缺失或不可用，请重新生成","REPORT_MISSING");return;}
     Uri uri=androidx.core.content.FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".fileprovider",report);
     Intent intent=new Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.openxmlformats-officedocument.wordprocessingml.document").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
     getActivity().runOnUiThread(()->{try{getActivity().startActivity(intent);call.resolve();}catch(android.content.ActivityNotFoundException e){call.reject("未找到可打开 Word 的应用，请安装 Word/WPS，或使用保存 / 分享","NO_VIEWER");}catch(Exception e){call.reject("外部打开未完成，请使用保存 / 分享","REPORT_OPEN");}});
   }catch(Exception e){call.reject("报告文件不可用，请重新生成","REPORT_MISSING");}
 }
}
