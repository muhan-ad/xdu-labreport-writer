package com.labmaker.app;
import android.app.Dialog;import android.graphics.Color;import android.os.*;import android.view.*;import android.webkit.*;import android.widget.*;
import androidx.webkit.*;
import com.getcapacitor.*;import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.*;import java.io.*;import java.nio.charset.StandardCharsets;import java.util.*;import java.util.concurrent.*;

/** Official login in an independent WebView profile. No native bridge is exposed to that page. */
@CapacitorPlugin(name="LabAcademic")
public class LabAcademicPlugin extends Plugin {
 private final Handler ui=new Handler(Looper.getMainLooper());private final ExecutorService worker=Executors.newSingleThreadExecutor();
 private final AcademicSession session=AcademicAuthority.SESSION;private Dialog dialog;private WebView web;private TextView label;private Button readButton,closeButton;private PluginCall pending;
 private volatile long epoch=0;private long readToken=0;private boolean reading=false,clearing=false,cacheSaving=false;private String account="",requestId="",reader="",readKey="";
 private int dp(int value){return Math.round(value*getContext().getResources().getDisplayMetrics().density);}
 private Button button(String text,boolean primary){Button button=new Button(getActivity());button.setText(text);button.setAllCaps(false);button.setTextSize(14);button.setTextColor(primary?Color.WHITE:0xff147e3b);button.setMinWidth(dp(64));button.setMinimumHeight(dp(44));android.graphics.drawable.GradientDrawable shape=new android.graphics.drawable.GradientDrawable();shape.setColor(primary?0xff147e3b:0xffedf5ed);shape.setCornerRadius(dp(12));button.setBackground(new android.graphics.drawable.RippleDrawable(android.content.res.ColorStateList.valueOf(0x33147e3b),shape,null));button.setPadding(dp(10),dp(8),dp(10),dp(8));return button;}
 @Override public void load(){AcademicAuthority.init(getContext());try(InputStream in=getContext().getAssets().open("timetable-reader.js")){reader=new String(in.readAllBytes(),StandardCharsets.UTF_8);}catch(Exception ignored){}}
 private JSObject result(String expected)throws Exception{
  AcademicTimetable.Snapshot snapshot;String status;synchronized(session){snapshot=session.snapshot(expected);status=session.status();if(status.equals("fresh")&&!AcademicAuthority.fresh(expected,System.currentTimeMillis()))status="stale";}
  if(snapshot==null||!snapshot.complete()){AcademicTimetable.Snapshot cached=AcademicAuthority.cached(expected);if(cached!=null){snapshot=cached;if(!status.equals("incomplete")&&!status.equals("reading"))status="stale";}}
  return new JSObject().put("status",snapshot==null?"disconnected":status).put("snapshot",snapshot==null?JSONObject.NULL:snapshot.json());
 }
 @PluginMethod public void status(PluginCall call){worker.execute(()->{try{call.resolve(result(call.getString("account","")));}catch(Exception e){call.reject("本机教务缓存无法读取，原文件已保留；可重新同步或明确清除","ACADEMIC_CACHE");}});}
 @PluginMethod public void retrySave(PluginCall call){worker.execute(()->{AcademicTimetable.Snapshot snapshot=session.snapshot(call.getString("account",""));if(snapshot==null||!snapshot.complete()){call.reject("当前账号没有可保存的完整课表，请重新同步","ACADEMIC_CACHE_STATE");return;}try{AcademicAuthority.CACHE.save(snapshot);call.resolve();}catch(Exception error){call.reject("课表仍未保存至本机，请检查设备空间后重试","ACADEMIC_CACHE_SAVE");}});}
 @PluginMethod public void cancel(PluginCall call){ui.post(()->{if(requestId.equals(call.getString("id",""))&&pending!=null&&!cacheSaving)finish(null,"已取消教务连接");call.resolve();});}
 @PluginMethod public void clear(PluginCall call){ui.post(()->{
  if(pending!=null||clearing){call.reject("教务窗口或会话正在处理，请稍候","ACADEMIC_BUSY");return;}
  String expected=call.getString("account","");if(!call.getBoolean("confirmed",false)){call.reject("请先确认清除教务会话","CONFIRM");return;}
  try{if(!WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE))throw new IllegalStateException();
   Profile profile=ProfileStore.getInstance().getOrCreateProfile(AcademicWebPolicy.profile(expected));clearing=true;if(session.snapshot(expected)!=null)session.clear();worker.execute(()->{try{AcademicAuthority.CACHE.clear(expected);ui.post(()->{try{profile.getWebStorage().deleteAllData();profile.getCookieManager().removeAllCookies(done->{clearing=false;call.resolve();});}catch(Exception error){clearing=false;call.reject("教务缓存已清除，官网登录存储未能清除，请重试","ACADEMIC_CLEAR");}});}catch(Exception error){ui.post(()->{clearing=false;call.reject("教务缓存未能清除，请重试","ACADEMIC_CLEAR");});}});
  }catch(Exception e){clearing=false;call.reject("教务独立会话不可用，请更新系统 WebView 后重试","ACADEMIC_PROFILE");}
 });}
 @PluginMethod public void connect(PluginCall call){ui.post(()->{
  if(pending!=null||clearing){call.reject("教务连接或会话清理正在进行","ACADEMIC_BUSY");return;}
  String expected=call.getString("account",""),id=call.getString("id","");
  if(!expected.matches("\\d{5,20}")||!id.matches("[a-f0-9-]{36}")){call.reject("教务账号或连接标识无效","ACADEMIC_INPUT");return;}
  if(reader.isEmpty()){call.reject("教务读取资源缺失","RESOURCE");return;}
  if(!WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)){call.reject("请更新 Android 系统 WebView，以使用独立的教务登录窗口","ACADEMIC_PROFILE");return;}
  pending=call;requestId=id;account=expected;final long current=++epoch;
  try{
   readToken=session.begin(account);dialog=new Dialog(getActivity());dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);LinearLayout root=new LinearLayout(getActivity());root.setOrientation(LinearLayout.VERTICAL);root.setBackgroundColor(Color.WHITE);
   LinearLayout header=new LinearLayout(getActivity());header.setPadding(16,10,16,10);header.setGravity(Gravity.CENTER_VERTICAL);label=new TextView(getActivity());label.setText("在官网完成认证，再点读取课表");label.setTextColor(0xff147e3b);header.addView(label,new LinearLayout.LayoutParams(0,-2,1));
   readButton=button("读取课表",true);readButton.setOnClickListener(v->read(current));header.addView(readButton);Button close=button("关闭",false);closeButton=close;close.setOnClickListener(v->{if(!cacheSaving)finish(null,"已取消教务连接");});LinearLayout.LayoutParams closeParams=new LinearLayout.LayoutParams(-2,-2);closeParams.setMarginStart(dp(8));header.addView(close,closeParams);root.addView(header);
   web=new WebView(getActivity());WebViewCompat.setProfile(web,AcademicWebPolicy.profile(account));WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setSaveFormData(false);settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setCacheMode(WebSettings.LOAD_NO_CACHE);settings.setSupportMultipleWindows(false);settings.setJavaScriptCanOpenWindowsAutomatically(false);
   WebViewCompat.getProfile(web).getCookieManager().setAcceptThirdPartyCookies(web,false);
   web.setWebChromeClient(new WebChromeClient(){@Override public void onPermissionRequest(PermissionRequest request){request.deny();}@Override public boolean onShowFileChooser(WebView v,ValueCallback<android.net.Uri[]> callback,FileChooserParams params){callback.onReceiveValue(null);return true;}});
   web.setWebViewClient(new WebViewClient(){
    @Override public void onPageStarted(WebView v,String url,android.graphics.Bitmap icon){if(epoch==current&&reading&&!cacheSaving)readFailure(readToken,"页面已变化，请完成认证后重新读取");}
    @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest request){if(epoch!=current)return true;boolean allowed=AcademicWebPolicy.allowed(request.getUrl().toString());if(!allowed&&request.isForMainFrame()&&label!=null)label.setText("官网跳转地址待核实");return !allowed;}
    @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest request){return AcademicWebPolicy.allowed(request.getUrl().toString())?null:new WebResourceResponse("text/plain","utf-8",403,"Blocked",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));}
    @Override public void onReceivedSslError(WebView v,SslErrorHandler handler,android.net.http.SslError error){handler.cancel();if(epoch==current)label.setText("官网证书未通过校验");}
    @Override public void onReceivedError(WebView v,WebResourceRequest request,WebResourceError error){if(epoch==current&&request.isForMainFrame())label.setText("连接失败，请检查校园网并重试");}
   });
   root.addView(web,new LinearLayout.LayoutParams(-1,0,1));dialog.setContentView(root);dialog.setOnCancelListener(v->finish(null,"已取消教务连接"));dialog.show();dialog.getWindow().setLayout(-1,-1);web.loadUrl(AcademicWebPolicy.ENTRY);
   ui.postDelayed(()->{if(epoch==current&&pending!=null)finish(null,"教务连接超时，请重试");},240000);
  }catch(Exception e){finish(null,"教务登录窗口未能打开，请更新系统 WebView 后重试");}
 });}
 private void read(long current){
  if(epoch!=current||pending==null||reading||web==null)return;
  if(!AcademicWebPolicy.allowed(web.getUrl())||!"ehall.xidian.edu.cn".equals(android.net.Uri.parse(web.getUrl()).getHost())){label.setText("请先完成官网统一认证");return;}
  try{readToken=session.begin(account);}catch(Exception e){finish(null,"教务账号无效");return;}
  final long token=readToken;final String owner=account,key="__labAcademic_"+UUID.randomUUID().toString().replace("-","");readKey=key;reading=true;readButton.setEnabled(false);label.setText("正在读取并校验课表…");
  String quote=JSONObject.quote(key),code=reader+"\n;(()=>{globalThis["+quote+"]=null;TimetableReader.readTimetable("+JSONObject.quote(owner)+").then(value=>{const text=JSON.stringify(value);globalThis["+quote+"]=text.length<=4000000?text:JSON.stringify({error:'too_large'});}).catch(error=>{globalThis["+quote+"]=JSON.stringify({error:String(error.message)});});return true;})()";
  web.evaluateJavascript(code,ignored->poll(current,token,owner,key,0));
 }
 private void poll(long current,long token,String owner,String key,int attempt){
  if(epoch!=current||pending==null||web==null||!reading||!key.equals(readKey))return;
  if(attempt>400){readFailure(token,"读取超时，请重试");web.reload();return;}
  web.evaluateJavascript("globalThis["+JSONObject.quote(key)+"]||null",value->{if(epoch!=current||pending==null||!key.equals(readKey))return;
   try{Object decoded=new JSONTokener(value).nextValue();if(decoded==JSONObject.NULL){ui.postDelayed(()->poll(current,token,owner,key,attempt+1),250);return;}if(!(decoded instanceof String)||((String)decoded).length()>4000000)throw new Exception();JSONObject raw=new JSONObject((String)decoded);
    if(raw.has("error")){String reason=raw.optString("error");readFailure(token,reason.equals("needs_login")?"登录已过期，请完成官网认证":reason.equals("account_mismatch")?"官网账号与填写账号不一致":reason.equals("identity_unverified")?"官网未提供可核实的本人课表":reason.equals("rate_limited")?"官网请求频繁，请稍后重试":"课表未读取完整，请重试");return;}
    worker.execute(()->{try{if(epoch!=current)return;AcademicTimetable.Snapshot validated=AcademicTimetable.normalize(raw,owner,System.currentTimeMillis());ui.post(()->{if(epoch!=current||pending==null||!key.equals(readKey))return;try{boolean accepted=session.acceptSnapshot(token,validated);if(accepted){cacheSaving=true;dialog.setCancelable(false);closeButton.setEnabled(false);label.setText("课表已核对，正在保存…");}worker.execute(()->{String warning="";if(epoch!=current)return;if(accepted)try{AcademicAuthority.CACHE.save(validated);}catch(Exception error){warning="课表已同步，本机保存失败；重启后需重新同步";}try{JSObject response=result(owner);if(!warning.isEmpty())response.put("cacheWarning",warning);ui.post(()->{if(epoch==current&&pending!=null&&key.equals(readKey))finish(response,null);});}catch(Exception error){ui.post(()->{if(epoch==current)readFailure(token,"本机课表状态无法读取，请重新同步");});}});}catch(Exception e){readFailure(token,"课表状态无法读取");}});}catch(Exception e){ui.post(()->{if(epoch==current&&key.equals(readKey))readFailure(token,"官网课表未通过校验，请核对账号或稍后重试");});}});
   }catch(Exception e){readFailure(token,"课表返回格式无法识别，请重试");}
  });
 }
 private void readFailure(long token,String message){if(token!=readToken)return;session.fail(token);reading=false;cacheSaving=false;readKey="";if(dialog!=null)dialog.setCancelable(true);if(closeButton!=null)closeButton.setEnabled(true);if(readButton!=null)readButton.setEnabled(true);if(label!=null)label.setText(message);}
 private void finish(JSObject result,String error){
  PluginCall call=pending;pending=null;requestId="";epoch++;if(result==null)session.fail(readToken);reading=false;cacheSaving=false;readKey="";if(web!=null){web.stopLoading();web.destroy();web=null;}if(dialog!=null){dialog.setOnCancelListener(null);dialog.dismiss();dialog=null;}label=null;readButton=null;closeButton=null;
  if(call!=null){if(result!=null)call.resolve(result);else call.reject(error==null?"教务连接已关闭":error,"ACADEMIC_CONNECTION");}
 }
 @Override protected void handleOnDestroy(){ui.post(()->finish(null,"应用页面已关闭"));worker.shutdownNow();}
}
