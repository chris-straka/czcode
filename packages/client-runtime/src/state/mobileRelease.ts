/**
 * App updates from the owner's own servers: each paired environment can offer
 * the newest Android APK built on that machine.
 *
 * @module state/mobileRelease
 */
import type { AndroidRelease } from "@cz/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { HttpClient } from "effect/http";
import { Atom } from "effect/reactivity";

import * as RemoteEnvironmentAuthorization from "../authorization/service.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import type { PreparedConnection } from "../connection/model.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import * as ManagedRelay from "../relay/managedRelay.ts";
import {
  makeEnvironmentHttpApiUrlBuilder,
  type RemoteEnvironmentRequestError,
} from "../rpc/http.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "./environmentHttpAuth.ts";
import { EnvironmentHttpConnectionNotReadyError } from "./pullRequests.ts";
import { createEnvironmentQueryAtomFamily } from "./runtime.ts";

const REQUEST_TIMEOUT_MS = 30_000;
const RELEASE_REFRESH_INTERVAL_MS = 10 * 60_000;

export class MobileReleaseHttpClient extends Context.Service<
  MobileReleaseHttpClient,
  {
    readonly android: (
      prepared: PreparedConnection,
    ) => Effect.Effect<AndroidRelease | null, RemoteEnvironmentRequestError>;
  }
>()("@cz/client-runtime/state/mobileRelease/MobileReleaseHttpClient") {}

export const layer: Layer.Layer<MobileReleaseHttpClient, never, HttpClient.HttpClient> =
  Layer.effect(
    MobileReleaseHttpClient,
    Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      const signer = yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner);
      const remoteAuthorization = yield* Effect.serviceOption(
        RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization,
      );
      return MobileReleaseHttpClient.of({
        android: (prepared) =>
          executeAuthenticatedEnvironmentHttpRequest({
            prepared,
            signer,
            remoteAuthorization,
            group: "mobileRelease",
            timeoutMs: REQUEST_TIMEOUT_MS,
            method: "GET",
            url: (base) => makeEnvironmentHttpApiUrlBuilder(base).mobileRelease.android(),
            request: ({ client, headers }) => client.android({ headers }),
          }).pipe(
            Effect.map((result) => result.release),
            Effect.provideService(HttpClient.HttpClient, httpClient),
          ),
      });
    }),
  );

/** The newest Android release each environment offers, re-read every ten minutes. */
export function createMobileReleaseEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | MobileReleaseHttpClient | R, E>,
) {
  return {
    android: createEnvironmentQueryAtomFamily(runtime, {
      label: "environment-data:mobile-release:android",
      staleTimeMs: RELEASE_REFRESH_INTERVAL_MS,
      refreshIntervalMs: RELEASE_REFRESH_INTERVAL_MS,
      execute: (_: null) =>
        Effect.gen(function* () {
          const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
          const client = yield* MobileReleaseHttpClient;
          const prepared = yield* SubscriptionRef.get(supervisor.prepared);
          if (Option.isNone(prepared)) {
            return yield* new EnvironmentHttpConnectionNotReadyError({
              message: "The environment HTTP connection is not ready.",
            });
          }
          return yield* client.android(prepared.value);
        }),
    }),
  };
}
