/**
 * The TUI's atoms: client-runtime's environment, shell, and thread atoms over
 * the TUI runtime, built the way the web and mobile clients build theirs.
 *
 * @module atoms
 */
import { createEnvironmentCatalogAtoms } from "@cz/client-runtime/state/connections";
import { createDecisionEnvironmentAtoms } from "@cz/client-runtime/state/decisions";
import { createQueueEnvironmentAtoms } from "@cz/client-runtime/state/queue";
import {
  createEnvironmentShellAtoms,
  createEnvironmentSnapshotAtom,
  createShellEnvironmentAtoms,
} from "@cz/client-runtime/state/shell";
import {
  createEnvironmentThreadDetailAtoms,
  createEnvironmentThreadStateAtoms,
  createThreadEnvironmentAtoms,
} from "@cz/client-runtime/state/threads";

import type { TuiRuntime } from "../runtime/connection.ts";

export function makeTuiAtoms({ runtime }: TuiRuntime) {
  const catalog = createEnvironmentCatalogAtoms(runtime);
  const shellEnvironment = createShellEnvironmentAtoms(runtime);
  const shell = createEnvironmentShellAtoms(runtime);
  const snapshotAtom = createEnvironmentSnapshotAtom(shell.stateAtom);
  const threadEnvironment = createThreadEnvironmentAtoms(runtime, snapshotAtom);
  const threads = createEnvironmentThreadStateAtoms(runtime);
  const threadDetails = createEnvironmentThreadDetailAtoms(threads.stateAtom);
  const decisions = createDecisionEnvironmentAtoms(runtime);
  const queue = createQueueEnvironmentAtoms(runtime);
  return {
    catalog,
    shellEnvironment,
    shell,
    snapshotAtom,
    threadEnvironment,
    threads,
    threadDetails,
    decisions,
    queue,
  };
}

export type TuiAtoms = ReturnType<typeof makeTuiAtoms>;
