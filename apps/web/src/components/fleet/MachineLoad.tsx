import { RegistryContext } from "@effect/atom-react";
import type { FleetMachine } from "@cz/client-runtime/fleet";
import { createFleetAtom } from "@cz/client-runtime/state/fleet";
import type { EnvironmentId } from "@cz/contracts";
import { useContext, useEffect } from "react";

import { environmentCatalog } from "../../connection/catalog";
import { cn } from "../../lib/utils";
import { serverEnvironment } from "../../state/server";
import { environmentSnapshotAtom } from "../../state/shell";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Every enabled machine with its latest reading and running agents (Fleet, the machine filter). */
export const fleetAtom = createFleetAtom({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  connectionStateAtom: environmentCatalog.stateAtom,
  shellSnapshotAtom: environmentSnapshotAtom,
  hostResourcesAtom: (environmentId) =>
    serverEnvironment.hostResources({ environmentId, input: {} }),
  onlinePeersAtom: (environmentId) => serverEnvironment.onlinePeers({ environmentId, input: {} }),
});

const levelClass = (ratio: number) =>
  ratio >= 0.9 ? "bg-destructive" : ratio >= 0.7 ? "bg-warning" : "bg-success";

export function Meter({
  ratio,
  muted,
  className,
}: {
  readonly ratio: number;
  readonly muted?: boolean;
  readonly className?: string;
}) {
  const clamped = Math.min(1, Math.max(0, ratio));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div
        className={cn(
          "h-full rounded-full",
          muted ? "bg-muted-foreground/40" : levelClass(clamped),
        )}
        style={{ width: `${Math.max(clamped > 0 ? 2 : 0, clamped * 100)}%` }}
      />
    </div>
  );
}

/**
 * Refreshes the given machines' host readings every `intervalMs` while the
 * tab is visible (the server caches them 5 s). Off while `enabled` is false.
 */
export function useLiveHostResources(
  environmentIds: ReadonlyArray<EnvironmentId>,
  intervalMs: number,
  enabled = true,
) {
  const registry = useContext(RegistryContext);
  const key = environmentIds.join(",");
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      for (const environmentId of key.split(",").filter(Boolean)) {
        registry.refresh(
          serverEnvironment.hostResources({
            environmentId: environmentId as EnvironmentId,
            input: {},
          }),
        );
      }
    };
    tick();
    const timer = setInterval(tick, intervalMs);
    return () => clearInterval(timer);
  }, [key, intervalMs, enabled, registry]);
}

const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;

/** The fullest disk's used share; null without disk readings. */
function fullestDisk(machine: FleetMachine): number | null {
  const ratios = (machine.resources?.disks ?? []).map((disk) =>
    disk.totalBytes > 0 ? 1 - disk.freeBytes / disk.totalBytes : 0,
  );
  return ratios.length > 0 ? Math.max(...ratios) : null;
}

/** One machine's load in a line: CPU, RAM, swap, and fullest disk as small bars, then its agents. */
export function MachineLoadMeter({ machine }: { readonly machine: FleetMachine }) {
  const resources = machine.resources;
  const awake = machine.state === "awake";
  if (!resources) {
    return <span className="text-xs text-muted-foreground">{awake ? "…" : machine.state}</span>;
  }
  const bars = [
    { label: "CPU", ratio: resources.cpuUtilization ?? 0 },
    {
      label: "RAM",
      ratio:
        resources.totalMemoryBytes > 0
          ? 1 - resources.availableMemoryBytes / resources.totalMemoryBytes
          : 0,
    },
    ...(resources.swap && resources.swap.totalBytes > 0
      ? [{ label: "Swap", ratio: resources.swap.usedBytes / resources.swap.totalBytes }]
      : []),
    ...(fullestDisk(machine) !== null ? [{ label: "Disk", ratio: fullestDisk(machine)! }] : []),
  ];
  const title = [
    ...bars.map((bar) => `${bar.label} ${percent(bar.ratio)}`),
    `${machine.agents.length} agent${machine.agents.length === 1 ? "" : "s"} running`,
  ].join(" · ");
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="flex items-center gap-1.5" aria-label={title} />}>
        {bars.map((bar) => (
          <Meter key={bar.label} ratio={bar.ratio} muted={!awake} className="h-1 w-4" />
        ))}
        <span className="min-w-4 text-right text-xs tabular-nums text-muted-foreground">
          {awake ? machine.agents.length : machine.state}
        </span>
      </TooltipTrigger>
      <TooltipPopup side="bottom">{title}</TooltipPopup>
    </Tooltip>
  );
}
