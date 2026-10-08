import type { HostLoadHistory, HostLoadStats } from "@cz/contracts";
import { describe, expect, it } from "vite-plus/test";

import { hostLoadView } from "./hostLoad.ts";

const GB = 1024 ** 3;

const stats = (cpu: number, memoryBytes: number, gpu: number | null = null): HostLoadStats => ({
  avgCpu: cpu,
  peakCpu: Math.min(1, cpu * 2),
  avgMemoryBytes: memoryBytes,
  peakMemoryBytes: memoryBytes,
  avgGpu: gpu,
  peakGpu: gpu,
});

const history = (
  cpuCount: number,
  totalMemoryBytes: number,
  buckets: ReadonlyArray<HostLoadStats | null>,
  summary: HostLoadStats | null,
): HostLoadHistory => ({
  sampleIntervalMs: 60_000,
  firstSampleAt: summary === null ? null : 1_000,
  cpuCount,
  totalMemoryBytes,
  summary,
  buckets,
});

describe("hostLoadView", () => {
  it("is null when no machine has samples in the range", () => {
    expect(hostLoadView([history(8, 16 * GB, [null, null], null)])).toBeNull();
  });

  it("reads one machine as fractions, with gaps where it was off", () => {
    const view = hostLoadView([
      history(8, 16 * GB, [stats(0.2, 4 * GB), null], stats(0.2, 4 * GB)),
    ]);
    expect(view?.cpu).toEqual({ avg: 0.2, peak: 0.4, points: [0.2, null] });
    expect(view?.memory.avg).toBe(0.25);
    expect(view?.gpu).toBeNull();
  });

  it("weighs CPU by cores and RAM by total memory across machines", () => {
    const big = history(24, 64 * GB, [stats(0.5, 32 * GB, 0.8)], stats(0.5, 32 * GB, 0.8));
    const small = history(8, 16 * GB, [stats(0.1, 0)], stats(0.1, 0));
    const view = hostLoadView([big, small]);
    expect(view?.cpu.avg).toBeCloseTo((0.5 * 24 + 0.1 * 8) / 32);
    expect(view?.memory.avg).toBeCloseTo(32 / 80);
    expect(view?.memoryTotalBytes).toBe(80 * GB);
    // Only the machine with a GPU counts toward GPU load.
    expect(view?.gpu?.avg).toBe(0.8);
  });

  it("counts only the machines that reported in each bucket", () => {
    const view = hostLoadView([
      history(8, 16 * GB, [stats(0.6, GB), null], stats(0.6, GB)),
      history(8, 16 * GB, [null, stats(0.2, GB)], stats(0.2, GB)),
    ]);
    expect(view?.cpu.points).toEqual([0.6, 0.2]);
  });
});
