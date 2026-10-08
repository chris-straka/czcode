import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as EventSink from "./EventSink.ts";
import * as IdAllocator from "./IdAllocator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as StuckRunStarts from "./StuckRunStarts.ts";

const NOW = Date.parse("2026-10-08T18:00:00Z");
const MINUTE = 60_000;
const iso = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));

const written: Array<Parameters<EventSink.EventSinkV2["Service"]["writeIfRunCurrent"]>[0]> = [];

const runFor = (id: string) => ({
  id,
  threadId: `thread-${id}`,
  ordinal: 1,
  status: "starting",
  activeAttemptId: `attempt-${id}`,
  providerInstanceId: "claudeAgent",
  completedAt: null,
});

const TestLayer = StuckRunStarts.serviceLayer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getRuntimeRecoveryProjection: (threadId) => {
          const id = String(threadId).replace("thread-", "");
          return Effect.succeed({
            runs: [runFor(id)],
            attempts: [
              {
                id: `attempt-${id}`,
                runId: id,
                rootNodeId: `node-${id}`,
                providerThreadId: `provider-thread-${id}`,
                status: "pending",
              },
            ],
            nodes: [{ id: `node-${id}`, runId: id, status: "pending" }],
            turnItems: [],
          } as unknown as ProjectionStore.ProjectionRuntimeRecoveryState);
        },
      }),
      Layer.mock(EventSink.EventSinkV2)({
        writeIfRunCurrent: (input) =>
          Effect.sync(() => {
            written.push(input);
            return { committed: true, storedEvents: [] };
          }),
      }),
      IdAllocator.layer,
    ),
  ),
  Layer.provideMerge(SqlitePersistence.layerMemory),
);

const insertRun = (id: string, requestedAt: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO orchestration_v2_projection_runs ${sql.insert({
        run_id: id,
        thread_id: `thread-${id}`,
        ordinal: 1,
        provider: "claudeAgent",
        status: "starting",
        requested_at: iso(requestedAt),
        payload_json: JSON.stringify(runFor(id)),
      })}
    `;
  });

const insertStartEffect = (id: string, status: string, lastError: string | null) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO orchestration_v2_effect_outbox ${sql.insert({
        effect_id: `effect-${id}`,
        command_id: `command-${id}`,
        thread_id: `thread-${id}`,
        effect_type: "provider-turn.start",
        payload_json: JSON.stringify({ type: "provider-turn.start", runId: id }),
        status,
        available_at: iso(NOW - 60 * MINUTE),
        created_at: iso(NOW - 60 * MINUTE),
        updated_at: iso(NOW - 60 * MINUTE),
        last_error: lastError,
      })}
    `;
  });

describe("StuckRunStarts", () => {
  it.layer(TestLayer)((it) => {
    it.effect("fails a start whose effect was cancelled, and leaves live or fresh ones", () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        const restartLoss =
          "Cancelled because the server process ended before the effect completed.";
        // Retired by startup recovery an hour ago: nothing will start it.
        yield* insertRun("cancelled", NOW - 60 * MINUTE);
        yield* insertStartEffect("cancelled", "cancelled", restartLoss);
        // Still waiting on its effect: a slow start, not a stuck one.
        yield* insertRun("pending", NOW - 60 * MINUTE);
        yield* insertStartEffect("pending", "pending", null);
        // Too young to judge.
        yield* insertRun("fresh", NOW - 2 * MINUTE);

        const stuck = yield* StuckRunStarts.StuckRunStarts;
        assert.equal(yield* stuck.sweep, 1);
        assert.equal(written.length, 1);
        const [write] = written;
        assert.equal(write?.runId, "cancelled");
        assert.equal(write?.expectedStatus, "starting");
        assert.deepStrictEqual(
          write?.events.map((event) => event.type),
          ["turn-item.updated", "run.updated", "run-attempt.updated", "node.updated"],
        );
        const item = write?.events[0];
        assert.equal(
          item?.type === "turn-item.updated" && item.payload.type === "error"
            ? item.payload.failure.message
            : null,
          `The provider turn never started: ${restartLoss}`,
        );
        const run = write?.events[1];
        assert.equal(run?.type === "run.updated" ? run.payload.status : null, "failed");
      }),
    );
  });

  it("explains a start with no effect at all", () => {
    assert.equal(
      StuckRunStarts.stuckStartMessage(null),
      "The provider turn never started, and nothing was left to start it.",
    );
  });
});
