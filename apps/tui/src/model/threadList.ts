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

export function threadRows(environments: ReadonlyArray<EnvironmentShell>): Array<ThreadRow> {
  const rows: Array<ThreadRow> = [];
  for (const environment of environments) {
    const snapshot = environment.snapshot;
    if (snapshot === null) continue;
    const projects = new Map(snapshot.projects.map((project) => [project.id, project.title]));
    for (const thread of snapshot.threads) {
      if (thread.deletedAt !== null || thread.archivedAt !== null) continue;
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
