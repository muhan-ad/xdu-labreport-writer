package com.labmaker.app;

import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.*;

/** CRUD only. There is no bridge method to retrieve a stored password. */
@CapacitorPlugin(name="LabSchoolAccounts")
public class LabSchoolAccountsPlugin extends Plugin {
    private final ExecutorService queue=Executors.newSingleThreadExecutor();
    private SchoolAccountVault vault;
    @Override public void load(){vault=SchoolAccountStorage.open(getContext());}
    private interface Work {void run()throws Exception;}
    private void submit(PluginCall call,Work work){queue.execute(()->{try{work.run();}catch(Exception ignored){call.reject("本机账号操作未完成，请重试；配置损坏时可删除或重置账号","ACCOUNT_STORAGE");}});}
    @PluginMethod public void list(PluginCall call){submit(call,()->{JSObject result=new JSObject();result.put("accounts",vault.list());call.resolve(result);});}
    @PluginMethod public void save(PluginCall call){
        if(!Boolean.TRUE.equals(call.getBoolean("confirmed",false))){call.reject("请先确认在本机保存账号","CONFIRM");return;}
        String system=call.getString("system",""),id=call.getString("id",""),account=call.getString("account",""),password=call.getString("password",""),label=call.getString("label","");
        submit(call,()->{String saved=vault.save(system,id,account,password,label);call.resolve(new JSObject().put("id",saved));});
    }
    @PluginMethod public void remove(PluginCall call){
        if(!Boolean.TRUE.equals(call.getBoolean("confirmed",false))){call.reject("请确认删除账号","CONFIRM");return;}
        String id=call.getString("id","");submit(call,()->{vault.remove(id);call.resolve();});
    }
    @PluginMethod public void reset(PluginCall call){
        if(!Boolean.TRUE.equals(call.getBoolean("confirmed",false))){call.reject("请确认清空本机账号","CONFIRM");return;}
        submit(call,()->{synchronized(vault){vault.reset();SchoolAccountStorage.resetKey();}call.resolve();});
    }
    @Override protected void handleOnDestroy(){queue.shutdown();}
}
