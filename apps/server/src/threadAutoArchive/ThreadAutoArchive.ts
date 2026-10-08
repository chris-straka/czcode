/**
 * Finished threads archive themselves (fork): the owner shouldn't have to
 * tidy up after agents. A thread nobody has touched for a week, with nothing
 * running, pending, snoozed, pinned, or asked of the owner, is archived;
 * Settings → Archived brings it back.
 *
 * @module ThreadAutoArchive
 */
import { CommandId } from "@cz/contracts";
import { backgroundWorkHoldsCompletion } from "@cz/shared/orchestrationV2PendingBackgroundWork";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";

import * as DecisionService from "../decisions/DecisionService.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { threadHasQueuedTurnStart } from "../orchestration-v2/ThreadSettlementService.ts";

/** How long a finished thread sits untouched before it archives itself. */
export const ARCHIVE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

const millis = (value: DateTime.Utc | null | undefined) =>
  value == null ? null : DateTime.toEpochMillis(value);

/** True when a thread is finished and has sat untouched long enough to archive. */
export function shouldAutoArchive(
  thread: ProjectionStore.ProjectionSettlementCandidate,
  openDecisionThreads: ReadonlySet<string>,
  nowMs: number,
): boolean {
  if (thread.archivedAt !== null || thread.pinnedAt != null) return false;
  if (thread.pendingRuntimeRequest !== null || thread.activityRunStatus != null) return false;
  if (backgroundWorkHoldsCompletion(thread.pendingBackgroundTasks ?? [])) return false;
  if (threadHasQueuedTurnStart(thread, nowMs)) return false;
  if ((millis(thread.snoozedUntil) ?? 0) > nowMs) return false;
  if (openDecisionThreads.has(thread.id)) return false;
  const lastActivity = Math.max(
    millis(thread.updatedAt) ?? 0,
    millis(thread.latestUserMessageAt) ?? 0,
    millis(thread.latestRunCompletedAt) ?? 0,
  );
  return lastActivity > 0 && lastActivity < nowMs - ARCHIVE_AFTER_MS;
}

const make = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const decisions = yield* DecisionService.DecisionService;
  const crypto = yield* Crypto.Crypto;

  const sweep = Effect.gen(function* () {
    const threads = yield* projections.getSettlementCandidates();
    const open = yield* decisions.list({ status: "open", limit: 1000 });
    const asking = new Set(open.flatMap(({ item }) => (item.thread ? [item.thread] : [])));
    const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
    for (const thread of threads) {
      if (!shouldAutoArchive(thread, asking, nowMs)) continue;
      const uuid = yield* crypto.randomUUIDv4;
      yield* orchestrator
        .dispatch({
          type: "thread.archive",
          commandId: CommandId.make(`server:auto-archive:${thread.id}:${uuid}`),
          threadId: thread.id,
        })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Auto-archive skipped a thread.", { threadId: thread.id, cause }),
          ),
        );
    }
  }).pipe(
    Effect.catchCause((cause) => Effect.logWarning("Thread auto-archive sweep failed.", { cause })),
  );

  yield* Effect.forkScoped(sweep.pipe(Effect.repeat(Schedule.spaced("1 hour"))));
});

/** Archives finished threads on an hourly sweep for as long as the server runs. */
export const layer = Layer.effectDiscard(make);
