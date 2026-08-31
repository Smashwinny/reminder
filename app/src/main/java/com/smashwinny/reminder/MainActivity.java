package com.smashwinny.reminder;

import android.Manifest;
import android.animation.ValueAnimator;
import android.app.AlarmManager;
import android.app.AlertDialog;
import android.app.DatePickerDialog;
import android.app.PendingIntent;
import android.app.TimePickerDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.database.Cursor;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.text.Editable;
import android.text.TextWatcher;
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
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.DateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

public class MainActivity extends android.app.Activity {
    private static final int BRAND = Color.rgb(38, 88, 73);
    private static final int BRAND_SOFT = Color.rgb(224, 235, 230);
    private static final int PAPER = Color.rgb(248, 247, 243);
    private static final int INK = Color.rgb(34, 39, 36);
    private static final int MUTED = Color.rgb(103, 113, 108);
    private static final int LINE = Color.rgb(226, 229, 225);
    private static final int NEW_FILL = Color.rgb(255, 226, 226);
    private static final int NEW_STRONG = Color.rgb(199, 62, 62);
    private static final int SEEN_FILL = Color.rgb(223, 235, 255);
    private static final int SEEN_STRONG = Color.rgb(57, 105, 178);
    private static final int DOING_FILL = Color.rgb(255, 242, 191);
    private static final int DOING_STRONG = Color.rgb(160, 115, 16);
    private static final int DONE_FILL = Color.rgb(221, 243, 226);
    private static final int DONE_STRONG = Color.rgb(43, 126, 70);
    private static final String PREFS = "tasks_v1";
    private static final long AUTO_SYNC_DELAY_MS = 900;
    private final List<Task> tasks = new ArrayList<>();
    private final List<String> stableOrder = new ArrayList<>();
    private LinearLayout list;
    private LinearLayout completedList;
    private TextView summary;
    private EditText input;
    private EditText searchInput;
    private TextView attachmentStatus;
    private Uri pendingAttachmentUri;
    private String pendingAttachmentType = "";
    private String pendingAttachmentName = "";
    private static final int PICK_IMAGE = 31;
    private static final int PICK_VIDEO = 32;
    private int sortMode;
    private TextView syncStatus;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private boolean syncInProgress;
    private boolean syncAgain;
    private final Runnable automaticSync = () -> {
        String server = getSharedPreferences(PREFS, MODE_PRIVATE).getString("sync_url", "").trim();
        String token = getSharedPreferences(PREFS, MODE_PRIVATE).getString("auth_token", "").trim();
        if (!server.isEmpty() && !token.isEmpty()) syncNow(server, token, "merge", true);
    };

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        load();
        sortMode = getSharedPreferences(PREFS, MODE_PRIVATE).getInt("sort_mode", 0);
        requestNotificationPermission();
        renderScreen();
        scheduleAutoSync(250);
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
        brandCopy.addView(text("拾遗", 17, INK, Typeface.BOLD));
        brandCopy.addView(text("让重要的事保持可见", 12, MUTED, Typeface.NORMAL));
        brandRow.addView(brandCopy, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button sync = smallButton("同步");
        sync.setOnClickListener(v -> showSyncDialog());
        brandRow.addView(sync, new LinearLayout.LayoutParams(dp(76), dp(40)));
        root.addView(brandRow);

        syncStatus = text(syncStatusText(), 12, MUTED, Typeface.NORMAL);
        syncStatus.setPadding(0, dp(9), 0, 0);
        root.addView(syncStatus);

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
        LinearLayout attachmentActions = row();
        Button addImage = smallButton("添加图片");
        Button addVideo = smallButton("添加视频");
        addImage.setOnClickListener(v -> chooseAttachment("image/*", PICK_IMAGE));
        addVideo.setOnClickListener(v -> chooseAttachment("video/*", PICK_VIDEO));
        attachmentActions.addView(addImage, new LinearLayout.LayoutParams(0, dp(40), 1));
        LinearLayout.LayoutParams videoLp = new LinearLayout.LayoutParams(0, dp(40), 1);
        videoLp.setMargins(dp(8), 0, 0, 0);
        attachmentActions.addView(addVideo, videoLp);
        LinearLayout.LayoutParams attachmentLp = matchWrap();
        attachmentLp.setMargins(0, dp(8), 0, 0);
        capture.addView(attachmentActions, attachmentLp);
        attachmentStatus = text("附件保留在手机原位置，不计入任务同步流量", 11, MUTED, Typeface.NORMAL);
        attachmentStatus.setPadding(0, dp(6), 0, 0);
        capture.addView(attachmentStatus);
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
            button.setOnClickListener(v -> {
                sortMode = mode;
                getSharedPreferences(PREFS, MODE_PRIVATE).edit().putInt("sort_mode", sortMode).apply();
                refreshList(true);
            });
            LinearLayout.LayoutParams sortLp = new LinearLayout.LayoutParams(0, dp(40), 1);
            if (i > 0) sortLp.setMargins(dp(7), 0, 0, 0);
            sorts.addView(button, sortLp);
        }
        root.addView(sorts);

        searchInput = new EditText(this);
        searchInput.setHint("搜索任务或摘要中的关键词…");
        searchInput.setSingleLine(true);
        searchInput.setTextColor(INK);
        searchInput.setHintTextColor(MUTED);
        searchInput.setTextSize(14);
        searchInput.setPadding(dp(14), 0, dp(14), 0);
        searchInput.setBackground(roundRect(Color.WHITE, 12, LINE, 1));
        LinearLayout.LayoutParams searchLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(44));
        searchLp.setMargins(0, dp(10), 0, dp(14));
        root.addView(searchInput, searchLp);
        searchInput.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            public void onTextChanged(CharSequence s, int start, int before, int count) { refreshList(true); }
            public void afterTextChanged(Editable s) {}
        });

        list = column();
        root.addView(list, matchWrap());
        TextView completedTitle = text("已完成", 16, MUTED, Typeface.BOLD);
        completedTitle.setPadding(0, dp(22), 0, dp(10));
        root.addView(completedTitle);
        completedList = column();
        root.addView(completedList, matchWrap());
        setContentView(scroll);
        refreshList(true);
    }

    private void addTask() {
        String value = input.getText().toString().trim();
        if (value.isEmpty() && pendingAttachmentUri == null) { Toast.makeText(this, "先输入一件事或添加附件", Toast.LENGTH_SHORT).show(); return; }
        long now = System.currentTimeMillis();
        Task task = new Task(UUID.randomUUID().toString(), value.isEmpty() ? pendingAttachmentName : value, now);
        if (pendingAttachmentUri != null) {
            task.attachmentUri = pendingAttachmentUri.toString();
            task.attachmentType = pendingAttachmentType;
            task.attachmentName = pendingAttachmentName;
        }
        tasks.add(0, task);
        input.setText("");
        pendingAttachmentUri = null;
        pendingAttachmentType = "";
        pendingAttachmentName = "";
        attachmentStatus.setText("附件保留在手机原位置，不计入任务同步流量");
        save();
        refreshList(true);
    }

    private void chooseAttachment(String mime, int requestCode) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType(mime)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(intent, requestCode);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (resultCode != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData();
        try { getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION); }
        catch (SecurityException ignored) {}
        pendingAttachmentUri = uri;
        pendingAttachmentType = requestCode == PICK_VIDEO ? "video" : "image";
        pendingAttachmentName = attachmentDisplayName(uri);
        attachmentStatus.setText((requestCode == PICK_VIDEO ? "已选择视频：" : "已选择图片：") + pendingAttachmentName);
    }

    private String attachmentDisplayName(Uri uri) {
        try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) return cursor.getString(0);
        } catch (Exception ignored) {}
        return "附件";
    }

    private void refreshList() { refreshList(false); }

    private void refreshList(boolean reorder) {
        list.removeAllViews();
        completedList.removeAllViews();
        List<Task> shown = new ArrayList<>();
        String query = searchInput == null ? "" : searchInput.getText().toString().trim().toLowerCase();
        for (Task task : tasks) if (!task.deleted && (query.isEmpty() || searchableText(task).contains(query))) shown.add(task);
        if (reorder || stableOrder.isEmpty()) {
            if (sortMode == 0) Collections.sort(shown, (a, b) -> Integer.compare(taskPriority(a), taskPriority(b)));
            else if (sortMode == 1) Collections.sort(shown, (a, b) -> Long.compare(b.createdAt, a.createdAt));
            else Collections.sort(shown, (a, b) -> Long.compare(a.reminderAt == 0 ? Long.MAX_VALUE : a.reminderAt, b.reminderAt == 0 ? Long.MAX_VALUE : b.reminderAt));
            stableOrder.clear();
            for (Task task : shown) stableOrder.add(task.id);
        } else {
            Collections.sort(shown, (a, b) -> {
                int ai = stableOrder.indexOf(a.id), bi = stableOrder.indexOf(b.id);
                if (ai < 0 && bi < 0) return Long.compare(b.createdAt, a.createdAt);
                if (ai < 0) return -1;
                if (bi < 0) return 1;
                return Integer.compare(ai, bi);
            });
            for (Task task : shown) if (!stableOrder.contains(task.id)) stableOrder.add(task.id);
        }
        int done = 0;
        for (Task task : shown) if (task.state == Task.DONE) done++;
        summary.setText(shown.isEmpty() ? "任务列表" : "任务 " + shown.size() + " 项  ·  已完成 " + done + " 项");
        List<Task> active = new ArrayList<>(), doneTasks = new ArrayList<>();
        for (Task task : shown) { if (task.state == Task.DONE) doneTasks.add(task); else active.add(task); }
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
        for (Task task : active) list.addView(taskView(task));
        if (active.isEmpty()) list.addView(text(query.isEmpty() ? "没有未完成任务" : "未找到未完成任务", 13, MUTED, Typeface.NORMAL));
        for (Task task : doneTasks) completedList.addView(taskView(task));
        if (doneTasks.isEmpty()) completedList.addView(text(query.isEmpty() ? "完成的任务会收在这里" : "未找到已完成任务", 13, MUTED, Typeface.NORMAL));
    }

    private String searchableText(Task task) {
        return ((task.text == null ? "" : task.text) + "\n" + (task.summary == null ? "" : task.summary)).toLowerCase();
    }

    private View taskView(Task task) {
        LinearLayout card = row();
        card.setGravity(Gravity.CENTER_VERTICAL);
        card.setPadding(dp(15), dp(15), dp(13), dp(15));
        card.setBackground(roundRect(stateFill(task), 16, stateStrong(task), 1));
        card.setOnClickListener(v -> openTask(task));
        LinearLayout.LayoutParams cardLp = matchWrap();
        cardLp.setMargins(0, 0, 0, dp(9));
        card.setLayoutParams(cardLp);
        if (isCobweb(task)) card.post(() -> {
            SpiderWebDrawable web = new SpiderWebDrawable();
            web.setBounds(Math.max(0, card.getWidth() - dp(76)), 0, card.getWidth(), dp(76));
            card.getOverlay().add(web);
        });

        LinearLayout copy = column();
        copy.setPadding(0, 0, dp(10), 0);
        String firstLine = task.text.split("\\n", 2)[0];
        TextView taskText = text(firstLine, 16, task.state == Task.DONE ? Color.GRAY : INK, Typeface.BOLD);
        if (task.state == Task.DONE) taskText.setPaintFlags(taskText.getPaintFlags() | android.graphics.Paint.STRIKE_THRU_TEXT_FLAG);
        copy.addView(taskText);
        String stateName = taskStateName(task);
        String meta = stateName + " · " + DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(task.createdAt);
        if (task.reminderAt > 0) meta += "\n提醒 " + DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(task.reminderAt);
        TextView metaView = text(meta, 12, MUTED, Typeface.NORMAL);
        metaView.setPadding(0, dp(6), 0, 0);
        copy.addView(metaView);
        if (task.attachmentUri != null && !task.attachmentUri.isEmpty()) {
            if ("image".equals(task.attachmentType)) {
                ImageView preview = new ImageView(this);
                preview.setScaleType(ImageView.ScaleType.CENTER_CROP);
                try { preview.setImageURI(Uri.parse(task.attachmentUri)); }
                catch (Exception ignored) { preview.setImageResource(R.drawable.ic_empty_tasks); }
                LinearLayout.LayoutParams previewLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(132));
                previewLp.setMargins(0, dp(9), 0, 0);
                copy.addView(preview, previewLp);
            } else {
                TextView video = text("▶  视频 · " + task.attachmentName, 12, BRAND, Typeface.BOLD);
                video.setPadding(0, dp(8), 0, 0);
                copy.addView(video);
            }
        }
        if (isCobweb(task)) {
            TextView web = text("🕸  久置落灰 · 点击重新唤醒", 12, DOING_STRONG, Typeface.BOLD);
            web.setPadding(0, dp(7), 0, 0);
            copy.addView(web);
        }
        if (task.summary != null && !task.summary.isEmpty()) {
            TextView summaryView = text(task.summary, 13, INK, Typeface.NORMAL);
            summaryView.setPadding(0, dp(7), 0, 0);
            summaryView.setMaxLines(4);
            copy.addView(summaryView);
        } else if ("pending".equals(task.summaryStatus)) {
            TextView aiStatus = text("Kimi 正在阅读链接，稍后同步即可看到摘要", 12, MUTED, Typeface.NORMAL);
            aiStatus.setPadding(0, dp(6), 0, 0);
            copy.addView(aiStatus);
        } else if ("error".equals(task.summaryStatus)) {
            TextView aiStatus = text("摘要暂时失败，下次同步会重试", 12, NEW_STRONG, Typeface.NORMAL);
            aiStatus.setPadding(0, dp(6), 0, 0);
            copy.addView(aiStatus);
        }
        card.addView(copy, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        TextView doneBox = text(task.state == Task.DONE ? "✓" : "", 21,
                task.state == Task.DONE ? Color.WHITE : stateStrong(task), Typeface.BOLD);
        doneBox.setContentDescription(task.state == Task.DONE ? "已完成，点击恢复" : "标记完成");
        doneBox.setGravity(Gravity.CENTER);
        doneBox.setBackground(roundRect(task.state == Task.DONE ? DONE_STRONG : Color.TRANSPARENT,
                10, stateStrong(task), 2));
        doneBox.setOnClickListener(v -> {
            int fromFill = stateFill(task);
            task.state = task.state == Task.DONE ? Task.SEEN : Task.DONE;
            task.updatedAt = System.currentTimeMillis();
            if (task.state == Task.DONE) cancelAlarm(task);
            save();
            int toFill = stateFill(task), toStrong = stateStrong(task);
            doneBox.setText(task.state == Task.DONE ? "✓" : "");
            doneBox.setTextColor(task.state == Task.DONE ? Color.WHITE : toStrong);
            doneBox.setContentDescription(task.state == Task.DONE ? "已完成，点击恢复" : "标记完成");
            doneBox.setBackground(roundRect(task.state == Task.DONE ? DONE_STRONG : Color.TRANSPARENT, 10, toStrong, 2));
            ValueAnimator animator = ValueAnimator.ofArgb(fromFill, toFill);
            animator.setDuration(700);
            animator.addUpdateListener(value -> card.setBackground(roundRect((int) value.getAnimatedValue(), 16, toStrong, 1)));
            animator.start();
            card.postDelayed(() -> refreshList(false), 720);
        });
        card.addView(doneBox, new LinearLayout.LayoutParams(dp(30), dp(30)));
        return card;
    }

    private int taskPriority(Task task) {
        if (task.state == Task.DONE) return 100;
        if (isStale(task)) return 10;
        return task.viewCount;
    }

    private int stateFill(Task task) {
        if (task.state == Task.DONE) return DONE_FILL;
        if (isStale(task)) return staleFill(task);
        int[] fills = {
                Color.rgb(255, 205, 205), Color.rgb(255, 220, 220), Color.rgb(255, 232, 232),
                Color.rgb(255, 240, 240), Color.rgb(255, 246, 246)};
        return fills[Math.max(0, Math.min(4, task.viewCount))];
    }

    private int stateStrong(Task task) {
        if (task.state == Task.DONE) return DONE_STRONG;
        if (isStale(task)) return DOING_STRONG;
        int[] borders = {
                Color.rgb(190, 44, 44), Color.rgb(205, 77, 77), Color.rgb(216, 107, 107),
                Color.rgb(224, 137, 137), Color.rgb(230, 164, 164)};
        return borders[Math.max(0, Math.min(4, task.viewCount))];
    }

    private boolean isStale(Task task) {
        long anchor = task.lastViewedAt > 0 ? task.lastViewedAt : task.createdAt;
        return task.state != Task.DONE && System.currentTimeMillis() - anchor >= 7L * 24 * 60 * 60 * 1000;
    }

    private boolean isCobweb(Task task) {
        long anchor = task.lastViewedAt > 0 ? task.lastViewedAt : task.createdAt;
        return task.state != Task.DONE && System.currentTimeMillis() - anchor >= 30L * 24 * 60 * 60 * 1000;
    }

    private int staleFill(Task task) {
        long anchor = task.lastViewedAt > 0 ? task.lastViewedAt : task.createdAt;
        float days = (System.currentTimeMillis() - anchor) / 86400000f;
        float progress = Math.min(1f, Math.max(0f, (days - 7f) / 23f));
        return blend(Color.rgb(255, 248, 218), Color.rgb(244, 215, 126), progress);
    }

    private int blend(int from, int to, float p) {
        return Color.rgb((int)(Color.red(from)+(Color.red(to)-Color.red(from))*p),
                (int)(Color.green(from)+(Color.green(to)-Color.green(from))*p),
                (int)(Color.blue(from)+(Color.blue(to)-Color.blue(from))*p));
    }

    private void openTask(Task task) {
        boolean wasCobweb = isCobweb(task);
        if (task.state != Task.DONE) {
            if (isStale(task)) task.viewCount = 0;
            else task.viewCount = Math.min(4, task.viewCount + 1);
            task.lastViewedAt = System.currentTimeMillis();
            task.updatedAt = task.lastViewedAt;
            save();
        }
        ScrollView scroll = new ScrollView(this);
        LinearLayout panel = column();
        panel.setPadding(dp(22), dp(20), dp(22), dp(12));
        panel.setBackground(roundRect(stateFill(task), 18, stateStrong(task), 1));
        scroll.addView(panel);
        if (wasCobweb) panel.post(() -> {
            SpiderWebDrawable web = new SpiderWebDrawable();
            web.setBounds(Math.max(0, panel.getWidth() - dp(92)), 0, panel.getWidth(), dp(92));
            panel.getOverlay().add(web);
        });

        TextView eyebrow = text("任务详情", 12, stateStrong(task), Typeface.BOLD);
        panel.addView(eyebrow);
        TextView fullText = text(task.text, 20, INK, Typeface.BOLD);
        fullText.setTextIsSelectable(true);
        fullText.setPadding(0, dp(10), 0, dp(8));
        panel.addView(fullText);
        TextView stateLabel = text(taskStateName(task) + " · " + DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(task.createdAt), 13, MUTED, Typeface.NORMAL);
        panel.addView(stateLabel);
        if (wasCobweb) {
            TextView cobweb = text("🕸 这件事落灰很久了，已经重新变红提醒你", 13, DOING_STRONG, Typeface.BOLD);
            cobweb.setPadding(0, dp(10), 0, 0);
            panel.addView(cobweb);
        }

        if (task.summary != null && !task.summary.isEmpty()) {
            TextView aiLabel = text("Kimi 摘要", 12, BRAND, Typeface.BOLD);
            aiLabel.setPadding(0, dp(20), 0, dp(7));
            panel.addView(aiLabel);
            TextView fullSummary = text(task.summary, 16, INK, Typeface.NORMAL);
            fullSummary.setTextIsSelectable(true);
            fullSummary.setLineSpacing(dp(2), 1.08f);
            panel.addView(fullSummary);
        }
        if (task.reminderAt > 0) {
            TextView reminder = text("提醒时间  " + DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(task.reminderAt), 13, BRAND, Typeface.BOLD);
            reminder.setPadding(0, dp(18), 0, 0);
            panel.addView(reminder);
        }
        if (task.attachmentUri != null && !task.attachmentUri.isEmpty()) {
            if ("image".equals(task.attachmentType)) {
                ImageView fullImage = new ImageView(this);
                fullImage.setAdjustViewBounds(true);
                fullImage.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
                try { fullImage.setImageURI(Uri.parse(task.attachmentUri)); }
                catch (Exception ignored) { fullImage.setImageResource(R.drawable.ic_empty_tasks); }
                LinearLayout.LayoutParams imageLp = matchWrap();
                imageLp.setMargins(0, dp(16), 0, 0);
                panel.addView(fullImage, imageLp);
            }
            Button openAttachment = smallButton("打开" + ("video".equals(task.attachmentType) ? "视频" : "图片"));
            LinearLayout.LayoutParams attachmentOpenLp = matchWrap();
            attachmentOpenLp.setMargins(0, dp(12), 0, 0);
            panel.addView(openAttachment, attachmentOpenLp);
            openAttachment.setOnClickListener(v -> {
                try {
                    Intent open = new Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(task.attachmentUri),
                            "video".equals(task.attachmentType) ? "video/*" : "image/*")
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(open);
                } catch (Exception error) { Toast.makeText(this, "原文件已移动或删除", Toast.LENGTH_LONG).show(); }
            });
        }
        if (onlyUrl(task.text)) {
            Button open = smallButton("打开原链接");
            LinearLayout.LayoutParams openLp = matchWrap();
            openLp.setMargins(0, dp(18), 0, 0);
            panel.addView(open, openLp);
            open.setOnClickListener(v -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(task.text.trim()))));
        }
        Button complete = smallButton(task.state == Task.DONE ? "恢复为未完成" : "标记完成");
        LinearLayout.LayoutParams completeLp = matchWrap();
        completeLp.setMargins(0, dp(12), 0, 0);
        panel.addView(complete, completeLp);
        Button delete = smallButton("删除任务");
        delete.setTextColor(NEW_STRONG);
        LinearLayout.LayoutParams deleteLp = matchWrap();
        deleteLp.setMargins(0, dp(12), 0, 0);
        panel.addView(delete, deleteLp);

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setView(scroll)
                .setPositiveButton(task.state == Task.DONE ? "恢复任务" : "开始任务", null)
                .setNeutralButton(task.state == Task.DONE ? null : "设置提醒", null)
                .setNegativeButton("关闭", null)
                .create();
        dialog.setOnShowListener(ignored -> {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
                int next = task.state == Task.DONE ? Task.SEEN : Task.DOING;
                changeStateInDetail(task, next, panel, eyebrow, stateLabel);
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).setText(next == Task.DOING ? "进行中" : "开始任务");
                complete.setText("标记完成");
            });
            if (task.state != Task.DONE) dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v -> chooseReminder(task));
            complete.setOnClickListener(v -> {
                int next = task.state == Task.DONE ? Task.SEEN : Task.DONE;
                changeStateInDetail(task, next, panel, eyebrow, stateLabel);
                complete.setText(next == Task.DONE ? "恢复为未完成" : "标记完成");
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).setText(next == Task.DONE ? "恢复任务" : "开始任务");
            });
            delete.setOnClickListener(v -> new AlertDialog.Builder(this).setTitle("删除这项任务？")
                    .setMessage("删除后会在下次同步时从其他设备移除。")
                    .setPositiveButton("确认删除", (confirm, which) -> { removeTask(task); save(); dialog.dismiss(); })
                    .setNegativeButton("取消", null).show());
        });
        dialog.setOnDismissListener(ignored -> refreshList(false));
        dialog.show();
    }

    private void changeStateInDetail(Task task, int nextState, LinearLayout panel, TextView eyebrow, TextView stateLabel) {
        if (task.state == nextState) return;
        int fromFill = stateFill(task);
        task.state = nextState;
        task.updatedAt = System.currentTimeMillis();
        if (nextState == Task.DONE) cancelAlarm(task);
        save();
        int toFill = stateFill(task), toStrong = stateStrong(task);
        ValueAnimator animator = ValueAnimator.ofArgb(fromFill, toFill);
        animator.setDuration(700);
        animator.addUpdateListener(value -> panel.setBackground(roundRect((int) value.getAnimatedValue(), 18, toStrong, 1)));
        animator.start();
        eyebrow.setTextColor(toStrong);
        stateLabel.setText(taskStateName(task) + " · " + DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(task.createdAt));
    }

    private String taskStateName(Task task) {
        if (task.state == Task.DONE) return "已完成";
        if (isCobweb(task)) return "🕸 久未查看";
        if (isStale(task)) return "久未查看";
        if (task.state == Task.DOING) return "进行中 · 已查看 " + task.viewCount + " 次";
        return task.viewCount == 0 ? "未查看" : "已查看 " + task.viewCount + " 次";
    }

    private boolean onlyUrl(String value) {
        String trimmed = value == null ? "" : value.trim();
        return !trimmed.contains(" ") && !trimmed.contains("\n") && (trimmed.startsWith("http://") || trimmed.startsWith("https://"));
    }

    private void removeTask(Task task) { cancelAlarm(task); task.deleted = true; task.updatedAt = System.currentTimeMillis(); }

    private void chooseReminder(Task task) {
        Calendar calendar = Calendar.getInstance();
        new DatePickerDialog(this, (view, year, month, day) -> {
            calendar.set(year, month, day);
            new TimePickerDialog(this, (timeView, hour, minute) -> {
                calendar.set(Calendar.HOUR_OF_DAY, hour); calendar.set(Calendar.MINUTE, minute); calendar.set(Calendar.SECOND, 0);
                if (calendar.getTimeInMillis() <= System.currentTimeMillis()) { Toast.makeText(this, "提醒时间需要晚于现在", Toast.LENGTH_SHORT).show(); return; }
                task.reminderAt = calendar.getTimeInMillis();
                task.updatedAt = System.currentTimeMillis();
                scheduleAlarm(task); save(); refreshList();
            }, calendar.get(Calendar.HOUR_OF_DAY), calendar.get(Calendar.MINUTE), true).show();
        }, calendar.get(Calendar.YEAR), calendar.get(Calendar.MONTH), calendar.get(Calendar.DAY_OF_MONTH)).show();
    }

    private PendingIntent alarmIntent(Task task) {
        Intent intent = new Intent(this, ReminderReceiver.class).putExtra("id", task.id).putExtra("text", task.text);
        return PendingIntent.getBroadcast(this, task.id.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private void scheduleAlarm(Task task) {
        ((AlarmManager) getSystemService(ALARM_SERVICE)).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, task.reminderAt, alarmIntent(task));
    }

    private void cancelAlarm(Task task) { ((AlarmManager) getSystemService(ALARM_SERVICE)).cancel(alarmIntent(task)); }

    private void load() {
        String userId = getSharedPreferences(PREFS, MODE_PRIVATE).getString("current_user_id", "");
        String raw = getSharedPreferences(PREFS, MODE_PRIVATE).getString(userId.isEmpty() ? "items" : "items_" + userId, "[]");
        try { JSONArray array = new JSONArray(raw); for (int i = 0; i < array.length(); i++) tasks.add(Task.fromJson(array.getJSONObject(i))); }
        catch (JSONException ignored) { Toast.makeText(this, "任务数据读取失败", Toast.LENGTH_LONG).show(); }
    }

    private void save() {
        saveLocalOnly();
        scheduleAutoSync(AUTO_SYNC_DELAY_MS);
    }

    private void saveLocalOnly() {
        JSONArray array = new JSONArray();
        String userId = getSharedPreferences(PREFS, MODE_PRIVATE).getString("current_user_id", "");
        try { for (Task task : tasks) array.put(task.toJson()); getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(userId.isEmpty() ? "items" : "items_" + userId, array.toString()).apply(); }
        catch (JSONException ignored) { Toast.makeText(this, "任务保存失败", Toast.LENGTH_LONG).show(); }
    }

    private void switchLocalAccount(String userId) {
        String previous = getSharedPreferences(PREFS, MODE_PRIVATE).getString("current_user_id", "");
        if (userId.equals(previous)) return;
        if (previous.isEmpty()) {
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString("current_user_id", userId).apply();
            saveLocalOnly(); // 首次登录：现有个人版数据归属第一个账号
            return;
        }
        saveLocalOnly();
        for (Task task : tasks) cancelAlarm(task);
        tasks.clear(); stableOrder.clear();
        String raw = getSharedPreferences(PREFS, MODE_PRIVATE).getString("items_" + userId, "[]");
        try { JSONArray array = new JSONArray(raw); for (int i = 0; i < array.length(); i++) tasks.add(Task.fromJson(array.getJSONObject(i))); }
        catch (JSONException ignored) { Toast.makeText(this, "该账号本地数据读取失败", Toast.LENGTH_LONG).show(); }
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString("current_user_id", userId).apply();
        restoreFutureAlarms(); refreshList();
    }

    private void scheduleAutoSync(long delayMs) {
        mainHandler.removeCallbacks(automaticSync);
        mainHandler.postDelayed(automaticSync, delayMs);
    }

    private String syncStatusText() {
        long last = getSharedPreferences(PREFS, MODE_PRIVATE).getLong("last_sync_at", 0);
        if (last == 0) return "尚未同步 · 点击右上角登录云端";
        return "上次同步 " + DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(last);
    }

    private void showSyncDialog() {
        String savedUrl = getSharedPreferences(PREFS, MODE_PRIVATE).getString("sync_url", "https://reminder.geniusqi.com");
        String savedUsername = getSharedPreferences(PREFS, MODE_PRIVATE).getString("username", "");
        LinearLayout form = column();
        form.setPadding(dp(22), 0, dp(22), 0);
        EditText url = new EditText(this);
        url.setHint("云端地址");
        url.setSingleLine(true);
        url.setText(savedUrl);
        EditText username = new EditText(this);
        username.setHint("用户名"); username.setSingleLine(true); username.setText(savedUsername);
        EditText password = new EditText(this);
        password.setHint("密码（至少8位）"); password.setSingleLine(true);
        password.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        EditText invite = new EditText(this);
        invite.setHint("邀请码（仅首次注册填写）"); invite.setSingleLine(true);
        form.addView(url, matchWrap());
        form.addView(username, matchWrap()); form.addView(password, matchWrap()); form.addView(invite, matchWrap());
        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("登录拾遗云端")
                .setMessage("手机和电脑登录同一账号即可同步；每位用户的任务相互隔离。")
                .setView(form)
                .setPositiveButton("登录", null)
                .setNeutralButton("邀请码注册", null)
                .setNegativeButton("取消", null)
                .create();
        dialog.setOnShowListener(ignored -> {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
                authenticate(url.getText().toString(), username.getText().toString(), password.getText().toString(), "", false, dialog);
            });
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v -> {
                authenticate(url.getText().toString(), username.getText().toString(), password.getText().toString(), invite.getText().toString(), true, dialog);
            });
        });
        dialog.show();
    }

    private void authenticate(String urlValue, String usernameValue, String password, String inviteCode, boolean register, AlertDialog dialog) {
        String server = urlValue.trim().replaceAll("/+$", "");
        String username = usernameValue.trim();
        if (server.isEmpty() || username.isEmpty() || password.length() < 8) {
            Toast.makeText(this, "请填写地址、用户名和至少8位密码", Toast.LENGTH_LONG).show();
            return;
        }
        Toast.makeText(this, register ? "正在注册…" : "正在登录…", Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                JSONObject body = new JSONObject().put("username", username).put("password", password).put("inviteCode", inviteCode.trim());
                connection = (HttpURLConnection) new URL(server + "/api/auth/" + (register ? "register" : "login")).openConnection();
                connection.setConnectTimeout(12000); connection.setReadTimeout(20000); connection.setRequestMethod("POST");
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8"); connection.setDoOutput(true);
                try (OutputStream output = connection.getOutputStream()) { output.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
                int status = connection.getResponseCode();
                BufferedReader reader = new BufferedReader(new InputStreamReader(status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream(), StandardCharsets.UTF_8));
                StringBuilder raw = new StringBuilder(); String line; while ((line = reader.readLine()) != null) raw.append(line);
                JSONObject result = new JSONObject(raw.toString());
                if (status < 200 || status >= 300) throw new IllegalStateException(result.optString("error", "认证失败"));
                String token = result.getString("token");
                String userId = result.getJSONObject("user").getString("id");
                runOnUiThread(() -> {
                    switchLocalAccount(userId);
                    getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString("sync_url", server).putString("username", username).putString("auth_token", token).remove("sync_code").apply();
                    dialog.dismiss(); Toast.makeText(this, register ? "注册成功" : "登录成功", Toast.LENGTH_SHORT).show(); syncNow(server, token, "merge", false);
                });
            } catch (Exception error) { runOnUiThread(() -> Toast.makeText(this, "认证失败：" + error.getMessage(), Toast.LENGTH_LONG).show()); }
            finally { if (connection != null) connection.disconnect(); }
        }).start();
    }

    private void syncNow(String server, String token, String mode, boolean silent) {
        if (!server.startsWith("http://") && !server.startsWith("https://")) {
            if (!silent) Toast.makeText(this, "云端地址需要以 http:// 或 https:// 开头", Toast.LENGTH_LONG).show();
            return;
        }
        if (syncInProgress) { syncAgain = true; return; }
        syncInProgress = true;
        if (syncStatus != null) syncStatus.setText("正在同步…");
        if (!silent) Toast.makeText(this, "正在同步…", Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                JSONObject body = new JSONObject().put("mode", mode);
                JSONArray local = new JSONArray();
                for (Task task : tasks) local.put(task.toJson());
                body.put("tasks", local);
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                connection = (HttpURLConnection) new URL(server + "/api/sync").openConnection();
                connection.setConnectTimeout(12000);
                connection.setReadTimeout(20000);
                connection.setRequestMethod("POST");
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                connection.setRequestProperty("Authorization", "Bearer " + token);
                connection.setDoOutput(true);
                try (OutputStream output = connection.getOutputStream()) { output.write(bytes); }
                int status = connection.getResponseCode();
                BufferedReader reader = new BufferedReader(new InputStreamReader(
                        status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream(), StandardCharsets.UTF_8));
                StringBuilder response = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) response.append(line);
                if (status != 200) throw new IllegalStateException(new JSONObject(response.toString()).optString("error", "服务器错误 " + status));
                JSONArray merged = new JSONObject(response.toString()).getJSONArray("tasks");
                List<Task> received = new ArrayList<>();
                for (int i = 0; i < merged.length(); i++) received.add(Task.fromJson(merged.getJSONObject(i)));
                runOnUiThread(() -> {
                    String activeToken = getSharedPreferences(PREFS, MODE_PRIVATE).getString("auth_token", "");
                    if (!token.equals(activeToken)) return; // 账号切换期间丢弃旧账号的迟到响应
                    if ("merge".equals(mode)) {
                        tasks.clear();
                        tasks.addAll(received);
                    } else if ("download".equals(mode)) {
                        mergeIntoLocal(received);
                    }
                    saveLocalOnly();
                    restoreFutureAlarms();
                    long syncedAt = System.currentTimeMillis();
                    getSharedPreferences(PREFS, MODE_PRIVATE).edit().putLong("last_sync_at", syncedAt).apply();
                    if (syncStatus != null) syncStatus.setText(syncStatusText());
                    refreshList();
                    String action = "upload".equals(mode) ? "上传完成" : "download".equals(mode) ? "接收完成" : "双向同步完成";
                    if (!silent) Toast.makeText(this, action + "，同步库共 " + received.size() + " 条记录", Toast.LENGTH_SHORT).show();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    if (syncStatus != null) syncStatus.setText("同步失败 · 点击右上角重试");
                    if (!silent) Toast.makeText(this, "同步失败：" + error.getMessage(), Toast.LENGTH_LONG).show();
                });
            } finally {
                if (connection != null) connection.disconnect();
                runOnUiThread(() -> {
                    syncInProgress = false;
                    if (syncAgain) { syncAgain = false; scheduleAutoSync(250); }
                });
            }
        }).start();
    }

    private void restoreFutureAlarms() {
        long now = System.currentTimeMillis();
        for (Task task : tasks) {
            if (!task.deleted && task.state != Task.DONE && task.reminderAt > now) scheduleAlarm(task);
        }
    }

    private void mergeIntoLocal(List<Task> received) {
        for (Task remote : received) {
            int localIndex = -1;
            for (int i = 0; i < tasks.size(); i++) {
                if (tasks.get(i).id.equals(remote.id)) { localIndex = i; break; }
            }
            if (localIndex < 0) tasks.add(remote);
            else {
                Task local = tasks.get(localIndex);
                if (remote.updatedAt > local.updatedAt) {
                    if (local.summaryUpdatedAt > remote.summaryUpdatedAt) copySummary(local, remote);
                    tasks.set(localIndex, remote);
                } else if (remote.summaryUpdatedAt > local.summaryUpdatedAt) {
                    copySummary(remote, local);
                }
            }
        }
    }

    private void copySummary(Task source, Task target) {
        target.summary = source.summary;
        target.summaryStatus = source.summaryStatus;
        target.summaryError = source.summaryError;
        target.summaryUpdatedAt = source.summaryUpdatedAt;
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 7);
    }

    private LinearLayout column() { LinearLayout v = new LinearLayout(this); v.setOrientation(LinearLayout.VERTICAL); return v; }
    private LinearLayout row() { LinearLayout v = new LinearLayout(this); v.setOrientation(LinearLayout.HORIZONTAL); return v; }
    private TextView text(String value, int sp, int color, int style) { TextView v = new TextView(this); v.setText(value); v.setTextSize(sp); v.setTextColor(color); v.setTypeface(Typeface.DEFAULT, style); return v; }
    private Button button(String value) { Button b = new Button(this); b.setText(String.format("＋  %s", value)); b.setTextColor(Color.WHITE); b.setTextSize(14); b.setTypeface(Typeface.DEFAULT, Typeface.BOLD); b.setAllCaps(false); b.setBackground(roundRect(BRAND, 12)); return b; }
    private Button smallButton(String value) { Button b = new Button(this); b.setText(value); b.setTextColor(BRAND); b.setTextSize(12); b.setTypeface(Typeface.DEFAULT, Typeface.BOLD); b.setAllCaps(false); b.setBackground(roundRect(BRAND_SOFT, 99)); return b; }
    private GradientDrawable roundRect(int color, int radiusDp) { return roundRect(color, radiusDp, Color.TRANSPARENT, 0); }
    private GradientDrawable roundRect(int color, int radiusDp, int strokeColor, int strokeDp) { GradientDrawable d = new GradientDrawable(); d.setColor(color); d.setCornerRadius(dp(radiusDp)); if (strokeDp > 0) d.setStroke(dp(strokeDp), strokeColor); return d; }
    private LinearLayout.LayoutParams matchWrap() { return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private int withAlpha(int color, int alpha) { return Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color)); }

    private final class SpiderWebDrawable extends Drawable {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        SpiderWebDrawable() { paint.setColor(withAlpha(DOING_STRONG, 105)); paint.setStyle(Paint.Style.STROKE); paint.setStrokeWidth(dp(1)); }
        @Override public void draw(Canvas canvas) {
            float right = getBounds().right, top = getBounds().top;
            float radius = Math.min(getBounds().width(), getBounds().height());
            for (int i = 0; i <= 4; i++) {
                double angle = Math.PI / 2 * i / 4.0;
                canvas.drawLine(right, top, right - (float)Math.cos(angle) * radius, top + (float)Math.sin(angle) * radius, paint);
            }
            for (int ring = 1; ring <= 3; ring++) {
                float r = radius * ring / 4f;
                canvas.drawArc(right - r, top - r, right + r, top + r, 90, 90, false, paint);
            }
        }
        @Override public void setAlpha(int alpha) { paint.setAlpha(alpha); }
        @Override public void setColorFilter(android.graphics.ColorFilter filter) { paint.setColorFilter(filter); }
        @Override public int getOpacity() { return PixelFormat.TRANSLUCENT; }
    }
}
