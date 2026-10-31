package com.labmaker.app;

import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import okhttp3.*;
import org.json.*;

/** Secrets never leave native storage after configuration. No request or key logging. */
@CapacitorPlugin(name = "LabAI")
public class LabAIPlugin extends Plugin {
    private static final String ALIAS = "lab-maker-ai-v1";
    private final Object lock = new Object();
    private final ExecutorService workers = Executors.newFixedThreadPool(4);
    private final ScheduledExecutorService streamTimer = Executors.newSingleThreadScheduledExecutor();
    private final Map<String, Call> active = new HashMap<>();
    private final Map<String, Integer> revisions = new HashMap<>();
    private final Map<String, String> slots = new HashMap<>();
    private final Map<String, String> sources = new HashMap<>();
    private static final class StreamWatch { final AtomicLong activity=new AtomicLong(System.nanoTime()); boolean prompted; long sequence; }
    private final Map<String, StreamWatch> streamWatches = new HashMap<>();
    private final OkHttpClient client = new OkHttpClient.Builder()
        .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).proxy(Proxy.NO_PROXY)
        .connectTimeout(30, TimeUnit.SECONDS).writeTimeout(60, TimeUnit.SECONDS)
        .dns(host -> { List<InetAddress> addresses = Dns.SYSTEM.lookup(host);
            for (InetAddress address : addresses) if (!(BuildConfig.DEBUG && host.equals("127.0.0.1")) && !publicAddress(address))
                throw new UnknownHostException("Non-public API address");
            return addresses; }).build();
    private SharedPreferences store() { return getContext().getSharedPreferences("ai-v1", 0); }
    private String slot(PluginCall call) {
        String value = call.getString("slot", "chat");
        if (!value.equals("chat") && !value.equals("vision")) throw new IllegalArgumentException("配置类型无效");
        return value;
    }
    private SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore"); ks.load(null);
        if (!ks.containsAlias(ALIAS)) {
            KeyGenerator kg = KeyGenerator.getInstance("AES", "AndroidKeyStore");
            kg.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
            kg.generateKey();
        }
        return (SecretKey)ks.getKey(ALIAS, null);
    }
    private JSONObject read(String slot) throws Exception {
        String raw = store().getString(slot, null);
        if (raw == null) return null;
        String[] parts = raw.split(":");
        if (parts.length != 2) throw new IOException();
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        cipher.updateAAD(slot.getBytes(StandardCharsets.UTF_8));
        return new JSONObject(new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8));
    }
    private void write(String slot, JSONObject value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
        cipher.updateAAD(slot.getBytes(StandardCharsets.UTF_8));
        String encrypted = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" +
            Base64.encodeToString(cipher.doFinal(value.toString().getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
        if (!store().edit().putString(slot, encrypted).commit()) throw new IOException();
    }
    private boolean mock(HttpUrl url) {
        return BuildConfig.DEBUG && url.scheme().equals("http") && url.host().equals("127.0.0.1") && url.port() == 58440;
    }
    private HttpUrl endpoint(String raw) {
        HttpUrl url = HttpUrl.parse(raw);
        if (url == null || (!url.isHttps() && !mock(url)) || !url.username().isEmpty() || !url.password().isEmpty() || url.query() != null || url.fragment() != null)
            throw new IllegalArgumentException("API 地址须为 HTTPS 服务地址，不可包含账号、查询参数或片段");
        String h = url.host().toLowerCase(Locale.ROOT);
        if (!mock(url) && (h.equals("localhost") || h.endsWith(".local") || h.endsWith(".lan"))) throw new IllegalArgumentException("API 地址不可使用本机或局域网");
        return url;
    }
    static boolean publicAddress(InetAddress address) {
        if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress() || address.isSiteLocalAddress() || address.isMulticastAddress()) return false;
        byte[] b = address.getAddress(); int a = b[0] & 255;
        if (b.length == 4) return a != 0 && a < 224 && a != 127 && !(a == 100 && (b[1] & 255) >= 64 && (b[1] & 255) <= 127)
            && !(a == 192 && (b[1] & 255) == 0) && !(a == 198 && ((b[1] & 255) == 18 || (b[1] & 255) == 19));
        return (a & 0xe0) == 0x20; // Global IPv6 unicast only.
    }
    private JSObject publicStatus(JSONObject config) {
        JSObject result = new JSObject(); result.put("hasKey", config != null);
        if (config != null) { result.put("endpoint", config.optString("endpoint")); result.put("model", config.optString("model")); }
        return result;
    }
    private Boolean inheritanceOverride(PluginCall call) { return call.getData().has("inheritChat")?call.getBoolean("inheritChat",false):null; }
    private JSObject statusFor(String slot,Boolean override) throws Exception {
        JSONObject record=read(slot);String source=AIConfiguration.source(slot,override,record);
        JSObject result=publicStatus(AIConfiguration.resolve(slot,override,this::read));
        result.put("inheritsChat",slot.equals("vision")&&source.equals("chat"));if(slot.equals("vision")){result.put("inheritModel",record==null?"":record.optString("inheritModel",""));if(source.equals("chat")){JSONObject chat=read("chat");result.put("baseModel",chat==null?"":chat.optString("model",""));}}return result;
    }
    private void invalidate(String slot) {
        revisions.put(slot, revisions.getOrDefault(slot, 0) + 1);
        for (String id : new ArrayList<>(slots.keySet())) if (AIConfiguration.affected(slots.get(id),sources.get(id),slot)) active.get(id).cancel();
    }
    @PluginMethod public void status(PluginCall call) {
        workers.execute(() -> { try { synchronized(lock) { call.resolve(statusFor(slot(call),inheritanceOverride(call))); } }
            catch (Exception e) { call.reject("本机密钥无法解密，请清除此配置后重新保存", "SECRET_READ"); } });
    }
    @PluginMethod public void configure(PluginCall call) {
        workers.execute(() -> { try { synchronized(lock) {
            String slot = slot(call);
            if(call.getBoolean("inheritChat",false)) {
                if(!slot.equals("vision"))throw new IllegalArgumentException("仅图片识别可继承问答配置");
                String model=call.getString("model","").trim();JSONObject record=AIConfiguration.inheritance(read(slot),true,model);JSObject result=publicStatus(AIConfiguration.resolve(slot,true,model,this::read));result.put("inheritsChat",true);result.put("inheritModel",model);JSONObject chat=read("chat");result.put("baseModel",chat==null?"":chat.optString("model",""));write(slot,record);invalidate(slot);call.resolve(result);return;
            }
            String base = endpoint(call.getString("endpoint", "").trim()).toString().replaceAll("/+$", "");
            String model = call.getString("model", "").trim(), secret = call.getString("key", "").trim();
            if (model.isEmpty() || model.length() > 256 || model.chars().anyMatch(c->c<32||c==127) || secret.length() > 4096 || secret.matches("(?s).*[\\r\\n].*")) throw new IllegalArgumentException("模型或密钥格式无效");
            if (secret.isEmpty()) { JSONObject old = read(slot);
                if (old == null || !base.equals(old.optString("endpoint"))) throw new IllegalArgumentException("首次保存或更换 API 地址时，请重新填写密钥");
                secret = old.getString("key");
            }
            if(secret.chars().anyMatch(c->c<33||c>126))throw new IllegalArgumentException("密钥格式无效，请只填写服务商提供的 API Key");
            JSONObject value = new JSONObject().put("endpoint", base).put("model", model).put("key", secret);
            if(slot.equals("vision")){JSONObject old=read(slot);if(old!=null&&old.has("inheritModel"))value.put("inheritModel",old.optString("inheritModel",""));}write(slot, value); invalidate(slot); call.resolve(statusFor(slot,null));
        }} catch (IllegalArgumentException e) { call.reject(e.getMessage(), "CONFIG"); }
        catch (Exception e) { call.reject("密钥加密保存失败，请重试；未降级为明文存储", "SECRET_WRITE"); } });
    }
    @PluginMethod public void clear(PluginCall call) {
        workers.execute(() -> { try { synchronized(lock) { String slot = slot(call);
            if (!store().edit().remove(slot).commit()) throw new IOException(); invalidate(slot); call.resolve(publicStatus(null));
        }} catch(Exception e) { call.reject("清除配置失败，请重试", "SECRET_CLEAR"); } });
    }
    @PluginMethod public void cancel(PluginCall call) {
        synchronized(lock) { Call request = active.get(call.getString("id", "")); if (request != null) request.cancel(); }
        call.resolve();
    }
    @PluginMethod public void resume(PluginCall call) {
        synchronized(lock) { StreamWatch watch=streamWatches.get(call.getString("id", "")); if(watch!=null){watch.prompted=false;watch.activity.set(System.nanoTime());} }
        call.resolve();
    }
    private void streamEvent(String id,Call request,int revision,String slot,StreamWatch watch,String kind,String text) throws IOException {
        synchronized(lock){
            if(request.isCanceled()||active.get(id)!=request||revision!=revisions.getOrDefault(slot,0)||streamWatches.get(id)!=watch)throw new IOException("Request cancelled");
            JSObject event=new JSObject();event.put("id",id);event.put("seq",++watch.sequence);event.put("kind",kind);event.put("delta",text);notifyListeners("stream",event);
        }
    }
    @PluginMethod public void models(PluginCall call) {
        final String id=call.getString("id","");final String slot;final int revision;final Call request;final String secret;
        try{synchronized(lock){slot=slot(call);if(!id.matches("[a-zA-Z0-9-]{8,80}")||active.containsKey(id))throw new IllegalArgumentException("请求标识无效");if(Collections.frequency(new ArrayList<>(slots.values()),slot)>=2)throw new IllegalArgumentException("已有两个请求正在处理，请稍后再试");
            String base=endpoint(call.getString("endpoint","").trim()).toString().replaceAll("/+$","");String draft=call.getString("key","").trim();if(draft.length()>4096||draft.chars().anyMatch(c->c<32||c==127))throw new IllegalArgumentException("密钥格式无效");
            try{secret=APIModels.keyFor(base,draft,draft.isEmpty()?AIConfiguration.resolve(slot,false,this::read):null);}catch(APIModels.Failure e){throw new IllegalArgumentException(e.getMessage());}
            request=client.newBuilder().readTimeout(30,TimeUnit.SECONDS).callTimeout(30,TimeUnit.SECONDS).build().newCall(new Request.Builder().url(base+"/models").header("Authorization","Bearer "+secret).get().build());revision=revisions.getOrDefault(slot,0);active.put(id,request);slots.put(id,slot);sources.put(id,slot);
        }}catch(IllegalArgumentException e){call.reject(e.getMessage(),"CONFIG");return;}catch(Exception e){call.reject("本机密钥无法读取，请重新填写密钥","SECRET_READ");return;}
        workers.execute(()->{try{JSONObject result=APIModels.read(request,secret);synchronized(lock){if(request.isCanceled()||revision!=revisions.getOrDefault(slot,0)){call.reject("请求已取消或配置已变更","CANCELLED");return;}call.resolve(JSObject.fromJSONObject(result));}}
            catch(Exception e){call.reject(request.isCanceled()?"已停止获取模型":e instanceof APIModels.Failure?e.getMessage():e instanceof java.io.InterruptedIOException?"获取模型超时（30秒），可手动填写模型名称":"无法获取模型列表，请检查网络或手动填写模型",request.isCanceled()?"CANCELLED":"MODELS");}
            finally{synchronized(lock){active.remove(id);slots.remove(id);sources.remove(id);}}});
    }
    @PluginMethod public void complete(PluginCall call) {
        // Reserve synchronously so cancel/config changes cannot overtake a queued request.
        final String id = call.getString("id", "");
        final String slot;
        final int revision;
        final Call request;
        final String secret;
        final boolean streaming;
        try { synchronized(lock) {
            slot = slot(call);
            if (!id.matches("[a-zA-Z0-9-]{8,80}") || active.containsKey(id)) throw new IllegalArgumentException("请求标识无效");
            if (Collections.frequency(new ArrayList<>(slots.values()), slot) >= 2) throw new IllegalArgumentException("已有两个请求正在处理，请稍后再试");
            JSONObject config;JSObject draft=call.getObject("draft");boolean inheritedDraft=draft!=null&&draft.optBoolean("inheritChat",false);if(inheritedDraft){if(!slot.equals("vision")||!call.getBoolean("test",false))throw new IllegalArgumentException("继承草稿仅用于识图配置测试");config=AIConfiguration.resolve(slot,true,draft.optString("model","").trim(),this::read);}else if(draft!=null){if(!call.getBoolean("test",false))throw new IllegalArgumentException("草稿仅用于连接测试");String baseDraft=endpoint(draft.optString("endpoint").trim()).toString().replaceAll("/+$","");String keyDraft=draft.optString("key").trim();try{config=APIModels.draft(baseDraft,draft.optString("model"),keyDraft,keyDraft.isEmpty()?AIConfiguration.resolve(slot,false,this::read):null);}catch(APIModels.Failure e){throw new IllegalArgumentException(e.getMessage());}}else config=AIConfiguration.resolve(slot,null,this::read);if(config==null)throw new IllegalArgumentException("请先配置 API 密钥");
            HttpUrl base = endpoint(config.getString("endpoint")); secret = config.getString("key");if(secret.isEmpty()||secret.length()>4096||secret.chars().anyMatch(c->c<33||c>126))throw new IllegalArgumentException("密钥格式无效，请重新填写 API Key");
            JSArray messages = call.getArray("messages");if(draft!=null){messages=new JSArray();messages.put(new JSONObject().put("role","user").put("content","Reply with OK only."));} if (messages == null || messages.length() == 0 || messages.length() > 12) throw new IllegalArgumentException("请求内容无效");
            streaming=slot.equals("chat")&&!call.getBoolean("test",false)&&call.getBoolean("stream",false);
            JSONObject body = new JSONObject().put("model", config.getString("model")).put("messages", messages).put("stream", streaming);
            if (call.getBoolean("test", false)) body.put("max_tokens", 128);
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8); if (bytes.length > 12 * 1024 * 1024) throw new IllegalArgumentException("请求内容过大");
            OkHttpClient requestClient = client.newBuilder()
                .readTimeout(call.getBoolean("test",false)?30:(slot.equals("vision")||streaming) ? 0 : 300, TimeUnit.SECONDS).callTimeout(call.getBoolean("test",false)?45:(slot.equals("vision")||streaming) ? 0 : 360, TimeUnit.SECONDS).build();
            String url = base.toString().replaceAll("/+$", "") + "/chat/completions";
            request = requestClient.newCall(new Request.Builder().url(url).header("Authorization", "Bearer " + secret)
                .post(RequestBody.create(MediaType.get("application/json; charset=utf-8"), bytes)).build());
            revision = revisions.getOrDefault(slot, 0); active.put(id, request); slots.put(id, slot); sources.put(id,AIConfiguration.source(slot,draft==null?null:inheritedDraft,read(slot)));
        }} catch (IllegalArgumentException e) { call.reject(e.getMessage(), "CONFIG"); return; }
        catch (Exception e) { call.reject("本机配置读取失败，请重新保存 API 配置", "SECRET_READ"); return; }
        workers.execute(() -> {
            long started = System.currentTimeMillis();
            final StreamWatch watch=streaming?new StreamWatch():null;ScheduledFuture<?> timer=null;
            if(watch!=null){synchronized(lock){if(!request.isCanceled()&&active.get(id)==request)streamWatches.put(id,watch);}
                timer=streamTimer.scheduleAtFixedRate(()->{synchronized(lock){if(streamWatches.get(id)!=watch||watch.prompted||request.isCanceled()||active.get(id)!=request||revision!=revisions.getOrDefault(slot,0))return;if(System.nanoTime()-watch.activity.get()<TimeUnit.SECONDS.toNanos(90))return;watch.prompted=true;try{streamEvent(id,request,revision,slot,watch,"stall","");}catch(IOException ignored){}}},1,1,TimeUnit.SECONDS);}
            try (Response response = request.execute()) {
                if (!response.isSuccessful()) {
                    int code = response.code();
                    String reason = code == 401 || code == 403 ? "密钥无效或没有权限" : code == 402 ? "API 余额不足" : code == 429 ? "请求过于频繁或额度不足" : code == 404 ? "API 地址或模型不存在" : code == 400 ? "模型不支持当前请求，请核对模型及图片能力" : code >= 300 && code < 400 ? "API 返回重定向，请填写最终服务地址" : "API 服务暂时不可用";
                    call.reject(reason + "（HTTP " + code + "）", "HTTP_" + code); return;
                }
                if (response.body() == null) throw new IOException();
                if(streaming&&response.header("Content-Type", "").toLowerCase(Locale.ROOT).startsWith("text/event-stream")){
                    String text=AIStreamReader.read(response.body().byteStream(),secret,new AIStreamReader.Listener(){
                        public void activity(){watch.activity.set(System.nanoTime());}
                        public void delta(String kind,String value)throws IOException{streamEvent(id,request,revision,slot,watch,kind,value);}
                    });
                    synchronized(lock){if(request.isCanceled()||active.get(id)!=request||revision!=revisions.getOrDefault(slot,0))throw new IOException();JSObject result=new JSObject();result.put("text",text);result.put("elapsedMs",System.currentTimeMillis()-started);call.resolve(result);}return;
                }
                ByteArrayOutputStream output = new ByteArrayOutputStream(); byte[] buffer = new byte[8192]; int n;
                try(InputStream input = response.body().byteStream()) { while((n = input.read(buffer)) != -1) { if(output.size() + n > 2 * 1024 * 1024) throw new IOException(); output.write(buffer, 0, n); } }
                JSONObject payload = new JSONObject(output.toString("UTF-8"));
                String text = AIStreamReader.completeText(payload);
                synchronized(lock) {
                    if(request.isCanceled() || revision != revisions.getOrDefault(slot, 0)) { call.reject("请求已取消或配置已变更", "CANCELLED"); return; }
                    String safe=text.replace(secret, "[密钥已隐藏]");if(watch!=null)for(int i=0;i<safe.length();i+=16384)streamEvent(id,request,revision,slot,watch,"content",safe.substring(i,Math.min(safe.length(),i+16384)));
                    JSObject result = new JSObject(); result.put("text", safe); result.put("elapsedMs", System.currentTimeMillis() - started); call.resolve(result);
                }
            } catch(Exception e) { call.reject(request.isCanceled() ? "请求已取消" : e instanceof AIStreamReader.Failure?e.getMessage():"无法取得模型响应，请检查网络、API 地址与返回格式后重试", request.isCanceled() ? "CANCELLED" : e instanceof AIStreamReader.Failure?((AIStreamReader.Failure)e).code:"NETWORK"); }
            finally { if(timer!=null)timer.cancel(false);synchronized(lock) { active.remove(id); slots.remove(id); sources.remove(id); streamWatches.remove(id); } }
        });
    }
    @Override protected void handleOnDestroy() { synchronized(lock) { for(Call request:active.values())request.cancel(); } workers.shutdownNow(); streamTimer.shutdownNow(); client.connectionPool().evictAll(); }
}
