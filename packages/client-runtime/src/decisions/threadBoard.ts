/**
 * The Threads page as a board: one summary per project, and inside a
 * project one row per task, with retries of the same title folded into it.
 * Shared by web and mobile.
 *
 * Sorts with `.sort` on fresh arrays, not `.toSorted`: the phone's Hermes
 * engine has no `toSorted`.
 *
 * @module threadBoard
 */

export type BoardThreadStatus = "needs-you" | "running" | "failed" | "done" | "idle";

export interface BoardThread {
  readonly title: string;
  readonly updatedAt: string;
}

/** One task: the thread to show, and every try of it, newest first (lead included). */
export interface ThreadRun<T extends BoardThread> {
  readonly lead: T;
  readonly tries: ReadonlyArray<T>;
  readonly status: BoardThreadStatus;
}

export interface ProjectSummary<T extends BoardThread> {
  readonly project: string;
  readonly runs: ReadonlyArray<ThreadRun<T>>;
  readonly threadCount: number;
  readonly needsYou: number;
  readonly running: number;
  /** Tasks whose latest state is failed; retries count once. */
  readonly failed: number;
  /** Threads that are over (done, failed, idle): what "archive finished" clears. */
  readonly finished: ReadonlyArray<T>;
  /** Newest update in the project, epoch ms. */
  readonly latest: number;
}

const STATUS_RANK: Record<BoardThreadStatus, number> = {
  "needs-you": 0,
  running: 1,
  failed: 2,
  done: 3,
  idle: 3,
};

const titleKey = (title: string) => title.trim().replace(/\s+/g, " ").toLowerCase();
const time = (thread: BoardThread) => Date.parse(thread.updatedAt) || 0;

/**
 * Folds threads with the same title (case and spacing aside) into one run.
 * The lead is the try that matters most: waiting on the owner, then running,
 * then the newest. Runs are ordered the same way.
 */
export function groupRetries<T extends BoardThread>(
  threads: ReadonlyArray<T>,
  statusOf: (thread: T) => BoardThreadStatus,
): ThreadRun<T>[] {
  const byTitle = new Map<string, T[]>();
  for (const thread of threads) {
    const key = titleKey(thread.title);
    const list = byTitle.get(key);
    if (list) list.push(thread);
    else byTitle.set(key, [thread]);
  }
  const rank = (thread: T) => STATUS_RANK[statusOf(thread)];
  return [...byTitle.values()]
    .map((tries) => {
      const sorted = [...tries].sort((a, b) => time(b) - time(a));
      const lead = [...sorted].sort((a, b) => rank(a) - rank(b) || time(b) - time(a))[0]!;
      return { lead, tries: sorted, status: statusOf(lead) };
    })
    .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || time(b.lead) - time(a.lead));
}

/**
 * One summary per project: projects that need the owner first, then ones
 * with something running, then the most recently active.
 */
export function summarizeProjects<T extends BoardThread>(
  threads: ReadonlyArray<T>,
  projectOf: (thread: T) => string,
  statusOf: (thread: T) => BoardThreadStatus,
): ProjectSummary<T>[] {
  const byProject = new Map<string, T[]>();
  for (const thread of threads) {
    const project = projectOf(thread);
    const list = byProject.get(project);
    if (list) list.push(thread);
    else byProject.set(project, [thread]);
  }
  const tier = (summary: ProjectSummary<T>) =>
    summary.needsYou > 0 ? 0 : summary.running > 0 ? 1 : 2;
  return [...byProject]
    .map(([project, list]): ProjectSummary<T> => {
      const runs = groupRetries(list, statusOf);
      const statuses = list.map(statusOf);
      return {
        project,
        runs,
        threadCount: list.length,
        needsYou: statuses.filter((status) => status === "needs-you").length,
        running: statuses.filter((status) => status === "running").length,
        failed: runs.filter((run) => run.status === "failed").length,
        finished: list.filter((_, index) => STATUS_RANK[statuses[index]!] >= STATUS_RANK.failed),
        latest: Math.max(...list.map(time)),
      };
    })
    .sort((a, b) => tier(a) - tier(b) || b.latest - a.latest);
}

/** The latest few tasks in a project, newest first, for a card's preview. */
export function latestRuns<T extends BoardThread>(
  summary: ProjectSummary<T>,
  count: number,
): ThreadRun<T>[] {
  return [...summary.runs].sort((a, b) => time(b.lead) - time(a.lead)).slice(0, count);
}
