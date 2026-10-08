/**
 * Machine load over a range as fractions ready to draw, for one machine or
 * all of them. Each host reports its own minute samples (HostLoadHistory);
 * this module only combines what they return.
 *
 * @module hostLoad
 */
import type { HostLoadHistory, HostLoadStats } from "@cz/contracts";

export interface LoadSeries {
  /** Average over the range. */
  readonly avg: number;
  /** Highest bucket peak in the range. */
  readonly peak: number;
  /** Bucket averages, null where no machine reported. */
  readonly points: ReadonlyArray<number | null>;
}

export interface HostLoadView {
  readonly cpu: LoadSeries;
  readonly memory: LoadSeries;
  readonly memoryTotalBytes: number;
  /** Null when no machine in the range has an NVIDIA GPU. */
  readonly gpu: LoadSeries | null;
  readonly firstSampleAt: number | null;
}

type Part = { readonly value: number; readonly weight: number };

const weighted = (parts: ReadonlyArray<Part>) => {
  const weight = parts.reduce((total, part) => total + part.weight, 0);
  return weight <= 0
    ? null
    : parts.reduce((total, part) => total + part.value * part.weight, 0) / weight;
};

function combineSeries(
  histories: ReadonlyArray<HostLoadHistory>,
  pick: (
    stats: HostLoadStats,
    history: HostLoadHistory,
  ) => { readonly avg: number; readonly peak: number } | null,
  weightOf: (history: HostLoadHistory) => number,
): LoadSeries | null {
  const at = (stats: (history: HostLoadHistory) => HostLoadStats | null | undefined) => {
    const parts = histories.flatMap((history) => {
      const entry = stats(history);
      const picked = entry ? pick(entry, history) : null;
      return picked ? [{ ...picked, weight: weightOf(history) }] : [];
    });
    const avg = weighted(parts.map((part) => ({ value: part.avg, weight: part.weight })));
    const peak = weighted(parts.map((part) => ({ value: part.peak, weight: part.weight })));
    return avg === null || peak === null ? null : { avg, peak };
  };
  const summary = at((history) => history.summary);
  if (summary === null) return null;
  const length = Math.max(0, ...histories.map((history) => history.buckets.length));
  const buckets = Array.from({ length }, (_, index) => at((history) => history.buckets[index]));
  return {
    avg: summary.avg,
    // Machines' peaks rarely coincide, so the combined peak is the busiest
    // bucket's weighted peak rather than a weighted sum of whole-range peaks.
    peak: Math.max(0, ...buckets.map((bucket) => bucket?.peak ?? 0)),
    points: buckets.map((bucket) => bucket?.avg ?? null),
  };
}

/**
 * One machine's history, or several combined: CPU weighted by cores, RAM as
 * used over total memory, GPU averaged over machines that have one. Null when
 * none of them has a sample in the range.
 */
export function hostLoadView(histories: ReadonlyArray<HostLoadHistory>): HostLoadView | null {
  const cpu = combineSeries(
    histories,
    (stats) => ({ avg: stats.avgCpu, peak: stats.peakCpu }),
    (history) => history.cpuCount,
  );
  const memory = combineSeries(
    histories,
    (stats, history) =>
      history.totalMemoryBytes <= 0
        ? null
        : {
            avg: stats.avgMemoryBytes / history.totalMemoryBytes,
            peak: stats.peakMemoryBytes / history.totalMemoryBytes,
          },
    (history) => history.totalMemoryBytes,
  );
  if (cpu === null || memory === null) return null;
  const firstSamples = histories.flatMap((history) =>
    history.firstSampleAt === null ? [] : [history.firstSampleAt],
  );
  return {
    cpu,
    memory,
    memoryTotalBytes: histories.reduce((total, history) => total + history.totalMemoryBytes, 0),
    gpu: combineSeries(
      histories,
      (stats) =>
        stats.avgGpu === null || stats.peakGpu === null
          ? null
          : { avg: stats.avgGpu, peak: stats.peakGpu },
      () => 1,
    ),
    firstSampleAt: firstSamples.length === 0 ? null : Math.min(...firstSamples),
  };
}
