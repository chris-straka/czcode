/**
 * HTTP transport for decisions: the authenticated `/api/decisions` group and
 * the signed `/api/decision-media/*` route. Media URLs are short-lived HMAC
 * capabilities so `<img>`, `<audio>`, `<video>`, and native players can load
 * them without auth headers, like attachment assets.
 *
 * @module DecisionHttp
 */
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  DECISION_LIMITS,
  type DecisionItemWithAnswer,
  type DecisionMediaRef,
  EnvironmentHttpApi,
} from "@cz/contracts";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import {
  annotateEnvironmentRequest,
  failEnvironmentInternal,
  requireEnvironmentScope,
} from "../auth/http.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { signPayload, timingSafeEqualBase64Url } from "../auth/utils.ts";
import { assetFileResponse } from "../http.ts";
import * as DecisionService from "./DecisionService.ts";

const DECISION_MEDIA_ROUTE_PREFIX = "/api/decision-media";
const SIGNING_SECRET_NAME = "decision-media-signing-key";
const MEDIA_URL_TTL_MS = 6 * 60 * 60 * 1000;

const loadSigningSecret = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  return yield* secrets.getOrCreateRandom(SIGNING_SECRET_NAME, 32);
});

const mediaSignature = (secret: Uint8Array, key: string, mime: string, expiresAt: number) =>
  signPayload(`${key}\n${mime}\n${expiresAt}`, secret);

/** Fills a signed `url` into every media ref of the items. */
const withMediaUrls = Effect.fn("DecisionHttp.withMediaUrls")(function* (
  entries: ReadonlyArray<DecisionItemWithAnswer>,
) {
  const secret = yield* loadSigningSecret;
  const expiresAt = (yield* Clock.currentTimeMillis) + MEDIA_URL_TTL_MS;
  const sign = (ref: DecisionMediaRef): DecisionMediaRef => {
    const query = new URLSearchParams({
      mime: ref.mime,
      exp: String(expiresAt),
      sig: mediaSignature(secret, ref.key, ref.mime, expiresAt),
    });
    return { ...ref, url: `${DECISION_MEDIA_ROUTE_PREFIX}/${ref.key}?${query}` };
  };
  return entries.map(({ item, answer }) => ({
    item: { ...item, media: item.media.map(sign) },
    answer: answer?.uploads ? { ...answer, uploads: answer.uploads.map(sign) } : answer,
  }));
});

export const decisionsHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "decisions",
  Effect.fnUntraced(function* (handlers) {
    const decisions = yield* DecisionService.DecisionService;
    const signed = (entries: ReadonlyArray<DecisionItemWithAnswer>) =>
      withMediaUrls(entries).pipe(
        Effect.catch((cause) => failEnvironmentInternal("internal_error", cause)),
      );
    const signedOne = (entry: DecisionItemWithAnswer) =>
      signed([entry]).pipe(Effect.map((entries) => entries[0] ?? entry));

    return handlers
      .handle("list", (args) =>
        Effect.gen(function* () {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return { items: yield* signed(yield* decisions.list(args.query)) };
        }),
      )
      .handle("history", (args) =>
        Effect.gen(function* () {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return { items: yield* signed(yield* decisions.history(args.query)) };
        }),
      )
      .handle("get", (args) =>
        Effect.gen(function* () {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* signedOne(yield* decisions.get(args.params.id));
        }),
      )
      .handle("wait", (args) =>
        Effect.gen(function* () {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          const seconds = Math.min(
            Math.max(args.query.timeout_s ?? 60, 0),
            DECISION_LIMITS.maxWaitSeconds,
          );
          return yield* signedOne(yield* decisions.wait(args.params.id, Duration.seconds(seconds)));
        }),
      )
      .handle("submit", (args) =>
        Effect.gen(function* () {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* decisions.submit(args.payload);
        }),
      )
      .handle("answer", (args) =>
        Effect.gen(function* () {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* decisions.answer(args.params.id, args.payload);
        }),
      )
      .handle("withdraw", (args) =>
        Effect.gen(function* () {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* decisions.withdraw(args.params.id);
        }),
      )
      .handle("upload", (args) =>
        Effect.gen(function* () {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* decisions.putMedia(args.query, args.payload);
        }),
      );
  }),
);

/** Serves an uploaded decision file for a URL signed by {@link decisionsHttpApiLayer}. */
export const decisionMediaRouteLayer = HttpRouter.add(
  "GET",
  `${DECISION_MEDIA_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) return HttpServerResponse.text("Bad Request", { status: 400 });
    const key = url.value.pathname.slice(`${DECISION_MEDIA_ROUTE_PREFIX}/`.length);
    const mime = url.value.searchParams.get("mime") ?? "";
    const expiresAt = Number(url.value.searchParams.get("exp"));
    const signature = url.value.searchParams.get("sig") ?? "";
    const notFound = HttpServerResponse.text("Not Found", { status: 404 });
    if (!key || !mime || !Number.isFinite(expiresAt)) return notFound;
    if (expiresAt < (yield* Clock.currentTimeMillis)) return notFound;
    const secret = yield* loadSigningSecret.pipe(Effect.option);
    if (
      Option.isNone(secret) ||
      !timingSafeEqualBase64Url(signature, mediaSignature(secret.value, key, mime, expiresAt))
    ) {
      return notFound;
    }
    const decisions = yield* DecisionService.DecisionService;
    const path = yield* decisions.mediaPath(key);
    if (Option.isNone(path)) return notFound;
    // Range-aware, so the app's video and audio players can seek.
    return yield* assetFileResponse(
      { path: path.value, mimeType: mime },
      request.headers.range,
      request.headers["if-range"],
    ).pipe(Effect.orElseSucceed(() => notFound));
  }),
);
