/**
 * Waking a sleeping agent host: a host that sleeps when idle can be woken by
 * any other cz server on its LAN, so a client asks each environment it's
 * connected to until one sends the Wake-on-LAN packet.
 *
 * @module state/hostWake
 */
import type { WakeHostResult } from "@cz/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { HttpClient } from "effect/unstable/http";
import { Atom } from "effect/unstable/reactivity";

import * as RemoteEnvironmentAuthorization from "../authorization/service.ts";
import type { PreparedConnection } from "../connection/model.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import * as ManagedRelay from "../relay/managedRelay.ts";
import {
  makeEnvironmentHttpApiUrlBuilder,
  type RemoteEnvironmentRequestError,
} from "../rpc/http.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "./environmentHttpAuth.ts";
import { EnvironmentHttpConnectionNotReadyError } from "./pullRequests.ts";
import { createEnvironmentCommand } from "./runtime.ts";

const REQUEST_TIMEOUT_MS = 15_000;

export class HostWakeHttpClient extends Context.Service<
  HostWakeHttpClient,
  {
    readonly wake: (
      prepared: PreparedConnection,
      host: string,
    ) => Effect.Effect<WakeHostResult, RemoteEnvironmentRequestError>;
  }
>()("@cz/client-runtime/state/hostWake/HostWakeHttpClient") {}

export const layer: Layer.Layer<HostWakeHttpClient, never, HttpClient.HttpClient> = Layer.effect(
  HostWakeHttpClient,
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const signer = yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner);
    const remoteAuthorization = yield* Effect.serviceOption(
      RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization,
    );
    return HostWakeHttpClient.of({
      wake: (prepared, host) =>
        executeAuthenticatedEnvironmentHttpRequest({
          prepared,
          signer,
          remoteAuthorization,
          group: "hostWake",
          timeoutMs: REQUEST_TIMEOUT_MS,
          method: "POST",
          url: (base) => makeEnvironmentHttpApiUrlBuilder(base).hostWake.wake(),
          request: ({ client, headers }) => client.wake({ payload: { host }, headers }),
        }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient)),
    });
  }),
);

/** `wake` runs on the environment it's called for, asking it to wake `host`. */
export function createHostWakeEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | HostWakeHttpClient | R, E>,
) {
  return {
    wake: createEnvironmentCommand(runtime, {
      label: "environment-data:host-wake:wake",
      execute: (input: { readonly host: string }) =>
        Effect.gen(function* () {
          const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
          const client = yield* HostWakeHttpClient;
          const prepared = yield* SubscriptionRef.get(supervisor.prepared);
          if (Option.isNone(prepared)) {
            return yield* new EnvironmentHttpConnectionNotReadyError({
              message: "The environment HTTP connection is not ready.",
            });
          }
          return yield* client.wake(prepared.value, input.host);
        }),
    }),
  };
}

/** The host to wake for an environment reached at `url` (its tailnet or LAN name). */
export function wakeHostFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" ? null : host;
  } catch {
    return null;
  }
}

/**
 * Asks each connected environment in turn to wake `host`, stopping at the
 * first that sent the packet. Returns that environment's id, or null.
 */
export async function wakeHostThroughAny<Id>(input: {
  readonly host: string;
  readonly through: ReadonlyArray<Id>;
  readonly wake: (environmentId: Id, host: string) => Promise<WakeHostResult | null>;
}): Promise<Id | null> {
  for (const environmentId of input.through) {
    const result = await input.wake(environmentId, input.host).catch(() => null);
    if (result?.sent) return environmentId;
  }
  return null;
}
