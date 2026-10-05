import type { QueuedRun, QueuedRunInput } from "@cz/contracts";
import { formatDuration } from "@cz/shared/usageLimits";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import { EnvironmentHttpConnectionNotReadyError } from "./pullRequests.ts";
import * as QueueHttp from "./queueHttp.ts";
import { createEnvironmentCommand, createEnvironmentQueryAtomFamily } from "./runtime.ts";

export * as QueueHttp from "./queueHttp.ts";

/** Queued runs start on the server's 30-second poll; this keeps the list close behind. */
const QUEUE_REFRESH_INTERVAL_MS = 30_000;

const withPrepared = <A, E, R>(
  run: (
    client: QueueHttp.QueueHttpClient["Service"],
    prepared: Parameters<QueueHttp.QueueHttpClient["Service"]["list"]>[0],
  ) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
    const client = yield* QueueHttp.QueueHttpClient;
    const prepared = yield* SubscriptionRef.get(supervisor.prepared);
    if (Option.isNone(prepared)) {
      return yield* new EnvironmentHttpConnectionNotReadyError({
        message: "The environment HTTP connection is not ready.",
      });
    }
    return yield* run(client, prepared.value);
  });

/** The reset queue per environment: its runs and the owner's actions on them. */
export function createQueueEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | QueueHttp.QueueHttpClient | R, E>,
) {
  return {
    list: createEnvironmentQueryAtomFamily(runtime, {
      label: "environment-data:queue:list",
      staleTimeMs: 0,
      refreshIntervalMs: QUEUE_REFRESH_INTERVAL_MS,
      execute: (_: null) => withPrepared((client, prepared) => client.list(prepared)),
    }),
    enqueue: createEnvironmentCommand(runtime, {
      label: "environment-data:queue:enqueue",
      execute: (input: QueuedRunInput) =>
        withPrepared((client, prepared) => client.enqueue(prepared, input)),
    }),
    cancel: createEnvironmentCommand(runtime, {
      label: "environment-data:queue:cancel",
      execute: (input: { readonly id: string }) =>
        withPrepared((client, prepared) => client.cancel(prepared, input.id)),
    }),
    runNow: createEnvironmentCommand(runtime, {
      label: "environment-data:queue:run-now",
      execute: (input: { readonly id: string }) =>
        withPrepared((client, prepared) => client.runNow(prepared, input.id)),
    }),
  };
}

/** When a queued run starts, for lists and toasts: "at the reset, in 2h 10m". */
export function queuedRunStartLabel(run: QueuedRun, now: number): string {
  if (run.status === "started") return "started";
  if (run.status === "failed") return "couldn't start";
  if (run.status === "cancelled") return "cancelled";
  if (run.dueAt <= now) return "starting";
  const wait = formatDuration(run.dueAt - now);
  return run.dueReason === "reset" ? `at the reset, in ${wait}` : `in ${wait}`;
}
