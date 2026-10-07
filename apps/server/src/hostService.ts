/**
 * Whether this server is the machine's host service, from its own cgroup.
 *
 * @module hostService
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

/**
 * Why a server in this cgroup must not act as the machine's host, or null
 * when it may. Only the systemd service itself (cz-host.service) may manage
 * agent scopes or put the machine to sleep. Agents inherit the service's
 * CZ_AGENT_SCOPES and CZ_SLEEP_WHEN_IDLE_MINUTES, so a server an agent starts
 * (a dev server, a test, `cz serve`) runs inside that agent's scope: its
 * scope cleanup would stop every agent on the machine, and an idle one would
 * suspend the machine under the real host.
 */
export function hostServiceCgroupProblem(cgroupPath: string | undefined): string | null {
  if (!cgroupPath || !cgroupPath.includes("user@"))
    return "not running under a systemd user manager";
  const unit = cgroupPath.split("/").findLast((segment) => segment !== "") ?? "";
  if (!unit.endsWith(".service")) {
    return `running in ${unit || "an unnamed cgroup"}, not as its own service (started from a terminal or by an agent)`;
  }
  return null;
}

/** This process's cgroup v2 path ("/user.slice/.../app.slice/cz-host.service"), if any. */
export const readOwnCgroupPath = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const content = yield* fs
    .readFileString("/proc/self/cgroup")
    .pipe(Effect.orElseSucceed(() => ""));
  return (
    content
      .split("\n")
      .find((line) => line.startsWith("0::"))
      ?.slice(3)
      .trim() || undefined
  );
});
