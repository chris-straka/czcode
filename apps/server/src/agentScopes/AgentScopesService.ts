/**
 * Gives each agent on a Linux host its own systemd scope, so running out of
 * memory costs one agent instead of the server. Without this, every agent and
 * every build it starts shares the server's cgroup, and systemd-oomd ends the
 * whole service: all threads stop and are cancelled on restart.
 *
 * Opt-in with CZ_AGENT_SCOPES=1 (ccez/hosts/linux.sh sets it for cz-host).
 * Every few seconds this moves the server's long-lived children (provider
 * CLIs, their servers, terminals) and their descendants into
 * `cz-agent-<pid>-<name>.scope` units through the user manager; whatever they
 * start afterwards is born in the scope. Quick commands finish before a sweep
 * picks them up. Scopes set no memory limit. Scopes left by a previous server
 * are stopped at startup, as their agents lost their server anyway, which is
 * why only the service itself may turn scopes on (see hostServiceCgroupProblem).
 *
 * @module AgentScopesService
 */
import { HostProcessPlatform } from "@cz/shared/hostProcess";
import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { hostServiceCgroupProblem, readOwnCgroupPath } from "../hostService.ts";
import * as ProcessRunner from "../processRunner.ts";
import { parseProcStat, planScopes, processKey, scopeUnitName, type ProcessEntry } from "./plan.ts";

const SWEEP_INTERVAL = Duration.seconds(5);
const enabledConfig = Config.Boolean("CZ_AGENT_SCOPES").pipe(Config.option);
const MANAGER = [
  "--user",
  "call",
  "org.freedesktop.systemd1",
  "/org/freedesktop/systemd1",
  "org.freedesktop.systemd1.Manager",
];

const run = Effect.gen(function* () {
  const enabled = Option.getOrElse(
    yield* enabledConfig.pipe(Effect.orElseSucceed(() => Option.none<boolean>())),
    () => false,
  );
  if (!enabled || (yield* HostProcessPlatform) !== "linux") return;

  const fs = yield* FileSystem.FileSystem;
  const processes = yield* ProcessRunner.ProcessRunner;
  const serverPid = process.pid;

  // cgroup v2: "0::/user.slice/.../app.slice/cz-host.service".
  const cgroupPath = yield* readOwnCgroupPath;
  const problem = hostServiceCgroupProblem(cgroupPath);
  if (problem !== null || !cgroupPath) {
    yield* Effect.logInfo(`Agent scopes are off: ${problem ?? "no cgroup"}`);
    return;
  }
  const procsFile = `/sys/fs/cgroup${cgroupPath}/cgroup.procs`;

  const systemd = (args: ReadonlyArray<string>) =>
    processes.run({ command: "busctl", args: [...MANAGER, ...args], timeout: "10 seconds" });

  yield* processes
    .run({
      command: "systemctl",
      args: ["--user", "stop", "cz-agent-*.scope"],
      timeout: "30 seconds",
    })
    .pipe(Effect.ignore({ log: true }));
  yield* Effect.logInfo("Agent scopes are on", { cgroup: cgroupPath });

  const readStat = (pid: number) =>
    fs.readFileString(`/proc/${pid}/stat`).pipe(
      Effect.map(parseProcStat),
      Effect.orElseSucceed(() => null),
    );

  let previouslySeen = new Set<string>();
  const scoped = new Map<string, string>();

  const sweep = Effect.gen(function* () {
    const pids = (yield* fs.readFileString(procsFile))
      .split("\n")
      .map(Number)
      .filter((pid) => Number.isInteger(pid) && pid > 0);
    const known = new Map<number, ProcessEntry>();
    // The processes here, then their ancestors that already moved out.
    let frontier = pids;
    for (let round = 0; round < 64 && frontier.length > 0; round++) {
      const read = yield* Effect.forEach(frontier, readStat, { concurrency: 16 });
      for (const entry of read) if (entry) known.set(entry.pid, entry);
      frontier = [
        ...new Set(
          read.flatMap((entry) =>
            entry && entry.ppid > 1 && entry.ppid !== serverPid && !known.has(entry.ppid)
              ? [entry.ppid]
              : [],
          ),
        ),
      ];
    }
    const here = pids.flatMap((pid) => {
      const entry = known.get(pid);
      return entry ? [entry] : [];
    });
    const plan = planScopes({
      processes: here,
      lookup: (pid) => known.get(pid),
      serverPid,
      previouslySeen,
      scoped,
    });

    for (const { root, pids: members } of plan.create) {
      const unit = scopeUnitName(root);
      const result = yield* systemd([
        "StartTransientUnit",
        "ssa(sv)a(sa(sv))",
        unit,
        "fail",
        "4",
        "PIDs",
        "au",
        String(members.length),
        ...members.map(String),
        "Description",
        "s",
        `cz agent: ${root.comm}`,
        "CollectMode",
        "s",
        "inactive-or-failed",
        // Delegated, so stragglers can be attached later (AttachProcessesToUnit).
        "Delegate",
        "b",
        "true",
        "0",
      ]);
      if (result.code === 0) {
        scoped.set(processKey(root), unit);
        yield* Effect.logInfo("Moved an agent into its own scope", { unit, pids: members.length });
      } else {
        yield* Effect.logWarning("Could not give an agent its own scope", {
          unit,
          stderr: result.stderr.trim(),
        });
      }
    }
    for (const { unit, pids: members } of plan.attach) {
      yield* systemd([
        "AttachProcessesToUnit",
        "ssau",
        unit,
        "",
        String(members.length),
        ...members.map(String),
      ]).pipe(Effect.ignore({ log: true }));
    }

    previouslySeen = new Set(here.map(processKey));
    // Forget agents that are gone, so a reused pid starts fresh.
    for (const key of scoped.keys()) {
      const [pid] = key.split(":");
      const entry = known.get(Number(pid)) ?? (yield* readStat(Number(pid)));
      if (!entry || processKey(entry) !== key) scoped.delete(key);
    }
  }).pipe(Effect.catch((error) => Effect.logDebug("Agent scope sweep failed", error)));

  return yield* Effect.forever(sweep.pipe(Effect.andThen(Effect.sleep(SWEEP_INTERVAL))));
});

/** Runs the sweep in the background when CZ_AGENT_SCOPES is set on Linux. */
export const layer = Layer.effectDiscard(Effect.forkScoped(run)).pipe(
  Layer.provide(ProcessRunner.layer),
);
