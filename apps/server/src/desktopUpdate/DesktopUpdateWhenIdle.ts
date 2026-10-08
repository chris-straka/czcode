/**
 * Installs a desktop app update the app has already downloaded once cz is
 * idle, so an update never cuts off an agent mid-turn and never waits for
 * someone to click "Restart to update". Idle means the same thing as for
 * host sleep and ccez/hosts/cz-update.sh: no thread running, starting, or
 * running background tasks, and no queued run or scheduled task due within
 * 10 minutes. The install goes through DesktopAppUpdate, the same
 * prepare-then-commit handshake a remote "update desktop" request uses.
 *
 * @module DesktopUpdateWhenIdle
 */
import type { DesktopUpdateStatusReport } from "@cz/contracts";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { nextWakeAt, threadKeepsAwake } from "../hostSleep/idle.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as DesktopTelemetryReceiver from "../resourceTelemetry/DesktopTelemetryReceiver.ts";
import * as ResetQueueService from "../resetQueue/ResetQueueService.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as DesktopAppUpdate from "./DesktopAppUpdate.ts";

const CHECK_INTERVAL = Duration.minutes(1);
const UPCOMING_WORK_MS = 10 * 60 * 1000;

/**
 * True when the desktop has a downloaded update to install. After a failed
 * install it waits for the user to retry, so a broken update can't restart
 * the backends every minute.
 */
export function hasDownloadedDesktopUpdate(report: Option.Option<DesktopUpdateStatusReport>) {
  return (
    Option.isSome(report) &&
    report.value.state.status === "downloaded" &&
    report.value.state.downloadedVersion !== null &&
    report.value.state.errorContext !== "install"
  );
}

/**
 * One check: installs the downloaded update when nothing is busy. `busy`
 * names what is keeping cz busy, or is null when it is idle.
 */
export const installIfIdle = <E>(input: {
  readonly latestReport: Effect.Effect<Option.Option<DesktopUpdateStatusReport>>;
  readonly busy: Effect.Effect<string | null, E>;
  readonly update: DesktopAppUpdate.DesktopAppUpdate["Service"];
}) =>
  Effect.gen(function* () {
    if (!hasDownloadedDesktopUpdate(yield* input.latestReport)) return "nothing-to-install";
    const busy = yield* input.busy;
    if (busy !== null) return "busy";
    yield* Effect.logInfo("cz is idle; installing the downloaded desktop update");
    const prepared = yield* input.update.run(() => Effect.void);
    if (prepared.desktopUpdateToken === undefined) return "nothing-to-install";
    // Success stops this server, so this only returns on failure.
    return yield* input.update.commit(prepared.desktopUpdateToken);
  });

const run = Effect.gen(function* () {
  const update = yield* DesktopAppUpdate.DesktopAppUpdate;
  if (!update.available) return;
  const receiver = yield* DesktopTelemetryReceiver.DesktopTelemetryReceiver;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const queue = yield* ResetQueueService.ResetQueueService;
  const scheduledTasks = yield* ScheduledTaskService.ScheduledTaskService;

  const latestReport = Effect.scoped(
    receiver.desktopUpdates.pipe(Effect.map((reports) => reports.latest)),
  );
  const busy = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const shells = yield* projections.getShellSnapshot();
    if (shells.threads.some((thread) => threadKeepsAwake(thread, now))) return "agent work";
    const nextRun = nextWakeAt({
      queuedRuns: yield* queue.list,
      scheduledTasks: (yield* scheduledTasks.list()).tasks,
    });
    return nextRun !== null && nextRun - now < UPCOMING_WORK_MS ? "upcoming work" : null;
  });

  const check = installIfIdle({ latestReport, busy, update }).pipe(
    Effect.catch((error) => Effect.logWarning("Installing the desktop update failed", error)),
  );
  return yield* Effect.forever(Effect.sleep(CHECK_INTERVAL).pipe(Effect.andThen(check)));
});

/** Watches for a downloaded desktop update on servers the desktop app started. */
export const layer = Layer.effectDiscard(Effect.forkScoped(run));
