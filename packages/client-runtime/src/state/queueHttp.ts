import type { QueuedRun, QueuedRunInput } from "@cz/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient } from "effect/unstable/http";

import * as RemoteEnvironmentAuthorization from "../authorization/service.ts";
import type { PreparedConnection } from "../connection/model.ts";
import * as ManagedRelay from "../relay/managedRelay.ts";
import {
  makeEnvironmentHttpApiUrlBuilder,
  type RemoteEnvironmentRequestError,
} from "../rpc/http.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "./environmentHttpAuth.ts";

const REQUEST_TIMEOUT_MS = 30_000;

/** The reset queue on one environment, over its authenticated HTTP API. */
export class QueueHttpClient extends Context.Service<
  QueueHttpClient,
  {
    readonly list: (
      prepared: PreparedConnection,
    ) => Effect.Effect<ReadonlyArray<QueuedRun>, RemoteEnvironmentRequestError>;
    readonly enqueue: (
      prepared: PreparedConnection,
      input: QueuedRunInput,
    ) => Effect.Effect<QueuedRun, RemoteEnvironmentRequestError>;
    readonly cancel: (
      prepared: PreparedConnection,
      id: string,
    ) => Effect.Effect<QueuedRun, RemoteEnvironmentRequestError>;
    readonly runNow: (
      prepared: PreparedConnection,
      id: string,
    ) => Effect.Effect<QueuedRun, RemoteEnvironmentRequestError>;
  }
>()("@cz/client-runtime/state/queueHttp/QueueHttpClient") {}

export const layer: Layer.Layer<QueueHttpClient, never, HttpClient.HttpClient> = Layer.effect(
  QueueHttpClient,
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const signer = yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner);
    const remoteAuthorization = yield* Effect.serviceOption(
      RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization,
    );
    const common = (prepared: PreparedConnection) =>
      ({
        prepared,
        signer,
        remoteAuthorization,
        group: "queue",
        timeoutMs: REQUEST_TIMEOUT_MS,
      }) as const;
    const urls = (httpBaseUrl: string) => makeEnvironmentHttpApiUrlBuilder(httpBaseUrl).queue;
    const run = <A>(
      effect: Effect.Effect<A, RemoteEnvironmentRequestError, HttpClient.HttpClient>,
    ) => effect.pipe(Effect.provideService(HttpClient.HttpClient, httpClient));

    return QueueHttpClient.of({
      list: (prepared) =>
        run(
          executeAuthenticatedEnvironmentHttpRequest({
            ...common(prepared),
            method: "GET",
            url: (base) => urls(base).list(),
            request: ({ client, headers }) => client.list({ headers }),
          }).pipe(Effect.map((result) => result.runs)),
        ),
      enqueue: (prepared, input) =>
        run(
          executeAuthenticatedEnvironmentHttpRequest({
            ...common(prepared),
            method: "POST",
            url: (base) => urls(base).enqueue(),
            request: ({ client, headers }) => client.enqueue({ payload: input, headers }),
          }),
        ),
      cancel: (prepared, id) =>
        run(
          executeAuthenticatedEnvironmentHttpRequest({
            ...common(prepared),
            method: "POST",
            url: (base) => urls(base).cancel({ params: { id } }),
            request: ({ client, headers }) => client.cancel({ params: { id }, headers }),
          }),
        ),
      runNow: (prepared, id) =>
        run(
          executeAuthenticatedEnvironmentHttpRequest({
            ...common(prepared),
            method: "POST",
            url: (base) => urls(base).runNow({ params: { id } }),
            request: ({ client, headers }) => client.runNow({ params: { id }, headers }),
          }),
        ),
    });
  }),
);
