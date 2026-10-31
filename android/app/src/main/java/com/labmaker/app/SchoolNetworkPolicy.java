package com.labmaker.app;

import java.net.*;
import java.io.*;
import java.util.*;
import javax.net.ssl.SSLException;
import okhttp3.HttpUrl;

/** Fixed school origin, with unrestricted official redirect paths and queries. */
final class SchoolNetworkPolicy {
    static boolean loginEntry(HttpUrl u) {
        String path=u.encodedPath().toLowerCase(Locale.ROOT);
        return path.equals("/phyews/")||path.equals("/phyews/default.aspx");
    }
    static boolean allowed(HttpUrl u, boolean mock) {
        if(!u.username().isEmpty()||!u.password().isEmpty()||u.fragment()!=null)return false;
        if(mock ? !u.host().equals("127.0.0.1")||u.port()!=58441||!u.scheme().equals("http") :
            !u.host().equals("wlsy.xidian.edu.cn")||u.port()!=(u.isHttps()?443:80)||!(u.scheme().equals("http")||u.isHttps()))return false;
        // Redirect paths and query parameters are owned by the school, not a per-page allowlist.
        // Raw plugin operations still map to fixed endpoints; only redirects may vary within this origin.
        return true;
    }
    static String stage(String operation) {
        switch(operation) {
            case "loginPage":return "打开官网登录页";
            case "login":return "提交学校登录";
            case "overview":return "读取账号信息";
            case "enrolled":return "读取已选课表";
            case "cancellable":return "核对退课状态";
            case "allowedWeeks":return "读取允许周次";
            default:return operation.startsWith("rooms")?"读取教室":operation.startsWith("schedule")?"读取教师":"读取场次";
        }
    }
    static String failureCode(Exception e) {
        if(e instanceof UnknownHostException)return "DNS";
        if(e instanceof SocketTimeoutException || e instanceof InterruptedIOException)return "TIMEOUT";
        if(e instanceof SSLException)return "TLS";
        if(e instanceof ConnectException || e instanceof NoRouteToHostException)return "CONNECT";
        if(e instanceof java.net.UnknownServiceException)return "NETWORK_POLICY";
        return "NETWORK";
    }
    static String failureMessage(String operation,Exception e) {
        String reason;
        switch(failureCode(e)) {
            case "DNS":reason="无法解析官网域名，请连接校园网后重试";break;
            case "TIMEOUT":reason="连接或读取超时，请连接校园网并重试";break;
            case "CONNECT":reason="无法连接官网，请确认校园网已连接且已认证";break;
            case "TLS":reason="官网安全连接握手失败，请核对系统时间或稍后重试";break;
            case "NETWORK_POLICY":reason="系统阻止了官网网络连接，请反馈此错误";break;
            default:reason="网络连接中断，请确认校园网可访问官网后重试";
        }
        return stage(operation)+"失败："+reason+"（"+failureCode(e)+"）";
    }
    static String blockedPath(HttpUrl url) {
        // Deliberately omit host, query, credentials and form data from user-facing diagnostics.
        String path=url.encodedPath();
        return path.length()>100?"路径过长":path.replaceAll("[^A-Za-z0-9/_.%-]","?");
    }
}
