/**
 * HostLoadHistory - this host's CPU, RAM, and NVIDIA GPU load, sampled once a
 * minute into `cz.sqlite` and kept for the Usage page's longest range. Each
 * host keeps its own; clients ask every machine and combine them.
 *
 * @module HostLoadHistory
 */
// @effect-diagnostics nodeBuiltinImport:off - Effect has no CPU counters or total memory.
import * as NodeOS from "node:os";
import type {
  HostLoadHistory as HostLoadHistoryResult,
  HostLoadHistoryInput,
  HostLoadStats,
} from "@cz/contracts";
import { HostProcessPlatform } from "@cz/shared/hostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import * as ForkDatabase from "../forkDatabase/ForkDatabase.ts";
import { HostResources, readCpu } from "./HostResources.ts";

export const SAMPLE_INTERVAL_MS = 60_000;
/** The Usage page's longest range is 90 days. */
export const RETENTION_MS = 91 * 24 * 60 * 60_000;

export interface HostLoadSample {
  readonly sampledAt: number;
  /** Share of all cores busy over the minute before `sampledAt`. */
  readonly cpu: number;
  readonly memoryUsedBytes: number;
  /** Mean utilization across NVIDIA GPUs, or null without one. */
  readonly gpu: number | null;
}

export class HostLoadHistory extends Context.Service<
  HostLoadHistory,
  {
    readonly record: (sample: HostLoadSample) => Effect.Effect<void>;
    readonly read: (input: HostLoadHistoryInput) => Effect.Effect<HostLoadHistoryResult>;
  }
>()("cz/resourceTelemetry/HostLoadHistory") {}

/**
 * `nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits`
 * prints one percentage per GPU. Returns their mean as a fraction, or null.
 */
export function parseNvidiaSmiUtilization(output: string): number | null {
  const values = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map(Number);
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) return null;
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  return Math.min(1, Math.max(0, mean / 100));
}

export interface HostLoadBucketRow {
  readonly bucket: number;
  readonly samples: number;
  readonly avgCpu: number;
  readonly peakCpu: number;
  readonly avgMemory: number;
  readonly peakMemory: number;
  readonly avgGpu: number | null;
  readonly peakGpu: number | null;
}

const clampFraction = (value: number) => Math.min(1, Math.max(0, value));

/** Lays SQL bucket rows onto `count` slots and folds them into the range summary. */
export function assembleHostLoad(
  rows: ReadonlyArray<HostLoadBucketRow>,
  count: number,
): { readonly summary: HostLoadStats | null; readonly buckets: Array<HostLoadStats | null> } {
  const buckets: Array<HostLoadStats | null> = Array.from({ length: count }, () => null);
  const toStats = (row: Omit<HostLoadBucketRow, "bucket" | "samples">): HostLoadStats => ({
    avgCpu: clampFraction(row.avgCpu),
    peakCpu: clampFraction(row.peakCpu),
    avgMemoryBytes: Math.round(row.avgMemory),
    peakMemoryBytes: Math.round(row.peakMemory),
    avgGpu: row.avgGpu === null ? null : clampFraction(row.avgGpu),
    peakGpu: row.peakGpu === null ? null : clampFraction(row.peakGpu),
  });
  const inRange = rows.filter((row) => row.bucket >= 0 && row.bucket < count && row.samples > 0);
  for (const row of inRange) buckets[row.bucket] = toStats(row);
  if (inRange.length === 0) return { summary: null, buckets };

  const weighted = (value: (row: HostLoadBucketRow) => number, of: typeof inRange) => {
    const samples = of.reduce((total, row) => total + row.samples, 0);
    return of.reduce((total, row) => total + value(row) * row.samples, 0) / samples;
  };
  const withGpu = inRange.filter((row) => row.avgGpu !== null);
  return {
    buckets,
    summary: toStats({
      avgCpu: weighted((row) => row.avgCpu, inRange),
      peakCpu: Math.max(...inRange.map((row) => row.peakCpu)),
      avgMemory: weighted((row) => row.avgMemory, inRange),
      peakMemory: Math.max(...inRange.map((row) => row.peakMemory)),
      avgGpu: withGpu.length === 0 ? null : weighted((row) => row.avgGpu ?? 0, withGpu),
      peakGpu: withGpu.length === 0 ? null : Math.max(...withGpu.map((row) => row.peakGpu ?? 0)),
    }),
  };
}

const make = Effect.gen(function* () {
  const { sql } = yield* ForkDatabase.ForkDatabase;

  const record = (sample: HostLoadSample) =>
    Effect.gen(function* () {
      yield* sql`
        INSERT OR REPLACE INTO host_load_samples ${sql.insert({
          sampled_at: sample.sampledAt,
          cpu: sample.cpu,
          memory_used: sample.memoryUsedBytes,
          gpu: sample.gpu,
        })}
      `;
      yield* sql`DELETE FROM host_load_samples WHERE sampled_at < ${sample.sampledAt - RETENTION_MS}`;
    }).pipe(
      Effect.catch((error) => Effect.logWarning("Could not record host load.", error)),
      Effect.asVoid,
    );

  const read = (input: HostLoadHistoryInput) =>
    Effect.gen(function* () {
      const untilMs = Math.max(input.sinceMs + 1, input.untilMs);
      const bucketMs = (untilMs - input.sinceMs) / input.buckets;
      const rows = yield* sql<HostLoadBucketRow>`
        SELECT
          CAST((sampled_at - ${input.sinceMs}) / ${bucketMs} AS INTEGER) AS bucket,
          COUNT(*) AS samples,
          AVG(cpu) AS avgCpu,
          MAX(cpu) AS peakCpu,
          AVG(memory_used) AS avgMemory,
          MAX(memory_used) AS peakMemory,
          AVG(gpu) AS avgGpu,
          MAX(gpu) AS peakGpu
        FROM host_load_samples
        WHERE sampled_at >= ${input.sinceMs} AND sampled_at < ${untilMs}
        GROUP BY bucket
      `;
      const first = yield* sql<{ readonly sampledAt: number | null }>`
        SELECT MIN(sampled_at) AS sampledAt FROM host_load_samples
      `;
      return {
        sampleIntervalMs: SAMPLE_INTERVAL_MS,
        firstSampleAt: first[0]?.sampledAt ?? null,
        cpuCount: NodeOS.cpus().length,
        totalMemoryBytes: NodeOS.totalmem(),
        ...assembleHostLoad(rows, input.buckets),
      };
    }).pipe(Effect.orDie);

  return HostLoadHistory.of({ record, read });
});

/** The store alone; tests record samples themselves. */
export const serviceLayer = Layer.effect(HostLoadHistory, make);

const sampler = Effect.gen(function* () {
  const history = yield* HostLoadHistory;
  const hostResources = yield* HostResources;
  const platform = yield* HostProcessPlatform;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  // macOS has no NVIDIA driver. Elsewhere, failing before any reading means no card, so stop asking.
  let probeGpu = platform !== "darwin";
  let seenGpu = false;
  const readGpu = Effect.gen(function* () {
    if (!probeGpu) return null;
    const output = yield* spawner
      .string(
        ChildProcess.make(
          "nvidia-smi",
          ["--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"],
          { stdin: "ignore", stderr: "ignore" },
        ),
      )
      .pipe(
        Effect.timeout("5 seconds"),
        Effect.orElseSucceed(() => ""),
      );
    const utilization = parseNvidiaSmiUtilization(output);
    if (utilization !== null) seenGpu = true;
    else if (!seenGpu) probeGpu = false;
    return utilization;
  });

  // CPU is the busy share across the whole minute, not a momentary reading.
  let previousCpu = readCpu();
  const sample = Effect.gen(function* () {
    const cpu = readCpu();
    const totalDelta = cpu.total - previousCpu.total;
    const idleDelta = cpu.idle - previousCpu.idle;
    const comparable = cpu.count === previousCpu.count && totalDelta > 0 && idleDelta >= 0;
    previousCpu = cpu;
    if (!comparable) return;
    const resources = yield* hostResources.read;
    yield* history.record({
      sampledAt: yield* Clock.currentTimeMillis,
      cpu: clampFraction(1 - idleDelta / totalDelta),
      memoryUsedBytes: Math.max(0, resources.totalMemoryBytes - resources.availableMemoryBytes),
      gpu: yield* readGpu,
    });
  });

  yield* Effect.forkScoped(
    Effect.forever(Effect.sleep(Duration.millis(SAMPLE_INTERVAL_MS)).pipe(Effect.andThen(sample))),
  );
});

/** The store plus the once-a-minute sampler. */
export const layer = Layer.effectDiscard(sampler).pipe(Layer.provideMerge(serviceLayer));
