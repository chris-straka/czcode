/**
 * ScheduleJobsService - every recurring job on this machine for the
 * Schedules view: czcode's scheduled tasks, plus the timers registered in the
 * host's jobs.toml with their live state from systemd (or launchd on macOS).
 * Timers found on the host but missing from jobs.toml are listed too, marked
 * unregistered, so a job an agent forgot to register still shows.
 *
 * @module ScheduleJobsService
 */
import type { ScheduleJob, ScheduleJobList } from "@cz/contracts";
import { HostProcessEnvironment, HostProcessPlatform } from "@cz/shared/hostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../processRunner.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import { taskAsJob } from "./czTasks.ts";
import { type JobEntry, jobsFilePath, readJobs } from "./jobsFile.ts";
import {
  calendarInWords,
  type JournalEntry,
  onCalendarOf,
  parseSystemctlShow,
  runsFromJournal,
  scheduledRun,
  unixTimestampMs,
} from "./systemd.ts";

export class ScheduleJobsService extends Context.Service<
  ScheduleJobsService,
  { readonly list: Effect.Effect<ScheduleJobList> }
>()("cz/scheduleJobs/ScheduleJobsService") {}

const JournalLine = Schema.fromJsonString(
  Schema.Struct({ __REALTIME_TIMESTAMP: Schema.String, MESSAGE: Schema.Unknown }),
);
const decodeJournalLine = Schema.decodeUnknownOption(JournalLine);
const TimerListing = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      unit: Schema.String,
      next: Schema.NullOr(Schema.Number),
      last: Schema.NullOr(Schema.Number),
    }),
  ),
);
const decodeTimerListing = Schema.decodeUnknownOption(TimerListing);

/** How far back the journal is read to rebuild runs. */
const JOURNAL_SINCE = "-8d";

const make = Effect.gen(function* () {
  const runner = yield* ProcessRunner.ProcessRunner;
  const environment = yield* HostProcessEnvironment;
  const platform = yield* HostProcessPlatform;
  const tasks = yield* ScheduledTaskService.ScheduledTaskService;
  const projects = yield* ProjectService.ProjectService;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const run = (command: string, args: ReadonlyArray<string>) =>
    runner.run({ command, args, timeout: "10 seconds", timeoutBehavior: "timedOutResult" }).pipe(
      Effect.map((result) => (result.code === 0 ? result.stdout : null)),
      Effect.orElseSucceed(() => null),
    );
  const scopeArgs = (scope: JobEntry["scope"]) => (scope === "user" ? ["--user"] : []);

  /** A registered systemd timer: schedule, next run, and runs from the journal. */
  const systemdJob = Effect.fn("ScheduleJobsService.systemdJob")(function* (entry: JobEntry) {
    const unit = entry.unit!;
    const timer = parseSystemctlShow(
      (yield* run("systemctl", [
        ...scopeArgs(entry.scope),
        "show",
        unit,
        "--timestamp=unix",
        "-p",
        "Unit",
        "-p",
        "TimersCalendar",
        "-p",
        "NextElapseUSecRealtime",
        "-p",
        "LastTriggerUSec",
      ])) ?? "",
    );
    const service = timer.get("Unit") || unit.replace(/\.timer$/, ".service");
    const journal = yield* run("journalctl", [
      ...scopeArgs(entry.scope),
      "-u",
      service,
      "--since",
      JOURNAL_SINCE,
      "-o",
      "json",
      "--no-pager",
      "-n",
      "400",
    ]);
    const entries: JournalEntry[] = (journal ?? "").split("\n").flatMap((line) => {
      const parsed = decodeJournalLine(line);
      return Option.isSome(parsed) && typeof parsed.value.MESSAGE === "string"
        ? [{ us: Number(parsed.value.__REALTIME_TIMESTAMP), message: parsed.value.MESSAGE }]
        : [];
    });
    const runs = runsFromJournal(entries);
    const latest = runs.at(-1) ?? null;
    const scheduled = scheduledRun(runs, unixTimestampMs(timer.get("LastTriggerUSec")));
    const onCalendar = onCalendarOf(timer.get("TimersCalendar"));
    return {
      id: entry.id,
      source: "systemd",
      what: entry.what,
      project: entry.project ?? null,
      unit,
      schedule: onCalendar ? calendarInWords(onCalendar) : timer.size ? "Timer" : "Timer not found",
      lastRun: latest ?? { status: "never", at: null, reason: null },
      lastScheduledRun: scheduled && scheduled !== latest ? scheduled : null,
      nextRunAt: unixTimestampMs(timer.get("NextElapseUSecRealtime")),
      output: entry.output
        ? outputOf(entry.output)
        : { kind: "log", ref: `journalctl -u ${service}` },
      registered: true,
    } satisfies ScheduleJob;
  });

  /** A registered launchd job (macOS): last exit status; launchd doesn't say when it runs next. */
  const launchdJob = Effect.fn("ScheduleJobsService.launchdJob")(function* (entry: JobEntry) {
    const label = entry.launchd!;
    const uid = ((yield* run("id", ["-u"])) ?? "").trim();
    const printed = (yield* run("launchctl", ["print", `gui/${uid}/${label}`])) ?? "";
    const exit = /last exit code = (\S+)/.exec(printed)?.[1];
    const found = printed.length > 0;
    return {
      id: entry.id,
      source: "launchd",
      what: entry.what,
      project: entry.project ?? null,
      unit: label,
      schedule: found ? "launchd" : "Job not loaded",
      lastRun:
        exit === undefined || exit === "(never exited)"
          ? { status: "never", at: null, reason: null }
          : exit === "0"
            ? { status: "ok", at: null, reason: null }
            : { status: "failed", at: null, reason: `Exit code ${exit}` },
      lastScheduledRun: null,
      nextRunAt: null,
      output: entry.output ? outputOf(entry.output) : null,
      registered: true,
    } satisfies ScheduleJob;
  });

  /** Timers on the host that jobs.toml doesn't name, so a forgotten one still shows. */
  const unregisteredTimers = Effect.fn("ScheduleJobsService.unregisteredTimers")(function* (
    registered: ReadonlySet<string>,
  ) {
    const found: ScheduleJob[] = [];
    for (const scope of ["system", "user"] as const) {
      const listing = yield* run("systemctl", [
        ...scopeArgs(scope),
        "list-timers",
        "--all",
        "-o",
        "json",
      ]);
      const timers = Option.getOrElse(decodeTimerListing(listing ?? "[]"), () => []);
      for (const timer of timers) {
        if (!timer.unit || registered.has(timer.unit)) continue;
        found.push({
          id: `${scope}:${timer.unit}`,
          source: "systemd",
          what: timer.unit.replace(/\.timer$/, ""),
          project: null,
          unit: timer.unit,
          schedule: scope === "user" ? "User timer" : "System timer",
          lastRun: timer.last
            ? { status: "ok", at: Math.round(timer.last / 1000), reason: null }
            : { status: "never", at: null, reason: null },
          lastScheduledRun: null,
          nextRunAt: timer.next ? Math.round(timer.next / 1000) : null,
          output: null,
          registered: false,
        });
      }
    }
    return found;
  });

  const list: ScheduleJobsService["Service"]["list"] = Effect.gen(function* () {
    const file = yield* jobsFilePath(environment);
    const entries = yield* readJobs(file).pipe(
      Effect.tapError((error) => Effect.logWarning(error.message)),
      Effect.orElseSucceed((): ReadonlyArray<JobEntry> => []),
    );
    const describe = (entry: JobEntry): Effect.Effect<ScheduleJob | null> =>
      entry.launchd && platform === "darwin"
        ? launchdJob(entry)
        : entry.unit
          ? systemdJob(entry)
          : Effect.succeed(null);
    const registeredJobs = yield* Effect.forEach(entries, describe, { concurrency: 4 });
    const unregistered =
      platform === "linux"
        ? yield* unregisteredTimers(
            new Set(entries.flatMap((entry) => (entry.unit ? [entry.unit] : []))),
          )
        : [];
    const titles = new Map(
      (yield* projects.snapshot.pipe(Effect.orElseSucceed(() => ({ projects: [] })))).projects.map(
        (project) => [project.id as string, project.title] as const,
      ),
    );
    const czTasks = (yield* tasks
      .list()
      .pipe(Effect.orElseSucceed(() => ({ tasks: [] })))).tasks.map((task) =>
      taskAsJob(task, titles.get(task.projectId) ?? null),
    );
    return {
      jobs: [...czTasks, ...registeredJobs.filter((job) => job !== null), ...unregistered],
    };
  }).pipe(Effect.provideService(FileSystem.FileSystem, fs), Effect.provideService(Path.Path, path));

  return ScheduleJobsService.of({ list });
});

function outputOf(output: string): NonNullable<ScheduleJob["output"]> {
  return /^https?:\/\//.test(output) ? { kind: "url", ref: output } : { kind: "path", ref: output };
}

export const layer = Layer.effect(ScheduleJobsService, make);
