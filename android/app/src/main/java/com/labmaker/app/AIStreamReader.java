package com.labmaker.app;

import java.io.*;
import java.nio.charset.*;
import org.json.*;

/** Bounded SSE parsing and cross-event secret redaction. No network or Android UI dependencies. */
final class AIStreamReader {
    static final int MAX_EVENT = 262144, MAX_TEXT = 2 * 1024 * 1024;
    interface Listener { void delta(String kind, String text) throws IOException; void activity(); }
    static final class Failure extends IOException { final String code; Failure(String code, String message) { super(message); this.code=code; } }

    private static final class Redactor {
        final String secret, kind; final Listener listener; final StringBuilder pending = new StringBuilder(), output = new StringBuilder();
        Redactor(String secret,String kind,Listener listener){this.secret=secret;this.kind=kind;this.listener=listener;}
        void add(String text) throws IOException { if(text==null || text.isEmpty())return; pending.append(text); drain(false); }
        void finish() throws IOException { drain(true); }
        void emit(String text) throws IOException {
            if(text.isEmpty())return;
            if(output.length()+text.length()>MAX_TEXT)throw new Failure("STREAM_LIMIT","模型返回内容过长，请缩短请求后重试");
            output.append(text);
            for(int i=0;i<text.length();){int end=Math.min(text.length(),i+16384);if(end<text.length()&&Character.isHighSurrogate(text.charAt(end-1))&&Character.isLowSurrogate(text.charAt(end)))end--;listener.delta(kind,text.substring(i,end));i=end;}
        }
        void drain(boolean end) throws IOException {
            while(pending.length()>0){
                int match=secret.isEmpty()?-1:pending.indexOf(secret);
                if(match>=0){emit(pending.substring(0,match));emit("[密钥已隐藏]");pending.delete(0,match+secret.length());continue;}
                int safe=end?pending.length():Math.max(0,pending.length()-Math.max(0,secret.length()-1));
                if(safe>0&&safe<pending.length()&&Character.isHighSurrogate(pending.charAt(safe-1))&&Character.isLowSurrogate(pending.charAt(safe)))safe--;
                if(safe==0)return;emit(pending.substring(0,safe));pending.delete(0,safe);
            }
        }
    }
    private static String line(BufferedReader reader,Listener listener) throws IOException {
        StringBuilder line=new StringBuilder();int c;
        while((c=reader.read())!=-1){if(c=='\n')break;if(c=='\r'){reader.mark(1);int next=reader.read();if(next!='\n'&&next!=-1)reader.reset();break;}if(line.length()>=MAX_EVENT)throw new Failure("STREAM_LIMIT","模型返回的数据块过大，请重试");line.append((char)c);}
        return c==-1&&line.length()==0?null:line.toString();
    }
    // Some OpenAI-compatible providers omit finish_reason on ordinary JSON replies.
    // Preserve compatibility when absent, but never accept an explicit non-stop finish.
    static boolean verifyFinish(Object value) throws Failure {
        if(value==null||value==JSONObject.NULL)return false;
        if(!(value instanceof String)||((String)value).isEmpty())throw new Failure("STREAM_FORMAT","模型返回的结束状态格式不正确");
        if(value.equals("stop"))return true;
        throw new Failure("STREAM_INCOMPLETE",value.equals("tool_calls")||value.equals("function_call")
            ?"模型返回了当前不支持的工具调用，请更换模型或调整配置"
            :"模型未完整返回正文，请调整请求或稍后重试");
    }
    private static void rejectToolCalls(JSONObject message)throws Failure {
        Object calls=message.opt("tool_calls"),function=message.opt("function_call");
        if((calls!=null&&calls!=JSONObject.NULL&&(!(calls instanceof JSONArray)||((JSONArray)calls).length()>0))
            ||(function!=null&&function!=JSONObject.NULL))
            throw new Failure("STREAM_INCOMPLETE","模型返回了当前不支持的工具调用，请更换模型或调整配置");
    }
    static String completeText(JSONObject payload)throws Failure {
        try{
            JSONObject choice=payload.getJSONArray("choices").getJSONObject(0);
            verifyFinish(choice.opt("finish_reason"));
            JSONObject message=choice.getJSONObject("message");rejectToolCalls(message);
            Object raw=message.opt("content");StringBuilder text=new StringBuilder();
            if(raw instanceof String)text.append((String)raw);
            else if(raw instanceof JSONArray){JSONArray items=(JSONArray)raw;for(int i=0;i<items.length();i++)text.append(items.getJSONObject(i).optString("text",""));}
            else if(raw!=null&&raw!=JSONObject.NULL)throw new JSONException("invalid content");
            if(text.toString().trim().isEmpty())throw new Failure("EMPTY","模型没有返回正文，请更换模型或重试");
            return text.toString();
        }catch(JSONException error){throw new Failure("STREAM_FORMAT","模型返回的数据格式不正确，请重试");}
    }
    private static int event(String event,Redactor content,Redactor reasoning) throws IOException {
        if(event.equals("[DONE]"))return 2;
        try{
            JSONObject payload=new JSONObject(event);if(payload.has("error"))throw new Failure("STREAM_ERROR","模型返回了错误，请检查模型配置后重试");
            JSONArray choices=payload.optJSONArray("choices");if(choices==null||choices.length()==0)return 0;
            JSONObject choice=choices.optJSONObject(0);if(choice==null)throw new JSONException("invalid choice");JSONObject delta=choice.optJSONObject("delta");
            if(delta!=null){rejectToolCalls(delta);Object text=delta.opt("content"),thought=delta.opt("reasoning_content");if(thought==null||thought==JSONObject.NULL)thought=delta.opt("reasoning");if(text instanceof String){if(!((String)text).isEmpty())content.listener.activity();content.add((String)text);}else if(text!=null&&text!=JSONObject.NULL)throw new JSONException("invalid content");if(thought instanceof String){if(!((String)thought).isEmpty())reasoning.listener.activity();reasoning.add((String)thought);}else if(thought!=null&&thought!=JSONObject.NULL)throw new JSONException("invalid reasoning");}
            return verifyFinish(choice.opt("finish_reason"))?1:0;
        }catch(JSONException error){throw new Failure("STREAM_FORMAT","模型返回的数据格式不正确，请重试");}
    }
    static String read(InputStream input,String secret,Listener listener) throws IOException {
        BufferedReader reader=new BufferedReader(new InputStreamReader(input,StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)),8192);
        Redactor content=new Redactor(secret,"content",listener),reasoning=new Redactor(secret,"reasoning",listener);
        StringBuilder data=new StringBuilder();boolean completed=false;int eventBytes=0;String line;
        while((line=line(reader,listener))!=null){
            if(!line.isEmpty()){
                if(line.startsWith(":"))continue;
                if(line.startsWith("data:")){String part=line.substring(5);if(part.startsWith(" "))part=part.substring(1);eventBytes+=part.length();if(eventBytes>MAX_EVENT)throw new Failure("STREAM_LIMIT","模型返回的数据块过大，请重试");if(data.length()>0)data.append('\n');data.append(part);}
                continue;
            }
            if(data.length()==0)continue;
            String event=data.toString();data.setLength(0);eventBytes=0;
            int state=event(event,content,reasoning);if(state>0)completed=true;if(state==2)break;
        }
        // Process a complete final event even when the server omits its ending newline.
        if(data.length()>0&&event(data.toString(),content,reasoning)>0)completed=true;
        if(!completed)throw new Failure("STREAM_INCOMPLETE","模型响应中断，请重试");
        content.finish();reasoning.finish();if(content.output.toString().trim().isEmpty())throw new Failure("EMPTY","模型没有返回正文，请更换模型或重试");return content.output.toString();
    }
}
