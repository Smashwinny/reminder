package com.smashwinny.reminder;

import java.util.List;

/** Merge a delayed response into the current UI state, never replace that state wholesale. */
final class TaskMerge {
    static void merge(List<Task> tasks, List<Task> incoming) {
        for (Task remote : incoming) {
            int index = -1;
            for (int i = 0; i < tasks.size(); i++) if (tasks.get(i).id.equals(remote.id)) { index = i; break; }
            if (index < 0) { tasks.add(remote); continue; }
            Task local = tasks.get(index);
            Task winner = remote.updatedAt > local.updatedAt ? remote : local;
            Task summary = remote.summaryUpdatedAt > local.summaryUpdatedAt ? remote : local;
            winner.summary = summary.summary;
            winner.summaryStatus = summary.summaryStatus;
            winner.summaryError = summary.summaryError;
            winner.summaryUpdatedAt = summary.summaryUpdatedAt;
            tasks.set(index, winner);
        }
    }
}
