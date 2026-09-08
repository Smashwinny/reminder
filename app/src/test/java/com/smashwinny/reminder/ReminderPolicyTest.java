package com.smashwinny.reminder;

import org.junit.Test;
import static org.junit.Assert.*;

public class ReminderPolicyTest {
    @Test public void notificationsOnlyUseActiveDueTasksInCurrentAccount() {
        Task task = new Task("id", "private", 1);
        task.reminderAt = 100;
        assertTrue(ReminderPolicy.shouldNotify(task, "a", "a", 100));
        assertFalse(ReminderPolicy.shouldNotify(task, "a", "b", 100));
        assertFalse(ReminderPolicy.shouldNotify(task, null, "a", 100));
        assertFalse(ReminderPolicy.shouldNotify(task, "a", "a", 99));
        task.deleted = true;
        assertFalse(ReminderPolicy.shouldNotify(task, "a", "a", 100));
        task.deleted = false; task.state = Task.DONE;
        assertFalse(ReminderPolicy.shouldNotify(task, "a", "a", 100));
    }
}
