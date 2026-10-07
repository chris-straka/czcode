/**
 * Puts a spare agent host to sleep when cz has had nothing to do for a while,
 * so it idles at a few watts instead of a hundred. Opt-in: ccez/hosts/linux.sh
 * sets CZ_SLEEP_WHEN_IDLE_MINUTES on wired Linux hosts, along with Wake-on-LAN
 * and the root helper `cz-host-sleep` this runs through sudo. Another cz
 * server on the LAN wakes it on demand (WakeService); its own RTC alarm wakes
 * it for the next queued run or scheduled task, and at the daily times in
 * CZ_HOST_WAKE_TIMES, when the host's nightly jobs run.
 *
 * Busy means a turn running or about to start, a host job running (a
 * `cz-job-*` user service), a logged-in user who isn't idle (Tailscale SSH
 * included), or a CPU load from work cz doesn't track, such as a training
 * run left in the background.
 *
 * @module HostSleepService
 */
import * as NodeOS from "node:os";

import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ResetQueueService from "../resetQueue/ResetQueueService.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import {
  activeUserSessions,
  nextDailyWakeAt,
  nextWakeAt,
  runningHostJobs,
  shouldSleep,
  threadKeepsAwake,
  WAKE_LEAD_MS,
} from "./idle.ts";

const CHECK_INTERVAL = Duration.minutes(1);
// Load from work outside cz (builds, training) keeps the machine up.
const BUSY_LOAD = 1;
const HELPER = "/usr/local/sbin/cz-host-sleep";

const idleMinutesConfig = Config.Int("CZ_SLEEP_WHEN_IDLE_MINUTES").pipe(Config.option);
const wakeTimesConfig = Config.String("CZ_HOST_WAKE_TIMES").pipe(Config.option);

/** The sleep log, one JSON line per sleep or wake, read by `cz sleep`. */
export const sleepLogPath = (stateDir: string, path: Path.Path) =>
  path.join(stateDir, "host-sleep.jsonl");

const run = Effect.gen(function* () {
  const idleMinutes = Option.getOrElse(
    yield* idleMinutesConfig.pipe(Effect.orElseSucceed(() => Option.none<number>())),
    () => 0,
  );
  if (idleMinutes <= 0 || process.platform !== "linux") return;
  const idleMs = idleMinutes * 60 * 1000;
  const wakeTimes = Option.getOrElse(
    yield* wakeTimesConfig.pipe(Effect.orElseSucceed(() => Option.none<string>())),
    () => "",
  );
  const timeZone = DateTime.zoneMakeLocal();

  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const queue = yield* ResetQueueService.ResetQueueService;
  const scheduledTasks = yield* ScheduledTaskService.ScheduledTaskService;
  const processes = yield* ProcessRunner.ProcessRunner;
  const logPath = sleepLogPath(config.stateDir, path);

  const record = (event: "sleep" | "wake", at: number) =>
    fs
      .writeFileString(logPath, `${JSON.stringify({ event, at })}\n`, { flag: "a" })
      .pipe(Effect.ignore({ log: true }));

  const busy = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const shells = yield* projections.getShellSnapshot();
    if (shells.threads.some((thread) => threadKeepsAwake(thread, now))) return "agent work";
    if ((NodeOS.loadavg()[0] ?? 0) >= BUSY_LOAD) return "CPU load";
    // No user manager (a container, say) means no host jobs either.
    const jobs = yield* processes
      .run({
        command: "systemctl",
        args: ["--user", "list-units", "--state=activating", "--plain", "--no-legend", "cz-job-*"],
        timeout: "10 seconds",
      })
      .pipe(
        Effect.map((result) => result.stdout),
        Effect.orElseSucceed(() => ""),
      );
    if (runningHostJobs(jobs).length > 0) return "a host job";
    const sessions = yield* processes.run({
      command: "loginctl",
      args: ["list-sessions", "--no-legend"],
      timeout: "10 seconds",
    });
    if (activeUserSessions(sessions.stdout) > 0) return "a logged-in user";
    return null;
  });

  const wakeTime = Effect.gen(function* () {
    const queued = yield* queue.list;
    const tasks = yield* scheduledTasks.list();
    const now = yield* Clock.currentTimeMillis;
    const times = [
      nextWakeAt({ queuedRuns: queued, scheduledTasks: tasks.tasks }),
      nextDailyWakeAt(wakeTimes, now, timeZone),
    ].filter((time) => time !== null);
    return times.length === 0 ? null : Math.min(...times);
  });

  let idleSince = yield* Clock.currentTimeMillis;
  // Set after a sleep attempt; the next check (after resume) closes it in the log.
  let sleepPending = false;
  yield* Effect.logInfo("Host sleep is on", { idleMinutes });

  const check = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    if (sleepPending) {
      sleepPending = false;
      yield* record("wake", now);
      yield* Effect.logInfo("Awake again");
      idleSince = now;
    }
    if ((yield* busy) !== null) {
      idleSince = now;
      return;
    }
    const wakeAt = yield* wakeTime;
    if (!shouldSleep({ idleSince, now, idleMs, wakeAt })) return;
    const alarm = wakeAt === null ? 0 : Math.floor((wakeAt - WAKE_LEAD_MS) / 1000);
    yield* Effect.logInfo("Idle; going to sleep", {
      idleMinutes,
      wakeAt: wakeAt === null ? null : DateTime.formatIso(DateTime.makeUnsafe(wakeAt)),
    });
    yield* record("sleep", now);
    sleepPending = true;
    const result = yield* processes.run({
      command: "sudo",
      args: ["-n", HELPER, String(alarm)],
      timeout: "30 seconds",
    });
    if (result.code !== 0) {
      yield* Effect.logWarning("Could not go to sleep", { stderr: result.stderr.trim() });
    }
    // Asleep or not, count idleness afresh from here.
    idleSince = yield* Clock.currentTimeMillis;
  }).pipe(
    Effect.catch((error) =>
      Effect.logWarning("Host sleep check failed", error).pipe(
        Effect.andThen(
          Clock.currentTimeMillis.pipe(
            Effect.map((now) => {
              idleSince = now;
            }),
          ),
        ),
      ),
    ),
  );

  return yield* Effect.forever(Effect.sleep(CHECK_INTERVAL).pipe(Effect.andThen(check)));
});

/** Runs the idle check in the background when CZ_SLEEP_WHEN_IDLE_MINUTES is set. */
export const layer = Layer.effectDiscard(Effect.forkScoped(run)).pipe(
  Layer.provide(ProcessRunner.layer),
);
