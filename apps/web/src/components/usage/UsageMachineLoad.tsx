import { useAtomValue } from "@effect/atom-react";
import { formatBytes } from "@cz/client-runtime/fleet";
import { hostLoadView, type HostLoadView, type LoadSeries } from "@cz/client-runtime/hostLoad";
import type { EnvironmentId, HostLoadHistory } from "@cz/contracts";
import { formatDateTimeShort } from "@cz/shared/usageFormat";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { serverEnvironment } from "../../state/server";
import { fleetAtom } from "../fleet/MachineLoad";

/** Sparkline resolution: 48 points reads as a shape at every range. */
const BUCKETS = 48;

type MachineLoad =
  | { readonly kind: "offline" | "connecting" | "unsupported" | "loading" }
  | { readonly kind: "ready"; readonly history: HostLoadHistory };

/** Each selected machine's load for one range; machines that are not awake are not asked. */
const machineLoadAtom = Atom.family((key: string) =>
  Atom.make((get): ReadonlyMap<EnvironmentId, MachineLoad> => {
    const { sinceMs, untilMs } = JSON.parse(key) as { sinceMs: number; untilMs: number };
    const loads = new Map<EnvironmentId, MachineLoad>();
    for (const machine of get(fleetAtom)) {
      if (machine.state !== "awake") {
        loads.set(
          machine.environmentId,
          machine.state === "connecting" ? { kind: "connecting" } : { kind: "offline" },
        );
        continue;
      }
      const result = get(
        serverEnvironment.hostLoadHistory({
          environmentId: machine.environmentId,
          input: { sinceMs, untilMs, buckets: BUCKETS },
        }),
      );
      const history = Option.getOrNull(AsyncResult.value(result));
      loads.set(
        machine.environmentId,
        history !== null
          ? { kind: "ready", history }
          : result._tag === "Failure"
            ? { kind: "unsupported" }
            : { kind: "loading" },
      );
    }
    return loads;
  }).pipe(Atom.withLabel(`web-usage:machine-load:${key}`)),
);

const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;

/**
 * Average and peak CPU, RAM, and GPU per machine over the Usage page's range,
 * plus all selected machines combined. Machines that are off say so instead
 * of reading as idle.
 */
export function UsageMachineLoad({
  selectedEnvironmentIds,
  sinceMs,
  untilMs,
  rangeLabel,
  timeZone,
}: {
  readonly selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null;
  readonly sinceMs: number;
  readonly untilMs: number;
  readonly rangeLabel: string;
  readonly timeZone: string;
}) {
  const machines = useAtomValue(fleetAtom).filter(
    (machine) =>
      selectedEnvironmentIds === null || selectedEnvironmentIds.has(machine.environmentId),
  );
  const loads = useAtomValue(machineLoadAtom(JSON.stringify({ sinceMs, untilMs })));
  if (machines.length === 0) return null;

  const histories = machines.flatMap((machine) => {
    const load = loads.get(machine.environmentId);
    return load?.kind === "ready" ? [load.history] : [];
  });
  const views = new Map(
    machines.flatMap((machine) => {
      const load = loads.get(machine.environmentId);
      return load?.kind === "ready" ? [[machine.environmentId, hostLoadView([load.history])]] : [];
    }),
  );
  const combined = hostLoadView(histories);
  const reporting = [...views.values()].filter((view) => view !== null).length;
  const showGpu = [...views.values()].some((view) => view?.gpu);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-foreground">Machine load</h2>
        <span className="text-xs text-muted-foreground">Average and peak · {rangeLabel}</span>
      </div>
      <div className="flex flex-col">
        {machines.length > 1 && combined !== null ? (
          <MachineLoadRow
            label="All machines"
            detail={`${reporting} of ${machines.length} reporting`}
            view={combined}
            showGpu={showGpu}
          />
        ) : null}
        {machines.map((machine) => (
          <MachineLoadRow
            key={machine.environmentId}
            label={machine.label}
            detail={machineDetail(loads.get(machine.environmentId), sinceMs, timeZone)}
            view={views.get(machine.environmentId) ?? null}
            showGpu={showGpu}
            status={machineStatus(loads.get(machine.environmentId))}
          />
        ))}
      </div>
    </section>
  );
}

function machineStatus(load: MachineLoad | undefined): string {
  switch (load?.kind) {
    case "connecting":
      return "Connecting…";
    case "unsupported":
      return "This machine's cz does not record load yet. Update it.";
    case "loading":
      return "Loading…";
    case "ready":
      return "No samples in this range.";
    default:
      return "Offline";
  }
}

/** Cores and memory, and when recording began if that is inside the range. */
function machineDetail(
  load: MachineLoad | undefined,
  sinceMs: number,
  timeZone: string,
): string | undefined {
  if (load?.kind !== "ready") return undefined;
  const { firstSampleAt, cpuCount, totalMemoryBytes } = load.history;
  const size = `${cpuCount} cores · ${formatBytes(totalMemoryBytes)}`;
  // Recording starts when a host first runs this version; say so rather than imply idle.
  return firstSampleAt !== null && firstSampleAt > sinceMs + 60 * 60_000
    ? `${size} · since ${formatDateTimeShort(new Date(firstSampleAt).toISOString(), timeZone)}`
    : size;
}

function MachineLoadRow({
  label,
  detail,
  view,
  showGpu,
  status,
}: {
  readonly label: string;
  readonly detail: string | undefined;
  readonly view: HostLoadView | null;
  readonly showGpu: boolean;
  readonly status?: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-3 border-b border-border/50 py-3 sm:grid-cols-[11rem_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm text-foreground">{label}</span>
        {detail ? <span className="truncate text-xs text-muted-foreground">{detail}</span> : null}
      </div>
      {view === null ? (
        <span className="self-center text-xs text-muted-foreground">{status}</span>
      ) : (
        <div className="grid min-w-0 grid-cols-3 gap-x-4 sm:gap-x-6">
          <LoadMetric label="CPU" series={view.cpu} />
          <LoadMetric
            label="RAM"
            series={view.memory}
            aside={`of ${formatBytes(view.memoryTotalBytes)}`}
          />
          {showGpu ? (
            view.gpu ? (
              <LoadMetric label="GPU" series={view.gpu} />
            ) : (
              <span className="text-xs text-muted-foreground">No GPU</span>
            )
          ) : null}
        </div>
      )}
    </div>
  );
}

function LoadMetric({
  label,
  series,
  aside,
}: {
  readonly label: string;
  readonly series: LoadSeries;
  readonly aside?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="truncate text-xs text-muted-foreground">
        {label}
        {aside ? ` ${aside}` : ""}
      </span>
      <span className="flex flex-wrap items-baseline gap-x-1.5 text-sm text-foreground tabular-nums">
        {percent(series.avg)}
        <span className="text-xs whitespace-nowrap text-muted-foreground">
          avg · {percent(series.peak)} peak
        </span>
      </span>
      <Sparkline points={series.points} label={`${label} over the range`} />
    </div>
  );
}

/** Bucket averages on a fixed 0-100% scale; gaps where the machine was off. */
function Sparkline({
  points,
  label,
}: {
  readonly points: ReadonlyArray<number | null>;
  readonly label: string;
}) {
  // Runs of reported buckets; a lone bucket becomes a short dash so it still shows.
  const segments: Array<string> = [];
  let run: Array<[number, number]> = [];
  const flush = () => {
    if (run.length === 1)
      run = [
        [run[0]![0] - 0.4, run[0]![1]],
        [run[0]![0] + 0.4, run[0]![1]],
      ];
    if (run.length > 0) segments.push(run.map(([x, y]) => `${x},${y}`).join(" "));
    run = [];
  };
  points.forEach((point, index) => {
    if (point === null) flush();
    else run.push([index + 0.5, (1 - point) * 20]);
  });
  flush();
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 -1 ${Math.max(1, points.length)} 22`}
      preserveAspectRatio="none"
      className="h-6 w-full text-muted-foreground"
    >
      <line
        x1={0}
        x2={points.length}
        y1={20}
        y2={20}
        stroke="currentColor"
        strokeOpacity={0.25}
        vectorEffect="non-scaling-stroke"
      />
      {segments.map((segment) => (
        <polyline
          key={segment}
          points={segment}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.25}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          className="text-foreground"
        />
      ))}
    </svg>
  );
}
