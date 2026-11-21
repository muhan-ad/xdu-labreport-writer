package com.labmaker.app;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.ExifInterface;
import android.os.Build;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Enumeration;
import java.util.Locale;
import java.util.zip.Deflater;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;

/** Shrinks only the private upload copy, before it is hashed and shown for confirmation. */
final class ReportUploadImages {
  private static final int MIN_JPEG_BYTES = 256 * 1024;
  private static final int MAX_JPEG_BYTES = 8 * 1024 * 1024;
  private static final long MAX_DECODE_PIXELS = 16_000_000L;
  private static final long MAX_EXPANDED_BYTES = 256L * 1024 * 1024;
  private static final int JPEG_QUALITY = 95;

  private ReportUploadImages() {}

  static void optimize(File snapshot) {
    File candidate = new File(snapshot.getParentFile(), "optimized.docx");
    try {
      boolean changed;
      try (ZipFile zip = new ZipFile(snapshot)) {
        if (!canOptimize(zip)) return;
        changed = rewrite(zip, candidate);
      }
      if (changed && candidate.length() < snapshot.length()) candidate.renameTo(snapshot);
    } catch (IOException | RuntimeException ignored) {
      // The validated upload copy is still available if optimization is unsupported.
    } finally {
      candidate.delete();
    }
  }

  private static boolean canOptimize(ZipFile zip) {
    boolean hasPhoto = false;
    long bytes = 0;
    for (Enumeration<? extends ZipEntry> entries = zip.entries(); entries.hasMoreElements();) {
      ZipEntry entry = entries.nextElement();
      long size = entry.getSize();
      if (size < 0 || size > MAX_EXPANDED_BYTES - bytes) return false;
      bytes += size;
      hasPhoto |= eligible(entry);
    }
    return hasPhoto;
  }

  private static boolean eligible(ZipEntry entry) {
    String name = entry.getName().toLowerCase(Locale.ROOT);
    return name.startsWith("word/media/") && (name.endsWith(".jpg") || name.endsWith(".jpeg"))
        && entry.getSize() >= MIN_JPEG_BYTES && entry.getSize() <= MAX_JPEG_BYTES;
  }

  private static boolean rewrite(ZipFile zip, File candidate) throws IOException {
    boolean changed = false;
    try (ZipOutputStream out = new ZipOutputStream(new FileOutputStream(candidate))) {
      out.setLevel(Deflater.BEST_SPEED);
      byte[] buffer = new byte[65536];
      for (Enumeration<? extends ZipEntry> entries = zip.entries(); entries.hasMoreElements();) {
        ZipEntry original = entries.nextElement();
        ZipEntry entry = new ZipEntry(original.getName());
        if (original.getTime() >= 0) entry.setTime(original.getTime());
        out.putNextEntry(entry);
        try (InputStream in = zip.getInputStream(original)) {
          if (eligible(original)) {
            byte[] bytes = readJpeg(in, (int) original.getSize());
            byte[] smaller = compressJpeg(bytes);
            out.write(smaller != null ? smaller : bytes);
            changed |= smaller != null;
          } else {
            int count;
            while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
          }
        }
        out.closeEntry();
      }
    }
    return changed;
  }

  private static byte[] readJpeg(InputStream in, int size) throws IOException {
    byte[] bytes = new byte[size];
    int offset = 0;
    while (offset < size) {
      int count = in.read(bytes, offset, size - offset);
      if (count == -1) throw new IOException("图片长度不一致");
      offset += count;
    }
    if (in.read() != -1) throw new IOException("图片长度不一致");
    return bytes;
  }

  private static byte[] compressJpeg(byte[] bytes) {
    BitmapFactory.Options bounds = new BitmapFactory.Options();
    bounds.inJustDecodeBounds = true;
    BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
    if (!"image/jpeg".equals(bounds.outMimeType) || bounds.outWidth < 1 || bounds.outHeight < 1
        || (long) bounds.outWidth * bounds.outHeight > MAX_DECODE_PIXELS) return null;
    try {
      ExifInterface exif = new ExifInterface(new ByteArrayInputStream(bytes));
      int orientation = exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
      if (orientation != ExifInterface.ORIENTATION_NORMAL && orientation != ExifInterface.ORIENTATION_UNDEFINED)
        return null;
    } catch (IOException ignored) {
      return null;
    }
    Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
    if (bitmap == null) return null;
    try {
      ByteArrayOutputStream output = new ByteArrayOutputStream(bytes.length / 2);
      if (!bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, output)
          || output.size() > bytes.length * 9 / 10) return null;
      byte[] result = output.toByteArray();
      if (Build.VERSION.SDK_INT >= 26 && bounds.outColorSpace != null && !bounds.outColorSpace.isSrgb()) {
        BitmapFactory.Options encoded = new BitmapFactory.Options();
        encoded.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(result, 0, result.length, encoded);
        if (!bounds.outColorSpace.equals(encoded.outColorSpace)) return null;
      }
      return result;
    } finally {
      bitmap.recycle();
    }
  }
}
