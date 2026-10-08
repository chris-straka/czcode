/**
 * The TUI's atoms: client-runtime's environment, shell, and thread atoms over
 * the TUI runtime, built the way the web and mobile clients build theirs.
 *
 * @module atoms
 */
import { ConnectionOnboarding } from "@cz/client-runtime/connection";
import { createEnvironmentCatalogAtoms } from "@cz/client-runtime/state/connections";
import { createDecisionEnvironmentAtoms } from "@cz/client-runtime/state/decisions";
import { createOrchestrationEnvironmentAtoms } from "@cz/client-runtime/state/orchestration";
import { createQueueEnvironmentAtoms } from "@cz/client-runtime/state/queue";
import { createHostWakeEnvironmentAtoms } from "@cz/client-runtime/state/hostWake";
import { createVcsEnvironmentAtoms } from "@cz/client-runtime/state/vcs";
import { createAssetEnvironmentAtoms } from "@cz/client-runtime/state/assets";
import { createAtomCommandScheduler, createRuntimeCommand } from "@cz/client-runtime/state/runtime";
import { createServerEnvironmentAtoms } from "@cz/client-runtime/state/server";
import { createEnvironmentSessionAtoms } from "@cz/client-runtime/state/session";
import {
  createEnvironmentServerConfigsAtom,
  createEnvironmentShellAtoms,
  createEnvironmentSnapshotAtom,
  createShellEnvironmentAtoms,
} from "@cz/client-runtime/state/shell";
import {
  createEnvironmentThreadDetailAtoms,
  createEnvironmentThreadStateAtoms,
  createThreadEnvironmentAtoms,
} from "@cz/client-runtime/state/threads";
import * as Effect from "effect/Effect";

import type { TuiRuntime } from "../runtime/connection.ts";

export function makeTuiAtoms({ runtime }: TuiRuntime) {
  const catalog = createEnvironmentCatalogAtoms(runtime);
  const session = createEnvironmentSessionAtoms(runtime);
  const server = createServerEnvironmentAtoms(runtime, {
    initialConfigValueAtom: session.initialConfigValueAtom,
    usageLimitSources: true,
    usageLimitsCommand: true,
  });
  const serverConfigsAtom = createEnvironmentServerConfigsAtom({
    catalogValueAtom: catalog.catalogValueAtom,
    serverConfigValueAtom: server.configValueAtom,
  });
  const shellEnvironment = createShellEnvironmentAtoms(runtime);
  const shell = createEnvironmentShellAtoms(runtime);
  const snapshotAtom = createEnvironmentSnapshotAtom(shell.stateAtom);
  const threadEnvironment = createThreadEnvironmentAtoms(runtime, snapshotAtom);
  const threads = createEnvironmentThreadStateAtoms(runtime);
  const threadDetails = createEnvironmentThreadDetailAtoms(threads.stateAtom);
  const decisions = createDecisionEnvironmentAtoms(runtime);
  const queue = createQueueEnvironmentAtoms(runtime);
  const hostWake = createHostWakeEnvironmentAtoms(runtime);
  const orchestration = createOrchestrationEnvironmentAtoms(runtime);
  const vcs = createVcsEnvironmentAtoms(runtime);
  const assets = createAssetEnvironmentAtoms(runtime);
  const pairing = createRuntimeCommand(runtime, {
    label: "tui:connection:pair",
    scheduler: createAtomCommandScheduler(),
    concurrency: {
      mode: "singleFlight",
      key: (input: { readonly pairingUrl: string }) => input.pairingUrl,
    },
    execute: (input: { readonly pairingUrl: string }) =>
      ConnectionOnboarding.ConnectionOnboarding.pipe(
        Effect.flatMap((onboarding) => onboarding.registerPairing(input)),
      ),
  });
  return {
    catalog,
    session,
    server,
    serverConfigsAtom,
    shellEnvironment,
    shell,
    snapshotAtom,
    threadEnvironment,
    threads,
    threadDetails,
    decisions,
    queue,
    hostWake,
    orchestration,
    vcs,
    assets,
    pairing,
  };
}

export type TuiAtoms = ReturnType<typeof makeTuiAtoms>;
