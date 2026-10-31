package com.labmaker.app;

import java.io.IOException;
import java.util.*;
import org.jsoup.Jsoup;

/** Resolves stored credentials only inside native login paths, never to a JS response. */
final class SchoolSavedLogin {
    static String courseResponse(String html)throws IOException{
        if(Jsoup.parse(html).getElementsByAttributeValue("name","login1$StuPassword").first()!=null)throw new IOException("官网未接受已保存账号登录，请核对账号配置或官网状态");
        return "<!doctype html><html><body>saved-login-response</body></html>";
    }
    static SchoolAccountVault.Credentials resolve(SchoolAccountVault vault,String system,String id,String expected)throws Exception{
        if(expected==null||!expected.matches("\\d{6,30}"))throw new IOException("请选择有效的已保存账号");
        SchoolAccountVault.Credentials value;
        try{value=vault.credentials(system,id);}catch(Exception ignored){throw new IOException("已保存账号不存在或无法解密，请在账号管理中核对");}
        if(!expected.equals(value.account))throw new IOException("已保存账号已变化，请刷新账号列表后重新选择");
        return value;
    }
    static Map<String,String> courseForm(SchoolAccountVault vault,String id,Map<String,String> original)throws Exception{
        if(original==null||!"Student".equals(original.get("login1$UserRole")))throw new IOException("学校登录身份无效");
        String password=original.get("login1$StuPassword");if(password!=null&&!password.isEmpty())throw new IOException("请勿同时提交密码和已保存账号");
        SchoolAccountVault.Credentials value=resolve(vault,"course",id,original.get("login1$StuLoginID"));
        Map<String,String> form=new LinkedHashMap<>(original);form.put("login1$StuPassword",value.password);return form;
    }
}
