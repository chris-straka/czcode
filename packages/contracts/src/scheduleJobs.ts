/**
 * Every recurring job on a machine (fork): czcode's own scheduled tasks and
 * the systemd timers or launchd jobs agents install, registered in the host's
 * `~/.config/cz-host/jobs.toml` (see ccez/hosts/README.md, "Recurring jobs").
 *
 * @module scheduleJobs
 */
import * as Schema from "effect/Schema";

export const ScheduleJobSource = Schema.Literals(["cz-task", "systemd", "launchd"]);
export type ScheduleJobSource = typeof ScheduleJobSource.Type;

/**
 * How a run ended: ok, attention (it ran and found something for the owner,
 * said in `reason`), failed (with why), running now, or never run.
 */
export const ScheduleJobRun = Schema.Struct({
  status: Schema.Literals(["ok", "attention", "failed", "running", "never"]),
  /** Unix epoch ms the run started; null when it never ran. */
  at: Schema.NullOr(Schema.Number),
  /** One line: why a failed run failed, or what an attention run found. */
  reason: Schema.NullOr(Schema.String),
});
export type ScheduleJobRun = typeof ScheduleJobRun.Type;

/** Where the job's latest output is: a thread, a log command, a file or folder, or a URL. */
export const ScheduleJobOutput = Schema.Struct({
  kind: Schema.Literals(["thread", "log", "path", "url"]),
  ref: Schema.String,
});
export type ScheduleJobOutput = typeof ScheduleJobOutput.Type;

export const ScheduleJob = Schema.Struct({
  id: Schema.String,
  source: ScheduleJobSource,
  /** One plain sentence: what the job does. */
  what: Schema.String,
  project: Schema.NullOr(Schema.String),
  /** The systemd timer or launchd label, for timers. */
  unit: Schema.NullOr(Schema.String),
  /** The schedule in words, like "Daily 06:00". */
  schedule: Schema.String,
  lastRun: ScheduleJobRun,
  /**
   * The latest scheduled run, when it differs from the latest run: a failed
   * 06:00 run stays visible after a manual retry works.
   */
  lastScheduledRun: Schema.NullOr(ScheduleJobRun),
  /** Unix epoch ms of the next run; null when paused or unknown. */
  nextRunAt: Schema.NullOr(Schema.Number),
  output: Schema.NullOr(ScheduleJobOutput),
  /** False for a timer found on the host but missing from jobs.toml. */
  registered: Schema.Boolean,
  /**
   * An unregistered timer the OS or a package installed (apt, logrotate,
   * snap...). Absent from older servers, which didn't tell them apart.
   */
  system: Schema.optionalKey(Schema.Boolean),
});
export type ScheduleJob = typeof ScheduleJob.Type;

export const ScheduleJobList = Schema.Struct({ jobs: Schema.Array(ScheduleJob) });
export type ScheduleJobList = typeof ScheduleJobList.Type;

/** A job is failing when its latest run, or its latest scheduled run, failed. */
export function scheduleJobFailing(
  job: Pick<ScheduleJob, "lastRun" | "lastScheduledRun">,
): boolean {
  return job.lastRun.status === "failed" || job.lastScheduledRun?.status === "failed";
}
