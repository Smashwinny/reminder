package com.smashwinny.reminder;

import org.json.JSONException;
import org.json.JSONObject;

final class Task {
    static final int NEW = 0;
    static final int DOING = 1;
    static final int SEEN = 2;
    static final int DONE = 3;

    long id;
    String text;
    long createdAt;
    long reminderAt;
    int state;

    Task(long id, String text, long createdAt) {
        this.id = id;
        this.text = text;
        this.createdAt = createdAt;
        this.state = NEW;
    }

    JSONObject toJson() throws JSONException {
        return new JSONObject()
                .put("id", id).put("text", text).put("createdAt", createdAt)
                .put("reminderAt", reminderAt).put("state", state);
    }

    static Task fromJson(JSONObject json) throws JSONException {
        Task task = new Task(json.getLong("id"), json.getString("text"), json.getLong("createdAt"));
        task.reminderAt = json.optLong("reminderAt");
        task.state = json.optInt("state");
        return task;
    }
}
