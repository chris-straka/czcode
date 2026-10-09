/**
 * Installs a desktop app update the app has already downloaded, but only at
 * a moment nobody will miss the app: no agent turn running or about to
 * start, nothing busy for a while, nobody at the keyboard, the newest build
 * settled, and no automatic restart in the last hour. Otherwise the sidebar
 * keeps showing "Restart to update" and the owner decides. Each decision is
 * recorded once when it changes, as a `desktopUpdate.decision` span in the
 * server trace (`grep desktopUpdate.decision server.trace.ndjson`), so the log
 * answers "why did (or didn't) the app restart?".
 *
 * The install goes through DesktopAppUpdate, the same prepare-then-commit
 * handshake a remote "update desktop" request uses. Preparing can take
 * minutes when a newer build lands meanwhile, so the rules are checked again
 * between prepare and commit.
 *
 * @module DesktopUpdateWhenIdle
 */
import type { DesktopUpdateStatusReport } from "@cz/contracts";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";

import * as ServerConfig from "../config.ts";
import { nextWakeAt, threadKeepsAwake } from "../hostSleep/idle.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as DesktopTelemetryReceiver from "../resourceTelemetry/DesktopTelemetryReceiver.ts";
import * as ResetQueueService from "../resetQueue/ResetQueueService.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as DesktopAppUpdate from "./DesktopAppUpdate.ts";

const CHECK_INTERVAL = Duration.minutes(1);
const MINUTE = 60 * 1000;
/** A queued run or scheduled task due this soon counts as about to start. */
const UPCOMING_WORK_MS = 10 * MINUTE;
/** Nothing busy for this long: a gap between two turns is not idle. */
export const QUIET_MS = 10 * MINUTE;
/** A new build waits this long, so a burst of pushes to main costs one restart. */
export const SETTLE_MS = 15 * MINUTE;
/** At most one automatic restart this often; a click is not limited. */
export const MIN_RESTART_GAP_MS = 60 * MINUTE;
/** Keyboard or mouse used within this long: ask instead of restarting. */
export const OWNER_IDLE_MS = 15 * MINUTE;

/**
 * What keeps this host busy right now, or null when it is idle: a turn
 * running, a message waiting to start one, background tasks, or a queued
 * run or scheduled task due within 10 minutes. The same rule host sleep and
 * ccez/hosts/cz-update.sh use; replace it with the shared capacity query
 * ("anything running or about to start on this host") once that lands.
 */
const hostBusy = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const queue = yield* ResetQueueService.ResetQueueService;
  const scheduledTasks = yield* ScheduledTaskService.ScheduledTaskService;
  const now = yield* Clock.currentTimeMillis;
  const shells = yield* projections.getShellSnapshot();
  if (shells.threads.some((thread) => threadKeepsAwake(thread, now))) return "agents running";
  const nextRun = nextWakeAt({
    queuedRuns: yield* queue.list,
    scheduledTasks: (yield* scheduledTasks.list()).tasks,
  });
  return nextRun !== null && nextRun - now < UPCOMING_WORK_MS ? "agent work about to start" : null;
});

export interface RestartInput {
  readonly now: number;
  readonly report: Option.Option<DesktopUpdateStatusReport>;
  /** hostBusy's answer. */
  readonly busy: string | null;
  /** Last time hostBusy was not null; server start counts. */
  readonly lastBusyAt: number;
  /** When the downloaded version was first seen. */
  readonly downloadedSince: number;
  readonly lastAutoRestartAt: number | null;
  /** Seconds since the last keyboard or mouse input; null when unknown. */
  readonly ownerIdleSeconds: number | null;
  readonly screenLocked: boolean;
}

export type RestartDecision =
  | { readonly action: "install"; readonly version: string }
  | { readonly action: "nothing" }
  | { readonly action: "wait"; readonly reason: string };

/** Whether to restart into the downloaded update now, and if not, why. */
export function decideRestart(input: RestartInput): RestartDecision {
  if (Option.isNone(input.report)) return { action: "nothing" };
  const state = input.report.value.state;
  // After a failed install it waits for a click, so a broken update can't
  // restart the app over and over.
  if (state.downloadedVersion === null || state.errorContext === "install") {
    return { action: "nothing" };
  }
  if (input.busy !== null) return { action: "wait", reason: input.busy };
  if (state.status !== "downloaded" || state.availableVersion !== state.downloadedVersion) {
    return { action: "wait", reason: "a newer build is downloading" };
  }
  if (input.now - input.lastBusyAt < QUIET_MS) {
    return { action: "wait", reason: "agents were working in the last 10 minutes" };
  }
  if (input.now - input.downloadedSince < SETTLE_MS) {
    return { action: "wait", reason: "waiting in case a newer build lands" };
  }
  if (
    input.lastAutoRestartAt !== null &&
    input.now - input.lastAutoRestartAt < MIN_RESTART_GAP_MS
  ) {
    return { action: "wait", reason: "restarted for an update within the hour" };
  }
  // Unknown activity counts as someone there: asking is the safe default.
  const ownerAway =
    input.screenLocked ||
    (input.ownerIdleSeconds !== null && input.ownerIdleSeconds * 1000 >= OWNER_IDLE_MS);
  if (!ownerAway) {
    return { action: "wait", reason: "someone is using the Mac; showing Restart to update" };
  }
  return { action: "install", version: state.downloadedVersion };
}

/** One line in the server trace: the trace keeps spans, not bare log lines. */
const record = (line: string) =>
  Effect.logInfo(line).pipe(
    Effect.withSpan("desktopUpdate.decision", { attributes: { decision: line } }),
  );

function describe(decision: RestartDecision): string {
  switch (decision.action) {
    case "install":
      return `desktop update: installing ${decision.version}`;
    case "wait":
      return `desktop update: deferred (${decision.reason})`;
    case "nothing":
      return "";
  }
}

const run = Effect.gen(function* () {
  const update = yield* DesktopAppUpdate.DesktopAppUpdate;
  if (!update.available) return;
  const receiver = yield* DesktopTelemetryReceiver.DesktopTelemetryReceiver;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  // Survives the restart it records, so the hourly limit holds across them.
  const restartFile = path.join(config.stateDir, "desktop-update-restart.txt");

  const startedAt = yield* Clock.currentTimeMillis;
  const lastBusyAt = yield* Ref.make(startedAt);
  const downloaded = yield* Ref.make({ version: null as string | null, since: startedAt });
  const lastLogged = yield* Ref.make("");

  const readInput = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const report = yield* Effect.scoped(
      receiver.desktopUpdates.pipe(Effect.map((reports) => reports.latest)),
    );
    const version = Option.isSome(report) ? report.value.state.downloadedVersion : null;
    const since = yield* Ref.modify(downloaded, (current) => {
      const next = current.version === version ? current : { version, since: now };
      return [next.since, next] as const;
    });
    const busy = yield* hostBusy;
    if (busy !== null) yield* Ref.set(lastBusyAt, now);
    const power = Option.map(yield* receiver.latest, (snapshot) => snapshot.power);
    const lastAutoRestartAt = yield* fs.readFileString(restartFile).pipe(
      Effect.map((text) => Number(text.trim())),
      Effect.map((at) => (Number.isFinite(at) && at > 0 ? at : null)),
      Effect.orElseSucceed(() => null),
    );
    return {
      now,
      report,
      busy,
      lastBusyAt: yield* Ref.get(lastBusyAt),
      downloadedSince: since,
      lastAutoRestartAt,
      ownerIdleSeconds: Option.isSome(power) && !power.value.stale ? power.value.idleSeconds : null,
      screenLocked: Option.isSome(power) && power.value.locked === "true",
    } satisfies RestartInput;
  });

  const logDecision = (decision: RestartDecision) => {
    const line = describe(decision);
    return Ref.getAndSet(lastLogged, line).pipe(
      Effect.flatMap((previous) => (line === "" || previous === line ? Effect.void : record(line))),
    );
  };

  const check = Effect.gen(function* () {
    const decision = decideRestart(yield* readInput);
    yield* logDecision(decision);
    if (decision.action !== "install") return;
    const prepared = yield* update.run(() => Effect.void);
    const token = prepared.desktopUpdateToken;
    if (token === undefined) return;
    // Preparing can take minutes; check again right before the app quits.
    const recheck = decideRestart(yield* readInput);
    if (recheck.action !== "install" || prepared.targetVersion !== decision.version) {
      const reason = recheck.action === "wait" ? recheck.reason : "the update changed";
      yield* record(`desktop update: skipped at the last moment (${reason})`);
      yield* Ref.set(lastLogged, "");
      yield* receiver.cancelDesktopUpdate(token).pipe(Effect.ignore);
      return;
    }
    yield* fs
      .writeFileString(restartFile, String(yield* Clock.currentTimeMillis))
      .pipe(Effect.ignore);
    // Success stops this server, so this only returns on failure.
    return yield* update.commit(token);
  }).pipe(Effect.catch((error) => record(`desktop update: install failed (${error.message})`)));
  return yield* Effect.forever(Effect.sleep(CHECK_INTERVAL).pipe(Effect.andThen(check)));
});

/** Watches for a downloaded desktop update on servers the desktop app started. */
export const layer = Layer.effectDiscard(Effect.forkScoped(run));
