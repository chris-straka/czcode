/**
 * The Morning brief: one card at the top of the feed summing up the night
 * for the machines the filter shows. Decisions waiting (the three that
 * matter most first), threads that finished or failed overnight, and
 * scheduled jobs that failed. Shared by web and mobile.
 *
 * Sorts with `.sort` on fresh arrays, not `.toSorted`: the phone's Hermes
 * engine has no `toSorted`.
 *
 * @module morningBrief
 */
import type { DecisionItem, EnvironmentId, ScheduleJob, ScheduleJobRun } from "@cz/contracts";
import * as DateTime from "effect/DateTime";

/** The brief appears from 04:00 and covers everything since 18:00 the evening before. */
const BRIEF_STARTS_HOUR = 4;
const NIGHT_STARTS_HOUR = 18;

export interface BriefWindow {
  /** The local day the brief is for, "2026-10-08"; "Done reading" is remembered per day. */
  readonly day: string;
  /** Epoch ms of 18:00 local the evening before. */
  readonly since: number;
}

/** Today's brief window in local time, or null before 04:00 (the night isn't over). */
export function briefWindow(
  now: number,
  timeZone: DateTime.TimeZone = DateTime.zoneMakeLocal(),
): BriefWindow | null {
  const zoned = DateTime.makeZonedUnsafe(now, { timeZone });
  const parts = DateTime.toParts(zoned);
  if (parts.hour < BRIEF_STARTS_HOUR) return null;
  const pad = (value: number) => String(value).padStart(2, "0");
  const evening = DateTime.setParts(
    DateTime.subtract(DateTime.startOf(zoned, "day"), { days: 1 }),
    {
      hour: NIGHT_STARTS_HOUR,
    },
  );
  return {
    day: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    since: DateTime.toEpochMillis(evening),
  };
}

export interface BriefDecision {
  readonly environmentId: EnvironmentId;
  readonly item: DecisionItem;
}

export interface BriefThread {
  readonly environmentId: EnvironmentId;
  readonly id: string;
  readonly archivedAt: string | null;
  readonly lineage: { readonly relationshipToParent: "fork" | "subagent" | null };
  readonly latestRun: { readonly status: string; readonly completedAt: string | null } | null;
}

export interface BriefJob {
  readonly environmentId: EnvironmentId;
  readonly job: ScheduleJob;
}

export interface MorningBrief<D extends BriefDecision, T extends BriefThread> {
  readonly decisions: {
    readonly total: number;
    /** The three that matter most: an agent waiting, then money, then the oldest. */
    readonly top: ReadonlyArray<D>;
    readonly byGroup: { readonly games: number; readonly software: number };
    /** Most first. */
    readonly byProject: ReadonlyArray<{ readonly project: string; readonly count: number }>;
  };
  /** Threads whose run ended overnight. */
  readonly threads: { readonly failed: ReadonlyArray<T>; readonly finished: ReadonlyArray<T> };
  /** Registered jobs whose run failed overnight, with the run that failed. */
  readonly failedJobs: ReadonlyArray<BriefJob & { readonly run: ScheduleJobRun }>;
}

const TOP_COUNT = 3;

/** How much a waiting decision matters: an agent blocked on it, then money, then oldest. */
function compareImportance(a: DecisionItem, b: DecisionItem): number {
  return (
    Number(b.blocking) - Number(a.blocking) ||
    Number(b.cost_note !== null) - Number(a.cost_note !== null) ||
    a.created_at - b.created_at
  );
}

/**
 * Builds the brief. `decisions` are the open ones the feed's filters show;
 * `threads` and `jobs` are already limited to the machines it shows.
 */
export function buildMorningBrief<D extends BriefDecision, T extends BriefThread>(input: {
  readonly decisions: ReadonlyArray<D>;
  readonly threads: ReadonlyArray<T>;
  readonly jobs: ReadonlyArray<BriefJob>;
  readonly groupOf: (project: string) => "games" | "software";
  readonly since: number;
}): MorningBrief<D, T> {
  const open = input.decisions.filter((entry) => entry.item.status === "open");
  const counts = new Map<string, number>();
  let games = 0;
  for (const entry of open) {
    counts.set(entry.item.project, (counts.get(entry.item.project) ?? 0) + 1);
    if (input.groupOf(entry.item.project) === "games") games += 1;
  }

  const endedAt = (thread: T) => Date.parse(thread.latestRun?.completedAt ?? "") || 0;
  const overnight = input.threads
    .filter(
      (thread) =>
        thread.archivedAt === null &&
        thread.lineage.relationshipToParent !== "subagent" &&
        endedAt(thread) >= input.since,
    )
    .sort((a, b) => endedAt(b) - endedAt(a));
  const failedStatus = (thread: T) =>
    thread.latestRun?.status === "failed" || thread.latestRun?.status === "interrupted";

  const failedJobs = input.jobs.flatMap((entry) => {
    if (!entry.job.registered) return [];
    const run = [entry.job.lastScheduledRun, entry.job.lastRun].find(
      (candidate) =>
        candidate?.status === "failed" && candidate.at !== null && candidate.at >= input.since,
    );
    return run ? [{ ...entry, run }] : [];
  });

  return {
    decisions: {
      total: open.length,
      top: [...open].sort((a, b) => compareImportance(a.item, b.item)).slice(0, TOP_COUNT),
      byGroup: { games, software: open.length - games },
      byProject: [...counts]
        .map(([project, count]) => ({ project, count }))
        .sort((a, b) => b.count - a.count || a.project.localeCompare(b.project)),
    },
    threads: {
      failed: overnight.filter(failedStatus),
      finished: overnight.filter(
        (thread) => !failedStatus(thread) && thread.latestRun?.status === "completed",
      ),
    },
    failedJobs,
  };
}

/** True when the night left nothing to say. */
export function morningBriefIsEmpty(brief: MorningBrief<BriefDecision, BriefThread>): boolean {
  return (
    brief.decisions.total === 0 &&
    brief.threads.failed.length === 0 &&
    brief.threads.finished.length === 0 &&
    brief.failedJobs.length === 0
  );
}

/** The folded line: "12 decisions · 3 threads finished · 1 failed · 1 job failed". */
export function morningBriefSummary(brief: MorningBrief<BriefDecision, BriefThread>): string {
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const failed = brief.threads.failed.length;
  return [
    brief.decisions.total > 0 ? plural(brief.decisions.total, "decision") : null,
    brief.threads.finished.length > 0
      ? `${plural(brief.threads.finished.length, "thread")} finished`
      : null,
    failed > 0 ? `${plural(failed, "thread")} failed` : null,
    brief.failedJobs.length > 0 ? `${plural(brief.failedJobs.length, "job")} failed` : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}
