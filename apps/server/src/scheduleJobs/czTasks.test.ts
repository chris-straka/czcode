import type { ScheduledTask } from "@cz/contracts";
import { describe, expect, it } from "vite-plus/test";

import { taskAsJob, taskScheduleInWords } from "./czTasks.ts";

describe("cz tasks as Schedules rows", () => {
  it("says triggers in words", () => {
    expect(taskScheduleInWords({ type: "fixed_time", timeOfDay: "08:00", weekdays: [1] })).toBe(
      "Weekly, Mon 08:00",
    );
    expect(taskScheduleInWords({ type: "fixed_time", timeOfDay: "06:30" })).toBe("Daily 06:30");
    expect(taskScheduleInWords({ type: "interval", everyMs: 7_200_000 })).toBe("Every 2 h");
    expect(taskScheduleInWords({ type: "interval", everyMs: 86_400_000 })).toBe("Daily");
  });

  it("shows a failed run with its error and links the thread", () => {
    const job = taskAsJob(
      {
        id: "t1",
        title: "Recheck cash-savings rates",
        enabled: true,
        schedule: { type: "fixed_time", timeOfDay: "08:00", weekdays: [1] },
        threadId: "thread:1",
        nextRunAt: "2026-10-12T14:00:00.000Z",
        lastRunAt: "2026-10-05T14:00:00.000Z",
        lastRunStatus: "failed",
        lastRunError: "Provider quota spent",
      } as unknown as ScheduledTask,
      "finance",
    );
    expect(job).toMatchObject({
      what: "Recheck cash-savings rates",
      schedule: "Weekly, Mon 08:00",
      lastRun: { status: "failed", reason: "Provider quota spent" },
      output: { kind: "thread", ref: "thread:1" },
      project: "finance",
    });
  });
});
