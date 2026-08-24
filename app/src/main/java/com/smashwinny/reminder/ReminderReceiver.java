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
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(new NotificationChannel(CHANNEL_ID, "任务提醒", NotificationManager.IMPORTANCE_HIGH));
        }
        Intent open = new Intent(context, MainActivity.class);
        PendingIntent pending = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        android.app.Notification notification = new android.app.Notification.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("渐明 · 该看看这件事了")
                .setContentText(intent.getStringExtra("text"))
                .setContentIntent(pending).setAutoCancel(true).build();
        manager.notify((int) intent.getLongExtra("id", 1), notification);
    }
}
