import type {
  DecisionAnswer,
  DecisionAnswerInput,
  DecisionItem,
  DecisionItemWithAnswer,
  DecisionListQuery,
  DecisionMediaRef,
  DecisionMediaUploadQuery,
} from "@cz/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient } from "effect/http";

import * as RemoteEnvironmentAuthorization from "../authorization/service.ts";
import type { PreparedConnection } from "../connection/model.ts";
import * as ManagedRelay from "../relay/managedRelay.ts";
import {
  makeEnvironmentHttpApiUrlBuilder,
  type RemoteEnvironmentRequestError,
} from "../rpc/http.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "./environmentHttpAuth.ts";

const REQUEST_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 5 * 60_000;

/** Decisions on one environment, over its authenticated HTTP API (ccez/DECISIONS.md). */
export class DecisionsHttpClient extends Context.Service<
  DecisionsHttpClient,
  {
    readonly list: (
      prepared: PreparedConnection,
      query: DecisionListQuery,
    ) => Effect.Effect<ReadonlyArray<DecisionItemWithAnswer>, RemoteEnvironmentRequestError>;
    readonly answer: (
      prepared: PreparedConnection,
      id: string,
      input: DecisionAnswerInput,
    ) => Effect.Effect<DecisionAnswer, RemoteEnvironmentRequestError>;
    readonly withdraw: (
      prepared: PreparedConnection,
      id: string,
    ) => Effect.Effect<DecisionItem, RemoteEnvironmentRequestError>;
    readonly upload: (
      prepared: PreparedConnection,
      meta: DecisionMediaUploadQuery,
      bytes: Uint8Array,
    ) => Effect.Effect<DecisionMediaRef, RemoteEnvironmentRequestError>;
  }
>()("@cz/client-runtime/state/decisionsHttp/DecisionsHttpClient") {}

export const layer: Layer.Layer<DecisionsHttpClient, never, HttpClient.HttpClient> = Layer.effect(
  DecisionsHttpClient,
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const signer = yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner);
    const remoteAuthorization = yield* Effect.serviceOption(
      RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization,
    );
    const common = (prepared: PreparedConnection) =>
      ({ prepared, signer, remoteAuthorization, group: "decisions" }) as const;
    const urls = (httpBaseUrl: string) => makeEnvironmentHttpApiUrlBuilder(httpBaseUrl).decisions;
    const run = <A>(
      effect: Effect.Effect<A, RemoteEnvironmentRequestError, HttpClient.HttpClient>,
    ) => effect.pipe(Effect.provideService(HttpClient.HttpClient, httpClient));

    return DecisionsHttpClient.of({
      list: (prepared, query) =>
        run(
          executeAuthenticatedEnvironmentHttpRequest({
            ...common(prepared),
            method: "GET",
            url: (base) => urls(base).list({ query }),
            timeoutMs: REQUEST_TIMEOUT_MS,
            request: ({ client, headers }) => client.list({ query, headers }),
          }).pipe(Effect.map((result) => result.items)),
        ),
      answer: (prepared, id, input) =>
        run(
          executeAuthenticatedEnvironmentHttpRequest({
            ...common(prepared),
            method: "POST",
            url: (base) => urls(base).answer({ params: { id } }),
            timeoutMs: REQUEST_TIMEOUT_MS,
            request: ({ client, headers }) =>
              client.answer({ params: { id }, payload: input, headers }),
          }),
        ),
      withdraw: (prepared, id) =>
        run(
          executeAuthenticatedEnvironmentHttpRequest({
            ...common(prepared),
            method: "POST",
            url: (base) => urls(base).withdraw({ params: { id } }),
            timeoutMs: REQUEST_TIMEOUT_MS,
            request: ({ client, headers }) => client.withdraw({ params: { id }, headers }),
          }),
        ),
      upload: (prepared, meta, bytes) =>
        run(
          executeAuthenticatedEnvironmentHttpRequest({
            ...common(prepared),
            method: "POST",
            url: (base) => urls(base).upload({ query: meta }),
            timeoutMs: UPLOAD_TIMEOUT_MS,
            request: ({ client, headers }) =>
              client.upload({ query: meta, payload: bytes, headers }),
          }),
        ),
    });
  }),
);
