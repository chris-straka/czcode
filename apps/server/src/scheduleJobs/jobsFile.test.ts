import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { addJob, readJobs, removeJob } from "./jobsFile.ts";

const withJobsFile = <A, E>(
  run: (file: string) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "cz-jobs-" });
    return yield* run(path.join(dir, "cz-host", "jobs.toml"));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe("jobs.toml", () => {
  it.effect("adds, replaces, and removes jobs, starting from no file", () =>
    withJobsFile((file) =>
      Effect.gen(function* () {
        expect(yield* readJobs(file)).toEqual([]);
        yield* addJob(file, {
          name: "feeds-watch",
          description: "Pull public data for launchkit and mediaforge",
          unit: "feeds-watch.timer",
          project: "scrapers",
        });
        yield* addJob(file, {
          name: "gk-nightly",
          description: "Nightly kit build",
          unit: "gk-nightly.timer",
          scope: "user",
        });
        yield* addJob(file, {
          name: "feeds-watch",
          description: "Pull public data",
          unit: "feeds-watch.timer",
        });
        expect((yield* readJobs(file)).map((job) => [job.name, job.description])).toEqual([
          ["gk-nightly", "Nightly kit build"],
          ["feeds-watch", "Pull public data"],
        ]);
        expect(yield* removeJob(file, "gk-nightly")).toBe(true);
        expect(yield* removeJob(file, "gk-nightly")).toBe(false);
        expect((yield* readJobs(file)).map((job) => job.name)).toEqual(["feeds-watch"]);
      }),
    ),
  );

  it.effect("reads the file host-jobs.sh writes", () =>
    withJobsFile((file) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fs.makeDirectory(path.dirname(file), { recursive: true });
        yield* fs.writeFileString(
          file,
          '# written by host-jobs.sh\n\n[[job]]\nname = "health"\ndescription = "Disk, SMART, logs"\nschedule = "*-*-* 03:30"\ncommand = "/x/health.sh"\nunit = "cz-job-health.timer"\n',
        );
        expect(yield* readJobs(file)).toEqual([
          expect.objectContaining({ name: "health", unit: "cz-job-health.timer" }),
        ]);
      }),
    ),
  );

  it.effect("refuses a job with no timer to read", () =>
    withJobsFile((file) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          addJob(file, { name: "x", description: "Nothing to watch" }),
        );
        expect(error.message).toContain("--unit");
      }),
    ),
  );
});
