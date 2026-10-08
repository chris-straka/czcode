import { describe, expect, it } from "vite-plus/test";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@cz/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";

import {
  canOneClickUpdateProviderCandidate,
  collectProviderUpdateCandidates,
  collectProviderUpdateMachines,
  describeProviderUpdateFailure,
  getProviderUpdateNoticeTitle,
  getProviderUpdateRunRows,
  getProviderUpdateRunSummary,
  getProviderUpdateSidebarPillView,
  hasOneClickUpdateProviderCandidate,
  isProviderUpdateCandidate,
  isProviderSettingsUpdateCandidate,
  providerUpdateNoticeKey,
  providerUpdateNotificationKey,
  providerUpdateRunsFor,
  type ProviderUpdateCandidate,
  type ProviderUpdateRun,
} from "./ProviderUpdateLaunchNotification.logic";

const checkedAt = "2026-04-23T10:00:00.000Z";
const sessionStartedAt = "2026-04-23T09:59:00.000Z";
const laterCheckedAt = "2026-04-23T10:01:00.000Z";

const driver = (value: string) => ProviderDriverKind.make(value);
const instanceId = (value: string) => ProviderInstanceId.make(value);

function provider(input: {
  readonly driver: ReturnType<typeof ProviderDriverKind.make>;
  readonly instanceId?: ReturnType<typeof ProviderInstanceId.make>;
  readonly enabled?: boolean;
  readonly version?: string | null;
  readonly latestVersion?: string | null;
  readonly canUpdate?: boolean;
  readonly updateCommand?: string | null;
  readonly updateState?: ServerProvider["updateState"];
  readonly advisoryStatus?: NonNullable<ServerProvider["versionAdvisory"]>["status"];
}): ServerProvider {
  const result: ServerProvider = {
    instanceId: input.instanceId ?? instanceId(String(input.driver)),
    driver: input.driver,
    enabled: input.enabled ?? true,
    installed: true,
    version: input.version ?? "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
    versionAdvisory: {
      status: input.advisoryStatus ?? "behind_latest",
      currentVersion: input.version ?? "1.0.0",
      latestVersion: "latestVersion" in input ? input.latestVersion : "1.1.0",
      updateCommand: "updateCommand" in input ? input.updateCommand : "npm install -g provider",
      canUpdate: input.canUpdate ?? true,
      checkedAt,
      message: "Update available.",
    },
  };

  if (input.updateState) {
    return { ...result, updateState: input.updateState };
  }

  return result;
}

function updateCandidate(input: Parameters<typeof provider>[0]): ProviderUpdateCandidate {
  return provider(input) as ProviderUpdateCandidate;
}

describe("provider update launch notification logic", () => {
  it("detects enabled providers with a latest-version advisory", () => {
    expect(isProviderUpdateCandidate(provider({ driver: driver("codex") }))).toBe(true);
    expect(isProviderUpdateCandidate(provider({ driver: driver("codex"), enabled: false }))).toBe(
      false,
    );
    expect(
      isProviderUpdateCandidate(
        provider({ driver: driver("codex"), advisoryStatus: "current", latestVersion: null }),
      ),
    ).toBe(false);
    expect(
      isProviderUpdateCandidate(provider({ driver: driver("codex"), latestVersion: null })),
    ).toBe(false);
  });

  it("deduplicates multi-instance provider candidates by driver", () => {
    expect(
      collectProviderUpdateCandidates([
        provider({
          driver: driver("codex"),
          instanceId: instanceId("codex_personal"),
          latestVersion: "1.1.0",
        }),
        provider({
          driver: driver("codex"),
          instanceId: instanceId("codex"),
          latestVersion: "1.1.0",
        }),
        provider({ driver: driver("cursor"), latestVersion: "0.3.0" }),
      ]),
    ).toHaveLength(2);
  });

  it("disables one-click updates when provider instances disagree on the update command", () => {
    const candidate = updateCandidate({
      driver: driver("claudeAgent"),
      instanceId: instanceId("claude_personal"),
      latestVersion: "2.1.123",
    });

    expect(
      canOneClickUpdateProviderCandidate(candidate, [
        candidate,
        provider({
          driver: driver("claudeAgent"),
          instanceId: instanceId("claude_work"),
          latestVersion: "2.1.123",
          canUpdate: true,
          updateCommand: "bun add -g @anthropic-ai/claude-code@latest",
        }),
      ]),
    ).toBe(false);
  });

  it("keeps one-click updates enabled when sibling instances are already current", () => {
    const candidate = updateCandidate({
      driver: driver("claudeAgent"),
      instanceId: instanceId("claude_personal"),
      latestVersion: "2.1.123",
      updateCommand: "npm install -g @anthropic-ai/claude-code@latest",
    });

    expect(
      hasOneClickUpdateProviderCandidate(candidate, [
        candidate,
        provider({
          driver: driver("claudeAgent"),
          instanceId: instanceId("claude_work"),
          version: "2.1.123",
          latestVersion: "2.1.123",
          advisoryStatus: "current",
          canUpdate: false,
          updateCommand: null,
        }),
      ]),
    ).toBe(true);
    expect(
      canOneClickUpdateProviderCandidate(candidate, [
        candidate,
        provider({
          driver: driver("claudeAgent"),
          instanceId: instanceId("claude_work"),
          version: "2.1.123",
          latestVersion: "2.1.123",
          advisoryStatus: "current",
          canUpdate: false,
          updateCommand: null,
        }),
      ]),
    ).toBe(true);
  });

  it("keeps the inline update action available while a provider update is already running", () => {
    const candidate = updateCandidate({
      driver: driver("codex"),
      updateState: {
        status: "running",
        startedAt: checkedAt,
        finishedAt: null,
        message: "Updating provider.",
        output: null,
      },
    });

    expect(hasOneClickUpdateProviderCandidate(candidate, [candidate])).toBe(true);
    expect(canOneClickUpdateProviderCandidate(candidate, [candidate])).toBe(false);
  });

  it("builds a notification key from provider latest versions", () => {
    const codex = updateCandidate({
      driver: driver("codex"),
      version: "1.0.0",
      latestVersion: "1.1.0",
    });
    const cursor = updateCandidate({
      driver: driver("cursor"),
      version: "0.2.0",
      latestVersion: "0.3.0",
    });

    expect(providerUpdateNotificationKey([codex, cursor])).toBe("codex:1.1.0|cursor:0.3.0");
    expect(providerUpdateNotificationKey([])).toBeNull();
  });

  it("keeps the same notification key while the published update version is unchanged", () => {
    const first = updateCandidate({
      driver: driver("codex"),
      version: "1.0.0",
      latestVersion: "1.2.0",
    });
    const second = updateCandidate({
      driver: driver("codex"),
      version: "1.1.0",
      latestVersion: "1.2.0",
    });
    const nextPublishedVersion = updateCandidate({
      driver: driver("codex"),
      version: "1.1.0",
      latestVersion: "1.3.0",
    });

    expect(providerUpdateNotificationKey([first])).toBe(providerUpdateNotificationKey([second]));
    expect(providerUpdateNotificationKey([nextPublishedVersion])).not.toBe(
      providerUpdateNotificationKey([first]),
    );
  });

  it("summarizes active provider updates for the sidebar pill", () => {
    const view = getProviderUpdateSidebarPillView([
      provider({
        driver: driver("codex"),
        updateState: {
          status: "running",
          startedAt: checkedAt,
          finishedAt: null,
          message: "Updating provider.",
          output: null,
        },
      }),
      provider({
        driver: driver("cursor"),
        updateState: {
          status: "queued",
          startedAt: null,
          finishedAt: null,
          message: "Waiting for another provider update to finish.",
          output: null,
        },
      }),
    ]);

    expect(view).toMatchObject({
      tone: "loading",
      title: "Updating 2 providers",
      description: "Codex and Cursor updates are in progress.",
    });
  });

  it("uses the provider name for single active sidebar pill updates", () => {
    const view = getProviderUpdateSidebarPillView([
      provider({
        driver: driver("codex"),
        updateState: {
          status: "running",
          startedAt: checkedAt,
          finishedAt: null,
          message: "Updating provider.",
          output: null,
        },
      }),
    ]);

    expect(view).toMatchObject({
      key: "loading:codex:running",
      tone: "loading",
      title: "Updating Codex",
      description: "Codex update in progress.",
    });
  });

  it("uses the provider name for single failed sidebar pill updates", () => {
    const view = getProviderUpdateSidebarPillView(
      [
        provider({
          driver: driver("claudeAgent"),
          updateState: {
            status: "failed",
            startedAt: checkedAt,
            finishedAt: checkedAt,
            message: "Update command exited with code 1.",
            output: null,
          },
        }),
      ],
      { visibleAfterIso: sessionStartedAt },
    );

    expect(view).toMatchObject({
      key: "failed:claudeAgent:2026-04-23T10:00:00.000Z:Update command exited with code 1.",
      tone: "error",
      title: "Claude v1.1.0 update failed",
      description: "Update command exited with code 1.",
      dismissible: true,
    });
  });

  it("shows a short-lived success sidebar pill after a single provider update succeeds", () => {
    const view = getProviderUpdateSidebarPillView(
      [
        provider({
          driver: driver("codex"),
          version: "1.1.0",
          latestVersion: "1.1.0",
          advisoryStatus: "current",
          updateState: {
            status: "succeeded",
            startedAt: checkedAt,
            finishedAt: checkedAt,
            message: "Provider updated.",
            output: null,
          },
        }),
      ],
      { visibleAfterIso: sessionStartedAt },
    );

    expect(view).toMatchObject({
      key: "succeeded:codex:2026-04-23T10:00:00.000Z:Provider updated.",
      tone: "success",
      title: "Codex updated: v1.1.0",
      description: "New sessions will use the updated provider.",
      dismissAfterVisibleMs: 3_000,
    });
  });

  it("keeps unchanged sidebar pill states dismissible", () => {
    const view = getProviderUpdateSidebarPillView(
      [
        provider({
          driver: driver("cursor"),
          updateState: {
            status: "unchanged",
            startedAt: checkedAt,
            finishedAt: checkedAt,
            message: "still old",
            output: null,
          },
        }),
      ],
      { visibleAfterIso: sessionStartedAt },
    );

    expect(view).toMatchObject({
      key: "unchanged:cursor:2026-04-23T10:00:00.000Z:still old",
      tone: "warning",
      title: "Cursor still needs an update",
      dismissible: true,
    });
  });

  it("does not show sidebar terminal states from before the current app session", () => {
    expect(
      getProviderUpdateSidebarPillView(
        [
          provider({
            driver: driver("codex"),
            updateState: {
              status: "failed",
              startedAt: checkedAt,
              finishedAt: checkedAt,
              message: "command failed",
              output: "stderr",
            },
          }),
        ],
        { visibleAfterIso: "2026-04-23T10:00:01.000Z" },
      ),
    ).toBeNull();
  });

  it("shows a newer success before falling back to an older failure", () => {
    const providers = [
      provider({
        driver: driver("claudeAgent"),
        updateState: {
          status: "failed",
          startedAt: checkedAt,
          finishedAt: checkedAt,
          message: "Update command exited with code 1.",
          output: null,
        },
      }),
      provider({
        driver: driver("codex"),
        version: "1.2.0",
        latestVersion: "1.2.0",
        advisoryStatus: "current",
        updateState: {
          status: "succeeded",
          startedAt: laterCheckedAt,
          finishedAt: laterCheckedAt,
          message: "Provider updated.",
          output: null,
        },
      }),
    ] satisfies ReadonlyArray<ServerProvider>;

    const successView = getProviderUpdateSidebarPillView(providers, {
      visibleAfterIso: sessionStartedAt,
    });
    expect(successView).toMatchObject({
      key: "succeeded:codex:2026-04-23T10:01:00.000Z:Provider updated.",
      tone: "success",
      title: "Codex updated: v1.2.0",
    });

    const failureView = getProviderUpdateSidebarPillView(providers, {
      visibleAfterIso: sessionStartedAt,
      dismissedKeys: new Set(["succeeded:codex:2026-04-23T10:01:00.000Z:Provider updated."]),
    });
    expect(failureView).toMatchObject({
      key: "failed:claudeAgent:2026-04-23T10:00:00.000Z:Update command exited with code 1.",
      tone: "error",
      title: "Claude v1.1.0 update failed",
    });
  });

  it("does not show a sidebar pill for passive update availability", () => {
    expect(
      getProviderUpdateSidebarPillView([
        provider({ driver: driver("codex"), canUpdate: true }),
        provider({ driver: driver("cursor"), canUpdate: false }),
      ]),
    ).toBeNull();
  });
});

it("does not offer incompatible latest versions and restores suggestions after policy relaxation", () => {
  const installed = provider({ driver: driver("codex") });
  for (const latestVersionStatus of ["broken", "unsupported", "supported", "unknown"] as const) {
    const snapshot: ServerProvider = {
      ...installed,
      compatibilityAdvisory: {
        status: "supported",
        latestVersionStatus,
        message: null,
        recommendedRange: null,
        recommendedVersion: null,
      },
    };
    const expected = latestVersionStatus === "supported" || latestVersionStatus === "unknown";
    expect(isProviderUpdateCandidate(snapshot)).toBe(expected);
    expect(isProviderSettingsUpdateCandidate(snapshot)).toBe(expected);
  }
});

describe("updating every machine", () => {
  const environmentId = (value: string) => EnvironmentId.make(value);
  const opencode = driver("opencode");
  const behind = provider({
    driver: opencode,
    version: "2.0.24",
    latestVersion: "2.0.26",
    updateCommand: "npm install -g opencode-ai@latest",
  });
  const updateState = (
    status: "succeeded" | "failed" | "unchanged",
    message: string,
    output: string | null = null,
  ): ServerProvider["updateState"] => ({
    status,
    startedAt: checkedAt,
    finishedAt: laterCheckedAt,
    message,
    output,
  });
  const after = (version: string, state: ServerProvider["updateState"]) =>
    AsyncResult.success({
      providers: [{ ...behind, version, ...(state ? { updateState: state } : {}) }],
    });

  const machines = collectProviderUpdateMachines([
    { environmentId: environmentId("mac"), label: "Mac", connected: true, providers: [] },
    { environmentId: environmentId("f"), label: "f", connected: true, providers: [behind] },
    { environmentId: environmentId("art"), label: "art", connected: true, providers: [behind] },
    {
      environmentId: environmentId("basement"),
      label: "basement",
      connected: true,
      providers: [behind],
    },
    {
      environmentId: environmentId("offline"),
      label: "offline",
      connected: false,
      providers: [behind],
    },
  ]);

  it("targets every connected machine that is behind, not just this one", () => {
    expect(machines.map((machine) => machine.label)).toEqual(["f", "art", "basement"]);
    expect(providerUpdateNoticeKey(machines)).toBe("opencode:2.0.26");
    expect(getProviderUpdateNoticeTitle(collectProviderUpdateCandidates([behind]))).toBe(
      "Update Available: OpenCode v2.0.26",
    );
  });

  it("shows each machine's progress while updates run", () => {
    const [f, art, basement] = providerUpdateRunsFor(machines) as [
      ProviderUpdateRun,
      ProviderUpdateRun,
      ProviderUpdateRun,
    ];
    const runs = [
      { ...f, result: after("2.0.26", updateState("succeeded", "Provider updated.")) },
      art,
      basement,
    ];
    expect(getProviderUpdateRunRows(runs).map((row) => [row.state, row.text])).toEqual([
      ["updated", "f: OpenCode v2.0.24 → v2.0.26"],
      ["running", "art: updating…"],
      ["running", "basement: updating…"],
    ]);
    expect(getProviderUpdateRunSummary(runs)).toBeNull();
  });

  it("reports each machine's failure in one plain sentence", () => {
    const [f, art, basement] = providerUpdateRunsFor(machines) as [
      ProviderUpdateRun,
      ProviderUpdateRun,
      ProviderUpdateRun,
    ];
    const runs: ProviderUpdateRun[] = [
      {
        ...f,
        result: after(
          "2.0.24",
          updateState(
            "failed",
            "Update command exited with code 243.",
            "npm error code EACCES\nnpm error path /home/b/.npm/_cacache/index-v5/1f",
          ),
        ),
      },
      { ...art, result: after("2.0.26", updateState("succeeded", "Provider updated.")) },
      { ...basement, result: AsyncResult.failure(Cause.die(new Error("WebSocket closed."))) },
    ];
    expect(getProviderUpdateRunRows(runs).map((row) => row.text)).toEqual([
      "f: npm can't write its cache",
      "art: OpenCode v2.0.24 → v2.0.26",
      "basement: WebSocket closed",
    ]);
    expect(getProviderUpdateRunSummary(runs)).toEqual({
      type: "error",
      title: "OpenCode updated on 1 of 3 machines",
    });
  });

  it("says what changed when every machine updated, and ignores interrupted ones", () => {
    const runs = providerUpdateRunsFor(machines).map((run, index): ProviderUpdateRun => ({
      ...run,
      result:
        index === 2
          ? AsyncResult.failure(Cause.interrupt())
          : after("2.0.26", updateState("succeeded", "Provider updated.")),
    }));
    expect(getProviderUpdateRunRows(runs)).toHaveLength(2);
    expect(getProviderUpdateRunSummary(runs)).toEqual({
      type: "success",
      title: "OpenCode updated on 2 machines",
    });
  });

  it("names a version that did not move instead of calling it a success", () => {
    const [f] = providerUpdateRunsFor(machines) as [ProviderUpdateRun];
    const rows = getProviderUpdateRunRows([
      {
        ...f,
        result: after(
          "2.0.24",
          updateState(
            "unchanged",
            "Update command completed, but czcode still detects an outdated provider version.",
          ),
        ),
      },
    ]);
    expect(rows[0]?.text).toBe("f: the update ran, but OpenCode still reports v2.0.24");
  });

  it("turns common installer failures into plain sentences", () => {
    const failure = (output: string) =>
      describeProviderUpdateFailure({ message: "Update command exited with code 1.", output });
    expect(failure("npm ERR! code EACCES\nnpm ERR! path /usr/lib/node_modules/opencode-ai")).toBe(
      "the installer can't write to its install folder",
    );
    expect(failure("npm ERR! code ENOTFOUND registry.npmjs.org")).toBe(
      "it couldn't reach the package registry",
    );
    expect(failure("npm ERR! code ENOSPC")).toBe("the disk is full");
    expect(describeProviderUpdateFailure({ message: "Update timed out." })).toBe(
      "the update timed out",
    );
    expect(failure("")).toBe("Update command exited with code 1");
  });
});
