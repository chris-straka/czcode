import type { DecisionItem, EnvironmentId, ScheduleJob } from "@cz/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  briefWindow,
  buildMorningBrief,
  morningBriefIsEmpty,
  morningBriefSummary,
} from "./morningBrief.ts";

const here = "env-f" as EnvironmentId;
const denver = DateTime.zoneMakeNamedUnsafe("America/Denver");
const local = (iso: string) =>
  DateTime.toEpochMillis(
    DateTime.makeZonedFromString(`${iso}[America/Denver]`).pipe((zoned) => {
      if (zoned._tag === "None") throw new Error(iso);
      return zoned.value;
    }),
  );
// 2026-10-07 18:00 in Denver.
const since = local("2026-10-07T18:00:00-06:00");
const at = (hours: number) => since + hours * 3_600_000;

const decision = (id: string, overrides: Partial<DecisionItem> = {}) => ({
  environmentId: here,
  item: {
    id,
    project: "czcode",
    kind: "pick",
    status: "open",
    blocking: false,
    priority: 0,
    cost_note: null,
    created_at: 1,
    ...overrides,
  } as DecisionItem,
});

const thread = (id: string, status: string | null, completedAt: number | null) => ({
  environmentId: here,
  id,
  archivedAt: null,
  lineage: { relationshipToParent: null },
  latestRun:
    status === null
      ? null
      : {
          status,
          completedAt:
            completedAt === null ? null : DateTime.formatIso(DateTime.makeUnsafe(completedAt)),
        },
});

const job = (id: string, overrides: Partial<ScheduleJob>): ScheduleJob => ({
  id,
  source: "systemd",
  what: id,
  project: null,
  unit: `${id}.timer`,
  schedule: "Daily 04:00",
  lastRun: { status: "ok", at: at(10), reason: null },
  lastScheduledRun: null,
  nextRunAt: null,
  output: null,
  registered: true,
  ...overrides,
});

describe("briefWindow", () => {
  it("starts at 04:00 and covers the night from 18:00 the evening before", () => {
    expect(briefWindow(local("2026-10-08T03:59:00-06:00"), denver)).toBeNull();
    expect(briefWindow(local("2026-10-08T07:30:00-06:00"), denver)).toEqual({
      day: "2026-10-08",
      since,
    });
  });
});

describe("buildMorningBrief", () => {
  const brief = buildMorningBrief({
    decisions: [
      decision("old", { created_at: 1 }),
      decision("newer", { created_at: 5, project: "hll" }),
      decision("money", { created_at: 9, cost_note: "$40 of GPU time", project: "hll" }),
      decision("agent-waiting", { created_at: 10, blocking: true }),
      decision("answered", { status: "answered" }),
    ],
    threads: [
      thread("before-the-night", "completed", at(-1)),
      thread("finished", "completed", at(3)),
      thread("failed", "failed", at(2)),
      thread("still-running", "running", null),
      thread("never-ran", null, null),
    ],
    jobs: [
      { environmentId: here, job: job("ok", {}) },
      {
        environmentId: here,
        job: job("update", { lastRun: { status: "failed", at: at(10), reason: "Build failed" } }),
      },
      {
        environmentId: here,
        job: job("retried", {
          lastScheduledRun: { status: "failed", at: at(12), reason: "binary missing" },
        }),
      },
      {
        environmentId: here,
        job: job("yesterday", { lastRun: { status: "failed", at: at(-5), reason: "old" } }),
      },
      {
        environmentId: here,
        job: job("unregistered", {
          registered: false,
          lastRun: { status: "failed", at: at(1), reason: "x" },
        }),
      },
    ],
    groupOf: (project) => (project === "hll" ? "games" : "software"),
    since,
  });

  it("puts an agent waiting first, then money, then the oldest", () => {
    expect(brief.decisions.top.map((entry) => entry.item.id)).toEqual([
      "agent-waiting",
      "money",
      "old",
    ]);
    expect(brief.decisions.total).toBe(4);
    expect(brief.decisions.byGroup).toEqual({ games: 2, software: 2 });
    expect(brief.decisions.byProject).toEqual([
      { project: "czcode", count: 2 },
      { project: "hll", count: 2 },
    ]);
  });

  it("keeps threads whose run ended overnight, failures apart", () => {
    expect(brief.threads.failed.map((entry) => entry.id)).toEqual(["failed"]);
    expect(brief.threads.finished.map((entry) => entry.id)).toEqual(["finished"]);
  });

  it("lists registered jobs that failed overnight, including a scheduled run retried by hand", () => {
    expect(brief.failedJobs.map((entry) => [entry.job.id, entry.run.reason])).toEqual([
      ["update", "Build failed"],
      ["retried", "binary missing"],
    ]);
  });

  it("folds to one line", () => {
    expect(morningBriefSummary(brief)).toBe(
      "4 decisions · 1 thread finished · 1 thread failed · 2 jobs failed",
    );
    expect(morningBriefIsEmpty(brief)).toBe(false);
  });
});
