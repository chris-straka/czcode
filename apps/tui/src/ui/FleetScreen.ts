import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  type FleetMachine,
  type FleetWarning,
  fleetTotals,
  formatBytes,
  formatSince,
  formatUsedOfTotal,
} from "@cz/client-runtime/fleet";
import { createFleetAtom } from "@cz/client-runtime/state/fleet";
import type { EnvironmentId, ThreadId } from "@cz/contracts";
import { Box, Text } from "ink";
import {
  createElement as h,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { TuiAtoms } from "../state/atoms.ts";
import { StatusContext, useCommand } from "./command.ts";
import { useNow, useViewport } from "./hooks.ts";
import { useKeys, useVimMotion } from "./input.ts";
import { useWakeHost } from "./useWakeHost.ts";

/** How often host readings refresh while the tab is open (the server caches 5 s). */
const REFRESH_MS = 3000;

const STATE_MARK: Record<FleetMachine["state"], { readonly mark: string; readonly color: string }> =
  {
    awake: { mark: "●", color: "green" },
    connecting: { mark: "◌", color: "yellow" },
    busy: { mark: "◐", color: "yellow" },
    asleep: { mark: "○", color: "blue" },
    unreachable: { mark: "✕", color: "red" },
  };

const levelColor = (ratio: number) => (ratio >= 0.9 ? "red" : ratio >= 0.7 ? "yellow" : "green");

/** A meter: `████░░░░` filled to `ratio`. */
function Meter(props: { readonly ratio: number; readonly width: number; readonly color?: string }) {
  const ratio = Math.min(1, Math.max(0, props.ratio));
  const filled = Math.round(ratio * props.width);
  return h(
    Text,
    null,
    h(Text, { color: props.color ?? levelColor(ratio) }, "█".repeat(filled)),
    h(Text, { dimColor: true }, "░".repeat(props.width - filled)),
  );
}

/** A labelled meter in fixed-width columns, so gauges line up from machine to machine. */
function Gauge(props: {
  readonly label: string;
  readonly ratio: number;
  readonly detail: string;
  readonly width: number;
  readonly detailWidth: number;
  readonly color?: string;
}) {
  return h(
    Box,
    { flexShrink: 0, marginRight: 1 },
    h(Box, { width: 6, flexShrink: 0 }, h(Text, { dimColor: true, wrap: "truncate" }, props.label)),
    h(Meter, {
      ratio: props.ratio,
      width: props.width,
      ...(props.color ? { color: props.color } : {}),
    }),
    h(
      Box,
      { width: props.detailWidth + 1, flexShrink: 0 },
      h(Text, { wrap: "truncate" }, ` ${props.detail}`),
    ),
  );
}

/**
 * An activity on one row: its first line, with tabs and other control
 * characters (which terminals draw wider than Ink measures) as spaces.
 */
const oneLine = (text: string) =>
  (text.split("\n")[0] ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();

const warningText = (warning: FleetWarning) =>
  warning.kind === "disk"
    ? `disk ${warning.mount} ${formatBytes(warning.freeBytes)} free`
    : warning.kind === "memory"
      ? `memory ${Math.round(warning.usedRatio * 100)}% used`
      : `swap ${Math.round(warning.usedRatio * 100)}% used`;

/** Agents listed under a machine until you step into it (then all of them). */
const AGENTS_PER_MACHINE = 5;

type Row =
  | { readonly kind: "machine"; readonly machine: FleetMachine }
  | { readonly kind: "more"; readonly machine: FleetMachine; readonly count: number }
  | {
      readonly kind: "agent";
      readonly machine: FleetMachine;
      readonly agent: FleetMachine["agents"][number];
    };

/**
 * Every paired machine at once, live: state, CPU, memory, swap and zram,
 * disks, load, and the agents working there now. j/k move between machines;
 * l or Enter steps into one, where j/k move between its agents, Enter opens
 * an agent's thread, s stops it, and h or Esc steps back out. w wakes a
 * sleeping machine (not a busy one, which is on but too loaded to answer).
 */
export function FleetScreen(props: {
  readonly atoms: TuiAtoms;
  readonly active: boolean;
  readonly onOpen: (environmentId: EnvironmentId, threadId: ThreadId) => void;
}) {
  const { atoms } = props;
  const registry = useContext(RegistryContext);
  const setStatus = useContext(StatusContext);
  const fleetAtom = useMemo(
    () =>
      createFleetAtom({
        catalogValueAtom: atoms.catalog.catalogValueAtom,
        connectionStateAtom: atoms.catalog.stateAtom,
        shellSnapshotAtom: atoms.snapshotAtom,
        hostResourcesAtom: (environmentId) =>
          atoms.server.hostResources({ environmentId, input: {} }),
        onlinePeersAtom: (environmentId) => atoms.server.onlinePeers({ environmentId, input: {} }),
      }),
    [atoms],
  );
  const machines = useAtomValue(fleetAtom);
  const totals = fleetTotals(machines);
  const now = useNow(15_000);
  const { columns, rows: height } = useViewport();
  const [machineCursor, setMachineCursor] = useState(0);
  const [agentCursor, setAgentCursor] = useState(0);
  // The machine whose agents j/k move through; null moves between machines.
  const [inside, setInside] = useState<EnvironmentId | null>(null);
  const interrupt = useCommand(atoms.threadEnvironment.interruptTurn);
  const wakeHost = useWakeHost(atoms);

  // Live while open: re-read every awake machine's host resources.
  const awakeIds = machines
    .filter((machine) => machine.state === "awake")
    .map((machine) => machine.environmentId)
    .join(",");
  useEffect(() => {
    if (!props.active) return;
    const timer = setInterval(() => {
      for (const environmentId of awakeIds.split(",").filter(Boolean)) {
        registry.refresh(
          atoms.server.hostResources({ environmentId: environmentId as EnvironmentId, input: {} }),
        );
      }
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [props.active, awakeIds, atoms, registry]);

  const rows: Array<Row> = machines.flatMap((machine): Array<Row> => {
    const shown =
      machine.environmentId === inside
        ? machine.agents
        : machine.agents.slice(0, AGENTS_PER_MACHINE);
    const hidden = machine.agents.length - shown.length;
    return [
      { kind: "machine", machine },
      ...shown.map((agent) => ({ kind: "agent" as const, machine, agent })),
      ...(hidden > 0 ? [{ kind: "more" as const, machine, count: hidden }] : []),
    ];
  });
  const machineIndex = Math.min(machineCursor, Math.max(0, machines.length - 1));
  const focused = machines[machineIndex];
  const agents = inside !== null && focused?.environmentId === inside ? focused.agents : null;
  const agentIndex = agents ? Math.min(agentCursor, Math.max(0, agents.length - 1)) : 0;
  const selected = Math.max(
    0,
    rows.findIndex((row) =>
      agents && agents.length > 0
        ? row.kind === "agent" && row.agent === agents[agentIndex]
        : row.kind === "machine" && row.machine === focused,
    ),
  );
  const current = rows[selected];

  const vim = useVimMotion();
  useKeys(
    (input, key) => {
      if (agents && agents.length > 0) {
        const back = () => setInside(null);
        if (
          vim(input, key, {
            cursor: agentIndex,
            count: agents.length,
            page: 10,
            onMove: setAgentCursor,
            onBack: back,
          })
        )
          return;
        if (key.escape) return back();
      } else {
        if (
          vim(input, key, {
            cursor: machineIndex,
            count: machines.length,
            page: 5,
            onMove: setMachineCursor,
          })
        )
          return;
        if ((input === "l" || key.return) && focused) {
          if (focused.agents.length === 0)
            return setStatus(`No agents working on ${focused.label}.`);
          setAgentCursor(0);
          return setInside(focused.environmentId);
        }
      }
      if (!current) return;
      if (key.return && current.kind === "agent") {
        return props.onOpen(current.machine.environmentId, current.agent.threadId);
      }
      if (input === "s" && current.kind === "agent" && !current.agent.needsYou) {
        void interrupt({
          environmentId: current.machine.environmentId,
          input: { threadId: current.agent.threadId },
        }).then((result) => result !== null && setStatus(`Stopping "${current.agent.title}".`));
        return;
      }
      if (input === "w") {
        const { machine } = current;
        if (machine.state === "awake") return setStatus(`${machine.label} is awake.`);
        // Online on the tailnet but too loaded to answer: a wake packet does nothing.
        if (machine.state === "busy") {
          return setStatus(`${machine.label} is on but too busy to answer; waking won't help.`);
        }
        setStatus(`Waking ${machine.label}…`);
        void wakeHost(machine.environmentId, { userInitiated: true }).then(
          (message) => message && setStatus(message),
        );
      }
    },
    { isActive: props.active },
  );

  if (machines.length === 0) {
    return h(Text, { dimColor: true }, "No machines yet. Pair one in Hosts.");
  }

  const wide = columns >= 100;
  const meterWidth = wide ? 12 : 8;
  const fleetCpu = totals.cpuCores > 0 ? totals.cpuBusyCores / totals.cpuCores : 0;
  const fleetRam =
    totals.memoryTotalBytes > 0 ? totals.memoryUsedBytes / totals.memoryTotalBytes : 0;
  const header = h(
    Box,
    { flexWrap: "wrap" },
    h(Text, { bold: true }, `${totals.awake}/${totals.machines} awake`),
    h(Text, { dimColor: true }, "  ·  "),
    h(
      Text,
      totals.agents > 0 ? { bold: true, color: "cyan" } : { bold: true },
      `${totals.agents} agent${totals.agents === 1 ? "" : "s"} working`,
    ),
    totals.needsYou > 0
      ? h(
          Text,
          { color: "yellow", bold: true },
          `  ${totals.needsYou} need${totals.needsYou === 1 ? "s" : ""} you`,
        )
      : null,
    h(Text, { dimColor: true }, "  ·  CPU "),
    h(Meter, { ratio: fleetCpu, width: 10 }),
    h(Text, null, ` ${totals.cpuBusyCores.toFixed(1)}/${totals.cpuCores} cores`),
    h(Text, { dimColor: true }, "  ·  RAM "),
    h(Meter, { ratio: fleetRam, width: 10 }),
    h(Text, null, ` ${formatUsedOfTotal(totals.memoryUsedBytes, totals.memoryTotalBytes)}`),
  );

  // Every entry in `lines` is exactly one terminal row (spacers included, no
  // wrapping), so the scroll window below can count rows by counting lines.
  const lines: Array<ReactNode> = [];
  const gaugeWidth = (detailWidth: number) => 6 + meterWidth + detailWidth + 2;
  const pushGaugeRows = (key: string, gauges: ReadonlyArray<readonly [ReactNode, number]>) => {
    const room = Math.max(20, columns - 6);
    let row: Array<ReactNode> = [];
    let used = 0;
    const flush = () => {
      if (row.length === 0) return;
      lines.push(h(Box, { key: `${key}:${lines.length}`, marginLeft: 4 }, ...row));
      row = [];
      used = 0;
    };
    for (const [gauge, detailWidth] of gauges) {
      const width = gaugeWidth(detailWidth);
      if (used > 0 && used + width > room) flush();
      row.push(gauge);
      used += width;
    }
    flush();
  };
  rows.forEach((row, index) => {
    const isSelected = index === selected;
    const pointer = h(Text, { color: "cyan" }, isSelected ? "› " : "  ");
    if (row.kind === "machine") {
      const { machine } = row;
      const resources = machine.resources;
      const mark = STATE_MARK[machine.state];
      const awake = machine.state === "awake";
      const busy = machine.state === "busy";
      const facts = [
        machine.state === "asleep"
          ? "asleep · w wakes it"
          : busy
            ? "busy, not responding"
            : machine.state,
        (awake || busy) && resources?.loadAverage?.[0] !== undefined
          ? `load ${resources.loadAverage[0].toFixed(1)}`
          : null,
        (awake || busy) && resources ? `${resources.cpuCount} cores` : null,
      ].filter(Boolean);
      if (index > 0) lines.push(h(Text, { key: `sp:${machine.environmentId}` }, " "));
      lines.push(
        h(
          Box,
          { key: `m:${machine.environmentId}` },
          pointer,
          h(Text, { color: mark.color }, `${mark.mark} `),
          h(Text, { bold: true }, machine.label),
          h(Text, { dimColor: true, wrap: "truncate" }, `  ${facts.join(" · ")}`),
          machine.warnings.length > 0
            ? h(
                Text,
                { color: "red", bold: true, wrap: "truncate" },
                `  ⚠ ${machine.warnings.map(warningText).join(" · ")}`,
              )
            : null,
        ),
      );
      if (resources && machine.state !== "unreachable") {
        // Readings from a machine that stopped answering are its last known state, greyed.
        const tone = awake ? {} : { color: "gray" };
        const memUsed = resources.totalMemoryBytes - resources.availableMemoryBytes;
        const zramRam = (resources.swap?.devices ?? [])
          .filter((device) => device.kind === "zram")
          .reduce((sum, device) => sum + (device.memoryBytes ?? 0), 0);
        const cpu = resources.cpuUtilization ?? 0;
        const vitals: Array<readonly [ReactNode, number] | null> = [
          [
            h(Gauge, {
              key: "cpu",
              label: "CPU",
              ratio: cpu,
              width: meterWidth,
              detailWidth: 5,
              detail: `${Math.round(cpu * 100)}%`,
              ...tone,
            }),
            5,
          ],
          [
            h(Gauge, {
              key: "ram",
              label: "RAM",
              ratio: resources.totalMemoryBytes > 0 ? memUsed / resources.totalMemoryBytes : 0,
              width: meterWidth,
              detailWidth: 10,
              detail: formatUsedOfTotal(memUsed, resources.totalMemoryBytes),
              ...tone,
            }),
            10,
          ],
          resources.swap && resources.swap.totalBytes > 0
            ? [
                h(Gauge, {
                  key: "swap",
                  label: "Swap",
                  ratio: resources.swap.usedBytes / resources.swap.totalBytes,
                  width: meterWidth,
                  detailWidth: 22,
                  detail: `${formatUsedOfTotal(resources.swap.usedBytes, resources.swap.totalBytes)}${zramRam > 0 ? ` zram ${formatBytes(zramRam)}` : ""}`,
                  ...tone,
                }),
                22,
              ]
            : null,
        ];
        const disks = (resources.disks ?? []).map(
          (disk) =>
            [
              h(Gauge, {
                key: `disk:${disk.mount}`,
                label: disk.mount,
                ratio: disk.totalBytes > 0 ? 1 - disk.freeBytes / disk.totalBytes : 0,
                width: meterWidth,
                detailWidth: 13,
                detail: `${formatBytes(disk.freeBytes)} free`,
                ...tone,
              }),
              13,
            ] as const,
        );
        pushGaugeRows(
          `v:${machine.environmentId}`,
          vitals.filter((gauge): gauge is readonly [ReactNode, number] => gauge !== null),
        );
        pushGaugeRows(`d:${machine.environmentId}`, disks);
        if (!awake) {
          const since = formatSince(resources.sampledAt, now);
          lines.push(
            h(
              Text,
              { key: `s:${machine.environmentId}`, dimColor: true },
              `    last reading ${since === "now" ? "just now" : `${since} ago`}`,
            ),
          );
        }
      }
      if (awake && machine.agents.length === 0) {
        lines.push(h(Text, { key: `i:${machine.environmentId}`, dimColor: true }, "    idle"));
      }
      return;
    }
    if (row.kind === "more") {
      lines.push(
        h(
          Text,
          { key: `more:${row.machine.environmentId}`, dimColor: true },
          `    … ${row.count} more · l to see all`,
        ),
      );
      return;
    }
    const { agent } = row;
    const titleWidth = Math.max(12, Math.floor(columns * (wide ? 0.26 : 0.35)));
    lines.push(
      h(
        Box,
        { key: `a:${row.machine.environmentId}:${agent.threadId}`, marginLeft: 2 },
        pointer,
        h(
          Box,
          { width: titleWidth, flexShrink: 0, marginRight: 1 },
          h(Text, { bold: isSelected, wrap: "truncate" }, agent.title),
        ),
        wide
          ? h(
              Box,
              { width: 14, flexShrink: 0, marginRight: 1 },
              h(Text, { dimColor: true, wrap: "truncate" }, agent.project),
            )
          : null,
        wide
          ? h(
              Box,
              { width: 16, flexShrink: 0, marginRight: 1 },
              h(Text, { dimColor: true, wrap: "truncate" }, agent.model),
            )
          : null,
        h(
          Box,
          { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, marginRight: 1 },
          h(
            Text,
            { color: agent.needsYou ? "yellow" : agent.stuck ? "red" : "cyan", wrap: "truncate" },
            // First line only: a multi-line activity would add rows.
            oneLine(agent.activity),
          ),
        ),
        h(
          Box,
          { width: 7, flexShrink: 0, justifyContent: "flex-end" },
          h(Text, { dimColor: true }, formatSince(agent.sinceMs, now)),
        ),
      ),
    );
  });

  // Keep the selection on screen: show a window of lines around it.
  // Rows above and below the list: ct's tab bar and scope line (2), this
  // screen's header (wraps on narrow floats), its margin (1), the footer (1),
  // and a spare row for ct's status line.
  const headerRows = Math.ceil(100 / Math.max(20, columns - 2));
  const visible = Math.max(5, height - (2 + headerRows + 1 + 1 + 1));
  const selectedLine = lines.findIndex((line) => {
    const key = (line as { key?: string } | null)?.key ?? "";
    return current?.kind === "agent"
      ? key === `a:${current.machine.environmentId}:${current.agent.threadId}`
      : key === `m:${current?.machine.environmentId}`;
  });
  const top = Math.max(0, Math.min(selectedLine - Math.floor(visible / 2), lines.length - visible));

  return h(
    Box,
    { flexDirection: "column" },
    header,
    h(Box, { flexDirection: "column", marginTop: 1 }, ...lines.slice(top, top + visible)),
    h(
      Text,
      { dimColor: true, wrap: "truncate" },
      current?.kind === "agent"
        ? "enter open · s stop · h back · j/k move · live"
        : "l/enter agents · w wake · j/k move · live",
    ),
  );
}
