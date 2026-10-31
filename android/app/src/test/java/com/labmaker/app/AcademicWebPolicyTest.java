package com.labmaker.app;
import org.junit.Test;import static org.junit.Assert.*;
public class AcademicWebPolicyTest {
 @Test public void officialAuthenticationOriginsOnly(){assertTrue(AcademicWebPolicy.allowed(AcademicWebPolicy.ENTRY));assertTrue(AcademicWebPolicy.allowed("https://ids.xidian.edu.cn/authserver/login"));for(String bad:new String[]{"http://ehall.xidian.edu.cn/","https://ehall.xidian.edu.cn.evil.example/","https://ids.xidian.edu.cn@evil.example/","https://u:p@ehall.xidian.edu.cn/","https://ehall.xidian.edu.cn:443/","file:///data/private","javascript:alert(1)"})assertFalse(bad,AcademicWebPolicy.allowed(bad));}
 @Test public void profilesAreStableAccountScopedAndContainNoPlainAccount()throws Exception{String first=AcademicWebPolicy.profile("12345678901"),other=AcademicWebPolicy.profile("99999999999");assertEquals(first,AcademicWebPolicy.profile("12345678901"));assertNotEquals(first,other);assertFalse(first.contains("12345678901"));assertTrue(first.matches("lab-academic-[a-f0-9]{64}"));assertThrows(Exception.class,()->AcademicWebPolicy.profile("../bad"));}
}
