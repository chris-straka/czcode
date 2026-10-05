/**
 * ResetQueueService - runs that wait for a provider's quota to reset, then
 * start as ordinary threads ("Run at next reset"; replaces nightshift). The
 * provider snapshots already carry each quota window's reset time.
 *
 * @module ResetQueueService
 */
import {
  CommandId,
  MessageId,
  QueuedRun,
  QueuedRunError,
  type QueuedRunInput,
  QueuedRunNotFoundError,
} from "@cz/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ForkDatabase from "../forkDatabase/ForkDatabase.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ProviderRegistry from "../provider/Services/ProviderRegistry.ts";

const POLL_INTERVAL = Duration.seconds(30);

export class ResetQueueService extends Context.Service<
  ResetQueueService,
  {
    readonly enqueue: (input: QueuedRunInput) => Effect.Effect<QueuedRun, QueuedRunError>;
    /** Queued runs by due time, then the 50 most recent others. */
    readonly list: Effect.Effect<ReadonlyArray<QueuedRun>, QueuedRunError>;
    readonly cancel: (
      id: string,
    ) => Effect.Effect<QueuedRun, QueuedRunNotFoundError | QueuedRunError>;
    /** Makes a queued run due now; the next poll starts it. */
    readonly runNow: (
      id: string,
    ) => Effect.Effect<QueuedRun, QueuedRunNotFoundError | QueuedRunError>;
    /** Starts every due run. Returns how many started. */
    readonly startDue: Effect.Effect<number, QueuedRunError>;
  }
>()("cz/resetQueue/ResetQueueService") {}

const RunJson = Schema.fromJsonString(QueuedRun);
const decodeRun = Schema.decodeEffect(RunJson);
const encodeRun = Schema.encodeEffect(RunJson);

type UsageWindow = {
  readonly usedPercent: number;
  readonly resetsAt?: string | undefined;
};

/** Spare allowance this close to a reset would expire unused, so queued runs take it. */
export const SPARE_ALLOWANCE_LEAD_MS = 45 * 60 * 1000;

const futureResets = (windows: ReadonlyArray<UsageWindow>, now: number) =>
  windows.flatMap((window) => {
    const at = window.resetsAt ? Date.parse(window.resetsAt) : Number.NaN;
    return Number.isFinite(at) && at > now ? [{ window, at }] : [];
  });

/**
 * When a queued run should start: once every spent window has reset (a spent
 * weekly window outranks the session reset), else at the soonest reset.
 * Null when the provider reports no reset times.
 */
export function nextResetAt(windows: ReadonlyArray<UsageWindow>, now: number): number | null {
  const resets = futureResets(windows, now);
  const spent = resets.filter(({ window }) => window.usedPercent >= 100);
  if (spent.length > 0) return Math.max(...spent.map(({ at }) => at));
  return resets.length > 0 ? Math.min(...resets.map(({ at }) => at)) : null;
}

/** True when nothing is spent and the soonest reset is near: start now rather than waste it. */
export function spareAllowanceExpiring(windows: ReadonlyArray<UsageWindow>, now: number): boolean {
  if (windows.some((window) => window.usedPercent >= 100)) return false;
  const soonest = nextResetAt(windows, now);
  return soonest !== null && soonest - now <= SPARE_ALLOWANCE_LEAD_MS;
}

const make = Effect.gen(function* () {
  const { sql } = yield* ForkDatabase.ForkDatabase;
  const crypto = yield* Crypto.Crypto;
  const providers = yield* ProviderRegistry.ProviderRegistry;
  const threadLaunch = yield* ThreadLaunchService.ThreadLaunchService;
  const failure = (reason: string) => (cause: unknown) => new QueuedRunError({ reason, cause });

  const write = (run: QueuedRun) =>
    encodeRun(run).pipe(
      Effect.flatMap(
        (json) => sql`
          INSERT INTO queued_runs ${sql.insert({
            id: run.id,
            status: run.status,
            due_at: run.dueAt,
            created_at: run.createdAt,
            run_json: json,
          })}
          ON CONFLICT(id) DO UPDATE SET
            status = excluded.status, due_at = excluded.due_at, run_json = excluded.run_json
        `,
      ),
      Effect.mapError(failure("Could not save the queued run.")),
    );

  const read = (where: ReturnType<typeof sql.and>, order: "due" | "created", limit: number) =>
    sql<{ run_json: string }>`
      SELECT run_json FROM queued_runs WHERE ${where}
      ORDER BY ${order === "due" ? sql`due_at ASC` : sql`created_at DESC`}
      LIMIT ${limit}
    `.pipe(
      Effect.flatMap(Effect.forEach((row) => decodeRun(row.run_json))),
      Effect.mapError(failure("Could not read the reset queue.")),
    );

  const find = (id: string) =>
    read(sql.and([sql`id = ${id}`]), "created", 1).pipe(
      Effect.flatMap((runs) =>
        runs[0] ? Effect.succeed(runs[0]) : Effect.fail(new QueuedRunNotFoundError({ id })),
      ),
    );

  const enqueue: ResetQueueService["Service"]["enqueue"] = Effect.fn("ResetQueueService.enqueue")(
    function* (input) {
      const now = yield* Clock.currentTimeMillis;
      let dueAt = input.dueAt ?? now;
      let dueReason: QueuedRun["dueReason"] = "chosen";
      if (input.dueAt === undefined) {
        const provider = (yield* providers.getProviders).find(
          (candidate) => candidate.instanceId === input.modelSelection.instanceId,
        );
        const reset = nextResetAt(provider?.usageLimits?.windows ?? [], now);
        dueAt = reset ?? now;
        dueReason = reset === null ? "unknown-reset" : "reset";
      }
      const run: QueuedRun = {
        id: yield* crypto.randomUUIDv4.pipe(Effect.mapError(failure("Could not make an id."))),
        title: input.title,
        prompt: input.prompt,
        projectId: input.projectId,
        modelSelection: input.modelSelection,
        runtimeMode: input.runtimeMode ?? "auto",
        interactionMode: input.interactionMode ?? "default",
        workspaceStrategy: input.workspaceStrategy ?? { type: "root" },
        dueAt,
        dueReason,
        source: input.source ?? "composer",
        status: "queued",
        createdAt: now,
        startedAt: null,
        threadId: null,
        error: null,
      };
      yield* write(run);
      return run;
    },
  );

  const list: ResetQueueService["Service"]["list"] = Effect.gen(function* () {
    const queued = yield* read(sql.and([sql`status = 'queued'`]), "due", 500);
    const others = yield* read(sql.and([sql`status != 'queued'`]), "created", 50);
    return [...queued, ...others];
  });

  const cancel: ResetQueueService["Service"]["cancel"] = Effect.fn("ResetQueueService.cancel")(
    function* (id) {
      const run = yield* find(id);
      if (run.status !== "queued") return run;
      const cancelled: QueuedRun = { ...run, status: "cancelled" };
      yield* write(cancelled);
      return cancelled;
    },
  );

  const runNow: ResetQueueService["Service"]["runNow"] = Effect.fn("ResetQueueService.runNow")(
    function* (id) {
      const run = yield* find(id);
      if (run.status !== "queued") return run;
      const due: QueuedRun = { ...run, dueAt: yield* Clock.currentTimeMillis, dueReason: "chosen" };
      yield* write(due);
      return due;
    },
  );

  const start = (run: QueuedRun) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const result = yield* Effect.exit(
        threadLaunch.launch({
          commandId: CommandId.make(`queued-run:${run.id}`),
          projectId: run.projectId,
          title: run.title,
          modelSelection: run.modelSelection,
          runtimeMode: run.runtimeMode,
          interactionMode: run.interactionMode,
          workspaceStrategy: run.workspaceStrategy,
          initialMessage: {
            messageId: MessageId.make(`queued-run-message:${run.id}`),
            text: run.prompt,
            attachments: [],
          },
          createdBy: run.source === "composer" ? "user" : "system",
          creationSource: "server",
        }),
      );
      yield* write(
        result._tag === "Success"
          ? { ...run, status: "started", startedAt: now, threadId: result.value.threadId }
          : { ...run, status: "failed", startedAt: now, error: String(result.cause) },
      );
      return result._tag === "Success";
    });

  const startDue: ResetQueueService["Service"]["startDue"] = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const queued = yield* read(sql.and([sql`status = 'queued'`]), "due", 500);
    if (queued.length === 0) return 0;
    const snapshots = yield* providers.getProviders;
    const expiring = (run: QueuedRun) =>
      run.dueReason === "reset" &&
      spareAllowanceExpiring(
        snapshots.find((provider) => provider.instanceId === run.modelSelection.instanceId)
          ?.usageLimits?.windows ?? [],
        now,
      );
    const due = queued.filter((run) => run.dueAt <= now || expiring(run)).slice(0, 20);
    let started = 0;
    for (const run of due) if (yield* start(run)) started += 1;
    return started;
  });

  return ResetQueueService.of({ enqueue, list, cancel, runNow, startDue });
});

/** The service alone; tests drive `startDue` themselves. */
export const serviceLayer = Layer.effect(ResetQueueService, make);

const poller = Effect.gen(function* () {
  const queue = yield* ResetQueueService;
  yield* Effect.forkScoped(
    Effect.forever(
      Effect.sleep(POLL_INTERVAL).pipe(
        Effect.andThen(queue.startDue),
        Effect.catch((error) => Effect.logWarning("Reset queue poll failed.", error)),
      ),
    ),
  );
});

/** The service plus the poller that starts due runs every 30 seconds. */
export const layer = Layer.effectDiscard(poller).pipe(Layer.provideMerge(serviceLayer));
