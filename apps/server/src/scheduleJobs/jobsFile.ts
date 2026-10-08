/**
 * The host's register of recurring jobs, `~/.config/cz-host/jobs.toml`: one
 * `[[job]]` per timer, so cz can say what it does and find its live state
 * (see ccez/hosts/README.md, "Recurring jobs"). ccez/hosts/host-jobs.sh
 * writes the host's own nightly jobs here; agents add theirs with
 * `cz jobs add`, not by hand, and host-jobs.sh keeps them.
 *
 * @module jobsFile
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { parse, stringify } from "smol-toml";

export const JobEntry = Schema.Struct({
  /** Short and unique on the host, like "feeds-watch". */
  name: Schema.String.check(Schema.isPattern(/^[\w.-]+$/)),
  /** One plain sentence: what the job does. */
  description: Schema.String.check(Schema.isNonEmpty()),
  /** A systemd timer, like "feeds-watch.timer". */
  unit: Schema.optionalKey(Schema.String),
  /** Where the timer lives; omitted means a user unit if one is loaded, else system. */
  scope: Schema.optionalKey(Schema.Literals(["system", "user"])),
  /** A launchd label instead of a systemd timer (macOS hosts). */
  launchd: Schema.optionalKey(Schema.String),
  project: Schema.optionalKey(Schema.String),
  /** The latest output: a file or folder path, or a URL. */
  output: Schema.optionalKey(Schema.String),
  /** Written by ccez/hosts/host-jobs.sh for its own jobs; informational here. */
  schedule: Schema.optionalKey(Schema.String),
  command: Schema.optionalKey(Schema.String),
});
export type JobEntry = typeof JobEntry.Type;

const JobsDocument = Schema.Struct({ job: Schema.optionalKey(Schema.Array(JobEntry)) });
const decodeJobs = Schema.decodeUnknownEffect(JobsDocument);

/** The jobs file for this host: `CZ_JOBS_FILE`, else `~/.config/cz-host/jobs.toml`. */
export const jobsFilePath = (environment: NodeJS.ProcessEnv) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const explicit = environment.CZ_JOBS_FILE?.trim();
    if (explicit) return explicit;
    const home = environment.HOME ?? environment.USERPROFILE ?? "";
    return path.join(home, ".config", "cz-host", "jobs.toml");
  });

export class JobsFileError extends Schema.TaggedError<JobsFileError>()("JobsFileError", {
  message: Schema.String,
}) {}

/** The registered jobs; none when the file doesn't exist yet. */
export const readJobs = Effect.fn("jobsFile.readJobs")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false)))) return [];
  const text = yield* fs
    .readFileString(file)
    .pipe(Effect.mapError(() => new JobsFileError({ message: `Can't read ${file}.` })));
  const document = yield* Effect.try({
    try: () => parse(text),
    catch: (cause) => new JobsFileError({ message: `${file} isn't valid TOML: ${String(cause)}` }),
  });
  const decoded = yield* decodeJobs(document).pipe(
    Effect.mapError(
      (cause) =>
        new JobsFileError({ message: `${file} has a malformed [[job]]: ${cause.message}` }),
    ),
  );
  return decoded.job ?? [];
});

const writeJobs = Effect.fn("jobsFile.writeJobs")(function* (
  file: string,
  jobs: ReadonlyArray<JobEntry>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const header =
    "# Recurring jobs on this host, read by cz's Schedules view.\n# host-jobs.sh writes the cz-job-* entries; `cz jobs add` / `cz jobs remove` the rest.\n\n";
  yield* fs.makeDirectory(path.dirname(file), { recursive: true }).pipe(Effect.ignore);
  yield* fs
    .writeFileString(file, header + stringify({ job: jobs.map((job) => ({ ...job })) }))
    .pipe(Effect.mapError(() => new JobsFileError({ message: `Can't write ${file}.` })));
});

/** Adds a job, or replaces the one with the same name. */
export const addJob = Effect.fn("jobsFile.addJob")(function* (file: string, job: JobEntry) {
  if (!job.unit && !job.launchd) {
    return yield* new JobsFileError({ message: "A job needs --unit (systemd) or --launchd." });
  }
  const jobs = yield* readJobs(file);
  yield* writeJobs(file, [...jobs.filter((existing) => existing.name !== job.name), job]);
});

/** Removes a job by name; false when there was none. */
export const removeJob = Effect.fn("jobsFile.removeJob")(function* (file: string, name: string) {
  const jobs = yield* readJobs(file);
  const kept = jobs.filter((job) => job.name !== name);
  if (kept.length === jobs.length) return false;
  yield* writeJobs(file, kept);
  return true;
});
