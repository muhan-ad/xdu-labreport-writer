package com.labmaker.app;

import static org.junit.Assert.*;
import org.junit.Test;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

public class AIStreamReaderTest {
    static class Sink implements AIStreamReader.Listener { final List<String> contents=new ArrayList<>(),thoughts=new ArrayList<>();int activity;public void activity(){activity++;}public void delta(String kind,String text){(kind.equals("content")?contents:thoughts).add(text);} }
    static String chunk(String content,String reasoning){return "data: {\"choices\":[{\"delta\":{"+(content==null?"":"\"content\":"+JSONObjectQuote(content))+(content!=null&&reasoning!=null?",":"")+(reasoning==null?"":"\"reasoning_content\":"+JSONObjectQuote(reasoning))+"}}]}\n\n";}
    static String JSONObjectQuote(String s){return org.json.JSONObject.quote(s);}
    static String read(String s,String secret,Sink sink)throws Exception{return AIStreamReader.read(new ByteArrayInputStream(s.getBytes(StandardCharsets.UTF_8)),secret,sink);}
    @Test public void splitSecretAndChineseTextAreRedactedSeparatelyForReasoningAndContent()throws Exception{
        Sink s=new Sink();String wire=": keepalive\r\n\r\n"+chunk("你好 secret-", "思考 secret-")+chunk("TOKEN 世界", "TOKEN 中")+"data: [DONE]\n\n";
        String result=read(wire,"secret-TOKEN",s);assertEquals("你好 [密钥已隐藏] 世界",result);assertEquals(result,String.join("",s.contents));assertEquals("思考 [密钥已隐藏] 中",String.join("",s.thoughts));assertTrue(s.activity>0);
    }
    @Test public void utf8MaySplitAcrossNetworkReadsAndLastEventNeedNotEndWithNewline()throws Exception{
        Sink s=new Sink();byte[] bytes=(chunk("中文",null)+"data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}").getBytes(StandardCharsets.UTF_8);
        InputStream oneByte=new FilterInputStream(new ByteArrayInputStream(bytes)){public int read(byte[] b,int off,int len)throws IOException{return super.read(b,off,Math.min(1,len));}};
        assertEquals("中文",AIStreamReader.read(oneByte,"key",s));
    }
    @Test public void crLfCrOnlyMultilineDataAndDoneAreAccepted()throws Exception{
        Sink s=new Sink();String wire="data: {\"choices\":\rdata: [{\"delta\":{\"content\":\"ok\"}}]}\r\rdata: [DONE]\r\r";
        assertEquals("ok",read(wire,"x",s));
    }
    @Test public void interruptionTruncationBadJsonAndHugeEventAreRejected()throws Exception{
        for(String wire:new String[]{chunk("incomplete",null),"data: {broken}\n\n","data: "+"x".repeat(AIStreamReader.MAX_EVENT+1)+"\n\n","data: {\"choices\":[{\"delta\":{\"content\":\"partial\"},\"finish_reason\":\"length\"}]}\n\n"}){
            try{read(wire,"key",new Sink());fail("must reject");}catch(AIStreamReader.Failure expected){}
        }
    }
    @Test public void textLimitRejectsRatherThanReturningPartialSuccess()throws Exception{
        String part="a".repeat(65536);StringBuilder wire=new StringBuilder();for(int i=0;i<33;i++)wire.append(chunk(part,null));wire.append("data: [DONE]\n\n");
        try{read(wire.toString(),"key",new Sink());fail();}catch(AIStreamReader.Failure error){assertEquals("STREAM_LIMIT",error.code);}
    }
    @Test public void doneWithoutContentIsNotSuccess()throws Exception{try{read("data: [DONE]\n\n","key",new Sink());fail();}catch(AIStreamReader.Failure error){assertEquals("EMPTY",error.code);}}
    @Test public void heartbeatsDoNotCountAsProgressButActualContentDoes()throws Exception{Sink s=new Sink();assertEquals("hello",read(": heartbeat\n\n"+chunk("hello",null)+": heartbeat\n\ndata: [DONE]\n\n","key",s));assertEquals(1,s.activity);}
    @Test public void interruptedAndToolCallFinishesCannotReturnPartialSuccess()throws Exception{
        for(String reason:new String[]{"aborted","insufficient_system_resource","tool_calls","function_call","unexpected"}){
            String wire=chunk("partial",null)+"data: {\"choices\":[{\"delta\":{},\"finish_reason\":"+JSONObjectQuote(reason)+"}]}\n\ndata: [DONE]\n\n";
            try{read(wire,"key",new Sink());fail("must reject "+reason);}catch(AIStreamReader.Failure expected){assertEquals("STREAM_INCOMPLETE",expected.code);}
        }
    }
    @Test public void jsonRepliesCheckFinishAndNeverReturnExplicitlyPartialContent()throws Exception{
        for(String reason:new String[]{"length","content_filter","aborted","insufficient_system_resource","tool_calls","function_call","unexpected"}){
            org.json.JSONObject choice=new org.json.JSONObject().put("finish_reason",reason).put("message",new org.json.JSONObject().put("content","partial"));
            org.json.JSONObject payload=new org.json.JSONObject().put("choices",new org.json.JSONArray().put(choice));
            try{AIStreamReader.completeText(payload);fail("must reject "+reason);}catch(AIStreamReader.Failure expected){assertEquals("STREAM_INCOMPLETE",expected.code);}
        }
        org.json.JSONObject message=new org.json.JSONObject().put("content","完整");
        org.json.JSONObject choice=new org.json.JSONObject().put("message",message).put("finish_reason","stop");
        org.json.JSONObject payload=new org.json.JSONObject().put("choices",new org.json.JSONArray().put(choice));
        assertEquals("完整",AIStreamReader.completeText(payload));
        choice.remove("finish_reason");assertEquals("完整",AIStreamReader.completeText(payload)); // Legacy compatible servers.
        message.put("tool_calls",new org.json.JSONArray().put(new org.json.JSONObject()));
        try{AIStreamReader.completeText(payload);fail("unexpected tool call");}catch(AIStreamReader.Failure expected){assertEquals("STREAM_INCOMPLETE",expected.code);}
    }
    @Test public void streamingToolDeltasAreRejectedEvenWithoutFinishReason()throws Exception{
        String wire=chunk("partial",null)+"data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0}]}}]}\n\ndata: [DONE]\n\n";
        try{read(wire,"key",new Sink());fail("tool delta");}catch(AIStreamReader.Failure expected){assertEquals("STREAM_INCOMPLETE",expected.code);}
    }
}
