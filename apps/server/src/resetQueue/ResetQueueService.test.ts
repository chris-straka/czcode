import {
  ProjectId,
  ProviderInstanceId,
  type QueuedRunInput,
  type ServerProvider,
  ThreadId,
} from "@cz/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import * as ForkDatabase from "../forkDatabase/ForkDatabase.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ResetQueueService from "./ResetQueueService.ts";

const NIGHT = Date.parse("2026-10-05T22:00:00Z");
const HOUR = 60 * 60 * 1000;
const at = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));

const instanceId = ProviderInstanceId.make("claude");
let windows: ServerProvider["usageLimits"] extends infer U
  ? U extends { windows: infer W }
    ? W
    : never
  : never = [];
const launched: Array<string> = [];

const TestLayer = ResetQueueService.serviceLayer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      Layer.mock(ProviderRegistry.ProviderRegistry)({
        getProviders: Effect.sync(() => [
          {
            instanceId,
            driver: "claude",
            enabled: true,
            usageLimits: { checkedAt: at(NIGHT), windows },
          } as unknown as ServerProvider,
          {
            instanceId: ProviderInstanceId.make("codexWork"),
            driver: "codex",
            enabled: true,
          } as unknown as ServerProvider,
        ]),
      }),
      Layer.mock(ThreadLaunchService.ThreadLaunchService)({
        launch: (input) =>
          input.title === "breaks"
            ? Effect.die(new Error("launch failed"))
            : Effect.sync(() => {
                launched.push(input.title);
                return {
                  threadId: ThreadId.make(`thread-${input.title}`),
                  projection: undefined as never,
                  resumed: false,
                };
              }),
      }),
    ),
  ),
  Layer.provideMerge(ForkDatabase.layer),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "cz-queue-" })),
  Layer.provideMerge(NodeServices.layer),
);

const task = (title: string, overrides: Partial<QueuedRunInput> = {}): QueuedRunInput => ({
  title,
  prompt: `Do ${title}`,
  projectId: ProjectId.make("project-1"),
  modelSelection: { instanceId, model: "claude-opus-5-5" },
  ...overrides,
});

const window = (usedPercent: number, resetsAt: number, kind: "session" | "weekly") => ({
  id: kind,
  kind,
  label: kind,
  usedPercent,
  resetsAt: at(resetsAt),
});

describe("nextResetAt", () => {
  it("waits for every spent window, so a spent week outranks the session", () => {
    assert.equal(
      ResetQueueService.nextResetAt(
        [window(100, NIGHT + 2 * HOUR, "session"), window(100, NIGHT + 50 * HOUR, "weekly")],
        NIGHT,
      ),
      NIGHT + 50 * HOUR,
    );
  });

  it("takes the soonest reset when nothing is spent, and ignores past resets", () => {
    assert.equal(
      ResetQueueService.nextResetAt(
        [
          window(40, NIGHT - HOUR, "session"),
          window(60, NIGHT + 3 * HOUR, "session"),
          window(20, NIGHT + 50 * HOUR, "weekly"),
        ],
        NIGHT,
      ),
      NIGHT + 3 * HOUR,
    );
    assert.equal(ResetQueueService.nextResetAt([], NIGHT), null);
  });
});

it.layer(TestLayer)("ResetQueueService", (it) => {
  it.effect("queues for the reset, starts it once due, and records the thread", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NIGHT);
      windows = [window(100, NIGHT + 2 * HOUR, "session"), window(30, NIGHT + 50 * HOUR, "weekly")];
      const queue = yield* ResetQueueService.ResetQueueService;

      const run = yield* queue.enqueue(task("night-run"));
      assert.equal(run.dueAt, NIGHT + 2 * HOUR);
      assert.equal(run.dueReason, "reset");
      assert.equal(yield* queue.startDue, 0);

      yield* TestClock.setTime(NIGHT + 2 * HOUR);
      assert.equal(yield* queue.startDue, 1);
      const [started] = yield* queue.list;
      assert.equal(started?.status, "started");
      assert.equal(started?.threadId, "thread-night-run");
      assert.isTrue(launched.includes("night-run"));
    }),
  );

  it.effect("starts early when spare allowance would expire unused", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NIGHT);
      windows = [window(50, NIGHT + 3 * HOUR, "session")];
      const queue = yield* ResetQueueService.ResetQueueService;
      const run = yield* queue.enqueue(task("burn"));
      assert.equal(yield* queue.startDue, 0);

      yield* TestClock.setTime(NIGHT + 2.5 * HOUR);
      assert.equal(yield* queue.startDue, 1);
      assert.equal((yield* queue.list).find((entry) => entry.id === run.id)?.status, "started");
    }),
  );

  it.effect("cancel, run now, and a failed launch each leave a visible state", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NIGHT);
      windows = [];
      const queue = yield* ResetQueueService.ResetQueueService;

      const later = yield* queue.enqueue(task("later", { dueAt: NIGHT + 10 * HOUR }));
      const cancelled = yield* queue.cancel(later.id);
      assert.equal(cancelled.status, "cancelled");

      const unknown = yield* queue.enqueue(task("breaks"));
      assert.equal(unknown.dueReason, "unknown-reset");

      const chosen = yield* queue.enqueue(task("now", { dueAt: NIGHT + 10 * HOUR }));
      yield* queue.runNow(chosen.id);
      yield* queue.startDue;

      const byId = new Map((yield* queue.list).map((entry) => [entry.id, entry]));
      assert.equal(byId.get(later.id)?.status, "cancelled");
      assert.equal(byId.get(unknown.id)?.status, "failed");
      assert.isNotNull(byId.get(unknown.id)?.error);
      assert.equal(byId.get(chosen.id)?.status, "started");

      const missing = yield* queue.cancel("nope").pipe(Effect.flip);
      assert.equal(missing._tag, "QueuedRunNotFoundError");

      // A failed run is dismissed with cancel and leaves the queue for good.
      const dismissed = yield* queue.cancel(unknown.id);
      assert.equal(dismissed.status, "cancelled");
      assert.equal(yield* queue.startDue, 0);
    }),
  );

  it.effect("takes a driver name for its instance and refuses a provider the host lacks", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NIGHT);
      windows = [];
      const queue = yield* ResetQueueService.ResetQueueService;

      const byDriver = yield* queue.enqueue(
        task("by-driver", {
          modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
        }),
      );
      assert.equal(byDriver.modelSelection.instanceId, "codexWork");

      const unknown = yield* queue
        .enqueue(
          task("nowhere", {
            modelSelection: { instanceId: ProviderInstanceId.make("grok"), model: "grok-5" },
          }),
        )
        .pipe(Effect.flip);
      assert.equal(unknown._tag, "QueuedRunError");
      assert.include(unknown.message, "claude, codexWork");
    }),
  );

  it.effect("follow-ups start now when quota is free, else at the reset; one per decision", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NIGHT);
      const queue = yield* ResetQueueService.ResetQueueService;

      windows = [window(40, NIGHT + 3 * HOUR, "session")];
      const free = yield* queue.enqueue(
        task("resume-free", { start: "when-available", decisionId: "dec-free" }),
      );
      assert.equal(free.dueReason, "available");
      assert.equal(free.dueAt, NIGHT);

      windows = [window(100, NIGHT + 3 * HOUR, "session")];
      const spent = yield* queue.enqueue(
        task("resume-spent", { start: "when-available", decisionId: "dec-spent" }),
      );
      assert.equal(spent.dueAt, NIGHT + 3 * HOUR);

      assert.equal((yield* queue.forDecision("dec-free"))?.id, free.id);
      assert.isNull(yield* queue.forDecision("dec-none"));
      const again = yield* queue
        .enqueue(task("resume-free", { decisionId: "dec-free" }))
        .pipe(Effect.flip);
      assert.equal(again._tag, "QueuedRunError");
    }),
  );
});
