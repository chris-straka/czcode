/**
 * The fleet: every paired machine side by side with its capacity, health,
 * and the agents running on it right now. Pure, so web, mobile, and the
 * terminal app draw the same thing from the same rules.
 *
 * @module fleet
 */
import type {
  EnvironmentId,
  HostResourcesSnapshot,
  OnlinePeers,
  OrchestrationV2ShellSnapshot,
  OrchestrationV2ThreadShell,
  ThreadId,
} from "@cz/contracts";
import * as DateTime from "effect/DateTime";

/**
 * awake: connected. connecting: first attempt still in flight. busy: its cz
 * server isn't answering but the machine is online on the tailnet, so it is
 * overloaded, not asleep, and waking it would do nothing. asleep: not
 * answering, but another machine can send it a wake packet (a host that
 * sleeps when idle looks exactly like this). unreachable: not answering and
 * nothing can wake it.
 */
export type FleetMachineState = "awake" | "connecting" | "busy" | "asleep" | "unreachable";

/** A run still `starting` this long has no start left coming; the server fails it soon after. */
export const STUCK_START_MS = 15 * 60_000;

export interface FleetAgent {
  readonly threadId: ThreadId;
  readonly title: string;
  readonly project: string;
  readonly model: string;
  /** "$ vp test run", "needs you", or the run's status when the server says nothing more. */
  readonly activity: string;
  readonly needsYou: boolean;
  /** When the current work started, for "12m". */
  readonly sinceMs: number | null;
  /** Starting for longer than a start takes: shown, but not counted as working. */
  readonly stuck: boolean;
}

export type FleetWarning =
  | {
      readonly kind: "disk";
      readonly mount: string;
      readonly freeBytes: number;
      readonly freeRatio: number;
    }
  | { readonly kind: "memory"; readonly usedRatio: number }
  | { readonly kind: "swap"; readonly usedRatio: number };

export interface FleetMachine {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly state: FleetMachineState;
  /** The latest reading, kept while the machine stops answering so its last state stays visible. */
  readonly resources: HostResourcesSnapshot | null;
  readonly warnings: ReadonlyArray<FleetWarning>;
  readonly agents: ReadonlyArray<FleetAgent>;
}

export interface FleetTotals {
  readonly machines: number;
  readonly awake: number;
  readonly agents: number;
  readonly needsYou: number;
  /** Busy cores across awake machines (utilization × cores). */
  readonly cpuBusyCores: number;
  readonly cpuCores: number;
  readonly memoryUsedBytes: number;
  readonly memoryTotalBytes: number;
}

export interface FleetMachineInput {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly phase:
    | "connected"
    | "connecting"
    | "backoff"
    | "offline"
    | "blocked"
    | "available"
    | null;
  /** The machine has an address to wake by and another connected machine to send it. */
  readonly wakeable: boolean;
  /** Another connected machine sees it online on the tailnet. */
  readonly peerOnline: boolean;
  readonly resources: HostResourcesSnapshot | null;
  readonly shell: Pick<OrchestrationV2ShellSnapshot, "threads" | "projects"> | null;
}

/** A disk below this fraction free (or below DISK_LOW_BYTES) is flagged. */
const DISK_LOW_RATIO = 0.1;
const DISK_LOW_BYTES = 10 * 1024 ** 3;
const MEMORY_HIGH_RATIO = 0.9;
const SWAP_HIGH_RATIO = 0.8;

/** What a machine is short of, worst first. */
export function fleetWarnings(resources: HostResourcesSnapshot | null): Array<FleetWarning> {
  if (resources === null) return [];
  const warnings: Array<FleetWarning> = [];
  for (const disk of resources.disks ?? []) {
    if (disk.totalBytes <= 0) continue;
    const freeRatio = disk.freeBytes / disk.totalBytes;
    // A small disk (an EFI partition) is only flagged when nearly full.
    const lowBytes = disk.totalBytes > DISK_LOW_BYTES * 4 && disk.freeBytes < DISK_LOW_BYTES;
    if (freeRatio < DISK_LOW_RATIO || lowBytes) {
      warnings.push({ kind: "disk", mount: disk.mount, freeBytes: disk.freeBytes, freeRatio });
    }
  }
  if (resources.totalMemoryBytes > 0) {
    const usedRatio = 1 - resources.availableMemoryBytes / resources.totalMemoryBytes;
    if (usedRatio >= MEMORY_HIGH_RATIO) warnings.push({ kind: "memory", usedRatio });
  }
  if (resources.swap && resources.swap.totalBytes > 0) {
    const usedRatio = resources.swap.usedBytes / resources.swap.totalBytes;
    if (usedRatio >= SWAP_HIGH_RATIO) warnings.push({ kind: "swap", usedRatio });
  }
  // Least headroom first.
  const headroom = (warning: FleetWarning) =>
    warning.kind === "disk" ? warning.freeRatio : 1 - warning.usedRatio;
  return [...warnings].sort((left, right) => headroom(left) - headroom(right));
}

function machineState(input: FleetMachineInput): FleetMachineState {
  if (input.phase === "connected") return "awake";
  if (input.phase === "connecting" && input.resources === null && input.shell === null) {
    return "connecting";
  }
  if (input.peerOnline) return "busy";
  return input.wakeable ? "asleep" : "unreachable";
}

/**
 * Whether `host` (a connection URL's hostname: MagicDNS name, short name, or
 * Tailscale IP) is among the online peers.
 */
export function isPeerOnline(host: string | null, peers: OnlinePeers["peers"]): boolean {
  if (host === null) return false;
  const wanted = host.toLowerCase().replace(/\.$/, "");
  return peers.some((peer) => {
    const dnsName = peer.dnsName.toLowerCase();
    return (
      dnsName === wanted ||
      dnsName.split(".")[0] === wanted ||
      peer.hostName.toLowerCase() === wanted ||
      peer.tailscaleIps.includes(wanted)
    );
  });
}

const toMs = (value: DateTime.Utc | null | undefined) =>
  value == null ? null : DateTime.toEpochMillis(value);

/** A thread counts as running while it has an active run or is waiting on you. */
function isRunningAgent(thread: OrchestrationV2ThreadShell): boolean {
  return (
    thread.deletedAt === null &&
    thread.archivedAt === null &&
    (thread.activeRunId !== null || thread.pendingRuntimeRequest !== null)
  );
}

function agentsOf(shell: FleetMachineInput["shell"], nowMs: number): Array<FleetAgent> {
  if (shell === null) return [];
  const projects = new Map(shell.projects.map((project) => [project.id, project.title]));
  return shell.threads
    .filter(isRunningAgent)
    .map((thread) => {
      const needsYou = thread.pendingRuntimeRequest !== null;
      const sinceMs = toMs(thread.activityRunStartedAt) ?? toMs(thread.latestRunStartedAt);
      const starting =
        thread.activityRunStatus === "starting" || thread.activityRunStatus === "preparing";
      const stuck = !needsYou && starting && sinceMs !== null && nowMs - sinceMs > STUCK_START_MS;
      return {
        threadId: thread.id,
        title: thread.title || "Untitled",
        project: projects.get(thread.projectId) ?? "",
        model: thread.modelSelection.model,
        activity: needsYou
          ? "needs you"
          : stuck
            ? "stuck starting"
            : (thread.currentActivity ?? thread.activityRunStatus ?? "working"),
        needsYou,
        sinceMs,
        stuck,
      };
    })
    .sort(
      (left, right) =>
        Number(right.needsYou) - Number(left.needsYou) ||
        (left.sinceMs ?? Infinity) - (right.sinceMs ?? Infinity),
    );
}

/** One row per machine: awake ones first, the busiest at the top. */
export function fleetMachines(
  inputs: ReadonlyArray<FleetMachineInput>,
  nowMs: number,
): Array<FleetMachine> {
  const order: Record<FleetMachineState, number> = {
    awake: 0,
    connecting: 1,
    busy: 2,
    asleep: 3,
    unreachable: 4,
  };
  return inputs
    .map((input) => ({
      environmentId: input.environmentId,
      label: input.label,
      state: machineState(input),
      resources: input.resources,
      warnings: fleetWarnings(input.resources),
      // A machine that isn't answering may still list threads from its last
      // snapshot; they aren't known to be running, so don't show them.
      agents: input.phase === "connected" ? agentsOf(input.shell, nowMs) : [],
    }))
    .sort(
      (left, right) =>
        order[left.state] - order[right.state] ||
        right.agents.length - left.agents.length ||
        left.label.localeCompare(right.label),
    );
}

export function fleetTotals(machines: ReadonlyArray<FleetMachine>): FleetTotals {
  let cpuBusyCores = 0;
  let cpuCores = 0;
  let memoryUsedBytes = 0;
  let memoryTotalBytes = 0;
  for (const machine of machines) {
    if (machine.state !== "awake" || machine.resources === null) continue;
    const { resources } = machine;
    cpuCores += resources.cpuCount;
    cpuBusyCores += (resources.cpuUtilization ?? 0) * resources.cpuCount;
    memoryTotalBytes += resources.totalMemoryBytes;
    memoryUsedBytes += resources.totalMemoryBytes - resources.availableMemoryBytes;
  }
  const agents = machines.flatMap((machine) => machine.agents).filter((agent) => !agent.stuck);
  return {
    machines: machines.length,
    awake: machines.filter((machine) => machine.state === "awake").length,
    agents: agents.length,
    needsYou: agents.filter((agent) => agent.needsYou).length,
    cpuBusyCores,
    cpuCores,
    memoryUsedBytes,
    memoryTotalBytes,
  };
}

/** "1.2 TB", "512 GB", "37 MB": for capacity labels. */
export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** "8.5/30 GB": a used/total pair sharing the total's unit. */
export function formatUsedOfTotal(used: number, total: number): string {
  const [totalValue, unit] = formatBytes(total).split(" ");
  const scale = 1024 ** ["B", "KB", "MB", "GB", "TB"].indexOf(unit ?? "B");
  const value = used / scale;
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)}/${totalValue} ${unit}`;
}

/** "a few seconds", "12m", "3h": how long an agent has been at it. */
export function formatSince(sinceMs: number | null, nowMs: number): string {
  if (sinceMs === null) return "";
  const minutes = Math.max(0, Math.floor((nowMs - sinceMs) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48
    ? `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`
    : `${Math.floor(hours / 24)}d`;
}
