package com.labmaker.app;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.widget.TextView;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;

/** An external UID receiving a real temporary FileProvider grant. Local test build only. */
public final class NativeFileReceiverActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        JSONObject receipt = new JSONObject();
        try {
            Intent intent = getIntent();
            Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (!Intent.ACTION_SEND.equals(intent.getAction()) || uri == null ||
                !"content".equals(uri.getScheme()) || !"com.labmaker.app.fileprovider".equals(uri.getAuthority()))
                throw new IllegalArgumentException("Only the local main app test export is accepted");
            String name = "";
            try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
            }
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (InputStream input = getContentResolver().openInputStream(uri)) {
                if (input == null) throw new IllegalStateException("Missing exported stream");
                byte[] buffer = new byte[8192]; int count;
                while ((count = input.read(buffer)) != -1) {
                    if (bytes.size() + count > 1024 * 1024) throw new IllegalArgumentException("Test file exceeds 1 MiB");
                    bytes.write(buffer, 0, count);
                }
            }
            receipt.put("ok", true).put("name", name).put("mime", getContentResolver().getType(uri))
                .put("readGrant", (intent.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0)
                .put("base64", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP));
        } catch (Exception error) {
            try { receipt.put("ok", false).put("error", error.toString()); } catch (Exception ignored) { }
        }
        try (FileOutputStream output = new FileOutputStream(new File(getFilesDir(), "received-file.json"))) {
            output.write(receipt.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
        } catch (Exception error) { throw new IllegalStateException(error); }
        TextView text = new TextView(this);
        text.setText("文件已接收，仅本地验收\n返回实验搭子继续");
        text.setTextSize(22); text.setPadding(32, 48, 32, 32);
        text.setOnClickListener(view -> finish()); setContentView(text);
    }
}
