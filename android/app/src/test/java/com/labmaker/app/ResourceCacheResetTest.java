package com.labmaker.app;
import org.junit.Test;import static org.junit.Assert.*;import org.json.*;
import java.util.concurrent.atomic.*;

public class ResourceCacheResetTest {
 private JSONObject good()throws Exception{return new JSONObject().put("complete",true).put("cancelled",false).put("total",2).put("checked",2).put("problems",new JSONArray());}
 @Test public void verifiedResetCanBeRepeatedWithoutFileOperations()throws Exception{
  AtomicInteger calls=new AtomicInteger();for(int i=0;i<3;i++)ResourceCacheReset.run(good(),new AtomicBoolean(),()->true,Runnable::run,()->calls.incrementAndGet(),100);assertEquals(3,calls.get());
 }
 @Test public void incompleteCorruptAndCancelledChecksNeverReset()throws Exception{
  for(JSONObject result:new JSONObject[]{good().put("complete",false),good().put("checked",1),good().put("cancelled",true),good().put("problems",new JSONArray().put(new JSONObject().put("path","missing"))),good().put("total",0)}){
   AtomicInteger calls=new AtomicInteger();assertThrows(Exception.class,()->ResourceCacheReset.run(result,new AtomicBoolean(),()->true,Runnable::run,()->calls.incrementAndGet(),100));assertEquals(0,calls.get());
  }
 }
 @Test public void cancelledAndOldWorkNeverResetEvenWhenDispatchRuns()throws Exception{
  AtomicInteger calls=new AtomicInteger();assertThrows(Exception.class,()->ResourceCacheReset.run(good(),new AtomicBoolean(true),()->true,Runnable::run,()->calls.incrementAndGet(),100));assertThrows(Exception.class,()->ResourceCacheReset.run(good(),new AtomicBoolean(),()->false,Runnable::run,()->calls.incrementAndGet(),100));assertEquals(0,calls.get());
 }
 @Test public void timedOutQueuedTaskCannotRefreshLaterOrTouchANewerTask()throws Exception{
  AtomicReference<Runnable> pending=new AtomicReference<>();AtomicBoolean cancelled=new AtomicBoolean();AtomicInteger calls=new AtomicInteger();assertThrows(Exception.class,()->ResourceCacheReset.run(good(),cancelled,()->true,pending::set,()->calls.incrementAndGet(),10));assertTrue(cancelled.get());ResourceCacheReset.run(good(),new AtomicBoolean(),()->true,Runnable::run,()->calls.incrementAndGet(),100);pending.get().run();assertEquals(1,calls.get());
 }
 @Test public void actionAndDispatchFailureNeverReportSuccess()throws Exception{
  AtomicBoolean cancelled=new AtomicBoolean();assertThrows(Exception.class,()->ResourceCacheReset.run(good(),cancelled,()->true,Runnable::run,()->{throw new IllegalStateException();},100));assertTrue(cancelled.get());AtomicInteger calls=new AtomicInteger();assertThrows(Exception.class,()->ResourceCacheReset.run(good(),new AtomicBoolean(),()->true,r->{throw new IllegalStateException();},()->calls.incrementAndGet(),100));assertEquals(0,calls.get());
 }
}
