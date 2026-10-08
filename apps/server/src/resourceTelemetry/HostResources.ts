// @effect-diagnostics nodeBuiltinImport:off - Effect's FileSystem has no statfs, which disk free space needs.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import type { HostResourcesSnapshot } from "@cz/contracts";
import { HostProcessPlatform } from "@cz/shared/hostProcess";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import {
  parseDarwinMemoryPressure,
  parseDarwinSwapUsage,
  parseLinuxDiskMounts,
  sameDiskOnce,
  parseProcSwaps,
  parseZramMemoryBytes,
  swapFromDevices,
} from "./hostCapacity.ts";

/** Total and free bytes of the filesystem holding `mount`, or null when it can't be read. */
const statDisk = (mount: string) =>
  Effect.tryPromise(() => NodeFSP.statfs(mount)).pipe(
    Effect.map((stat) => ({
      mount,
      totalBytes: stat.blocks * stat.bsize,
      freeBytes: stat.bavail * stat.bsize,
    })),
    Effect.timeout("1 second"),
    Effect.orElseSucceed(() => null),
  );

export class HostResources extends Context.Service<
  HostResources,
  { readonly read: Effect.Effect<HostResourcesSnapshot> }
>()("cz/resourceTelemetry/HostResources") {}

/** Summed CPU times across cores; two readings give the busy share between them. */
export function readCpu() {
  const cpus = NodeOS.cpus();
  const cpu = cpus.reduce(
    (sum, { times }) => ({
      idle: sum.idle + times.idle,
      total: sum.total + times.user + times.nice + times.sys + times.idle + times.irq,
    }),
    { idle: 0, total: 0 },
  );
  return { ...cpu, count: cpus.length };
}

function darwinAvailableMemory(output: string): number | null {
  const pageSize = /page size of (\d+) bytes/.exec(output)?.[1];
  const free = /^Pages free:\s+(\d+)\./m.exec(output)?.[1];
  const inactive = /^Pages inactive:\s+(\d+)\./m.exec(output)?.[1];
  const speculative = /^Pages speculative:\s+(\d+)\./m.exec(output)?.[1];
  if (!pageSize || !free || !inactive || !speculative) return null;
  // vm_stat subtracts speculative pages from its printed "Pages free" count.
  // Adding them here counts each reclaimable page once; purgeable pages overlap.
  const available = (Number(free) + Number(inactive) + Number(speculative)) * Number(pageSize);
  return Number.isSafeInteger(available) && Number(pageSize) > 0 ? available : null;
}

const make = Effect.fn("makeHostResources")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const platform = yield* HostProcessPlatform;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const sample = Effect.fn("HostResources.sample")(function* () {
    const previousCpu = readCpu();
    // CPU counters need two readings; idle servers do no polling or process scans.
    yield* Effect.sleep("200 millis");
    const cpu = readCpu();
    const totalDelta = cpu.total - previousCpu.total;
    const idleDelta = cpu.idle - previousCpu.idle;
    const cpuUtilization =
      previousCpu.count === cpu.count && totalDelta > 0 && idleDelta >= 0
        ? Math.min(1, Math.max(0, 1 - idleDelta / totalDelta))
        : null;
    const totalMemoryBytes = NodeOS.totalmem();
    // On Windows libuv returns GlobalMemoryStatusEx.ullAvailPhys, including standby memory.
    let availableMemoryBytes = NodeOS.freemem();
    if (platform === "linux") {
      const meminfo = yield* fs
        .readFileString("/proc/meminfo")
        .pipe(Effect.orElseSucceed(() => ""));
      const available = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(meminfo)?.[1];
      if (available) availableMemoryBytes = Number(available) * 1024;
    } else if (platform === "darwin") {
      const output = yield* spawner
        .string(ChildProcess.make("/usr/bin/vm_stat", [], { stdin: "ignore", stderr: "ignore" }))
        .pipe(
          Effect.timeout("1 second"),
          Effect.orElseSucceed(() => ""),
        );
      availableMemoryBytes = darwinAvailableMemory(output) ?? availableMemoryBytes;
    }
    const readText = (path: string) => fs.readFileString(path).pipe(Effect.orElseSucceed(() => ""));
    const runText = (command: string, args: ReadonlyArray<string>) =>
      spawner
        .string(ChildProcess.make(command, [...args], { stdin: "ignore", stderr: "ignore" }))
        .pipe(
          Effect.timeout("1 second"),
          Effect.orElseSucceed(() => ""),
        );
    let swap: HostResourcesSnapshot["swap"];
    let memoryPressure: HostResourcesSnapshot["memoryPressure"];
    let mounts: Array<string> = [];
    if (platform === "linux") {
      const devices = yield* Effect.forEach(
        parseProcSwaps(yield* readText("/proc/swaps")),
        (device) =>
          device.kind === "zram"
            ? readText(`/sys/block/${device.name.split("/").pop()}/mm_stat`).pipe(
                Effect.map((stat) => {
                  const memoryBytes = parseZramMemoryBytes(stat);
                  return memoryBytes === null ? device : { ...device, memoryBytes };
                }),
              )
            : Effect.succeed(device),
      );
      swap = swapFromDevices(devices);
      mounts = parseLinuxDiskMounts(yield* readText("/proc/self/mounts"));
    } else if (platform === "darwin") {
      swap =
        parseDarwinSwapUsage(yield* runText("/usr/sbin/sysctl", ["vm.swapusage"])) ?? undefined;
      memoryPressure =
        parseDarwinMemoryPressure(
          yield* runText("/usr/sbin/sysctl", ["-n", "kern.memorystatus_vm_pressure_level"]),
        ) ?? undefined;
      // The sealed system volume reports the shared APFS container; Data is where files land.
      const external = yield* fs.readDirectory("/Volumes").pipe(Effect.orElseSucceed(() => []));
      mounts = ["/System/Volumes/Data", ...external.map((name) => `/Volumes/${name}`)];
    } else if (platform === "win32") {
      mounts = "CDEFGHIJ".split("").map((letter) => `${letter}:\\`);
    }
    const disks = sameDiskOnce(
      (yield* Effect.forEach(mounts, statDisk, { concurrency: 4 })).filter(
        (disk): disk is NonNullable<typeof disk> => disk !== null && disk.totalBytes > 0,
      ),
    );
    const loadAverage = platform === "win32" ? undefined : NodeOS.loadavg();
    return {
      ...(loadAverage ? { loadAverage } : {}),
      ...(swap ? { swap } : {}),
      ...(memoryPressure ? { memoryPressure } : {}),
      disks,
      sampledAt: DateTime.toEpochMillis(yield* DateTime.now),
      cpuUtilization,
      cpuCount: cpu.count,
      availableMemoryBytes: Math.min(totalMemoryBytes, Math.max(0, availableMemoryBytes)),
      totalMemoryBytes,
    };
  });

  // One server-lifetime cache deduplicates simultaneous requests from all sockets.
  const cache = yield* Cache.make({
    capacity: 1,
    lookup: (_key: "host") => sample(),
    timeToLive: "5 seconds",
  });
  return HostResources.of({ read: Cache.get(cache, "host") });
});

export const layer = Layer.effect(HostResources, make());
