package com.labmaker.app;

import org.junit.Test;
import static org.junit.Assert.*;
import java.io.IOException;
import java.util.*;
import javax.crypto.*;
import org.json.*;

public class SchoolAccountVaultTest {
    private static final String ACCOUNT="12345678",PASSWORD="TestVaultOnly_123!";
    static class MemoryStore implements SchoolAccountVault.Store {
        String raw;boolean fail;
        public String read(){return raw;}
        public void write(String value)throws Exception{if(fail)throw new IOException("simulated write failure");raw=value;}
    }
    static SchoolAccountVault.Codec codec=new SchoolAccountVault.Codec(){public String encode(byte[] b){return Base64.getEncoder().encodeToString(b);}public byte[] decode(String s){return Base64.getDecoder().decode(s);}};
    static SecretKey key()throws Exception{KeyGenerator g=KeyGenerator.getInstance("AES");g.init(256);return g.generateKey();}
    static SchoolAccountVault vault(MemoryStore store,SecretKey key){return new SchoolAccountVault(store,create->key,codec);}

    @Test public void encryptedStorageAndSummaryNeverExposePasswordAndSystemsStayIndependent()throws Exception{
        MemoryStore store=new MemoryStore();SchoolAccountVault v=vault(store,key());
        String course=v.save("course","",ACCOUNT,PASSWORD,"选课测试"),report=v.save("report","",ACCOUNT,"AnotherTestPassword","报告测试");
        assertNotEquals(course,report);assertFalse(store.raw.contains(ACCOUNT));assertFalse(store.raw.contains(PASSWORD));assertFalse(store.raw.contains("选课测试"));
        JSONArray list=v.list();assertEquals(2,list.length());assertFalse(list.toString().contains("password"));assertFalse(list.toString().contains(PASSWORD));
        assertEquals(ACCOUNT,list.getJSONObject(0).getString("account"));assertEquals(PASSWORD,v.credentials("course",course).password);
        assertThrows(IOException.class,()->v.credentials("report",course));
        assertEquals("AnotherTestPassword",v.credentials("report",report).password);
    }
    @Test public void duplicateSaveUpdatesOneRecordWithFreshIvAndPreservesOthers()throws Exception{
        MemoryStore store=new MemoryStore();SchoolAccountVault v=vault(store,key());String id=v.save("course","",ACCOUNT,PASSWORD,"first"),other=v.save("report","",ACCOUNT,"other","other");
        JSONObject before=new JSONObject(store.raw).getJSONArray("accounts").getJSONObject(0);
        assertEquals(id,v.save("course","",ACCOUNT,PASSWORD,"first"));JSONObject after=new JSONObject(store.raw).getJSONArray("accounts").getJSONObject(0);
        assertNotEquals(before.getString("iv"),after.getString("iv"));assertNotEquals(before.getString("ciphertext"),after.getString("ciphertext"));assertEquals(2,v.list().length());
        v.save("course",id,ACCOUNT,"updated","new label");assertEquals("updated",v.credentials("course",id).password);assertEquals("other",v.credentials("report",other).password);
    }
    @Test public void aadPreventsRecordAndSystemSubstitutionAndTamperingLocksOnlyThatRecord()throws Exception{
        MemoryStore store=new MemoryStore();SecretKey key=key();SchoolAccountVault v=vault(store,key);String one=v.save("course","",ACCOUNT,PASSWORD,"one"),two=v.save("report","","87654321","other","two");
        JSONObject root=new JSONObject(store.raw);JSONObject record=root.getJSONArray("accounts").getJSONObject(0);record.put("system","academic");store.raw=root.toString();
        assertTrue(v.list().getJSONObject(0).getBoolean("locked"));assertEquals("other",v.credentials("report",two).password);assertThrows(Exception.class,()->v.credentials("academic",one));
        record.put("system","course");record.put("id",UUID.randomUUID().toString());store.raw=root.toString();assertTrue(v.list().getJSONObject(0).getBoolean("locked"));
        record.put("id",one);String cipher=record.getString("ciphertext");record.put("ciphertext",(cipher.charAt(0)=='A'?'B':'A')+cipher.substring(1));store.raw=root.toString();assertTrue(v.list().getJSONObject(0).getBoolean("locked"));
        v.remove(one);assertEquals(1,v.list().length());assertEquals("other",v.credentials("report",two).password);
    }
    @Test public void lostKeyDoesNotSilentlyEraseAccountsAndCanBeExplicitlyRemoved()throws Exception{
        MemoryStore store=new MemoryStore();SchoolAccountVault original=vault(store,key());String id=original.save("course","",ACCOUNT,PASSWORD,"");String raw=store.raw;
        SchoolAccountVault wrong=vault(store,key());assertTrue(wrong.list().getJSONObject(0).getBoolean("locked"));assertEquals(raw,store.raw);assertThrows(Exception.class,()->wrong.credentials("course",id));
        wrong.remove(id);assertEquals(0,wrong.list().length());
    }
    @Test public void malformedCipherFieldsLockOnlyTheDamagedAccount()throws Exception{
        MemoryStore store=new MemoryStore();SchoolAccountVault v=vault(store,key());String bad=v.save("course","",ACCOUNT,PASSWORD,""),good=v.save("report","","87654321","other","");
        JSONObject root=new JSONObject(store.raw);JSONObject record=root.getJSONArray("accounts").getJSONObject(0);record.put("ciphertext","not-valid-base64!");store.raw=root.toString();
        assertTrue(v.list().getJSONObject(0).getBoolean("locked"));assertFalse(v.list().getJSONObject(1).getBoolean("locked"));assertEquals("other",v.credentials("report",good).password);
        record.remove("iv");store.raw=root.toString();assertEquals(2,v.list().length());assertTrue(v.list().getJSONObject(0).getBoolean("locked"));v.remove(bad);assertEquals(1,v.list().length());
    }
    @Test public void failedSaveAndCorruptDirectoryDoNotOverwritePriorData()throws Exception{
        MemoryStore store=new MemoryStore();SchoolAccountVault v=vault(store,key());String id=v.save("course","",ACCOUNT,PASSWORD,"");String before=store.raw;store.fail=true;
        assertThrows(IOException.class,()->v.save("course",id,ACCOUNT,"new",""));assertEquals(before,store.raw);assertEquals(PASSWORD,v.credentials("course",id).password);
        store.fail=false;store.raw="broken";assertThrows(Exception.class,()->v.save("course","",ACCOUNT,PASSWORD,""));assertEquals("broken",store.raw);
        v.reset();assertEquals(0,v.list().length());
    }
    @Test public void validationQuotaAndExplicitDeletePreserveUnrelatedEntries()throws Exception{
        MemoryStore store=new MemoryStore();SchoolAccountVault v=vault(store,key());
        assertThrows(IOException.class,()->v.save("simulation","",ACCOUNT,PASSWORD,""));assertThrows(IOException.class,()->v.save("course","","abc",PASSWORD,""));assertThrows(IOException.class,()->v.save("course","",ACCOUNT,"",""));
        assertThrows(IOException.class,()->v.save("course","../escape",ACCOUNT,PASSWORD,""));assertThrows(IOException.class,()->v.save("course","",ACCOUNT,PASSWORD,"bad\nlabel"));
        for(int i=0;i<50;i++)v.save("course","","123456"+i,PASSWORD,"");assertEquals(50,v.list().length());
        assertThrows(IOException.class,()->v.save("course","","999999999",PASSWORD,""));
        assertNotNull(v.save("course","","1234560","new",""));String id=v.list().getJSONObject(0).getString("id");v.remove(id);assertEquals(49,v.list().length());assertThrows(IOException.class,()->v.credentials("course",id));
    }
}
