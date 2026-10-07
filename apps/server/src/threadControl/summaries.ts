/**
 * The rows `cz thread list` shows, built from the thread shells and projects.
 *
 * @module threadControlSummaries
 */
import type { OrchestrationV2ThreadShell, Project, ThreadControlSummary } from "@cz/contracts";
import * as DateTime from "effect/DateTime";

import { threadKeepsAwake } from "../hostSleep/idle.ts";

/** Live threads, running first, then most recently updated. */
export function threadSummaries(
  threads: ReadonlyArray<OrchestrationV2ThreadShell>,
  projects: ReadonlyArray<Pick<Project, "id" | "title">>,
  now: number,
): Array<ThreadControlSummary> {
  const projectTitles = new Map(projects.map((project) => [project.id, project.title]));
  return threads
    .filter((thread) => thread.deletedAt === null)
    .map((thread) => ({
      threadId: thread.id,
      projectId: thread.projectId,
      projectTitle: projectTitles.get(thread.projectId) ?? null,
      title: thread.title,
      model: `${thread.modelSelection.instanceId}/${thread.modelSelection.model}`,
      running: thread.activeRunId !== null,
      busy: threadKeepsAwake(thread, now),
      archived: thread.archivedAt !== null,
      updatedAt: DateTime.formatIso(thread.updatedAt),
    }))
    .toSorted(
      (left, right) =>
        Number(right.running) - Number(left.running) ||
        right.updatedAt.localeCompare(left.updatedAt),
    );
}
