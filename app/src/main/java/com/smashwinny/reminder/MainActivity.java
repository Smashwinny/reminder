package com.smashwinny.reminder;

import android.Manifest;
import android.app.AlarmManager;
import android.app.AlertDialog;
import android.app.DatePickerDialog;
import android.app.PendingIntent;
import android.app.TimePickerDialog;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONException;

import java.text.DateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

public class MainActivity extends android.app.Activity {
    private static final int BRAND = Color.rgb(38, 88, 73);
    private static final int BRAND_SOFT = Color.rgb(224, 235, 230);
    private static final int PAPER = Color.rgb(248, 247, 243);
    private static final int INK = Color.rgb(34, 39, 36);
    private static final int MUTED = Color.rgb(103, 113, 108);
    private static final int LINE = Color.rgb(226, 229, 225);
    private static final String PREFS = "tasks_v1";
    private final List<Task> tasks = new ArrayList<>();
    private LinearLayout list;
    private TextView summary;
    private EditText input;
    private int sortMode;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        load();
        requestNotificationPermission();
        renderScreen();
    }

    private void renderScreen() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(PAPER);
        LinearLayout root = column();
        root.setPadding(dp(20), dp(24), dp(20), dp(40));
        scroll.addView(root);

        LinearLayout brandRow = row();
        brandRow.setGravity(Gravity.CENTER_VERTICAL);
        TextView logo = text("✓", 18, Color.WHITE, Typeface.BOLD);
        logo.setGravity(Gravity.CENTER);
        logo.setBackground(roundRect(BRAND, 12));
        brandRow.addView(logo, new LinearLayout.LayoutParams(dp(36), dp(36)));
        LinearLayout brandCopy = column();
        brandCopy.setPadding(dp(10), 0, 0, 0);
        brandCopy.addView(text("渐明", 17, INK, Typeface.BOLD));
        brandCopy.addView(text("让重要的事保持可见", 12, MUTED, Typeface.NORMAL));
        brandRow.addView(brandCopy);
        root.addView(brandRow);

        TextView title = text("今天，先完成\n最值得的一件事。", 29, INK, Typeface.BOLD);
        title.setLineSpacing(0, 1.08f);
        LinearLayout.LayoutParams titleLp = matchWrap();
        titleLp.setMargins(0, dp(26), 0, dp(7));
        root.addView(title, titleLp);
        root.addView(text("粘贴即记录。颜色越深，越需要你的注意。", 15, MUTED, Typeface.NORMAL));

        LinearLayout capture = column();
        capture.setPadding(dp(16), dp(15), dp(16), dp(14));
        capture.setBackground(roundRect(Color.WHITE, 18, LINE, 1));
        capture.addView(text("快速收件箱", 12, BRAND, Typeface.BOLD));
        input = new EditText(this);
        input.setHint("粘贴课程、文章或任何要做的事…");
        input.setHintTextColor(Color.rgb(150, 157, 153));
        input.setTextColor(INK);
        input.setTextSize(16);
        input.setMinLines(3);
        input.setGravity(Gravity.TOP);
        input.setBackgroundColor(Color.TRANSPARENT);
        input.setPadding(0, dp(9), 0, dp(8));
        capture.addView(input, matchWrap());

        Button add = button("记录任务");
        add.setOnClickListener(v -> addTask());
        capture.addView(add);
        LinearLayout.LayoutParams captureLp = matchWrap();
        captureLp.setMargins(0, dp(22), 0, 0);
        root.addView(capture, captureLp);

        summary = text("", 18, INK, Typeface.BOLD);
        summary.setPadding(0, dp(30), 0, dp(12));
        root.addView(summary);

        LinearLayout sorts = row();
        String[] labels = {"按颜色", "按时间", "按提醒"};
        for (int i = 0; i < labels.length; i++) {
            final int mode = i;
            Button button = smallButton(labels[i]);
            button.setOnClickListener(v -> { sortMode = mode; refreshList(); });
            LinearLayout.LayoutParams sortLp = new LinearLayout.LayoutParams(0, dp(40), 1);
            if (i > 0) sortLp.setMargins(dp(7), 0, 0, 0);
            sorts.addView(button, sortLp);
        }
        root.addView(sorts);

        list = column();
        root.addView(list, matchWrap());
        setContentView(scroll);
        refreshList();
    }

    private void addTask() {
        String value = input.getText().toString().trim();
        if (value.isEmpty()) { Toast.makeText(this, "先粘贴或输入一件事", Toast.LENGTH_SHORT).show(); return; }
        tasks.add(0, new Task(System.currentTimeMillis(), value, System.currentTimeMillis()));
        input.setText("");
        save();
        refreshList();
    }

    private void refreshList() {
        list.removeAllViews();
        List<Task> shown = new ArrayList<>(tasks);
        if (sortMode == 0) Collections.sort(shown, Comparator.comparingInt(t -> t.state));
        else if (sortMode == 1) Collections.sort(shown, (a, b) -> Long.compare(b.createdAt, a.createdAt));
        else Collections.sort(shown, (a, b) -> Long.compare(a.reminderAt == 0 ? Long.MAX_VALUE : a.reminderAt, b.reminderAt == 0 ? Long.MAX_VALUE : b.reminderAt));
        int done = 0;
        for (Task task : tasks) if (task.state == Task.DONE) done++;
        summary.setText(tasks.isEmpty() ? "任务列表" : "任务 " + tasks.size() + " 项  ·  已完成 " + done + " 项");
        if (shown.isEmpty()) {
            LinearLayout empty = column();
            empty.setGravity(Gravity.CENTER_HORIZONTAL);
            empty.setPadding(dp(20), dp(28), dp(20), dp(28));
            empty.setBackground(roundRect(Color.WHITE, 18, LINE, 1));
            ImageView image = new ImageView(this);
            image.setImageResource(R.drawable.ic_empty_tasks);
            empty.addView(image, new LinearLayout.LayoutParams(dp(64), dp(64)));
            TextView emptyTitle = text("先把第一件事放进来", 16, INK, Typeface.BOLD);
            emptyTitle.setPadding(0, dp(12), 0, dp(5));
            empty.addView(emptyTitle);
            TextView emptyBody = text("不必规划得很完美，记录下来就不会遗忘。", 13, MUTED, Typeface.NORMAL);
            emptyBody.setGravity(Gravity.CENTER);
            empty.addView(emptyBody);
            list.addView(empty);
            return;
        }
        for (Task task : shown) list.addView(taskView(task));
    }

    private View taskView(Task task) {
        LinearLayout card = row();
        card.setGravity(Gravity.CENTER_VERTICAL);
        card.setPadding(dp(13), dp(14), dp(12), dp(14));
        card.setBackground(roundRect(Color.WHITE, 16, LINE, 1));
        card.setOnClickListener(v -> openTask(task));
        LinearLayout.LayoutParams cardLp = matchWrap();
        cardLp.setMargins(0, 0, 0, dp(9));
        card.setLayoutParams(cardLp);

        View mark = new View(this);
        mark.setBackground(roundRect(withAlpha(BRAND, new int[]{255, 200, 125, 48}[task.state]), 99));
        card.addView(mark, new LinearLayout.LayoutParams(dp(7), dp(58)));

        LinearLayout copy = column();
        copy.setPadding(dp(12), 0, dp(8), 0);
        String firstLine = task.text.split("\\n", 2)[0];
        TextView taskText = text(firstLine, 16, task.state == Task.DONE ? Color.GRAY : INK, Typeface.BOLD);
        if (task.state == Task.DONE) taskText.setPaintFlags(taskText.getPaintFlags() | android.graphics.Paint.STRIKE_THRU_TEXT_FLAG);
        copy.addView(taskText);
        String stateName = new String[]{"未查看", "进行中", "已查看", "已完成"}[task.state];
        String meta = stateName + " · " + DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(task.createdAt);
        if (task.reminderAt > 0) meta += "\n提醒 " + DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(task.reminderAt);
        TextView metaView = text(meta, 12, MUTED, Typeface.NORMAL);
        metaView.setPadding(0, dp(6), 0, 0);
        copy.addView(metaView);
        card.addView(copy, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        if (task.state != Task.DONE) {
            Button done = smallButton("完成");
            done.setOnClickListener(v -> { task.state = Task.DONE; cancelAlarm(task); save(); refreshList(); });
            card.addView(done);
        }
        return card;
    }

    private void openTask(Task task) {
        if (task.state == Task.NEW) { task.state = Task.SEEN; save(); refreshList(); }
        String[] actions = task.state == Task.DONE
                ? new String[]{"恢复任务", "删除任务"}
                : new String[]{"开始任务", "设置提醒", "完成任务", "删除任务"};
        new AlertDialog.Builder(this).setTitle(task.text).setItems(actions, (dialog, which) -> {
            if (task.state == Task.DONE) {
                if (which == 0) task.state = Task.SEEN; else removeTask(task);
            } else if (which == 0) task.state = Task.DOING;
            else if (which == 1) chooseReminder(task);
            else if (which == 2) { task.state = Task.DONE; cancelAlarm(task); }
            else removeTask(task);
            save(); refreshList();
        }).setNegativeButton("关闭", null).show();
    }

    private void removeTask(Task task) { cancelAlarm(task); tasks.remove(task); }

    private void chooseReminder(Task task) {
        Calendar calendar = Calendar.getInstance();
        new DatePickerDialog(this, (view, year, month, day) -> {
            calendar.set(year, month, day);
            new TimePickerDialog(this, (timeView, hour, minute) -> {
                calendar.set(Calendar.HOUR_OF_DAY, hour); calendar.set(Calendar.MINUTE, minute); calendar.set(Calendar.SECOND, 0);
                if (calendar.getTimeInMillis() <= System.currentTimeMillis()) { Toast.makeText(this, "提醒时间需要晚于现在", Toast.LENGTH_SHORT).show(); return; }
                task.reminderAt = calendar.getTimeInMillis();
                scheduleAlarm(task); save(); refreshList();
            }, calendar.get(Calendar.HOUR_OF_DAY), calendar.get(Calendar.MINUTE), true).show();
        }, calendar.get(Calendar.YEAR), calendar.get(Calendar.MONTH), calendar.get(Calendar.DAY_OF_MONTH)).show();
    }

    private PendingIntent alarmIntent(Task task) {
        Intent intent = new Intent(this, ReminderReceiver.class).putExtra("id", task.id).putExtra("text", task.text);
        return PendingIntent.getBroadcast(this, (int) task.id, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private void scheduleAlarm(Task task) {
        ((AlarmManager) getSystemService(ALARM_SERVICE)).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, task.reminderAt, alarmIntent(task));
    }

    private void cancelAlarm(Task task) { ((AlarmManager) getSystemService(ALARM_SERVICE)).cancel(alarmIntent(task)); }

    private void load() {
        String raw = getSharedPreferences(PREFS, MODE_PRIVATE).getString("items", "[]");
        try { JSONArray array = new JSONArray(raw); for (int i = 0; i < array.length(); i++) tasks.add(Task.fromJson(array.getJSONObject(i))); }
        catch (JSONException ignored) { Toast.makeText(this, "任务数据读取失败", Toast.LENGTH_LONG).show(); }
    }

    private void save() {
        JSONArray array = new JSONArray();
        try { for (Task task : tasks) array.put(task.toJson()); getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString("items", array.toString()).apply(); }
        catch (JSONException ignored) { Toast.makeText(this, "任务保存失败", Toast.LENGTH_LONG).show(); }
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 7);
    }

    private LinearLayout column() { LinearLayout v = new LinearLayout(this); v.setOrientation(LinearLayout.VERTICAL); return v; }
    private LinearLayout row() { LinearLayout v = new LinearLayout(this); v.setOrientation(LinearLayout.HORIZONTAL); return v; }
    private TextView text(String value, int sp, int color, int style) { TextView v = new TextView(this); v.setText(value); v.setTextSize(sp); v.setTextColor(color); v.setTypeface(Typeface.DEFAULT, style); return v; }
    private Button button(String value) { Button b = new Button(this); b.setText("＋  " + value); b.setTextColor(Color.WHITE); b.setTextSize(14); b.setTypeface(Typeface.DEFAULT, Typeface.BOLD); b.setAllCaps(false); b.setBackground(roundRect(BRAND, 12)); return b; }
    private Button smallButton(String value) { Button b = new Button(this); b.setText(value); b.setTextColor(BRAND); b.setTextSize(12); b.setTypeface(Typeface.DEFAULT, Typeface.BOLD); b.setAllCaps(false); b.setBackground(roundRect(BRAND_SOFT, 99)); return b; }
    private GradientDrawable roundRect(int color, int radiusDp) { return roundRect(color, radiusDp, Color.TRANSPARENT, 0); }
    private GradientDrawable roundRect(int color, int radiusDp, int strokeColor, int strokeDp) { GradientDrawable d = new GradientDrawable(); d.setColor(color); d.setCornerRadius(dp(radiusDp)); if (strokeDp > 0) d.setStroke(dp(strokeDp), strokeColor); return d; }
    private LinearLayout.LayoutParams matchWrap() { return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private int withAlpha(int color, int alpha) { return Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color)); }
}
