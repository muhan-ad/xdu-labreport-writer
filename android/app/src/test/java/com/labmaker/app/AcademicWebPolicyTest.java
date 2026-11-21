package com.labmaker.app;
import org.junit.Test;import static org.junit.Assert.*;
public class AcademicWebPolicyTest {
 @Test public void academicDesktopIdentityDoesNotUseMobileWebViewTokens(){assertTrue(AcademicWebPolicy.USER_AGENT.contains("Chrome/"));assertFalse(AcademicWebPolicy.USER_AGENT.contains("; wv"));assertFalse(AcademicWebPolicy.USER_AGENT.contains("Mobile"));}
 @Test public void httpNavigationHasNoOriginOrPortAllowlist(){for(String good:new String[]{AcademicWebPolicy.ENTRY,"http://example.com:8080/new","https://example.org/other","https://ehall.xidian.edu.cn:443/"})assertTrue(good,AcademicWebPolicy.allowed(good));for(String bad:new String[]{"https://u:p@example.com/","file:///data/private","javascript:alert(1)"})assertFalse(bad,AcademicWebPolicy.allowed(bad));}

 @Test public void profilesAreStableAccountScopedAndContainNoPlainAccount()throws Exception{String first=AcademicWebPolicy.profile("12345678901"),other=AcademicWebPolicy.profile("99999999999");assertEquals(first,AcademicWebPolicy.profile("12345678901"));assertNotEquals(first,other);assertFalse(first.contains("12345678901"));assertTrue(first.matches("lab-academic-[a-f0-9]{64}"));assertThrows(Exception.class,()->AcademicWebPolicy.profile("../bad"));}
}
