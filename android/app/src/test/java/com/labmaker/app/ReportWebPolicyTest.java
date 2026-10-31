package com.labmaker.app;
import org.junit.Test;
import static org.junit.Assert.*;
public class ReportWebPolicyTest {
 @Test public void credentialDocumentsStayWithinReport(){assertTrue(ReportWebPolicy.document("http://wlsy.xidian.edu.cn/wgyreport/wgyreport.dll/?id=stu",false));assertTrue(ReportWebPolicy.document("https://wlsy.xidian.edu.cn/wgyreport/new",false));assertFalse(ReportWebPolicy.document("http://wlsy.xidian.edu.cn/PhyEws/default.aspx",false));assertFalse(ReportWebPolicy.document("http://u:p@wlsy.xidian.edu.cn/wgyreport/",false));assertFalse(ReportWebPolicy.document("http://wlsy.xidian.edu.cn:81/wgyreport/",false));}
 @Test public void debugAddressCannotEscapeToNetwork(){assertTrue(ReportWebPolicy.document("http://127.0.0.1:58442/wgyreport/mock",true));assertFalse(ReportWebPolicy.document("http://127.0.0.1:58441/wgyreport/mock",true));assertFalse(ReportWebPolicy.document("http://127.0.0.1:58442/wgyreport/mock",false));assertFalse(ReportWebPolicy.document("http://wlsy.xidian.edu.cn/wgyreport/",true));}
 @Test public void publicResourcesCannotReceiveFormPosts(){assertTrue(ReportWebPolicy.resource("https://cdn.falconsistemas.com.br/falcon/a.js","GET",false));assertFalse(ReportWebPolicy.resource("https://cdn.falconsistemas.com.br/falcon/a.js","POST",false));assertFalse(ReportWebPolicy.resource("https://evil.example/a.js","GET",false));assertFalse(ReportWebPolicy.resource("file:///data/private","GET",false));}
}
