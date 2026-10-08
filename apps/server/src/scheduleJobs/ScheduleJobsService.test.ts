import * as NodeServices from "@effect/platform-node/NodeServices";
import { HostProcessEnvironment, HostProcessPlatform } from "@cz/shared/hostProcess";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ProcessRunner from "../processRunner.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import { addJob } from "./jobsFile.ts";
import * as ScheduleJobsService from "./ScheduleJobsService.ts";

const journal = [
  [1791374400609193, "Starting feeds-watch.service - Daily public-data pull..."],
  [
    1791374400892809,
    "feeds-watch.service: Unable to locate executable '/home/f/.cargo/bin/feeds': No such file or directory",
  ],
  [1791374400897717, "feeds-watch.service: Failed with result 'exit-code'."],
  [1791408880256729, "Starting feeds-watch.service - Daily public-data pull..."],
  [1791409464100000, "Finished feeds-watch.service - Daily public-data pull..."],
]
  .map(([us, message]) => JSON.stringify({ __REALTIME_TIMESTAMP: String(us), MESSAGE: message }))
  .join("\n");

/** host-jobs.sh's health timer is a user unit; feeds-watch is a system one. */
const userShow = (args: ReadonlyArray<string>) =>
  args.includes("cz-job-health.timer")
    ? "LoadState=loaded\nUnit=cz-job-health.service\nTimersCalendar={ OnCalendar=*-*-* 03:30:00 ; next_elapse=@1791459000 }\nNextElapseUSecRealtime=@1791459000\n"
    : "LoadState=not-found\n";

/** `systemctl show` of the unregistered timers and their services, as on art on 2026-10-08. */
const unitShow = (args: ReadonlyArray<string>) => {
  const units: Record<string, string> = {
    "mfr-daily.timer":
      "Id=mfr-daily.timer\nFragmentPath=/home/f/.config/systemd/user/mfr-daily.timer\nUnit=mfr-daily.service\nTimersCalendar={ OnCalendar=*-*-* 07:00:00 ; next_elapse=@1791464400 }\nDescription=mfr-daily.timer",
    "mfr-daily.service":
      "Id=mfr-daily.service\nDescription=Morning politics roundup for mediaforge",
    "fwupd-refresh.timer":
      "Id=fwupd-refresh.timer\nFragmentPath=/usr/lib/systemd/system/fwupd-refresh.timer\nUnit=fwupd-refresh.service\nTimersCalendar=\nDescription=Refresh fwupd metadata regularly",
    "fwupd-refresh.service":
      "Id=fwupd-refresh.service\nDescription=Refresh fwupd metadata and update motd",
    "cz-net-watchdog.timer":
      "Id=cz-net-watchdog.timer\nFragmentPath=/etc/systemd/system/cz-net-watchdog.timer\nUnit=cz-net-watchdog.service\nTimersCalendar=\nDescription=Check the wired network every minute",
    "cz-net-watchdog.service":
      "Id=cz-net-watchdog.service\nDescription=Reconnect the wired network when the router stops answering",
  };
  return args
    .filter((arg) => units[arg])
    .map((arg) => units[arg])
    .join("\n\n");
};

/** Answers like systemd on f did on 2026-10-07. */
const fakeRunner = ProcessRunner.ProcessRunner.of({
  run: (input) =>
    Effect.succeed({
      stdout:
        input.command === "journalctl"
          ? journal
          : input.args.includes("list-timers")
            ? input.args.includes("--user")
              ? JSON.stringify([{ unit: "mfr-daily.timer", next: 1791464400000000, last: null }])
              : JSON.stringify([
                  { unit: "feeds-watch.timer", next: 1791460800000000, last: 1791374400000000 },
                  { unit: "fwupd-refresh.timer", next: 1791419668457592, last: 1791415993531720 },
                  { unit: "cz-net-watchdog.timer", next: 1791419668457592, last: null },
                ])
            : input.args.includes("Id")
              ? unitShow(input.args)
              : input.args.includes("--user")
                ? userShow(input.args)
                : "LoadState=loaded\nUnit=feeds-watch.service\nTimersCalendar={ OnCalendar=*-*-* 06:00:00 ; next_elapse=@1791460800 }\nNextElapseUSecRealtime=@1791460800\nLastTriggerUSec=@1791374400\n",
      stderr: "",
      code: 0,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      stdoutInvalidUtf8: false,
      stderrInvalidUtf8: false,
    } as never),
});

describe("ScheduleJobsService", () => {
  it.effect(
    "lists registered timers, user or system, with run records and failed scheduled runs, and finds unregistered ones",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dir = yield* fs.makeTempDirectoryScoped({ prefix: "cz-schedules-" });
        const file = path.join(dir, "jobs.toml");
        yield* addJob(file, {
          name: "health",
          description: "Disk, SMART, logs",
          unit: "cz-job-health.timer",
        });
        const state = path.join(dir, ".local", "state", "cz-host", "jobs");
        yield* fs.makeDirectory(state, { recursive: true });
        yield* fs.writeFileString(
          path.join(state, "health.json"),
          JSON.stringify({
            name: "health",
            status: "attention",
            startedAt: "2026-10-07T16:59:49-06:00",
            exitCode: 2,
            summary: "1 problem(s): disk /home is 87% full (57G free), getting tight",
          }),
        );
        yield* addJob(file, {
          name: "feeds-watch",
          description: "Pull public data for launchkit and mediaforge",
          unit: "feeds-watch.timer",
          project: "scrapers",
        });
        const service = yield* ScheduleJobsService.ScheduleJobsService.pipe(
          Effect.provide(
            ScheduleJobsService.layer.pipe(
              Layer.provide(Layer.succeed(ProcessRunner.ProcessRunner, fakeRunner)),
              Layer.provide(
                Layer.succeed(HostProcessEnvironment, { CZ_JOBS_FILE: file, HOME: dir }),
              ),
              Layer.provide(Layer.succeed(HostProcessPlatform, "linux")),
              Layer.provide(
                Layer.succeed(ScheduledTaskService.ScheduledTaskService, {
                  list: () => Effect.succeed({ tasks: [] }),
                } as never),
              ),
              Layer.provide(
                Layer.succeed(ProjectService.ProjectService, {
                  snapshot: Effect.succeed({ projects: [] }),
                } as never),
              ),
            ),
          ),
        );
        const { jobs } = yield* service.list;
        const feeds = jobs.find((job) => job.id === "feeds-watch");
        expect(feeds).toMatchObject({
          what: "Pull public data for launchkit and mediaforge",
          schedule: "Daily 06:00",
          lastRun: { status: "ok" },
          lastScheduledRun: {
            status: "failed",
            reason:
              "Unable to locate executable '/home/f/.cargo/bin/feeds': No such file or directory",
          },
          nextRunAt: 1791460800000,
          registered: true,
        });
        expect(jobs.find((job) => job.id === "health")).toMatchObject({
          schedule: "Daily 03:30",
          lastRun: {
            status: "attention",
            at: Date.parse("2026-10-07T16:59:49-06:00"),
            reason: "1 problem(s): disk /home is 87% full (57G free), getting tight",
          },
          output: { kind: "path", ref: path.join(state, "health.log") },
        });
        // Ours are described by their service; the OS's are marked system.
        expect(
          jobs
            .filter((job) => !job.registered)
            .map(({ unit, what, schedule, system }) => ({ unit, what, schedule, system })),
        ).toEqual([
          {
            unit: "fwupd-refresh.timer",
            what: "Refresh fwupd metadata and update motd",
            schedule: "System timer",
            system: true,
          },
          {
            unit: "cz-net-watchdog.timer",
            what: "Reconnect the wired network when the router stops answering",
            schedule: "System timer",
            system: false,
          },
          {
            unit: "mfr-daily.timer",
            what: "Morning politics roundup for mediaforge",
            schedule: "Daily 07:00",
            system: false,
          },
        ]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
