/**
 * `cz jobs`: the host's recurring jobs. `add` and `remove` edit this host's
 * `~/.config/cz-host/jobs.toml`, so an agent that installs a systemd timer or
 * launchd job registers it in the same step; `list` shows what the Schedules
 * view shows, here or on a paired machine.
 *
 * @module JobsCli
 */
import { type ScheduleJob, scheduleJobFailing } from "@cz/contracts";
import { HostProcessEnvironment } from "@cz/shared/hostProcess";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag } from "effect/cli";

import { addJob, jobsFilePath, removeJob } from "../scheduleJobs/jobsFile.ts";
import { baseDirFlag } from "./config.ts";
import { hostFlag, withServer } from "./serverClient.ts";

const encodeJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const when = (ms: number | null) =>
  ms === null ? "—" : DateTime.formatIso(DateTime.makeUnsafe(ms));

/** One line per job, failures flagged: what, schedule, last run, next run. */
function describeJob(job: ScheduleJob): string {
  const scheduled = job.lastScheduledRun;
  const last =
    job.lastRun.status === "failed"
      ? `FAILED ${when(job.lastRun.at)}: ${job.lastRun.reason ?? ""}`
      : job.lastRun.reason
        ? `${job.lastRun.status} ${when(job.lastRun.at)}: ${job.lastRun.reason}`
        : `${job.lastRun.status} ${when(job.lastRun.at)}`;
  const missed =
    scheduled?.status === "failed"
      ? `  (scheduled run FAILED ${when(scheduled.at)}: ${scheduled.reason ?? ""})`
      : "";
  return `${scheduleJobFailing(job) ? "!" : " "} ${job.id}  ${job.schedule}  last ${last}${missed}  next ${when(job.nextRunAt)}  ${job.what}`;
}

const addCommand = Command.make("add", {
  name: Flag.String("name").pipe(
    Flag.withDescription(
      "Short and unique on this host, like feeds-watch; defaults to the unit's.",
    ),
    Flag.optional,
  ),
  description: Flag.String("description").pipe(
    Flag.withDescription("One plain sentence: what the job does."),
  ),
  unit: Flag.String("unit").pipe(
    Flag.withDescription("The systemd timer, like feeds-watch.timer."),
    Flag.optional,
  ),
  user: Flag.Boolean("user").pipe(
    Flag.withDescription("The timer is a user unit (systemctl --user)."),
    Flag.withDefault(false),
  ),
  launchd: Flag.String("launchd").pipe(
    Flag.withDescription("A launchd label instead of a timer (macOS)."),
    Flag.optional,
  ),
  project: Flag.String("project").pipe(Flag.optional),
  output: Flag.String("output").pipe(
    Flag.withDescription("Where its latest output is: a file, folder, or URL."),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription("Register a recurring job on this host so the Schedules view shows it."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const file = yield* jobsFilePath(yield* HostProcessEnvironment);
      const unit = Option.getOrUndefined(flags.unit);
      const launchd = Option.getOrUndefined(flags.launchd);
      // Defaults to the timer's name ("feeds-watch.timer" is "feeds-watch").
      const name = Option.getOrElse(flags.name, () =>
        (unit ?? launchd ?? "").replace(/\.timer$/, ""),
      );
      const project = Option.getOrUndefined(flags.project);
      const output = Option.getOrUndefined(flags.output);
      yield* addJob(file, {
        name,
        description: flags.description,
        ...(unit ? { unit } : {}),
        ...(flags.user ? { scope: "user" as const } : {}),
        ...(launchd ? { launchd } : {}),
        ...(project ? { project } : {}),
        ...(output ? { output } : {}),
      });
      yield* Console.log(`Registered ${name} in ${file}.`);
    }),
  ),
);

const removeCommand = Command.make("remove", { name: Argument.String("name") }).pipe(
  Command.withDescription("Unregister a job (the timer itself is left alone)."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const file = yield* jobsFilePath(yield* HostProcessEnvironment);
      const removed = yield* removeJob(file, flags.name);
      yield* Console.log(removed ? `Removed ${flags.name}.` : `No job ${flags.name} in ${file}.`);
    }),
  ),
);

const listCommand = Command.make("list", {
  baseDir: baseDirFlag,
  host: hostFlag,
  json: Flag.Boolean("json").pipe(Flag.withDefault(false)),
  all: Flag.Boolean("all").pipe(
    Flag.withDescription("Include timers that aren't registered."),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withDescription("Every recurring job and how its last run went; ! marks a failure."),
  Command.withHandler((flags) =>
    withServer(
      { baseDir: flags.baseDir, host: flags.host, sessionLabel: "cz jobs cli" },
      ({ client, headers }) =>
        Effect.gen(function* () {
          const { jobs } = yield* client.jobs.list({ headers });
          const shown = flags.all ? jobs : jobs.filter((job) => job.registered);
          if (flags.json) return yield* Console.log(encodeJson({ jobs: shown }));
          if (shown.length === 0) return yield* Console.log("No recurring jobs registered.");
          for (const job of shown) yield* Console.log(describeJob(job));
        }),
    ),
  ),
);

export const jobsCommand = Command.make("jobs").pipe(
  Command.withDescription("Recurring jobs on this host: timers agents installed and cz tasks."),
  Command.withSubcommands([addCommand, listCommand, removeCommand]),
);
