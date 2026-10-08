import { describe, expect, it } from "@effect/vitest";
import type { DesktopUpdateState } from "@cz/contracts";
import * as Option from "effect/Option";

import {
  MIN_RESTART_GAP_MS,
  OWNER_IDLE_MS,
  QUIET_MS,
  SETTLE_MS,
  decideRestart,
  type RestartInput,
} from "./DesktopUpdateWhenIdle.ts";

const NOW = 10 * 60 * 60 * 1000;

function state(overrides: Partial<DesktopUpdateState> = {}): DesktopUpdateState {
  return {
    enabled: true,
    status: "downloaded",
    channel: "latest",
    currentVersion: "0.0.46-mac.1",
    hostArch: "arm64",
    appArch: "arm64",
    runningUnderArm64Translation: false,
    availableVersion: "0.0.46-mac.2",
    downloadedVersion: "0.0.46-mac.2",
    releaseNotes: [],
    omittedReleaseCount: 0,
    downloadPercent: 100,
    checkedAt: null,
    message: null,
    errorContext: null,
    canRetry: true,
    ...overrides,
  };
}

/** Idle, settled, nobody at the Mac, no recent restart: the install case. */
function input(overrides: Partial<RestartInput> & { state?: DesktopUpdateState } = {}) {
  const { state: updateState = state(), ...rest } = overrides;
  return {
    now: NOW,
    report: Option.some({
      version: 1 as const,
      type: "desktopUpdateStatus" as const,
      state: updateState,
    }),
    busy: null,
    lastBusyAt: NOW - QUIET_MS,
    downloadedSince: NOW - SETTLE_MS,
    lastAutoRestartAt: NOW - MIN_RESTART_GAP_MS,
    ownerIdleSeconds: OWNER_IDLE_MS / 1000,
    screenLocked: false,
    ...rest,
  } satisfies RestartInput;
}

const waitReason = (overrides: Parameters<typeof input>[0]) => {
  const decision = decideRestart(input(overrides));
  return decision.action === "wait" ? decision.reason : decision.action;
};

describe("decideRestart", () => {
  it("installs once everything has been quiet long enough", () => {
    expect(decideRestart(input())).toEqual({ action: "install", version: "0.0.46-mac.2" });
    expect(decideRestart(input({ lastAutoRestartAt: null }))).toMatchObject({ action: "install" });
  });

  it("never restarts while an agent turn runs or is about to start", () => {
    expect(waitReason({ busy: "agents running" })).toBe("agents running");
    expect(waitReason({ busy: "agent work about to start" })).toBe("agent work about to start");
  });

  it("treats a short gap between turns as busy", () => {
    expect(waitReason({ lastBusyAt: NOW - QUIET_MS + 1 })).toMatch(/last 10 minutes/);
  });

  it("waits for the newest build when several land in a row", () => {
    expect(waitReason({ downloadedSince: NOW - 60_000 })).toMatch(/newer build lands/);
    expect(
      waitReason({ state: state({ status: "downloading", availableVersion: "0.0.46-mac.3" }) }),
    ).toMatch(/newer build is downloading/);
    expect(waitReason({ state: state({ availableVersion: "0.0.46-mac.3" }) })).toMatch(
      /newer build is downloading/,
    );
  });

  it("restarts by itself at most once an hour", () => {
    expect(waitReason({ lastAutoRestartAt: NOW - MIN_RESTART_GAP_MS + 1 })).toMatch(
      /within the hour/,
    );
  });

  it("asks instead of restarting while someone uses the Mac", () => {
    expect(waitReason({ ownerIdleSeconds: 30 })).toMatch(/Restart to update/);
    expect(waitReason({ ownerIdleSeconds: null })).toMatch(/Restart to update/);
    expect(decideRestart(input({ ownerIdleSeconds: 30, screenLocked: true }))).toMatchObject({
      action: "install",
    });
  });

  it("leaves no download, or a failed install, alone", () => {
    expect(decideRestart(input({ report: Option.none() }))).toEqual({ action: "nothing" });
    expect(
      decideRestart(input({ state: state({ downloadedVersion: null, status: "downloading" }) })),
    ).toEqual({ action: "nothing" });
    expect(
      decideRestart(input({ state: state({ status: "error", errorContext: "install" }) })),
    ).toEqual({ action: "nothing" });
  });
});
