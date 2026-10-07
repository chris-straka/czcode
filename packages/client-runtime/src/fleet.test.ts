import type {
  EnvironmentId,
  HostResourcesSnapshot,
  OrchestrationV2ShellSnapshot,
  OrchestrationV2ThreadShell,
} from "@cz/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  type FleetMachineInput,
  fleetMachines,
  fleetTotals,
  fleetWarnings,
  formatSince,
} from "./fleet.ts";

const GB = 1024 ** 3;
const resources = (overrides: Partial<HostResourcesSnapshot> = {}): HostResourcesSnapshot => ({
  sampledAt: 0,
  cpuUtilization: 0.5,
  cpuCount: 8,
  availableMemoryBytes: 24 * GB,
  totalMemoryBytes: 32 * GB,
  disks: [{ mount: "/", totalBytes: 900 * GB, freeBytes: 800 * GB }],
  ...overrides,
});
const started = DateTime.makeUnsafe("2026-10-06T12:00:00Z");
const thread = (id: string, fields: Partial<Record<string, unknown>> = {}) =>
  ({
    id,
    projectId: "p",
    title: id,
    modelSelection: { instanceId: "claudeAgent", model: "claude-opus-5-5" },
    deletedAt: null,
    archivedAt: null,
    activeRunId: null,
    pendingRuntimeRequest: null,
    activityRunStartedAt: started,
    ...fields,
  }) as unknown as OrchestrationV2ThreadShell;
const shell = (threads: ReadonlyArray<OrchestrationV2ThreadShell>) =>
  ({
    projects: [{ id: "p", title: "czcode" }],
    threads,
  }) as unknown as OrchestrationV2ShellSnapshot;
const machine = (label: string, fields: Partial<FleetMachineInput> = {}): FleetMachineInput => ({
  environmentId: label as EnvironmentId,
  label,
  phase: "connected",
  wakeable: false,
  resources: resources(),
  shell: shell([]),
  ...fields,
});

describe("fleetWarnings", () => {
  it("flags a disk that is full, like art-ms-7917's SSD at 0 bytes", () => {
    const full = resources({
      disks: [
        { mount: "/", totalBytes: 900 * GB, freeBytes: 0 },
        { mount: "/home", totalBytes: 400 * GB, freeBytes: 300 * GB },
      ],
    });
    expect(fleetWarnings(full)).toEqual([{ kind: "disk", mount: "/", freeBytes: 0, freeRatio: 0 }]);
  });

  it("flags a big disk under 10 GB free, but not a small one with room", () => {
    const disks = [
      { mount: "/data", totalBytes: 2000 * GB, freeBytes: 8 * GB },
      { mount: "/boot/efi", totalBytes: 0.5 * GB, freeBytes: 0.4 * GB },
    ];
    expect(
      fleetWarnings(resources({ disks })).map(
        (warning) => warning.kind === "disk" && warning.mount,
      ),
    ).toEqual(["/data"]);
  });

  it("flags memory and swap running out", () => {
    const tight = resources({
      availableMemoryBytes: 1 * GB,
      swap: { totalBytes: 16 * GB, usedBytes: 15 * GB, devices: [] },
    });
    expect(fleetWarnings(tight).map((warning) => warning.kind)).toEqual(["memory", "swap"]);
  });
});

describe("fleetMachines", () => {
  it("shows awake machines first with their running agents, needing-you first", () => {
    const machines = fleetMachines([
      machine("art-ms-7917", { phase: "backoff", wakeable: true }),
      machine("z", {
        shell: shell([
          thread("idle"),
          thread("tests", { activeRunId: "run-1", currentActivity: "$ vp test run" }),
          thread("asks", { pendingRuntimeRequest: { kind: "approval" } }),
          thread("old", { activeRunId: "run-2", archivedAt: started }),
        ]),
      }),
      machine("f-ms-7917", { phase: "offline" }),
    ]);
    expect(machines.map((entry) => [entry.label, entry.state])).toEqual([
      ["z", "awake"],
      ["art-ms-7917", "asleep"],
      ["f-ms-7917", "unreachable"],
    ]);
    expect(machines[0]?.agents.map((agent) => [agent.title, agent.activity])).toEqual([
      ["asks", "needs you"],
      ["tests", "$ vp test run"],
    ]);
  });

  it("doesn't list threads from a machine that stopped answering", () => {
    const [asleep] = fleetMachines([
      machine("art", {
        phase: "backoff",
        wakeable: true,
        shell: shell([thread("t", { activeRunId: "r" })]),
      }),
    ]);
    expect(asleep?.agents).toEqual([]);
  });
});

describe("fleetTotals", () => {
  it("adds up awake machines only", () => {
    const totals = fleetTotals(
      fleetMachines([
        machine("a", { shell: shell([thread("t", { activeRunId: "r" })]) }),
        machine("b", { resources: resources({ cpuUtilization: 0.25, cpuCount: 4 }) }),
        machine("c", { phase: "offline" }),
      ]),
    );
    expect(totals).toMatchObject({
      machines: 3,
      awake: 2,
      agents: 1,
      cpuBusyCores: 5,
      cpuCores: 12,
    });
    expect(totals.memoryUsedBytes).toBe(16 * GB);
  });
});

describe("formatSince", () => {
  it("reads like a clock on the wall", () => {
    const now = Date.parse("2026-10-06T13:12:00Z");
    expect(formatSince(Date.parse("2026-10-06T13:11:50Z"), now)).toBe("now");
    expect(formatSince(Date.parse("2026-10-06T13:00:00Z"), now)).toBe("12m");
    expect(formatSince(Date.parse("2026-10-06T12:00:00Z"), now)).toBe("1h 12m");
  });
});
