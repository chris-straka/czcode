/**
 * czcode's own scheduled tasks as Schedules rows.
 *
 * @module czTasks
 */
import type { ScheduledTask, ScheduleJob } from "@cz/contracts";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A task's trigger in words: "Daily 08:00", "Weekly, Mon 08:00", "Every 2 h", "On webhook". */
export function taskScheduleInWords(schedule: ScheduledTask["schedule"]): string {
  switch (schedule.type) {
    case "fixed_time": {
      const days = schedule.weekdays ?? [];
      if (days.length === 0 || days.length === 7) return `Daily ${schedule.timeOfDay}`;
      return `Weekly, ${days.map((day) => WEEKDAYS[day]).join(", ")} ${schedule.timeOfDay}`;
    }
    case "interval": {
      const minutes = Math.round(schedule.everyMs / 60_000);
      if (minutes % 1440 === 0) return minutes === 1440 ? "Daily" : `Every ${minutes / 1440} days`;
      if (minutes % 60 === 0) return minutes === 60 ? "Hourly" : `Every ${minutes / 60} h`;
      return `Every ${minutes} min`;
    }
    case "webhook":
      return "On webhook";
    default:
      return "Scheduled";
  }
}

const epoch = (iso: string | null) => (iso === null ? null : Date.parse(iso));

/** One task as a row; `projectTitle` names its project. */
export function taskAsJob(task: ScheduledTask, projectTitle: string | null): ScheduleJob {
  const status =
    task.lastRunStatus === "succeeded"
      ? "ok"
      : task.lastRunStatus === "failed"
        ? "failed"
        : task.lastRunStatus;
  return {
    id: `cz-task:${task.id}`,
    source: "cz-task",
    what: task.title,
    project: projectTitle,
    unit: null,
    schedule: task.enabled
      ? taskScheduleInWords(task.schedule)
      : `Paused (${taskScheduleInWords(task.schedule)})`,
    lastRun: {
      status,
      at: epoch(task.lastRunAt),
      reason: status === "failed" ? (task.lastRunError ?? "Failed") : null,
    },
    lastScheduledRun: null,
    nextRunAt: task.enabled ? epoch(task.nextRunAt) : null,
    output: task.threadId ? { kind: "thread", ref: task.threadId } : null,
    registered: true,
  };
}
