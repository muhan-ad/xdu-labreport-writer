package com.labmaker.app;
import org.junit.Test;import static org.junit.Assert.*;import java.util.*;import java.io.IOException;import javax.crypto.*;
public class SchoolSavedLoginTest {
    private SchoolAccountVault vault()throws Exception{KeyGenerator g=KeyGenerator.getInstance("AES");g.init(256);SecretKey key=g.generateKey();return new SchoolAccountVault(new SchoolAccountVault.Store(){String raw;public String read(){return raw;}public void write(String value){raw=value;}},create->key,SchoolAccountVaultTest.codec);}
    private Map<String,String> form(){Map<String,String> f=new LinkedHashMap<>();f.put("__VIEWSTATE","fresh-state");f.put("__EVENTVALIDATION","fresh-validation");f.put("login1$StuLoginID","12345678");f.put("login1$UserRole","Student");f.put("login1$StuPassword","");return f;}
    @Test public void nativeOnlyInjectionPreservesFreshStateWithoutModifyingJsForm()throws Exception{
        SchoolAccountVault v=vault();String id=v.save("course","","12345678","test-native-secret","");Map<String,String> original=form(),result=SchoolSavedLogin.courseForm(v,id,original);
        assertEquals("test-native-secret",result.get("login1$StuPassword"));assertEquals("",original.get("login1$StuPassword"));assertEquals("fresh-state",result.get("__VIEWSTATE"));assertEquals("fresh-validation",result.get("__EVENTVALIDATION"));assertFalse(result.containsKey("savedAccountId"));
    }
    @Test public void wrongSystemChangedIdentityMixedPasswordAndDeletedRecordAreRejected()throws Exception{
        SchoolAccountVault v=vault();String report=v.save("report","","12345678","report-secret","");assertThrows(IOException.class,()->SchoolSavedLogin.courseForm(v,report,form()));
        String id=v.save("course","","12345678","course-secret","");Map<String,String> mixed=form();mixed.put("login1$StuPassword","other");assertThrows(IOException.class,()->SchoolSavedLogin.courseForm(v,id,mixed));
        v.save("course",id,"87654321","new-secret","");assertThrows(IOException.class,()->SchoolSavedLogin.courseForm(v,id,form()));v.remove(id);assertThrows(IOException.class,()->SchoolSavedLogin.resolve(v,"course",id,"87654321"));
    }
    @Test public void refreshedPasswordIsUsedAndReportLoginCannotReadCourseCredentials()throws Exception{
        SchoolAccountVault v=vault();String id=v.save("course","","12345678","old","");v.save("course",id,"12345678","updated","");assertEquals("updated",SchoolSavedLogin.courseForm(v,id,form()).get("login1$StuPassword"));assertThrows(IOException.class,()->SchoolSavedLogin.resolve(v,"report",id,"12345678"));
    }
    @Test public void savedLoginResponseNeverReturnsRemoteEchoesAndRejectsLoginForm()throws Exception{
        String result=SchoolSavedLogin.courseResponse("<html><body>echoed test-native-secret<input type='password' value='test-native-secret'></body></html>");assertFalse(result.contains("test-native-secret"));assertFalse(result.contains("password"));
        assertThrows(IOException.class,()->SchoolSavedLogin.courseResponse("<form><input name='login1$StuPassword' value='test-native-secret'></form>"));
    }
}
