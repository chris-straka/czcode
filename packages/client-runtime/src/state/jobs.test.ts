import type { ScheduleJob } from "@cz/contracts";
import { describe, expect, it } from "vite-plus/test";

import { isSystemTimer, scheduleJobRunLabel, sortScheduleJobs } from "./jobs.ts";

const job = (id: string, overrides: Partial<ScheduleJob>): ScheduleJob => ({
  id,
  source: "systemd",
  what: id,
  project: null,
  unit: `${id}.timer`,
  schedule: "Daily 03:30",
  lastRun: { status: "ok", at: 0, reason: null },
  lastScheduledRun: null,
  nextRunAt: null,
  output: null,
  registered: true,
  ...overrides,
});

describe("sortScheduleJobs", () => {
  it("puts failures first, even one hidden behind a later manual run, then attention, then by next run", () => {
    const jobs = [
      job("unregistered", { registered: false, nextRunAt: 1 }),
      job("later", { nextRunAt: 200 }),
      job("sooner", { nextRunAt: 100 }),
      job("attention", { lastRun: { status: "attention", at: 0, reason: "disk 87% full" } }),
      job("retried", {
        lastScheduledRun: { status: "failed", at: 0, reason: "No such file" },
      }),
    ];
    expect(sortScheduleJobs(jobs).map((entry) => entry.id)).toEqual([
      "retried",
      "attention",
      "sooner",
      "later",
      "unregistered",
    ]);
  });
});

describe("scheduleJobRunLabel", () => {
  it("says how a run went and when", () => {
    const now = 10 * 60 * 60 * 1000;
    expect(
      scheduleJobRunLabel({ status: "failed", at: now - 6 * 60 * 60 * 1000, reason: null }, now),
    ).toBe("Failed 6h 0m ago");
    expect(scheduleJobRunLabel({ status: "never", at: null, reason: null }, now)).toBe("Never run");
  });
});

describe("isSystemTimer", () => {
  it("hides the OS's timers and keeps ours, treating older servers' unregistered timers as the OS's", () => {
    expect(isSystemTimer(job("a", {}))).toBe(false);
    expect(isSystemTimer(job("b", { registered: false, system: false }))).toBe(false);
    expect(isSystemTimer(job("c", { registered: false, system: true }))).toBe(true);
    expect(isSystemTimer(job("d", { registered: false }))).toBe(true);
  });
});
