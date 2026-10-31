package com.labmaker.app;
import org.junit.Test;
import static org.junit.Assert.*;
import okhttp3.HttpUrl;
import java.net.*;
import javax.net.ssl.SSLHandshakeException;

public class SchoolNetworkPolicyTest {
    private boolean allowed(String path){return SchoolNetworkPolicy.allowed(HttpUrl.get("http://wlsy.xidian.edu.cn"+path),false);}
    @Test public void officialLoginAliases(){
        assertTrue(allowed("/phyews/"));
        assertTrue(allowed("/PhyEws/default.aspx"));
        assertTrue(allowed("/PhyEws/student/Student.aspx?"));
        assertTrue(allowed("/phyews/default.aspx?ReturnUrl=%2fphyews%2fstudent%2fstudent.aspx"));
    }
    @Test public void redirectBoundary(){
        assertTrue(allowed("/phyews/default.aspx?ReturnUrl=%2Fphyews%2Fstudent%2Fstudent.aspx&official=1"));
        assertTrue(allowed("/PhyEws/(F(official-session))/student/Student.aspx"));
        assertTrue(allowed("/new-official-login.aspx?state=official"));
        assertTrue(allowed("/phyews/unknown.aspx"));
        // A nested URL parameter is inert data. An actual redirect to that host is still rejected.
        assertTrue(allowed("/phyews/default.aspx?ReturnUrl=https%3A%2F%2Fexample.com"));
        assertFalse(SchoolNetworkPolicy.allowed(HttpUrl.get("http://example.com/phyews/"),false));
        assertFalse(SchoolNetworkPolicy.allowed(HttpUrl.get("http://wlsy.xidian.edu.cn:8080/phyews/"),false));
        assertFalse(SchoolNetworkPolicy.allowed(HttpUrl.get("http://user:pass@wlsy.xidian.edu.cn/phyews/"),false));
        assertFalse(SchoolNetworkPolicy.allowed(HttpUrl.get("http://127.0.0.1:58441/phyews/"),false));
        assertTrue(SchoolNetworkPolicy.allowed(HttpUrl.get("http://127.0.0.1:58441/phyews/"),true));
    }
    @Test public void diagnosticsDoNotEchoSecrets(){
        assertEquals("DNS",SchoolNetworkPolicy.failureCode(new UnknownHostException("password=secret")));
        assertEquals("TIMEOUT",SchoolNetworkPolicy.failureCode(new SocketTimeoutException("token=secret")));
        assertEquals("TLS",SchoolNetworkPolicy.failureCode(new SSLHandshakeException("secret")));
        assertTrue(SchoolNetworkPolicy.failureMessage("login",new ConnectException("secret")).contains("提交学校登录"));
        assertFalse(SchoolNetworkPolicy.failureMessage("login",new ConnectException("secret")).contains("secret"));
        assertEquals("/phyews/default.aspx",SchoolNetworkPolicy.blockedPath(HttpUrl.get("http://wlsy.xidian.edu.cn/phyews/default.aspx?password=secret")));
    }
}
