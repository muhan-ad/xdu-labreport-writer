package com.labmaker.app;

import android.graphics.*;
import android.net.http.SslError;
import android.os.*;
import android.util.Base64;
import android.view.*;
import android.webkit.*;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.*;
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

/** Own remote WebView, no Capacitor bridge, file chooser, upload command or native credentials store. */
@CapacitorPlugin(name="LabReportPortal")
public class LabReportPortalPlugin extends Plugin {
  private final Handler ui=new Handler(Looper.getMainLooper());
  private final ExecutorService ocr=Executors.newSingleThreadExecutor();
  private final ExecutorService accountIO=Executors.newSingleThreadExecutor();
  private final Map<String,JSONObject> imageCache=Collections.synchronizedMap(new LinkedHashMap<>());
  private WebView web;private PluginCall pendingEvaluation;private volatile long epoch=0;private boolean mock=false,evaluating=false,submitted=false,seenReady=false,pageReady=false;
  private String reportAgent="",script="",failure="",reportAccount="";private long loginAt=0;
  private volatile boolean uploadBusy=false,committing=false;private volatile long uploadClockOffset=0;private ReportUploadTicket uploadTicket;
  private TextRecognizer recognizer;
  @Override public void load(){
    try(InputStream in=getContext().getAssets().open("report-reader.js")){script=new String(in.readAllBytes(),StandardCharsets.UTF_8);}catch(Exception ignored){}
  }
  private String origin(){return mock?"http://127.0.0.1:58442":"http://wlsy.xidian.edu.cn";}
  private void destroy(){epoch++;PluginCall old=pendingEvaluation;pendingEvaluation=null;if(old!=null)old.reject("报告会话已清除，旧结果已丢弃","STALE_SESSION");uploadClockOffset=0;uploadBusy=false;reportAccount="";if(uploadTicket!=null){uploadTicket.delete();uploadTicket=null;}pageReady=false;evaluating=false;submitted=false;seenReady=false;failure="";imageCache.clear();if(web!=null){web.stopLoading();web.loadUrl("about:blank");if(web.getParent() instanceof ViewGroup)((ViewGroup)web.getParent()).removeView(web);web.destroy();web=null;}}
  @PluginMethod public void clear(PluginCall call){ui.post(()->{if(committing){call.reject("报告正在提交并回读，请稍候","COMMIT_BUSY");return;}destroy();CookieManager.getInstance().removeAllCookies(v->call.resolve());});}
  @PluginMethod public void useMock(PluginCall call){if(!BuildConfig.DEBUG){call.reject("测试入口不可用","OPERATION");return;}ui.post(()->{if(committing){call.reject("报告正在提交并回读，请稍候","COMMIT_BUSY");return;}destroy();mock=call.getBoolean("enabled",false);CookieManager.getInstance().removeAllCookies(v->call.resolve());});}
  @PluginMethod public void start(PluginCall call){ui.post(()->{
    if(committing){call.reject("报告正在提交并回读，请稍候","COMMIT_BUSY");return;}destroy();final long generation=epoch;
    if(script.isEmpty()){call.reject("报告读取资源缺失","RESOURCE");return;}
    CookieManager.getInstance().removeAllCookies(ignored->{
      if(epoch!=generation){call.reject("报告会话已清除","STALE_SESSION");return;}
      web=new WebView(getContext());web.setAlpha(0);web.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);web.setFocusable(false);
      WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(false);settings.setSaveFormData(false);settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setCacheMode(WebSettings.LOAD_DEFAULT);settings.setSupportMultipleWindows(false);settings.setJavaScriptCanOpenWindowsAutomatically(false);settings.setUserAgentString(settings.getUserAgentString()+" LabMakerMobile/"+BuildConfig.VERSION_NAME);settings.setOffscreenPreRaster(true);reportAgent=settings.getUserAgentString();
      CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
      web.setWebChromeClient(new WebChromeClient(){
        @Override public void onPermissionRequest(PermissionRequest request){request.deny();}
        @Override public boolean onShowFileChooser(WebView v,android.webkit.ValueCallback<android.net.Uri[]> callback,FileChooserParams params){callback.onReceiveValue(null);return true;}
        @Override public boolean onJsAlert(WebView v,String url,String msg,JsResult result){result.cancel();return true;}
        @Override public boolean onJsConfirm(WebView v,String url,String msg,JsResult result){result.cancel();return true;}
      });
      web.setWebViewClient(new WebViewClient(){
        @Override public void onPageStarted(WebView v,String url,Bitmap icon){if(epoch==generation)pageReady=false;}
        @Override public void onPageCommitVisible(WebView v,String url){if(epoch==generation)pageReady=ReportWebPolicy.document(url,mock);}
        @Override public void onPageFinished(WebView v,String url){if(epoch==generation)pageReady=ReportWebPolicy.document(url,mock);}
        @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){if(epoch!=generation)return true;boolean allowed=ReportWebPolicy.document(r.getUrl().toString(),mock);if(!allowed&&r.isForMainFrame())failure="报告网站跳转地址待核实";return !allowed;}
        @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){
          boolean fileRequest=false;if(committing&&r.getMethod().equalsIgnoreCase("POST"))for(Map.Entry<String,String> h:r.getRequestHeaders().entrySet())if(h.getKey().equalsIgnoreCase("Content-Type")&&h.getValue().toLowerCase(Locale.ROOT).contains("multipart/form-data"))fileRequest=true;
          return !fileRequest&&ReportWebPolicy.resource(r.getUrl().toString(),r.getMethod(),mock)?null:new WebResourceResponse("text/plain","utf-8",403,"Blocked",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));
        }
        @Override public void onReceivedSslError(WebView v,SslErrorHandler handler,SslError error){handler.cancel();if(epoch==generation)failure="报告网站证书校验失败";}
        @Override public void onReceivedError(WebView v,WebResourceRequest r,WebResourceError error){if(r.isForMainFrame()&&epoch==generation)failure="报告系统连接失败，请检查校园网";}
        @Override public void onReceivedHttpError(WebView v,WebResourceRequest r,WebResourceResponse response){if(r.isForMainFrame()&&epoch==generation)failure="报告网站请求失败（HTTP "+response.getStatusCode()+"）";}
      });
      ((ViewGroup)getActivity().findViewById(android.R.id.content)).addView(web,0,new ViewGroup.LayoutParams(1200,900));
      web.loadUrl(origin()+"/wgyreport/wgyreport.dll/?id=stu");call.resolve();
    });
  });}
  private void evaluate(PluginCall call,String command,JSONObject payload){ui.post(()->{
    if(uploadBusy){call.reject("正在核对或提交报告，请稍候","UPLOAD_BUSY");return;}
    if(web==null){call.reject("请先连接报告系统","SESSION");return;}
    if(!failure.isEmpty()){call.reject(failure,"NETWORK");return;}
    if(evaluating){call.reject("报告读取正在进行","BUSY");return;}
    if(!pageReady){call.resolve(new JSObject().put("phase","loading"));return;}
    String url=web.getUrl();if(url==null){call.resolve(new JSObject().put("phase","loading"));return;}
    if(!ReportWebPolicy.document(url,mock)){call.reject("报告网站地址待核实","REDIRECT");return;}
    final long generation=epoch;evaluating=true;pendingEvaluation=call;
    String code="(function(){try{"+script+";return JSON.stringify(labReportReader("+JSONObject.quote(command)+","+payload.toString()+","+JSONObject.quote(android.net.Uri.parse(url).getScheme()+"://"+android.net.Uri.parse(url).getAuthority())+"));}catch(e){return JSON.stringify({phase:'error',message:'官网报告页面结构待核实'});}})()";
    try{web.evaluateJavascript(code,value->{
      if(pendingEvaluation!=call)return;pendingEvaluation=null;
      if(generation!=epoch){call.reject("报告会话已清除，旧结果已丢弃","STALE_SESSION");return;}
      evaluating=false;
      try{
        if(value==null||value.length()>3*1024*1024)throw new Exception();
        Object decoded=new JSONTokener(value).nextValue();if(!(decoded instanceof String))throw new Exception();JSONObject result=new JSONObject((String)decoded);
        String phase=result.optString("phase");if(phase.equals("ready"))seenReady=true;
        if(phase.equals("needs_login")&&submitted){boolean failed=seenReady||!result.optString("message").isEmpty()||SystemClock.elapsedRealtime()-loginAt>8000;result.put("phase",seenReady?"expired":failed?"login_failed":"logging_in");if(failed&&result.optString("message").isEmpty())result.put("message",seenReady?"报告登录已失效，请重新登录":"报告登录未成功，请核对账号密码");}
        call.resolve(JSObject.fromJSONObject(result));
      }catch(Exception e){call.reject("报告页面响应无法解析","FORMAT");}
    });}catch(RuntimeException error){if(pendingEvaluation==call){pendingEvaluation=null;evaluating=false;call.reject("报告页面读取失败，请重试","READ");}}
  });}
  @PluginMethod public void read(PluginCall call){evaluate(call,"read",new JSONObject());}
  @PluginMethod public void sessionStatus(PluginCall call){ui.post(()->{if(uploadBusy){call.reject("正在核对或提交报告，请稍候","UPLOAD_BUSY");return;}call.resolve(new JSObject().put("active",web!=null&&submitted&&!reportAccount.isEmpty()).put("account",web!=null&&submitted?reportAccount:""));});}
  @PluginMethod public void login(PluginCall call){
    String account=call.getString("account",""),password=call.getString("password","");
    loginCredentials(call,account,password,epoch);
  }
  @PluginMethod public void loginSaved(PluginCall call){
    String id=call.getString("id",""),expected=call.getString("account","");long generation=epoch;
    accountIO.execute(()->{try{
      SchoolAccountVault.Credentials value=SchoolSavedLogin.resolve(SchoolAccountStorage.open(getContext()),"report",id,expected);
      loginCredentials(call,value.account,value.password,generation);
    }catch(Exception ignored){call.reject("已保存报告账号已变化或无法解密，请在账号管理中核对","ACCOUNT");}});
  }
  private void loginCredentials(PluginCall call,String account,String password,long generation){
    if(!account.matches("\\d{6,30}")||password.isEmpty()||password.length()>200){call.reject("请填写报告系统账号密码","FORM");return;}
    ui.post(()->{if(generation!=epoch||submitted){call.reject("请重新连接后登录","SESSION");return;}submitted=true;reportAccount=account;loginAt=SystemClock.elapsedRealtime();JSONObject payload=new JSONObject();try{payload.put("account",account).put("password",password);}catch(Exception ignored){}evaluate(call,"login",payload);});
  }
  @PluginMethod public void page(PluginCall call){int direction=call.getInt("direction",0);if(direction!=1&&direction!=-1){call.reject("无效页码方向","FORM");return;}JSONObject payload=new JSONObject();try{payload.put("direction",direction);}catch(Exception ignored){}evaluate(call,"page",payload);}
  @PluginMethod public void refresh(PluginCall call){imageCache.clear();evaluate(call,"refresh",new JSONObject());}
  private JSONObject recognizeImage(String data,long generation)throws Exception {
    if(generation!=epoch||!data.startsWith("data:image/png;base64,")||data.length()>140000)throw new IOException("状态图片已失效");
        byte[] bytes=Base64.decode(data.substring(22),Base64.DEFAULT);String hash=Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(bytes),Base64.NO_WRAP);
        JSONObject result=imageCache.get(hash);
        if(result==null){
          BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(bytes,0,bytes.length,bounds);
          if(bounds.outWidth<1||bounds.outWidth>1024||bounds.outHeight<1||bounds.outHeight>256)throw new Exception();
          Bitmap source=BitmapFactory.decodeByteArray(bytes,0,bytes.length);
          if(source==null)throw new Exception();
          if(recognizer==null)recognizer=TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build());
          List<String> texts=new ArrayList<>();
          try{for(int scale:new int[]{3,4}){
            int factor=Math.min(scale,Math.max(1,Math.min(1200/source.getWidth(),512/source.getHeight())));Bitmap tile=Bitmap.createBitmap(source.getWidth()*factor+30,(source.getHeight()*factor+30)*2,Bitmap.Config.ARGB_8888);Canvas canvas=new Canvas(tile);canvas.drawColor(Color.WHITE);Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG|Paint.FILTER_BITMAP_FLAG);
            if(scale==4){ColorMatrix matrix=new ColorMatrix();matrix.setSaturation(0);paint.setColorFilter(new ColorMatrixColorFilter(matrix));}
            for(int i=0;i<2;i++)canvas.drawBitmap(source,null,new Rect(15,i*(source.getHeight()*factor+30)+15,15+source.getWidth()*factor,i*(source.getHeight()*factor+30)+15+source.getHeight()*factor),paint);
            com.google.android.gms.tasks.Task<Text> task=recognizer.process(InputImage.fromBitmap(tile,0));try{texts.add(Tasks.await(task,8,TimeUnit.SECONDS).getText());}finally{if(task.isComplete())tile.recycle();else task.addOnCompleteListener(t->tile.recycle());}
          }}finally{source.recycle();}
          String status=ReportStatus.status(texts);Double score=status.isEmpty()?ReportStatus.agreed(texts):null;
          result=new JSONObject().put("status",status).put("score",score==null?JSONObject.NULL:score).put("state",status.isEmpty()&&score==null?"unreadable":"recognized");
          if(generation==epoch){if(imageCache.size()>=200)imageCache.clear();imageCache.put(hash,result);}
        }
    if(generation!=epoch)throw new IOException("报告会话已清除");return result;
  }
  @PluginMethod public void recognize(PluginCall call){
    final long generation=epoch;String data=call.getString("image","");
    ocr.execute(()->{try{call.resolve(JSObject.fromJSONObject(recognizeImage(data,generation)));}
      catch(Exception e){if(generation!=epoch)call.reject("报告会话已清除","STALE_SESSION");else call.resolve(new JSObject().put("status","").put("score",JSONObject.NULL).put("state","unreadable"));}});
  }

  private long uploadNow(){return SystemClock.elapsedRealtime()+(BuildConfig.DEBUG&&mock?uploadClockOffset:0);}
  @PluginMethod public void testUploadClock(PluginCall call){if(!BuildConfig.DEBUG||!mock||committing){call.reject("测试时钟仅允许用于空闲模拟报告会话","OPERATION");return;}Double value=call.getDouble("offset",0d);if(value==null||!Double.isFinite(value)||value<0||value>600000||Math.rint(value)!=value){call.reject("无效测试时间","FORM");return;}uploadClockOffset=value.longValue();call.resolve();}
  private JSONObject js(String command,JSONObject payload,long generation)throws Exception {
    CompletableFuture<JSONObject> result=new CompletableFuture<>();
    ui.post(()->{
      if(generation!=epoch||web==null){result.completeExceptionally(new IOException("报告会话已清除"));return;}
      if(!failure.isEmpty()){result.completeExceptionally(new IOException(failure));return;}
      String url=web.getUrl();if(!pageReady||!ReportWebPolicy.document(url,mock)){result.completeExceptionally(new IOException("报告网页尚未就绪"));return;}
      String actual=android.net.Uri.parse(url).getScheme()+"://"+android.net.Uri.parse(url).getAuthority();
      web.evaluateJavascript("(function(){try{"+script+";return JSON.stringify(labReportReader("+JSONObject.quote(command)+","+payload+","+JSONObject.quote(actual)+"));}catch(e){return JSON.stringify({phase:'error',message:'官网报告结构待核实'});}})()",value->{
        try{if(generation!=epoch)throw new IOException("报告会话已清除");Object text=new JSONTokener(value).nextValue();JSONObject state=new JSONObject((String)text);if(state.optString("phase").equals("error"))throw new IOException(state.optString("message","官网报告操作未能核实"));state.put("_nativeOrigin",actual);result.complete(state);}catch(Exception e){result.completeExceptionally(e);}
      });
    });
    try{return result.get(20,TimeUnit.SECONDS);}catch(ExecutionException e){throw new IOException(e.getCause().getMessage());}
  }
  private JSONObject ready(long generation,int page)throws Exception {
    long deadline=SystemClock.elapsedRealtime()+30000;
    while(SystemClock.elapsedRealtime()<deadline){JSONObject state=js("read",new JSONObject(),generation);String phase=state.optString("phase");if(phase.equals("needs_login")||phase.equals("expired")||phase.equals("login_failed"))throw new IOException("报告登录已失效，请重新登录");boolean pending=false;JSONArray rows=state.optJSONArray("rows");if(rows!=null)for(int i=0;i<rows.length();i++)pending|=rows.getJSONObject(i).optString("imageState").equals("loading");if(phase.equals("ready")&&state.optInt("page")==page&&!pending)return state;Thread.sleep(150);}
    throw new IOException("官网报告列表尚未就绪，请稍后重试");
  }
  private JSONObject row(JSONObject state,String fingerprint)throws Exception {
    JSONObject found=null;JSONArray rows=state.optJSONArray("rows");if(rows!=null)for(int i=0;i<rows.length();i++){JSONObject value=rows.getJSONObject(i);if(value.optString("fingerprint").equals(fingerprint)){if(found!=null)throw new IOException("报告记录存在歧义");found=value;}}
    if(found==null)throw new IOException("官网报告记录已变化，请重新核对");return found;
  }
  private JSONObject freshRow(String fingerprint,int page,long generation)throws Exception {
    js("refresh",new JSONObject(),generation);ready(generation,page);
    js("ensure-row",new JSONObject().put("fingerprint",fingerprint),generation);
    for(int i=0;i<10;i++){JSONObject current=row(ready(generation,page),fingerprint);if(current.has("canUpload")&&!current.isNull("canUpload"))return current;Thread.sleep(150);}
    throw new IOException("官网上传入口未能核实，请重试");
  }
  private void uploadAllowed(JSONObject row,long generation)throws Exception {
    if(!row.optBoolean("canUpload"))throw new IOException("官网当前不允许上传这份报告");
    String text=row.optString("gradeText");if(ReportStatus.numeric(text)!=null)throw new IOException("该实验已有明确成绩，无法上传报告");
    if(Arrays.asList("已上传","未上传","未批改").contains(text))return;
    String image=row.optString("gradeImage");
    if(image.startsWith("data:image/png;base64,")){
      byte[] bytes=Base64.decode(image.substring(22),Base64.DEFAULT);String hash=Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(bytes),Base64.NO_WRAP);JSONObject result=imageCache.get(hash);if(result==null)result=recognizeImage(image,generation);
      if(result!=null){if(!result.isNull("score"))throw new IOException("该实验已有明确成绩，无法上传报告");if(Arrays.asList("已上传","未上传","未批改").contains(result.optString("status")))return;}
    }
    throw new IOException("成绩或提交状态待核实，请先刷新状态后重试");
  }
  private boolean matchesReport(String id,String official)throws Exception {
    JSONObject catalog;JSONArray groups;
    try(InputStream in=getContext().getAssets().open("public/report-runtime/catalog.json")){catalog=new JSONObject(new String(in.readAllBytes(),StandardCharsets.UTF_8));}
    try(InputStream in=getContext().getAssets().open("report-aliases.json")){groups=new JSONArray(new String(in.readAllBytes(),StandardCharsets.UTF_8));}
    String name="";JSONArray exps=catalog.getJSONArray("experiments");for(int i=0;i<exps.length();i++)if(exps.getJSONObject(i).getString("id").equals(id))name=exps.getJSONObject(i).getString("name");
    if(name.isEmpty())return false;String a=name.replaceAll("\\s","").replace('（','(').replace('）',')'),b=official.replaceAll("\\s","").replace('（','(').replace('）',')');if(a.equals(b))return true;
    for(int i=0;i<groups.length();i++){boolean left=false,right=false;JSONArray g=groups.getJSONArray(i);for(int j=0;j<g.length();j++){String n=g.getString(j).replaceAll("\\s","").replace('（','(').replace('）',')');left|=n.equals(a);right|=n.equals(b);}if(left&&right)return true;}return false;
  }
  @PluginMethod public void prepareUpload(PluginCall call){ui.post(()->{
    if(uploadBusy||evaluating||web==null||!seenReady){call.reject("报告系统正在读取或尚未登录","UPLOAD_BUSY");return;}
    final long generation=epoch;uploadBusy=true;
    ocr.execute(()->{ReportUploadTicket prepared=null;try{
      String id=call.getString("experimentId",""),version=call.getString("generation",""),student=call.getString("studentId","");
      if(!id.matches("[a-f0-9]{12}")||!version.matches("[a-f0-9-]{36}")||reportAccount.isEmpty()||!reportAccount.equals(student))throw new IOException("报告中的学号与报告账号不一致，请核对学生信息并重新生成报告");
      android.net.Uri uri=android.net.Uri.parse(call.getString("uri",""));if(!"file".equals(uri.getScheme()))throw new IOException("本机报告路径无效");File source=new File(uri.getPath()).getCanonicalFile();String path=source.getPath();
      if(!(path.startsWith(getContext().getFilesDir().getCanonicalPath()+File.separator)||path.startsWith(getContext().getNoBackupFilesDir().getCanonicalPath()+File.separator))||!path.endsWith("/lab-maker/v1/reports/"+id+"/"+version+"/report.docx"))throw new IOException("只能上传本应用生成的对应实验报告");
      if(!source.isFile()||!source.canRead())throw new IOException("本机报告文件不可用，请重新生成报告");
      int page=call.getInt("page",0);String fingerprint=call.getString("fingerprint","");
      JSONObject current=freshRow(fingerprint,page,generation);uploadAllowed(current,generation);
      if(!matchesReport(id,current.getString("name")))throw new IOException("本机报告与官网实验名称不对应");
      prepared=new ReportUploadTicket(source,new File(getContext().getCacheDir(),"report-uploads"),call.getString("fileName",""),fingerprint,page,id,generation,uploadNow());
      if(generation!=epoch)throw new IOException("报告会话已清除");if(uploadTicket!=null)uploadTicket.delete();uploadTicket=prepared;
      JSONObject value=new JSONObject().put("ticket",prepared.id).put("fileName",prepared.fileName).put("size",prepared.size).put("sha256",prepared.sha256).put("previewPath","report-uploads/"+prepared.id+"/report.docx").put("expiresIn",Math.max(1,(prepared.expires-uploadNow())/1000)).put("row",current);
      call.resolve(JSObject.fromJSONObject(value));
    }catch(Exception e){if(prepared!=null)prepared.delete();call.reject(e.getMessage(),"UPLOAD_PREPARE");}finally{if(generation==epoch)uploadBusy=false;}});
  });}
  @PluginMethod public void openUploadPreview(PluginCall call){ui.post(()->{try{
    if(committing){call.reject("报告正在提交并回读","COMMIT_BUSY");return;}ReportUploadTicket ticket=uploadTicket;if(ticket==null||!ticket.id.equals(call.getString("ticket","")))throw new IOException("预览文件已失效");
    android.net.Uri uri=androidx.core.content.FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".fileprovider",ticket.file);
    android.content.Intent intent=new android.content.Intent(android.content.Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.openxmlformats-officedocument.wordprocessingml.document").addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
    getActivity().startActivity(intent);call.resolve();
  }catch(Exception e){call.reject("无法外部打开，请确认手机已安装 Word 或 WPS","PREVIEW");}});}
  @PluginMethod public void discardUpload(PluginCall call){ui.post(()->{if(committing){call.reject("报告正在提交并回读","COMMIT_BUSY");return;}if(uploadTicket!=null&&uploadTicket.id.equals(call.getString("ticket",""))){uploadTicket.delete();uploadTicket=null;}call.resolve();});}
  @PluginMethod public void commitUpload(PluginCall call){ui.post(()->{
    if(uploadBusy||committing){call.reject("报告正在处理，请勿重复提交","COMMIT_BUSY");return;}
    ReportUploadTicket ticket=uploadTicket;if(ticket==null||!ticket.id.equals(call.getString("ticket",""))||!call.getBoolean("confirmed",false)){call.reject("缺少有效的最终确认","UPLOAD_TICKET");return;}
    final long generation=epoch;uploadBusy=true;committing=true;
    ocr.execute(()->{boolean sent=false;try{
      ticket.consume(call.getString("ticket",""),true,generation,uploadNow());
      JSONObject state;uploadAllowed(freshRow(ticket.fingerprint,ticket.page,generation),generation);
      JSONObject bind=new JSONObject().put("fingerprint",ticket.fingerprint);
      js("open-upload",bind,generation);String dialog="";long deadline=SystemClock.elapsedRealtime()+20000;
      while(SystemClock.elapsedRealtime()<deadline){state=ready(generation,ticket.page);if(!state.optString("message").isEmpty())throw new IOException(state.optString("message"));dialog=state.optString("uploadDialog");if(!dialog.isEmpty())break;Thread.sleep(150);}
      if(dialog.isEmpty())throw new IOException("官网上传窗口未能核实");
      JSONObject setup=new JSONObject().put("id",ticket.id).put("dialogId",dialog).put("fileName",ticket.fileName).put("size",ticket.size);
      js("file-begin",setup,generation);
      try(InputStream in=new FileInputStream(ticket.file)){byte[] buffer=new byte[65536];int n;while((n=in.read(buffer))!=-1)js("file-chunk",new JSONObject().put("id",ticket.id).put("data",Base64.encodeToString(Arrays.copyOf(buffer,n),Base64.NO_WRAP)),generation);}
      js("file-finish",new JSONObject().put("id",ticket.id),generation);
      js("submit-upload",new JSONObject().put("id",ticket.id).put("fingerprint",ticket.fingerprint),generation);
      deadline=SystemClock.elapsedRealtime()+20000;JSONObject captured=null;
      while(SystemClock.elapsedRealtime()<deadline){JSONObject candidate=js("upload-request",new JSONObject().put("id",ticket.id),generation);if(candidate.optString("phase").equals("captured")){captured=candidate;break;}Thread.sleep(100);}
      if(captured==null)throw new IOException("官网文件提交协议未能核实，未发送报告");
      JSONObject request=captured.getJSONObject("request");okhttp3.HttpUrl target=okhttp3.HttpUrl.get(request.getString("url"));
      ReportUploadHttp.validateTarget(request,captured.getString("_nativeOrigin"));
      if(!ReportWebPolicy.document(target.toString(),mock)||!ReportWebPolicy.document(request.optString("referrer"),mock))throw new IOException("官网上传地址待核实");
      String cookie=CookieManager.getInstance().getCookie(target.toString());JSONObject response;
      sent=true;
      try{response=ReportUploadHttp.send(target,request,ticket,cookie,reportAgent);}
      catch(Exception network){response=new JSONObject().put("networkError",true).put("body","").put("status",0);}
      JSONArray cookies=response.optJSONArray("cookies");
      if(cookies!=null)for(int i=0;i<cookies.length();i++){String value=cookies.getString(i);CompletableFuture<Boolean> saved=new CompletableFuture<>();ui.post(()->CookieManager.getInstance().setCookie(target.toString(),value,saved::complete));saved.get(5,TimeUnit.SECONDS);}
      response.put("id",ticket.id);js("upload-response",response,generation);
      boolean networkError=response.optBoolean("networkError");
      deadline=SystemClock.elapsedRealtime()+(networkError?1000:60000);String message="";
      while(SystemClock.elapsedRealtime()<deadline){state=ready(generation,ticket.page);message=state.optString("message");if(!message.isEmpty()||state.optString("uploadDialog").isEmpty())break;Thread.sleep(250);}
      js("refresh",new JSONObject(),generation);state=ready(generation,ticket.page);JSONObject current=row(state,ticket.fingerprint);
      boolean statusConfirmed=current.optString("gradeText").equals("已上传")||ReportStatus.numeric(current.optString("gradeText"))!=null;
      if(!statusConfirmed&&!current.optString("gradeImage").isEmpty()){JSONObject recognized=recognizeImage(current.getString("gradeImage"),generation);statusConfirmed=recognized.optString("status").equals("已上传")||!recognized.isNull("score");}
      boolean success=!networkError&&statusConfirmed&&message.matches("(?s).*(上传成功|提交成功|上传完成).*")&&!message.matches("(?s).*(失败|未成功|不成功).*");
      if(success){js("dismiss-success",new JSONObject().put("message",message),generation);state=ready(generation,ticket.page);}
      call.resolve(new JSObject().put("submitted",true).put("verified",success).put("message",success?"官网返回上传成功，已回读对应报告记录":message.isEmpty()?"上传已发送，未能确认最终结果，请核对官网":"上传结果未确认，请在官网核对："+message).put("state",state));
    }catch(Exception e){
      if(sent){try{js("refresh",new JSONObject(),generation);JSONObject state=ready(generation,ticket.page);row(state,ticket.fingerprint);call.resolve(new JSObject().put("submitted",true).put("verified",false).put("message","报告可能已发送，已重新读取官网状态，请核对，勿重复提交").put("state",state));}catch(Exception unreadable){call.reject("报告可能已发送，且未能重新读取官网状态，请在官网核对，勿重复提交","UPLOAD_UNCERTAIN");}}
      else call.reject("未上传报告："+e.getMessage(),"UPLOAD_STOPPED");
    }
    finally{ticket.delete();if(uploadTicket==ticket)uploadTicket=null;if(generation==epoch){uploadBusy=false;committing=false;}}
    });
  });}

  @Override protected void handleOnDestroy(){ui.post(this::destroy);ocr.shutdownNow();accountIO.shutdownNow();if(recognizer!=null)recognizer.close();}
}
