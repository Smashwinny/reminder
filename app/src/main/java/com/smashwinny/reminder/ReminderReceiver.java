package com.smashwinny.reminder;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

public class ReminderReceiver extends BroadcastReceiver {
    static final String CHANNEL_ID = "task_reminders";

    @Override public void onReceive(Context context, Intent intent) {
        android.content.SharedPreferences prefs = context.getSharedPreferences("tasks_v1", Context.MODE_PRIVATE);
        String user = prefs.getString("current_user_id", "");
        String id = intent.getStringExtra("id");
        Task active = null;
        try {
            org.json.JSONArray items = new org.json.JSONArray(prefs.getString(user.isEmpty() ? "items" : "items_" + user, "[]"));
            for (int i = 0; i < items.length(); i++) {
                Task task = Task.fromJson(items.getJSONObject(i));
                if (task.id.equals(id) && ReminderPolicy.shouldNotify(task, intent.getStringExtra("user"), user, System.currentTimeMillis())) { active = task; break; }
            }
        } catch (Exception error) { return; }
        if (active == null) return; // Deleted, completed, rescheduled, switched-account or legacy alarm.
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (!androidx.core.app.NotificationManagerCompat.from(context).areNotificationsEnabled()) return;
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(new NotificationChannel(CHANNEL_ID, "任务提醒", NotificationManager.IMPORTANCE_HIGH));
        }
        Intent open = new Intent(context, MainActivity.class);
        PendingIntent pending = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        android.app.Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new android.app.Notification.Builder(context, CHANNEL_ID)
                : new android.app.Notification.Builder(context);
        android.app.Notification notification = builder.setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("拾遗 · 该看看这件事了")
                .setContentText(active.text)
                .setVisibility(android.app.Notification.VISIBILITY_PRIVATE)
                .setContentIntent(pending).setAutoCancel(true).build();
        try { manager.notify(user + ":" + id, 1, notification); }
        catch (SecurityException ignored) { /* Notification permission may change while processing. */ }
    }
}
