package com.labmaker.app;
import java.io.IOException;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;
import org.json.JSONObject;

/** Runs only a cache action after a complete installation check, never user-file cleanup. */
final class ResourceCacheReset {
 interface Dispatcher {void dispatch(Runnable task)throws Exception;}
 interface Action {void run()throws Exception;}
 static void run(JSONObject verified,AtomicBoolean cancelled,BooleanSupplier current,Dispatcher dispatcher,Action action,long timeoutMs)throws IOException {
  if(!verified.optBoolean("complete")||verified.optBoolean("cancelled")||verified.optInt("total")<1||verified.optInt("checked")!=verified.optInt("total")||verified.optJSONArray("problems")==null||verified.optJSONArray("problems").length()!=0)throw new IOException("安装资源不完整，缓存未刷新");
  CompletableFuture<Void> finished=new CompletableFuture<>();
  try{
   dispatcher.dispatch(()->{
    if(cancelled.get()||!current.getAsBoolean()){finished.completeExceptionally(new CancellationException());return;}
    try{action.run();finished.complete(null);}catch(Exception error){finished.completeExceptionally(error);}
   });
   finished.get(timeoutMs,TimeUnit.MILLISECONDS);
  }catch(Exception error){cancelled.set(true);if(error instanceof InterruptedException)Thread.currentThread().interrupt();throw new IOException("运行缓存刷新未完成，请重试");}
 }
}
