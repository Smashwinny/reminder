package com.smashwinny.reminder;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import org.json.JSONArray;

public final class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        String raw = context.getSharedPreferences("tasks_v1", Context.MODE_PRIVATE).getString("items", "[]");
        long now = System.currentTimeMillis();
        try {
            JSONArray array = new JSONArray(raw);
            AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            for (int i = 0; i < array.length(); i++) {
                Task task = Task.fromJson(array.getJSONObject(i));
                if (task.deleted || task.state == Task.DONE || task.reminderAt <= now) continue;
                Intent reminder = new Intent(context, ReminderReceiver.class)
                        .putExtra("id", task.id).putExtra("text", task.text);
                PendingIntent pending = PendingIntent.getBroadcast(context, task.id.hashCode(), reminder,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, task.reminderAt, pending);
            }
        } catch (Exception ignored) {
            // MainActivity will surface malformed local data when the user opens the app.
        }
    }
}
