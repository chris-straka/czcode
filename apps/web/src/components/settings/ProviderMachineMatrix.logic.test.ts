import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@cz/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildProviderMachineMatrix } from "./ProviderMachineMatrix.logic";

function provider(instanceId: string, overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make(instanceId),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-10-08T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  } as ServerProvider;
}

const machine = (id: string, providers: readonly ServerProvider[], connected = true) => ({
  environmentId: EnvironmentId.make(id),
  label: id,
  connected,
  providers,
});

describe("buildProviderMachineMatrix", () => {
  it("lines each provider up across machines, with a gap where a machine lacks it", () => {
    const rows = buildProviderMachineMatrix([
      machine("z", [provider("codex"), provider("claudeAgent")]),
      machine("basement", [provider("claudeAgent")]),
    ]);
    expect(
      rows.map((row) => [row.instanceId, row.cells.map((cell) => cell?.state ?? null)]),
    ).toEqual([
      ["codex", ["signed-in", null]],
      ["claudeAgent", ["signed-in", "signed-in"]],
    ]);
  });

  it("says signed out, not installed, disabled, and update available in plain states", () => {
    const [row] = buildProviderMachineMatrix([
      machine("z", [provider("codex", { auth: { status: "unauthenticated" } })]),
      machine("basement", [provider("codex", { installed: false, version: null })]),
      machine("f", [provider("codex", { enabled: false })]),
      machine("art", [
        provider("codex", {
          versionAdvisory: {
            status: "behind_latest",
            currentVersion: "1.0.0",
            latestVersion: "1.2.0",
            updateCommand: "npm i -g codex",
            canUpdate: true,
            checkedAt: null,
            message: null,
          },
          updateState: {
            status: "running",
            startedAt: null,
            finishedAt: null,
            message: null,
            output: null,
          },
        }),
      ]),
    ]);
    expect(row?.cells.map((cell) => cell?.state)).toEqual([
      "signed-out",
      "not-installed",
      "disabled",
      "signed-in",
    ]);
    expect(row?.cells[3]).toMatchObject({
      updateAvailable: true,
      latestVersion: "1.2.0",
      updating: true,
    });
  });
});
