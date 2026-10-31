package com.labmaker.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.core.content.FileProvider;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.security.MessageDigest;
import java.util.Arrays;

/** Tests native installer APIs for the disposable package only. No main-app install. */
public final class NativeInstallerActivity extends Activity {
    private File candidate;
    private JSONObject receipt;
    private void save() throws Exception {
        try (FileOutputStream out = new FileOutputStream(new File(getFilesDir(), "installer-receipt.json"))) {
            out.write(receipt.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
        }
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (!"com.labmaker.app.acceptance".equals(getPackageName())) throw new IllegalStateException("Test package required");
        receipt = new JSONObject();
        LinearLayout layout = new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);layout.setPadding(32,48,32,32);
        TextView title=new TextView(this);title.setText("本地系统安装验收");title.setTextSize(22);layout.addView(title);
        try {
            candidate = new File(getCacheDir(), "local-installer-acceptance.apk");
            int flags=Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;
            PackageInfo installed=getPackageManager().getPackageInfo(getPackageName(),flags);
            PackageInfo archive=getPackageManager().getPackageArchiveInfo(candidate.getAbsolutePath(),flags);
            if(archive==null||!getPackageName().equals(archive.packageName))throw new IllegalArgumentException("Only the disposable test APK is allowed");
            byte[] a=Build.VERSION.SDK_INT>=28?installed.signingInfo.getApkContentsSigners()[0].toByteArray():installed.signatures[0].toByteArray();
            byte[] b=Build.VERSION.SDK_INT>=28?archive.signingInfo.getApkContentsSigners()[0].toByteArray():archive.signatures[0].toByteArray();
            if(!Arrays.equals(a,b))throw new IllegalArgumentException("Test certificate differs");
            receipt.put("package",archive.packageName).put("version",archive.versionName).put("code",Build.VERSION.SDK_INT>=28?archive.getLongVersionCode():archive.versionCode)
                .put("minAndroid",archive.applicationInfo.minSdkVersion).put("bytes",candidate.length())
                .put("certificateSha256",MobileAppDownload.hex(MessageDigest.getInstance("SHA-256").digest(a)));
            save();
            Button settings=new Button(this);settings.setText("打开测试包安装授权");settings.setOnClickListener(v->{
                startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getPackageName())));
            });layout.addView(settings);
            Button install=new Button(this);install.setText("打开测试包系统安装页");install.setOnClickListener(v->{
                try {
                    boolean allowed=Build.VERSION.SDK_INT<26||getPackageManager().canRequestPackageInstalls();
                    receipt.put("sourceAllowed",allowed);save();if(!allowed){title.setText("需要先授权测试包");return;}
                    Uri uri=FileProvider.getUriForFile(this,getPackageName()+".fileprovider",candidate);
                    Intent intent=new Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    intent.setClipData(ClipData.newRawUri("本地测试包",uri));startActivity(intent);
                    receipt.put("installerOpened",true);save();
                }catch(Exception error){title.setText(error.toString());}
            });layout.addView(install);
        }catch(Exception error){title.setText(error.toString());}
        setContentView(layout);
    }
}
