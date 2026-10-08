/**
 * The thread list across every connected environment, newest activity first,
 * with the project each thread belongs to. Pure, so the ordering is testable.
 *
 * @module threadList
 */
import type {
  EnvironmentId,
  OrchestrationV2ShellSnapshot,
  OrchestrationV2ThreadShell,
} from "@cz/contracts";
import * as DateTime from "effect/DateTime";

export interface ThreadRow {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly projectTitle: string;
  readonly thread: OrchestrationV2ThreadShell;
  readonly updatedAtMs: number;
}

export interface EnvironmentShell {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly snapshot: OrchestrationV2ShellSnapshot | null;
}

/**
 * Every thread across the environments, pinned first, then newest activity.
 * `archived` lists the archive instead (the Archived view reads a separate
 * snapshot with the same shape).
 */
export function threadRows(
  environments: ReadonlyArray<EnvironmentShell>,
  options: { readonly archived?: boolean } = {},
): Array<ThreadRow> {
  const rows: Array<ThreadRow> = [];
  for (const environment of environments) {
    const snapshot = environment.snapshot;
    if (snapshot === null) continue;
    const projects = new Map(snapshot.projects.map((project) => [project.id, project.title]));
    for (const thread of snapshot.threads) {
      if (thread.deletedAt !== null) continue;
      if ((thread.archivedAt !== null) !== (options.archived ?? false)) continue;
      rows.push({
        environmentId: environment.environmentId,
        environmentLabel: environment.label,
        projectTitle: projects.get(thread.projectId) ?? "",
        thread,
        updatedAtMs: DateTime.toEpochMillis(thread.updatedAt),
      });
    }
  }
  return rows.sort(
    (left, right) =>
      Number(right.thread.pinnedAt != null) - Number(left.thread.pinnedAt != null) ||
      right.updatedAtMs - left.updatedAtMs,
  );
}

export type ThreadSection = "pinned" | "active" | "snoozed" | "settled";

/**
 * The desktop sidebar's shelf for a thread. Snooze wins until it wakes or the
 * thread needs the user; settled then wins over a stale pin.
 */
export function threadSection(thread: OrchestrationV2ThreadShell, nowMs: number): ThreadSection {
  const snoozedUntil = thread.snoozedUntil ? DateTime.toEpochMillis(thread.snoozedUntil) : null;
  if (snoozedUntil !== null && snoozedUntil > nowMs && thread.pendingRuntimeRequest === null) {
    return "snoozed";
  }
  if (thread.settledOverride === "settled") return "settled";
  if (thread.pinnedAt != null) return "pinned";
  return "active";
}

export type ThreadListItem =
  | {
      readonly kind: "header";
      readonly section: ThreadSection;
      readonly count: number;
      readonly expanded: boolean;
    }
  | { readonly kind: "thread"; readonly row: ThreadRow; readonly section: ThreadSection };

/** Snoozed and settled shelves start folded, as they do on desktop. */
export const FOLDED_SECTIONS: ReadonlyArray<ThreadSection> = ["snoozed", "settled"];

/**
 * The list as rows to draw: pinned and active threads, then a header for each
 * non-empty folded shelf followed by its threads when unfolded. A search
 * (`query`, plus thread keys the server matched by message text) flattens it.
 */
export function threadListItems(
  rows: ReadonlyArray<ThreadRow>,
  options: {
    readonly nowMs: number;
    readonly unfolded: ReadonlySet<ThreadSection>;
    readonly query?: string;
    readonly messageMatches?: ReadonlySet<string>;
  },
): Array<ThreadListItem> {
  const query = options.query?.trim().toLowerCase() ?? "";
  if (query !== "") {
    return rows
      .filter(
        (row) =>
          row.thread.title.toLowerCase().includes(query) ||
          row.projectTitle.toLowerCase().includes(query) ||
          (options.messageMatches?.has(threadKey(row)) ?? false),
      )
      .map((row) => ({ kind: "thread", row, section: threadSection(row.thread, options.nowMs) }));
  }
  const bySection = new Map<ThreadSection, Array<ThreadRow>>();
  for (const row of rows) {
    const section = threadSection(row.thread, options.nowMs);
    bySection.set(section, [...(bySection.get(section) ?? []), row]);
  }
  const items: Array<ThreadListItem> = [];
  for (const section of ["pinned", "active", ...FOLDED_SECTIONS] as const) {
    const sectionRows = bySection.get(section) ?? [];
    const folds = FOLDED_SECTIONS.includes(section);
    if (folds && sectionRows.length === 0) continue;
    const expanded = !folds || options.unfolded.has(section);
    if (folds) items.push({ kind: "header", section, count: sectionRows.length, expanded });
    if (expanded) for (const row of sectionRows) items.push({ kind: "thread", row, section });
  }
  return items;
}

export const threadKey = (row: Pick<ThreadRow, "environmentId" | "thread">) =>
  `${row.environmentId}:${row.thread.id}`;

/** A one-word state for the list: what the thread needs from you, if anything. */
export function threadState(thread: OrchestrationV2ThreadShell): string {
  if (thread.pendingRuntimeRequest !== null) return "needs you";
  if (thread.activeRunId !== null) return "working";
  if (thread.status === "failed") return "failed";
  if (thread.hasActionableProposedPlan) return "plan ready";
  return "";
}

/** "3m", "5h", "2d": compact age for a 60-column list. */
export function age(nowMs: number, thenMs: number): string {
  const minutes = Math.max(0, Math.round((nowMs - thenMs) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
