package com.smashwinny.reminder;

final class ReminderPolicy {
    static boolean shouldNotify(Task task, String scheduledUser, String currentUser, long now) {
        return scheduledUser != null && scheduledUser.equals(currentUser)
                && !task.deleted && task.state != Task.DONE
                && task.reminderAt > 0 && task.reminderAt <= now;
    }
}
