package com.labmaker.app;

import org.junit.Test;import static org.junit.Assert.*;import org.json.*;import java.util.*;import java.io.*;import okhttp3.*;import okhttp3.mockwebserver.*;

public class AIConfigurationTest {
    JSONObject config(String name) throws Exception {return new JSONObject().put("endpoint","https://"+name+".example/v1").put("model",name).put("key",name+"-dummy-key");}
    @Test public void oldVisionRecordsRemainIndependentAndDoNotReadChat()throws Exception {
        JSONObject own=config("vision");assertSame(own,AIConfiguration.resolve("vision",null,slot->{assertEquals("vision",slot);return own;}));assertFalse(AIConfiguration.inherits("vision",own));
    }
    @Test public void inheritanceKeepsIndependentCredentialsWithoutCopyingChatSecret()throws Exception {
        JSONObject own=config("vision"),chat=config("chat");String before=own.toString();JSONObject mode=AIConfiguration.inheritance(own,true);
        assertEquals(before,own.toString());assertTrue(AIConfiguration.inherits("vision",mode));assertFalse(mode.toString().contains("chat-dummy-key"));assertSame(chat,AIConfiguration.resolve("vision",null,slot->slot.equals("chat")?chat:mode));
        JSONObject restored=AIConfiguration.inheritance(mode,false);assertSame(restored,AIConfiguration.resolve("vision",null,slot->restored));assertEquals("vision-dummy-key",restored.getString("key"));
    }
    @Test public void previewOverridesDoNotPersistAndNeverBorrowAnotherEndpoint()throws Exception {
        JSONObject own=config("vision"),chat=config("chat");assertSame(chat,AIConfiguration.resolve("vision",true,slot->slot.equals("chat")?chat:own));assertFalse(own.has("inheritChat"));
        JSONObject inherited=AIConfiguration.inheritance(own,true);assertSame(inherited,AIConfiguration.resolve("vision",false,slot->{assertEquals("vision",slot);return inherited;}));
        try{APIModels.keyFor("https://new.example/v1","",AIConfiguration.resolve("vision",false,slot->inherited));fail();}catch(IOException expected){}
    }
    @Test public void absentOrClearedChatNeverFallsBackToIndependentKey()throws Exception {
        JSONObject inherited=AIConfiguration.inheritance(config("vision"),true);assertNull(AIConfiguration.resolve("vision",null,slot->slot.equals("vision")?inherited:null));
        JSONObject noOwn=AIConfiguration.inheritance(null,true);assertFalse(noOwn.has("key"));assertNull(AIConfiguration.resolve("vision",false,slot->noOwn));
    }
    @Test public void eachInheritedRequestReadsCurrentChatAfterReconfiguration()throws Exception {
        Map<String,JSONObject> store=new HashMap<>();store.put("vision",AIConfiguration.inheritance(config("vision"),true));store.put("chat",config("old"));assertEquals("old",AIConfiguration.resolve("vision",null,store::get).getString("model"));store.put("chat",config("new"));assertEquals("new",AIConfiguration.resolve("vision",null,store::get).getString("model"));
    }
    @Test public void corruptChatIsNotReadForIndependentModeAndInheritanceFailsClosed()throws Exception {
        JSONObject own=config("vision");AIConfiguration.Reader reader=slot->{if(slot.equals("chat"))throw new IOException("decrypt failure");return own;};assertSame(own,AIConfiguration.resolve("vision",false,reader));try{AIConfiguration.resolve("vision",true,reader);fail();}catch(IOException expected){}
        try{AIConfiguration.resolve("chat",true,reader);fail();}catch(IllegalArgumentException expected){}
    }
    @Test public void changedChatCancelsInheritedRequestsButNotIndependentVision()throws Exception {
        assertTrue(AIConfiguration.affected("vision","chat","chat"));assertTrue(AIConfiguration.affected("vision","chat","vision"));assertTrue(AIConfiguration.affected("chat","chat","chat"));assertFalse(AIConfiguration.affected("vision","vision","chat"));assertFalse(AIConfiguration.affected("chat","chat","vision"));
        try(MockWebServer server=new MockWebServer()){server.start();Call request=new OkHttpClient().newCall(new Request.Builder().url(server.url("/models")).build());if(AIConfiguration.affected("vision","chat","chat"))request.cancel();try{APIModels.read(request,"dummy");fail();}catch(IOException expected){}assertEquals(0,server.getRequestCount());}
    }
    @Test public void inheritedModelCanDifferWhileEndpointAndKeyStayWithChat()throws Exception {
        JSONObject chat=config("chat"),record=AIConfiguration.inheritance(config("vision"),true,"vision-special");
        JSONObject effective=AIConfiguration.resolve("vision",null,slot->slot.equals("vision")?record:chat);
        assertEquals("vision-special",effective.getString("model"));assertEquals(chat.getString("endpoint"),effective.getString("endpoint"));assertEquals(chat.getString("key"),effective.getString("key"));assertEquals("chat",chat.getString("model"));assertEquals("vision",record.getString("model"));assertFalse(record.toString().contains("chat-dummy-key"));
    }
    @Test public void draftModelOverridesDoNotPersistAndBlankAlwaysUsesCurrentChatModel()throws Exception {
        JSONObject chat=config("chat-new"),record=AIConfiguration.inheritance(config("vision"),true,"vision-saved");AIConfiguration.Reader reader=slot->slot.equals("vision")?record:chat;
        assertEquals("vision-draft",AIConfiguration.resolve("vision",true,"vision-draft",reader).getString("model"));assertEquals("chat-new",AIConfiguration.resolve("vision",true,"",reader).getString("model"));assertEquals("vision-saved",record.getString("inheritModel"));
    }
    @Test public void invalidInheritedModelsFailWithoutChangingIndependentRecord()throws Exception {
        JSONObject own=config("vision");String before=own.toString();for(String model:new String[]{"x".repeat(257),"bad\nmodel","bad\u007fmodel"}){try{AIConfiguration.inheritance(own,true,model);fail();}catch(IllegalArgumentException expected){}assertEquals(before,own.toString());}
    }
}
