import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  type FleetMachine,
  type FleetWarning,
  fleetTotals,
  formatBytes,
  formatSince,
  formatUsedOfTotal,
} from "@cz/client-runtime/fleet";
import type { EnvironmentId } from "@cz/contracts";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangleIcon, PowerIcon, SquareIcon } from "lucide-react";
import { useContext, useEffect, useState } from "react";

import { isElectron } from "~/env";
import { cn } from "../../lib/utils";
import { useEnvironments } from "../../state/environments";
import { useWakeEnvironment } from "../../state/hostWake";
import { serverEnvironment } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { SidebarInset } from "../ui/sidebar";
import { toastManager } from "../ui/toast";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { fleetAtom, Meter } from "./MachineLoad";

/** How often host readings refresh while the page is open (the server caches 5 s). */
const REFRESH_MS = 3000;

function Gauge(props: {
  readonly label: string;
  readonly ratio: number;
  readonly value: string;
  readonly muted: boolean;
}) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-2 text-xs">
      <span className="truncate text-muted-foreground">{props.label}</span>
      <Meter ratio={props.ratio} muted={props.muted} />
      <span className="text-right tabular-nums text-foreground">{props.value}</span>
    </div>
  );
}

const warningText = (warning: FleetWarning) =>
  warning.kind === "disk"
    ? `${warning.mount} has ${formatBytes(warning.freeBytes)} free`
    : warning.kind === "memory"
      ? `Memory ${Math.round(warning.usedRatio * 100)}% used`
      : `Swap ${Math.round(warning.usedRatio * 100)}% used`;

const STATE_BADGE: Record<
  FleetMachine["state"],
  { readonly label: string; readonly variant: "success" | "info" | "warning" | "error" }
> = {
  awake: { label: "Awake", variant: "success" },
  connecting: { label: "Connecting", variant: "warning" },
  asleep: { label: "Asleep", variant: "info" },
  unreachable: { label: "Unreachable", variant: "error" },
};

function Stat(props: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-card px-4 py-3">
      <span className="text-xs text-muted-foreground">{props.label}</span>
      {props.children}
    </div>
  );
}

function MachineCard({ machine, now }: { readonly machine: FleetMachine; readonly now: number }) {
  const navigate = useNavigate();
  const { environments } = useEnvironments();
  const wake = useWakeEnvironment();
  const interrupt = useAtomCommand(threadEnvironment.interruptTurn, { label: "stop agent" });
  const { resources } = machine;
  const awake = machine.state === "awake";
  const badge = STATE_BADGE[machine.state];
  const memUsed = resources ? resources.totalMemoryBytes - resources.availableMemoryBytes : 0;
  const zramRam = (resources?.swap?.devices ?? [])
    .filter((device) => device.kind === "zram")
    .reduce((sum, device) => sum + (device.memoryBytes ?? 0), 0);

  return (
    <section
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4",
        machine.warnings.length > 0 ? "border-destructive/60" : "border-border",
        !awake && "opacity-80",
      )}
      aria-label={machine.label}
    >
      <header className="flex items-center gap-2">
        <span className="truncate text-sm font-semibold text-foreground">{machine.label}</span>
        <Badge variant={badge.variant} size="sm">
          {badge.label}
        </Badge>
        {awake && resources?.loadAverage?.[0] !== undefined ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            load {resources.loadAverage[0].toFixed(1)} · {resources.cpuCount} cores
          </span>
        ) : null}
        {machine.state === "asleep" ? (
          <Button
            size="xs"
            variant="outline"
            className="ml-auto"
            onClick={() => {
              const target = environments.find(
                (environment) => environment.environmentId === machine.environmentId,
              );
              if (!target) return;
              void wake(target).then((outcome) =>
                toastManager.add({
                  type: outcome === "sent" ? "success" : "error",
                  title:
                    outcome === "sent"
                      ? `Waking ${machine.label}; it reconnects in about 30 seconds.`
                      : `No connected machine can wake ${machine.label}.`,
                }),
              );
            }}
          >
            <PowerIcon />
            Wake
          </Button>
        ) : null}
      </header>

      {machine.warnings.length > 0 ? (
        <div className="flex items-start gap-2 rounded-md bg-destructive/8 px-2.5 py-1.5 text-xs text-destructive-foreground dark:bg-destructive/16">
          <AlertTriangleIcon className="mt-px size-3.5 shrink-0" />
          <span>{machine.warnings.map(warningText).join(" · ")}</span>
        </div>
      ) : null}

      {resources && machine.state !== "unreachable" ? (
        <div className="flex flex-col gap-1.5">
          <Gauge
            label="CPU"
            ratio={resources.cpuUtilization ?? 0}
            value={`${Math.round((resources.cpuUtilization ?? 0) * 100)}%`}
            muted={!awake}
          />
          <Gauge
            label="Memory"
            ratio={resources.totalMemoryBytes > 0 ? memUsed / resources.totalMemoryBytes : 0}
            value={formatUsedOfTotal(memUsed, resources.totalMemoryBytes)}
            muted={!awake}
          />
          {resources.swap && resources.swap.totalBytes > 0 ? (
            <Gauge
              label="Swap"
              ratio={resources.swap.usedBytes / resources.swap.totalBytes}
              value={`${formatUsedOfTotal(resources.swap.usedBytes, resources.swap.totalBytes)}${zramRam > 0 ? ` · zram ${formatBytes(zramRam)}` : ""}`}
              muted={!awake}
            />
          ) : null}
          {(resources.disks ?? []).map((disk) => (
            <Gauge
              key={disk.mount}
              label={disk.mount}
              ratio={disk.totalBytes > 0 ? 1 - disk.freeBytes / disk.totalBytes : 0}
              value={`${formatBytes(disk.freeBytes)} free`}
              muted={!awake}
            />
          ))}
          {!awake ? (
            <span className="text-xs text-muted-foreground">
              Last reading{" "}
              {formatSince(resources.sampledAt, now) === "now"
                ? "just now"
                : `${formatSince(resources.sampledAt, now)} ago`}
            </span>
          ) : null}
        </div>
      ) : machine.state === "unreachable" ? (
        <p className="text-xs text-muted-foreground">Not answering, and no machine can wake it.</p>
      ) : null}

      {awake ? (
        machine.agents.length === 0 ? (
          <p className="text-xs text-muted-foreground">Idle</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/60 border-t border-border/60">
            {machine.agents.map((agent) => (
              <li key={agent.threadId} className="flex items-center gap-2 py-2">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
                  onClick={() =>
                    void navigate({
                      to: "/$environmentId/$threadId",
                      params: { environmentId: machine.environmentId, threadId: agent.threadId },
                    })
                  }
                >
                  <span className="w-full truncate text-sm text-foreground hover:underline">
                    {agent.title}
                  </span>
                  <span className="w-full truncate text-xs text-muted-foreground">
                    {agent.project} · {agent.model}
                  </span>
                  <span
                    className={cn(
                      "w-full truncate font-mono text-xs",
                      agent.needsYou ? "text-warning-foreground" : "text-info-foreground",
                    )}
                  >
                    {agent.activity}
                  </span>
                </button>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatSince(agent.sinceMs, now)}
                </span>
                {agent.needsYou ? null : (
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Stop ${agent.title}`}
                    onClick={() =>
                      void interrupt({
                        environmentId: machine.environmentId,
                        input: { threadId: agent.threadId },
                      })
                    }
                  >
                    <SquareIcon />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}

/** Every paired machine at once, live: capacity, health, and the agents working on each. */
export function FleetPage() {
  const machines = useAtomValue(fleetAtom);
  const totals = fleetTotals(machines);
  const registry = useContext(RegistryContext);
  const [now, setNow] = useState(() => Date.now());

  const awakeIds = machines
    .filter((machine) => machine.state === "awake")
    .map((machine) => machine.environmentId)
    .join(",");
  useEffect(() => {
    const tick = () => {
      // A hidden tab keeps its last readings rather than polling every machine.
      if (document.visibilityState !== "visible") return;
      setNow(Date.now());
      for (const environmentId of awakeIds.split(",").filter(Boolean)) {
        registry.refresh(
          serverEnvironment.hostResources({
            environmentId: environmentId as EnvironmentId,
            input: {},
          }),
        );
      }
    };
    const timer = setInterval(tick, REFRESH_MS);
    return () => clearInterval(timer);
  }, [awakeIds, registry]);

  const cpuRatio = totals.cpuCores > 0 ? totals.cpuBusyCores / totals.cpuCores : 0;
  const memoryRatio =
    totals.memoryTotalBytes > 0 ? totals.memoryUsedBytes / totals.memoryTotalBytes : 0;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <div className="flex w-full items-center gap-2">
            <span className="text-sm font-medium text-foreground">Fleet</span>
            <span className="text-xs text-muted-foreground">live</span>
          </div>
        </WorkspacePageHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Machines awake">
                <span className="text-xl font-semibold tabular-nums text-foreground">
                  {totals.awake}
                  <span className="text-muted-foreground">/{totals.machines}</span>
                </span>
              </Stat>
              <Stat label="Agents working">
                <span className="flex items-baseline gap-2">
                  <span className="text-xl font-semibold tabular-nums text-foreground">
                    {totals.agents}
                  </span>
                  {totals.needsYou > 0 ? (
                    <Badge variant="warning" size="sm">
                      {totals.needsYou} need{totals.needsYou === 1 ? "s" : ""} you
                    </Badge>
                  ) : null}
                </span>
              </Stat>
              <Stat label="CPU in use">
                <span className="text-sm tabular-nums text-foreground">
                  {totals.cpuBusyCores.toFixed(1)} of {totals.cpuCores} cores
                </span>
                <Meter ratio={cpuRatio} />
              </Stat>
              <Stat label="Memory in use">
                <span className="text-sm tabular-nums text-foreground">
                  {formatUsedOfTotal(totals.memoryUsedBytes, totals.memoryTotalBytes)}
                </span>
                <Meter ratio={memoryRatio} />
              </Stat>
            </div>
            {machines.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No machines yet. Pair one in Settings → Connections.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {machines.map((machine) => (
                  <MachineCard key={machine.environmentId} machine={machine} now={now} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}
