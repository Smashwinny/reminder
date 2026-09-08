package com.smashwinny.reminder;
import org.junit.Test;
import static org.junit.Assert.*;
import java.util.*;

public class TaskMergeTest {
    @Test public void delayedResponsePreservesNewTaskAndDeletion() {
        Task edited = new Task("old", "edited while sending", 1);
        edited.updatedAt = 20; edited.deleted = true;
        Task added = new Task("new", "created while sending", 20);
        List<Task> local = new ArrayList<>(Arrays.asList(edited, added));
        TaskMerge.merge(local, Arrays.asList(new Task("old", "old response", 1)));
        assertEquals(2, local.size()); assertSame(edited, local.get(0));
        assertTrue(local.get(0).deleted); assertSame(added, local.get(1));
    }
    @Test public void mergeKeepsIndependentSummaryAndIsIdempotent() {
        Task local = new Task("id", "local", 10); local.summary = "fresh summary"; local.summaryUpdatedAt = 30;
        Task remote = new Task("id", "remote edit", 20);
        List<Task> tasks = new ArrayList<>(Arrays.asList(local));
        TaskMerge.merge(tasks, Arrays.asList(remote)); TaskMerge.merge(tasks, Arrays.asList(remote));
        assertEquals(1, tasks.size()); assertEquals("remote edit", tasks.get(0).text);
        assertEquals("fresh summary", tasks.get(0).summary);
    }
}
