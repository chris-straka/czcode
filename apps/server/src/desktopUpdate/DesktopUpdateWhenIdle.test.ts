import { expect, it } from "@effect/vitest";
import {
  ServerSelfUpdateError,
  type DesktopUpdateState,
  type DesktopUpdateStatusReport,
} from "@cz/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type * as DesktopAppUpdate from "./DesktopAppUpdate.ts";
import { installIfIdle } from "./DesktopUpdateWhenIdle.ts";

function report(overrides: Partial<DesktopUpdateState>): Option.Option<DesktopUpdateStatusReport> {
  return Option.some({
    version: 1,
    type: "desktopUpdateStatus",
    state: {
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
    },
  });
}

function fakeUpdate() {
  const calls: Array<string> = [];
  const update: DesktopAppUpdate.DesktopAppUpdate["Service"] = {
    available: true,
    run: () =>
      Effect.sync(() => {
        calls.push("run");
        return {
          targetVersion: "0.0.46-mac.2",
          method: "desktop-app" as const,
          desktopUpdateToken: "token-1",
        };
      }),
    commit: (token) =>
      Effect.suspend(() => {
        calls.push(`commit ${token}`);
        return Effect.fail(new ServerSelfUpdateError({ reason: "stopped for the test" }));
      }),
  };
  return { calls, update };
}

it.effect("installs a downloaded update when nothing is busy", () =>
  Effect.gen(function* () {
    const { calls, update } = fakeUpdate();
    const result = yield* installIfIdle({
      latestReport: Effect.succeed(report({})),
      busy: Effect.succeed(null),
      update,
    }).pipe(Effect.flip);
    expect(result.reason).toBe("stopped for the test");
    expect(calls).toEqual(["run", "commit token-1"]);
  }),
);

it.effect("waits while an agent is working", () =>
  Effect.gen(function* () {
    const { calls, update } = fakeUpdate();
    const result = yield* installIfIdle({
      latestReport: Effect.succeed(report({})),
      busy: Effect.succeed("agent work"),
      update,
    });
    expect(result).toBe("busy");
    expect(calls).toEqual([]);
  }),
);

it.effect("leaves an update that is not downloaded, or failed to install, alone", () =>
  Effect.gen(function* () {
    const { calls, update } = fakeUpdate();
    for (const latest of [
      Option.none(),
      report({ status: "downloading", downloadedVersion: null, downloadPercent: 40 }),
      report({ errorContext: "install", message: "czcode couldn't move the old app aside." }),
    ]) {
      const result = yield* installIfIdle({
        latestReport: Effect.succeed(latest),
        busy: Effect.succeed(null),
        update,
      });
      expect(result).toBe("nothing-to-install");
    }
    expect(calls).toEqual([]);
  }),
);
