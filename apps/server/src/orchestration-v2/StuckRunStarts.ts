/**
 * StuckRunStarts - fails runs that sit in `starting` with nothing left to
 * start them. A run's provider turn starts through a `provider-turn.start`
 * effect; when that effect is cancelled or lost (startup recovery retiring it,
 * a crash between commit and claim), the run would otherwise stay `starting`
 * forever and read as working. After a grace period it fails with a reason.
 *
 * @module StuckRunStarts
 */
import { RunId, ThreadId, type OrchestrationV2DomainEvent } from "@cz/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { forkParked } from "../serverActivation.ts";
import * as EventSink from "./EventSink.ts";
import * as IdAllocator from "./IdAllocator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import { makeProviderFailure } from "./ProviderFailure.ts";

/** A healthy start leaves `starting` in seconds; a slow provider login in a few minutes. */
const STUCK_START_AFTER_MS = 15 * 60_000;
const SWEEP_INTERVAL = Duration.minutes(5);

export interface StuckRunStart {
  readonly threadId: string;
  readonly runId: string;
  /** Why the start effect ended, when it did. */
  readonly lastError: string | null;
}

export class StuckRunStarts extends Context.Service<
  StuckRunStarts,
  {
    /** Fails every stuck start and returns how many it failed. */
    readonly sweep: Effect.Effect<number>;
  }
>()("cz/orchestration-v2/StuckRunStarts") {}

/** What the failed run tells the user. */
export function stuckStartMessage(lastError: string | null): string {
  return lastError === null
    ? "The provider turn never started, and nothing was left to start it."
    : `The provider turn never started: ${lastError}`;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const eventSink = yield* EventSink.EventSinkV2;
  const ids = yield* IdAllocator.IdAllocatorV2;

  /** Runs `starting` past the grace period whose start effect is no longer pending or running. */
  const findStuck = (olderThan: string) =>
    sql<StuckRunStart>`
      SELECT
        runs.thread_id AS threadId,
        runs.run_id AS runId,
        (
          SELECT outbox.last_error FROM orchestration_v2_effect_outbox AS outbox
          WHERE outbox.effect_type = 'provider-turn.start'
            AND outbox.thread_id = runs.thread_id
            AND json_extract(outbox.payload_json, '$.runId') = runs.run_id
          ORDER BY outbox.updated_at DESC LIMIT 1
        ) AS lastError
      FROM orchestration_v2_projection_runs AS runs
      WHERE runs.status = 'starting'
        AND runs.requested_at < ${olderThan}
        AND NOT EXISTS (
          SELECT 1 FROM orchestration_v2_effect_outbox AS outbox
          WHERE outbox.effect_type = 'provider-turn.start'
            AND outbox.thread_id = runs.thread_id
            AND outbox.status IN ('pending', 'running')
            AND json_extract(outbox.payload_json, '$.runId') = runs.run_id
        )
    `;

  const fail = Effect.fn("StuckRunStarts.fail")(function* (stuck: StuckRunStart) {
    const threadId = ThreadId.make(stuck.threadId);
    const projection = yield* projections.getRuntimeRecoveryProjection(threadId);
    const run = projection.runs.find((candidate) => candidate.id === stuck.runId);
    if (run === undefined || run.status !== "starting" || run.activeAttemptId === null) return 0;
    const attempt = projection.attempts.find((candidate) => candidate.id === run.activeAttemptId);
    const rootNode = projection.nodes.find((candidate) => candidate.id === attempt?.rootNodeId);
    if (attempt === undefined || rootNode === undefined) return 0;
    const now = yield* DateTime.now;
    const runId = RunId.make(stuck.runId);
    const payloads = [
      {
        type: "turn-item.updated",
        payload: {
          id: ids.derive.runSignalTurnItem({ runId, signal: "stuck-start" }),
          threadId,
          runId,
          nodeId: rootNode.id,
          providerThreadId: attempt.providerThreadId,
          providerTurnId: null,
          nativeItemRef: null,
          parentItemId: null,
          ordinal:
            Math.max(
              0,
              ...projection.turnItems
                .filter((item) => item.runId === runId)
                .map((item) => item.ordinal),
            ) + 1,
          status: "failed",
          startedAt: now,
          completedAt: now,
          updatedAt: now,
          type: "error",
          title: "Provider turn never started",
          failure: makeProviderFailure({
            class: "provider_error",
            message: stuckStartMessage(stuck.lastError),
          }),
        },
      },
      { type: "run.updated", payload: { ...run, status: "failed", completedAt: now } },
      { type: "run-attempt.updated", payload: { ...attempt, status: "failed", completedAt: now } },
      { type: "node.updated", payload: { ...rootNode, status: "failed", completedAt: now } },
    ] as const;
    const events = yield* Effect.forEach(payloads, (event) =>
      Effect.gen(function* () {
        return {
          ...event,
          id: yield* ids.allocate.event({ threadId }),
          threadId,
          runId,
          nodeId: rootNode.id,
          providerInstanceId: run.providerInstanceId,
          occurredAt: now,
        } satisfies OrchestrationV2DomainEvent;
      }),
    );
    const written = yield* eventSink.writeIfRunCurrent({
      threadId,
      runId,
      activeAttemptId: attempt.id,
      expectedStatus: "starting",
      events,
    });
    if (!written.committed) return 0;
    yield* Effect.logWarning("Failed a run stuck in starting.", {
      threadId,
      runId,
      lastError: stuck.lastError,
    });
    return 1;
  });

  const sweep = Effect.gen(function* () {
    const now = yield* DateTime.now;
    const olderThan = DateTime.formatIso(
      DateTime.subtract(now, { milliseconds: STUCK_START_AFTER_MS }),
    );
    const stuck = yield* findStuck(olderThan);
    let failed = 0;
    for (const candidate of stuck) {
      failed += yield* fail(candidate).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Could not fail a stuck run start.", {
            runId: candidate.runId,
            cause,
          }).pipe(Effect.as(0)),
        ),
      );
    }
    return failed;
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Stuck run start sweep failed.", { cause }).pipe(Effect.as(0)),
    ),
  );

  return StuckRunStarts.of({ sweep });
});

/** The sweep alone; tests run it themselves. */
export const serviceLayer = Layer.effect(StuckRunStarts, make);

/** The sweep, run every five minutes once startup recovery is done. */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const stuck = yield* StuckRunStarts;
    yield* forkParked(
      Effect.forever(stuck.sweep.pipe(Effect.andThen(Effect.sleep(SWEEP_INTERVAL)))),
    );
  }),
).pipe(Layer.provideMerge(serviceLayer));
