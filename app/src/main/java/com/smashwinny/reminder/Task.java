package com.smashwinny.reminder;

import org.json.JSONException;
import org.json.JSONObject;

final class Task {
    static final int NEW = 0;
    static final int DOING = 1;
    static final int SEEN = 2;
    static final int DONE = 3;

    String id;
    String text;
    long createdAt;
    long updatedAt;
    long reminderAt;
    int state;
    boolean deleted;
    String summary;
    String summaryStatus;
    String summaryError;
    long summaryUpdatedAt;
    int viewCount;
    long lastViewedAt;
    String attachmentUri;
    String attachmentType;
    String attachmentName;

    Task(String id, String text, long createdAt) {
        this.id = id;
        this.text = text;
        this.createdAt = createdAt;
        this.updatedAt = createdAt;
        this.state = NEW;
    }

    JSONObject toJson() throws JSONException {
        return new JSONObject()
                .put("id", id).put("text", text).put("createdAt", createdAt)
                .put("updatedAt", updatedAt).put("reminderAt", reminderAt)
                .put("state", state).put("deleted", deleted)
                .put("summary", summary == null ? "" : summary)
                .put("summaryStatus", summaryStatus == null ? "" : summaryStatus)
                .put("summaryError", summaryError == null ? "" : summaryError)
                .put("summaryUpdatedAt", summaryUpdatedAt)
                .put("viewCount", viewCount).put("lastViewedAt", lastViewedAt)
                .put("attachmentUri", attachmentUri == null ? "" : attachmentUri)
                .put("attachmentType", attachmentType == null ? "" : attachmentType)
                .put("attachmentName", attachmentName == null ? "" : attachmentName);
    }

    static Task fromJson(JSONObject json) throws JSONException {
        Task task = new Task(String.valueOf(json.get("id")), json.getString("text"), json.getLong("createdAt"));
        task.updatedAt = json.optLong("updatedAt", task.createdAt);
        task.reminderAt = json.optLong("reminderAt");
        task.state = json.optInt("state");
        task.deleted = json.optBoolean("deleted");
        task.summary = json.optString("summary");
        task.summaryStatus = json.optString("summaryStatus");
        task.summaryError = json.optString("summaryError");
        task.summaryUpdatedAt = json.optLong("summaryUpdatedAt");
        task.viewCount = Math.max(0, Math.min(4, json.optInt("viewCount", task.state == SEEN ? 1 : 0)));
        task.lastViewedAt = json.optLong("lastViewedAt", task.viewCount > 0 ? task.updatedAt : 0);
        task.attachmentUri = json.optString("attachmentUri");
        task.attachmentType = json.optString("attachmentType");
        task.attachmentName = json.optString("attachmentName");
        return task;
    }
}
