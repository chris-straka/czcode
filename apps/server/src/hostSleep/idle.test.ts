import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  activeUserSessions,
  asleepMs,
  nextDailyWakeAt,
  nextWakeAt,
  runningHostJobs,
  shouldSleep,
} from "./idle.ts";

const MIN = 60 * 1000;

describe("host sleep rules", () => {
  it("counts only user sessions that aren't idle", () => {
    // basement with a desktop left alone, the user manager, and a Tailscale SSH shell.
    const output = [
      "      1 1000 b    -     1543   manager -    no   -",
      "      3 1000 b    seat0 3052   user    tty2 yes  1h 4min ago",
      "     c6 1000 b    -     5019   user    -    no   -",
    ].join("\n");
    expect(activeUserSessions(output)).toBe(1);
    expect(activeUserSessions(output.split("\n").slice(0, 2).join("\n"))).toBe(0);
  });

  it("wakes for the earliest queued run or enabled scheduled task", () => {
    const wakeAt = nextWakeAt({
      queuedRuns: [
        { status: "started", dueAt: 1_000 },
        { status: "queued", dueAt: 9_000_000 },
      ],
      scheduledTasks: [
        { enabled: false, nextRunAt: "2026-10-06T01:00:00Z" },
        { enabled: true, nextRunAt: "2026-10-06T02:00:00Z" },
        { enabled: true, nextRunAt: null },
      ],
    });
    expect(wakeAt).toBe(9_000_000);
    expect(nextWakeAt({ queuedRuns: [], scheduledTasks: [] })).toBeNull();
  });

  it("sleeps after the idle stretch unless something is due within it", () => {
    const base = { idleSince: 0, idleMs: 30 * MIN };
    expect(shouldSleep({ ...base, now: 29 * MIN, wakeAt: null })).toBe(false);
    expect(shouldSleep({ ...base, now: 30 * MIN, wakeAt: null })).toBe(true);
    expect(shouldSleep({ ...base, now: 30 * MIN, wakeAt: 50 * MIN })).toBe(false);
    expect(shouldSleep({ ...base, now: 30 * MIN, wakeAt: 2 * 60 * MIN })).toBe(true);
  });

  it("adds up time asleep, clipped to the window and counting an open sleep", () => {
    const events = [
      { event: "sleep", at: 0 },
      { event: "wake", at: 60 * MIN },
      { event: "sleep", at: 90 * MIN },
      { event: "wake", at: 120 * MIN },
      { event: "sleep", at: 150 * MIN },
    ] as const;
    expect(asleepMs(events, 0, 160 * MIN)).toBe(100 * MIN);
    expect(asleepMs(events, 30 * MIN, 160 * MIN)).toBe(70 * MIN);
  });

  it("stays awake for a running host job, not for agent scopes or other units", () => {
    const output = [
      "cz-job-backup.service loaded activating start start cz host job: backup",
      "cz-agent-123-claude.scope loaded active running claude",
      "other.service loaded activating start start something else",
    ].join("\n");
    expect(runningHostJobs(output)).toEqual(["cz-job-backup.service"]);
    expect(runningHostJobs("")).toEqual([]);
  });

  it("wakes at the next daily wake time in the host's time zone", () => {
    const zone = DateTime.zoneMakeNamedUnsafe("America/Edmonton");
    const at = (iso: string) => DateTime.toEpochMillis(DateTime.makeUnsafe(iso));
    // 22:00 MDT on Oct 7 is 04:00Z on Oct 8; 03:30 MDT on Oct 8 is 09:30Z.
    expect(nextDailyWakeAt("03:30", at("2026-10-08T04:00:00Z"), zone)).toBe(
      at("2026-10-08T09:30:00Z"),
    );
    // Just past 03:30 the next one is tomorrow's; the earliest of several wins.
    expect(nextDailyWakeAt("03:30", at("2026-10-08T09:31:00Z"), zone)).toBe(
      at("2026-10-09T09:30:00Z"),
    );
    expect(nextDailyWakeAt("12:00, 03:30", at("2026-10-08T09:31:00Z"), zone)).toBe(
      at("2026-10-08T18:00:00Z"),
    );
    expect(nextDailyWakeAt("", 0, zone)).toBeNull();
    expect(nextDailyWakeAt("25:00,soon", 0, zone)).toBeNull();
  });
});
