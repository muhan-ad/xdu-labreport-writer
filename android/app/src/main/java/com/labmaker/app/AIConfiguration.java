package com.labmaker.app;

import org.json.JSONObject;

/** Resolves credentials inside native code; inherited records never copy the chat secret. */
final class AIConfiguration {
    interface Reader { JSONObject read(String slot) throws Exception; }
    static boolean inherits(String slot, JSONObject record) {
        return "vision".equals(slot) && record != null && record.optBoolean("inheritChat", false);
    }
    static String source(String slot, Boolean override, JSONObject record) {
        if (!"chat".equals(slot) && !"vision".equals(slot)) throw new IllegalArgumentException("配置类型无效");
        if ("chat".equals(slot) && Boolean.TRUE.equals(override)) throw new IllegalArgumentException("仅图片识别可继承问答配置");
        return "vision".equals(slot) && (override == null ? inherits(slot, record) : override) ? "chat" : slot;
    }
    static JSONObject resolve(String slot, Boolean override, Reader reader) throws Exception {
        return resolve(slot,override,null,reader);
    }
    static JSONObject resolve(String slot, Boolean override, String modelOverride, Reader reader) throws Exception {
        source(slot,override,null); // Validate the requested mode before accessing a credential record.
        JSONObject record=reader.read(slot);
        String source=source(slot,override,record);
        JSONObject value=source.equals(slot)?record:reader.read(source);
        if(value==null||value.optString("key").isEmpty())return null;
        if(!source.equals(slot)) {
            String model=modelOverride==null?(record==null?"":record.optString("inheritModel","")):modelOverride;
            validateModel(model);
            if(!model.isEmpty())return new JSONObject(value.toString()).put("model",model);
        }
        return value;
    }
    static JSONObject inheritance(JSONObject record, boolean enabled) throws Exception {
        return (record==null?new JSONObject():new JSONObject(record.toString())).put("inheritChat",enabled);
    }
    static JSONObject inheritance(JSONObject record, boolean enabled,String model) throws Exception {
        validateModel(model);return inheritance(record,enabled).put("inheritModel",model.trim());
    }
    private static void validateModel(String model) {
        if(model==null||model.length()>256||model.chars().anyMatch(c->c<32||c==127))throw new IllegalArgumentException("识图模型名称无效");
    }
    static boolean affected(String requestSlot,String requestSource,String changedSlot) {
        return changedSlot.equals(requestSlot)||changedSlot.equals(requestSource);
    }
}
