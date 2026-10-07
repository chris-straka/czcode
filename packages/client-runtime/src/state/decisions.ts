import type {
  DecisionAnswerInput,
  DecisionListQuery,
  DecisionMediaUploadQuery,
  DecisionProjectBlurbInput,
} from "@cz/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import * as DecisionsHttp from "./decisionsHttp.ts";
import { EnvironmentHttpConnectionNotReadyError } from "./pullRequests.ts";
import { createEnvironmentCommand, createEnvironmentQueryAtomFamily } from "./runtime.ts";

export * as DecisionsHttp from "./decisionsHttp.ts";

/** How often an open feed re-reads a host's decisions (agents add them at any time). */
const DECISION_REFRESH_INTERVAL_MS = 15_000;

const withPrepared = <A, E, R>(
  run: (
    client: DecisionsHttp.DecisionsHttpClient["Service"],
    prepared: Parameters<DecisionsHttp.DecisionsHttpClient["Service"]["list"]>[0],
  ) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
    const client = yield* DecisionsHttp.DecisionsHttpClient;
    const prepared = yield* SubscriptionRef.get(supervisor.prepared);
    if (Option.isNone(prepared)) {
      return yield* new EnvironmentHttpConnectionNotReadyError({
        message: "The environment HTTP connection is not ready.",
      });
    }
    return yield* run(client, prepared.value);
  });

/** Decisions per environment: the feed query and the owner's actions on it. */
export function createDecisionEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | DecisionsHttp.DecisionsHttpClient | R, E>,
) {
  const list = createEnvironmentQueryAtomFamily(runtime, {
    label: "environment-data:decisions:list",
    staleTimeMs: 0,
    refreshIntervalMs: DECISION_REFRESH_INTERVAL_MS,
    execute: (query: DecisionListQuery) =>
      withPrepared((client, prepared) => client.list(prepared, query)),
  });
  return {
    list,
    /** Project descriptions change rarely; the chips re-read them with the feed's slow cadence. */
    projects: createEnvironmentQueryAtomFamily(runtime, {
      label: "environment-data:decisions:projects",
      staleTimeMs: 60_000,
      refreshIntervalMs: 5 * 60_000,
      execute: (_: "all") => withPrepared((client, prepared) => client.projects(prepared)),
    }),
    describeProject: createEnvironmentCommand(runtime, {
      label: "environment-data:decisions:describe-project",
      execute: (input: DecisionProjectBlurbInput) =>
        withPrepared((client, prepared) => client.describeProject(prepared, input)),
    }),
    /**
     * Feed card extras, keyed by the visible thread ids plus a version that
     * changes when a run finishes, so a card re-reads its result only then.
     */
    threadDigests: createEnvironmentQueryAtomFamily(runtime, {
      label: "environment-data:threads:digests",
      staleTimeMs: Number.POSITIVE_INFINITY,
      execute: (key: string) =>
        withPrepared((client, prepared) =>
          client.threadDigests(prepared, threadDigestIdsFromKey(key)),
        ),
    }),
    answer: createEnvironmentCommand(runtime, {
      label: "environment-data:decisions:answer",
      execute: (input: { readonly id: string; readonly answer: DecisionAnswerInput }) =>
        withPrepared((client, prepared) => client.answer(prepared, input.id, input.answer)),
    }),
    withdraw: createEnvironmentCommand(runtime, {
      label: "environment-data:decisions:withdraw",
      execute: (input: { readonly id: string }) =>
        withPrepared((client, prepared) => client.withdraw(prepared, input.id)),
    }),
    upload: createEnvironmentCommand(runtime, {
      label: "environment-data:decisions:upload",
      execute: (input: { readonly meta: DecisionMediaUploadQuery; readonly bytes: Uint8Array }) =>
        withPrepared((client, prepared) => client.upload(prepared, input.meta, input.bytes)),
    }),
  };
}

/**
 * A stable query key for a page of thread digests: ids with the run each
 * last finished, so the key only changes when a card's result can change.
 */
export function threadDigestKey(
  threads: ReadonlyArray<{ readonly id: string; readonly version: string | null }>,
): string {
  return threads.map((thread) => `${thread.id}@${thread.version ?? ""}`).join("\n");
}

export function threadDigestIdsFromKey(key: string): ReadonlyArray<string> {
  return key === "" ? [] : key.split("\n").map((entry) => entry.slice(0, entry.lastIndexOf("@")));
}
