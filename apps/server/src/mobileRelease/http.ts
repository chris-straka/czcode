/**
 * HTTP transport for app updates: `/api/mobile-release/android` describes the
 * newest APK, and the signed `/api/mobile-release-apk/*` route serves it so a
 * phone's browser can download it without auth headers.
 *
 * @module MobileReleaseHttp
 */
import { AuthOrchestrationReadScope, EnvironmentHttpApi } from "@cz/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import { annotateEnvironmentRequest, requireEnvironmentScope } from "../auth/http.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { signPayload, timingSafeEqualBase64Url } from "../auth/utils.ts";
import * as MobileReleaseService from "./MobileReleaseService.ts";

const APK_ROUTE_PREFIX = "/api/mobile-release-apk";
const APK_MIME = "application/vnd.android.package-archive";
const URL_TTL_MS = 60 * 60 * 1000;

const loadSigningSecret = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  return yield* secrets.getOrCreateRandom("mobile-release-signing-key", 32);
});

const apkSignature = (secret: Uint8Array, file: string, expiresAt: number) =>
  signPayload(`${file}\n${expiresAt}`, secret);

export const mobileReleaseHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "mobileRelease",
  Effect.fnUntraced(function* (handlers) {
    const releases = yield* MobileReleaseService.MobileReleaseService;
    return handlers.handle("android", (args) =>
      Effect.gen(function* () {
        yield* annotateEnvironmentRequest(args.endpoint.name);
        yield* requireEnvironmentScope(AuthOrchestrationReadScope);
        const latest = yield* releases.latestAndroid;
        if (Option.isNone(latest)) return { release: null };
        const { file, version, versionCode, sizeBytes } = latest.value;
        const secret = yield* loadSigningSecret.pipe(Effect.orDie);
        const expiresAt = (yield* Clock.currentTimeMillis) + URL_TTL_MS;
        const query = new URLSearchParams({
          exp: String(expiresAt),
          sig: apkSignature(secret, file, expiresAt),
        });
        const url = `${APK_ROUTE_PREFIX}/${file}?${query}`;
        return { release: { version, versionCode, sizeBytes, url } };
      }),
    );
  }),
);

/** Serves a published APK for a URL signed by {@link mobileReleaseHttpApiLayer}. */
export const mobileReleaseApkRouteLayer = HttpRouter.add(
  "GET",
  `${APK_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    const notFound = HttpServerResponse.text("Not Found", { status: 404 });
    if (Option.isNone(url)) return notFound;
    const file = url.value.pathname.slice(`${APK_ROUTE_PREFIX}/`.length);
    const expiresAt = Number(url.value.searchParams.get("exp"));
    const signature = url.value.searchParams.get("sig") ?? "";
    if (!Number.isFinite(expiresAt) || expiresAt < (yield* Clock.currentTimeMillis)) {
      return notFound;
    }
    const secret = yield* loadSigningSecret.pipe(Effect.option);
    if (
      Option.isNone(secret) ||
      !timingSafeEqualBase64Url(signature, apkSignature(secret.value, file, expiresAt))
    ) {
      return notFound;
    }
    const releases = yield* MobileReleaseService.MobileReleaseService;
    const path = yield* releases.androidPath(file);
    if (Option.isNone(path)) return notFound;
    return yield* HttpServerResponse.file(path.value, {
      contentType: APK_MIME,
      headers: {
        "content-disposition": `attachment; filename="${file}"`,
        "cache-control": "private, max-age=3600",
      },
    }).pipe(Effect.orElseSucceed(() => notFound));
  }),
);
