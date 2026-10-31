package com.labmaker.app;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.*;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import org.json.*;

/** Pure Java encrypted account store. Public summaries never contain passwords. */
final class SchoolAccountVault {
    interface Store { String read() throws Exception; void write(String value) throws Exception; }
    interface Keys { SecretKey get(boolean create) throws Exception; }
    interface Codec { String encode(byte[] bytes); byte[] decode(String text); }
    static final class Credentials {
        final String account,password,label;
        Credentials(String a,String p,String l){account=a;password=p;label=l;}
        @Override public String toString(){return "Credentials(redacted)";}
    }
    private final Store store;private final Keys keys;private final Codec codec;
    SchoolAccountVault(Store store,Keys keys,Codec codec){this.store=store;this.keys=keys;this.codec=codec;}
    static boolean system(String value){return "course".equals(value)||"report".equals(value)||"academic".equals(value);}
    private static void id(String value)throws IOException{if(value==null||!value.matches("[a-f0-9-]{36}"))throw new IOException("账号标识无效");}
    private JSONArray records()throws Exception{
        String raw=store.read();if(raw==null)return new JSONArray();
        if(raw.length()>128000)throw new IOException("本机账号配置过大");
        JSONObject root=new JSONObject(raw);JSONArray rows=root.getJSONArray("accounts");
        if(root.getInt("version")!=1||rows.length()>50)throw new IOException("本机账号配置格式无效");
        Set<String> seen=new HashSet<>();
        for(int i=0;i<rows.length();i++){JSONObject r=rows.getJSONObject(i);String value=r.getString("id");id(value);if(!seen.add(value)||!system(r.getString("system")))throw new IOException("本机账号目录无效");}
        return rows;
    }
    private byte[] aad(String system,String id){return ("lab-maker-school-accounts:v1:"+system+":"+id).getBytes(StandardCharsets.UTF_8);}
    private Credentials decode(JSONObject record)throws Exception{
        for(String name:new String[]{"iv","ciphertext"}){String encoded=record.getString(name);if(encoded.isEmpty()||encoded.length()>4096||!encoded.matches("[A-Za-z0-9+/]+={0,2}"))throw new IOException("本机账号密文格式无效");}
        byte[] iv=codec.decode(record.getString("iv")),content=codec.decode(record.getString("ciphertext"));
        if(iv.length!=12||content.length<16||content.length>4096)throw new IOException("账号密文无效");
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,keys.get(false),new GCMParameterSpec(128,iv));
        cipher.updateAAD(aad(record.getString("system"),record.getString("id")));
        byte[] plain=cipher.doFinal(content);
        try{JSONObject value=new JSONObject(new String(plain,StandardCharsets.UTF_8));return checked(value.getString("account"),value.getString("password"),value.getString("label"));}
        finally{Arrays.fill(plain,(byte)0);}
    }
    private static Credentials checked(String account,String password,String label)throws IOException{
        if(account==null||!account.matches("\\d{6,30}")||password==null||password.isEmpty()||password.length()>200||label==null||label.length()>40||label.matches("(?s).*[\\x00-\\x1f\\x7f].*"))throw new IOException("请填写有效账号、密码和不超过 40 字的备注");
        return new Credentials(account,password,label.trim());
    }
    private JSONObject encode(String system,String id,Credentials value)throws Exception{
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,keys.get(true));
        if(cipher.getIV().length!=12)throw new IOException("账号加密随机数无效");
        cipher.updateAAD(aad(system,id));
        byte[] plain=new JSONObject().put("account",value.account).put("password",value.password).put("label",value.label).toString().getBytes(StandardCharsets.UTF_8);
        try{return new JSONObject().put("id",id).put("system",system).put("iv",codec.encode(cipher.getIV())).put("ciphertext",codec.encode(cipher.doFinal(plain)));}
        finally{Arrays.fill(plain,(byte)0);}
    }
    private void persist(JSONArray rows)throws Exception{store.write(new JSONObject().put("version",1).put("accounts",rows).toString());}
    synchronized JSONArray list()throws Exception{
        JSONArray rows=records(),result=new JSONArray();
        for(int i=0;i<rows.length();i++){JSONObject r=rows.getJSONObject(i),summary=new JSONObject().put("id",r.getString("id")).put("system",r.getString("system"));
            try{Credentials value=decode(r);summary.put("account",value.account).put("label",value.label).put("locked",false);}
            catch(Exception ignored){summary.put("account","").put("label","无法解密的账号").put("locked",true);}
            result.put(summary);
        }
        return result;
    }
    synchronized String save(String system,String requestedId,String account,String password,String label)throws Exception{
        if(!system(system))throw new IOException("账号系统类型无效");Credentials value=checked(account,password,label);JSONArray rows=records();int index=-1;
        if(requestedId!=null&&!requestedId.isEmpty()){
            id(requestedId);for(int i=0;i<rows.length();i++){JSONObject r=rows.getJSONObject(i);if(r.getString("id").equals(requestedId)){if(!r.getString("system").equals(system))throw new IOException("账号不属于此系统");index=i;break;}}
            if(index<0)throw new IOException("账号已被删除，请刷新列表");
        }else for(int i=0;i<rows.length();i++){JSONObject r=rows.getJSONObject(i);if(!r.getString("system").equals(system))continue;Credentials old;try{old=decode(r);}catch(Exception ignored){continue;}if(old.account.equals(account)){index=i;break;}}
        if(index<0&&rows.length()>=50)throw new IOException("本机最多保存 50 个账号，请先删除不再使用的账号");
        String valueId=index<0?UUID.randomUUID().toString():rows.getJSONObject(index).getString("id");JSONObject encrypted=encode(system,valueId,value);
        if(index<0)rows.put(encrypted);else rows.put(index,encrypted);persist(rows);return valueId;
    }
    synchronized Credentials credentials(String system,String valueId)throws Exception{
        if(!system(system))throw new IOException("账号系统类型无效");id(valueId);JSONArray rows=records();
        for(int i=0;i<rows.length();i++){JSONObject r=rows.getJSONObject(i);if(r.getString("id").equals(valueId)){if(!r.getString("system").equals(system))throw new IOException("账号不属于此系统");return decode(r);}}
        throw new IOException("账号不存在或已删除");
    }
    synchronized void remove(String valueId)throws Exception{
        id(valueId);JSONArray rows=records(),next=new JSONArray();for(int i=0;i<rows.length();i++)if(!rows.getJSONObject(i).getString("id").equals(valueId))next.put(rows.getJSONObject(i));persist(next);
    }
    synchronized void reset()throws Exception{persist(new JSONArray());}
}
