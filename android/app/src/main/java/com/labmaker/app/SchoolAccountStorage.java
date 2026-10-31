package com.labmaker.app;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import android.util.Base64;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.*;

final class SchoolAccountStorage {
    private static final String ALIAS="lab-maker-school-accounts-v1";
    private static final Object KEY_LOCK=new Object();
    private static SchoolAccountVault instance;
    static void resetKey()throws Exception{synchronized(KEY_LOCK){KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);if(store.containsAlias(ALIAS))store.deleteEntry(ALIAS);}}
    static synchronized SchoolAccountVault open(Context context){
        if(instance!=null)return instance;
        AtomicFile file=new AtomicFile(new File(context.getNoBackupFilesDir(),"school-accounts-v1.json"));
        instance=new SchoolAccountVault(new SchoolAccountVault.Store(){
            public String read()throws Exception{try{return new String(file.readFully(),StandardCharsets.UTF_8);}catch(FileNotFoundException missing){return null;}}
            public void write(String value)throws Exception{
                FileOutputStream output=null;
                try{output=file.startWrite();output.write(value.getBytes(StandardCharsets.UTF_8));file.finishWrite(output);output=null;if(!value.equals(new String(file.readFully(),StandardCharsets.UTF_8)))throw new IOException("本机账号保存未能核实");}
                catch(Exception error){if(output!=null)file.failWrite(output);throw error;}
            }
        },create->{synchronized(KEY_LOCK){
            KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
            if(!store.containsAlias(ALIAS)){
                if(!create)throw new IOException("本机账号密钥不可用");
                KeyGenerator generator=KeyGenerator.getInstance("AES","AndroidKeyStore");
                generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).setRandomizedEncryptionRequired(true).build());generator.generateKey();
            }
            return (SecretKey)store.getKey(ALIAS,null);
        }},new SchoolAccountVault.Codec(){
            public String encode(byte[] bytes){return Base64.encodeToString(bytes,Base64.NO_WRAP);}
            public byte[] decode(String text){return Base64.decode(text,Base64.NO_WRAP);}
        });
        return instance;
    }
}
