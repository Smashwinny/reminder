package com.smashwinny.reminder;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

final class UpdateChecker {
    private static final String PREFS = "app_updates";
    private static boolean installing;

    private UpdateChecker() {}

    static final class Config {
        final String manifestUrl;
        final String appName;
        final long checkIntervalMs;

        Config(String manifestUrl, String appName) { this(manifestUrl, appName, 24L * 60 * 60 * 1000); }
        Config(String manifestUrl, String appName, long checkIntervalMs) {
            this.manifestUrl = manifestUrl;
            this.appName = appName;
            this.checkIntervalMs = Math.max(60_000, checkIntervalMs);
        }
    }

    static void checkPeriodically(Activity activity, Config config) {
        SharedPreferences prefs = activity.getSharedPreferences(PREFS, Activity.MODE_PRIVATE);
        long now = System.currentTimeMillis();
        if (now - prefs.getLong("last_check_at", 0) < config.checkIntervalMs) return;
        prefs.edit().putLong("last_check_at", now).apply();
        new Thread(() -> load(activity, config, false)).start();
    }

    static void checkNow(Activity activity, Config config) { new Thread(() -> load(activity, config, true)).start(); }

    static void resumePendingInstall(Activity activity) {
        installing = false;
        SharedPreferences prefs = activity.getSharedPreferences(PREFS, Activity.MODE_PRIVATE);
        String path = prefs.getString("pending_apk", "");
        int target = prefs.getInt("pending_version", 0);
        if (path.isEmpty()) return;
        if (installedVersion(activity) >= target) {
            new File(path).delete();
            prefs.edit().remove("pending_apk").remove("pending_version").apply();
            return;
        }
        if (Build.VERSION.SDK_INT < 26 || activity.getPackageManager().canRequestPackageInstalls()) install(activity, new File(path));
    }

    private static void load(Activity activity, Config config, boolean showCurrent) {
        HttpURLConnection connection = null;
        try {
            URL manifest = officialHttps(config.manifestUrl, null);
            connection = open(manifest, "application/json");
            if (connection.getResponseCode() != 200) throw new IllegalStateException("更新服务暂时不可用");
            StringBuilder raw = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                String line; while ((line = reader.readLine()) != null) raw.append(line);
            }
            JSONObject release = new JSONObject(raw.toString());
            if (!activity.getPackageName().equals(release.getString("applicationId"))) throw new SecurityException("更新包标识不匹配");
            int latest = release.getInt("versionCode");
            if (latest <= installedVersion(activity)) {
                if (showCurrent) activity.runOnUiThread(() -> message(activity, "已经是最新版本"));
                return;
            }
            URL apk = officialHttps(release.getString("apkUrl"), manifest.getHost());
            String version = release.optString("versionName", String.valueOf(latest));
            String notes = release.optString("notes", "包含体验优化与问题修复");
            String sha256 = release.getString("sha256");
            boolean required = release.optBoolean("required", false);
            activity.runOnUiThread(() -> showUpdate(activity, config.appName, latest, version, notes, apk.toString(), sha256, required, manifest.getHost()));
        } catch (Exception ignored) {
            if (showCurrent) activity.runOnUiThread(() -> message(activity, "暂时无法检查更新，请稍后再试"));
        } finally { if (connection != null) connection.disconnect(); }
    }

    private static void showUpdate(Activity activity, String appName, int versionCode, String version, String notes, String apkUrl, String sha256, boolean required, String trustedHost) {
        AlertDialog.Builder dialog = new AlertDialog.Builder(activity).setTitle(appName + "有新版本 " + version).setMessage(notes)
                .setPositiveButton("下载升级", (d, which) -> download(activity, appName, versionCode, apkUrl, sha256, trustedHost));
        if (!required) dialog.setNegativeButton("稍后提醒", null);
        dialog.setCancelable(!required).show();
    }

    private static void download(Activity activity, String appName, int versionCode, String apkUrl, String expectedSha256, String trustedHost) {
        Toast.makeText(activity, "正在安全下载更新…", Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            HttpURLConnection connection = null;
            File next = null;
            try {
                File dir = new File(activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "updates");
                if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("无法创建更新目录");
                String safeName = activity.getPackageName().replaceAll("[^A-Za-z0-9._-]", "_");
                next = new File(dir, safeName + "-" + versionCode + ".apk.next");
                File apk = new File(dir, safeName + "-" + versionCode + ".apk");
                connection = open(officialHttps(apkUrl, trustedHost), "application/vnd.android.package-archive");
                if (connection.getResponseCode() != 200) throw new IllegalStateException("下载失败");
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(next)) {
                    byte[] buffer = new byte[32 * 1024]; int count;
                    while ((count = input.read(buffer)) != -1) { output.write(buffer, 0, count); digest.update(buffer, 0, count); }
                }
                if (!hex(digest.digest()).equalsIgnoreCase(expectedSha256)) throw new SecurityException("更新文件校验失败");
                if (apk.exists() && !apk.delete()) throw new IllegalStateException("无法替换旧更新包");
                if (!next.renameTo(apk)) throw new IllegalStateException("无法保存更新包");
                activity.getSharedPreferences(PREFS, Activity.MODE_PRIVATE).edit().putString("pending_apk", apk.getAbsolutePath()).putInt("pending_version", versionCode).apply();
                activity.runOnUiThread(() -> requestInstall(activity, appName, apk));
            } catch (Exception error) {
                if (next != null) next.delete();
                activity.runOnUiThread(() -> message(activity, "更新下载失败，请稍后重试"));
            } finally { if (connection != null) connection.disconnect(); }
        }).start();
    }

    private static void requestInstall(Activity activity, String appName, File apk) {
        if (Build.VERSION.SDK_INT >= 26 && !activity.getPackageManager().canRequestPackageInstalls()) {
            new AlertDialog.Builder(activity).setTitle("允许" + appName + "安装更新")
                    .setMessage("首次升级需要开启一次“允许来自此来源的应用”。开启后返回" + appName + "，安装页面会自动继续。")
                    .setPositiveButton("去开启", (d, which) -> activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName()))))
                    .setNegativeButton("稍后", null).show();
            return;
        }
        install(activity, apk);
    }

    private static void install(Activity activity, File apk) {
        if (installing || !apk.isFile()) return;
        installing = true;
        Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".updates", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try { activity.startActivity(intent); } catch (Exception error) { installing = false; message(activity, "无法打开系统安装器"); }
    }

    private static HttpURLConnection open(URL url, String accept) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(10_000); connection.setReadTimeout(30_000);
        connection.setRequestProperty("Accept", accept); return connection;
    }

    private static URL officialHttps(String value, String expectedHost) throws Exception {
        URL url = new URL(value);
        if (!"https".equalsIgnoreCase(url.getProtocol()) || url.getUserInfo() != null || url.getHost().isEmpty()) throw new SecurityException("只允许官方 HTTPS 更新地址");
        if (expectedHost != null && !expectedHost.equalsIgnoreCase(url.getHost())) throw new SecurityException("更新包必须与清单来自同一官方域名");
        return url;
    }

    private static int installedVersion(Activity activity) {
        try {
            PackageInfo info = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
            long value = Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
            return value > Integer.MAX_VALUE ? Integer.MAX_VALUE : (int) value;
        } catch (Exception ignored) { return Integer.MAX_VALUE; }
    }

    private static String hex(byte[] bytes) { StringBuilder out = new StringBuilder(); for (byte value : bytes) out.append(String.format("%02x", value)); return out.toString(); }
    private static void message(Activity activity, String value) { new AlertDialog.Builder(activity).setMessage(value).setPositiveButton("知道了", null).show(); }
}
