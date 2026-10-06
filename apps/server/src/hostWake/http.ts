/**
 * HTTP transport for host wake: `/.well-known/cz-wake` publishes how to wake
 * this machine (for other cz servers on the tailnet; no auth, it is only a
 * MAC and a LAN address), and `/api/hosts/wake` asks this server to wake one.
 *
 * @module HostWakeHttp
 */
import { AuthOrchestrationOperateScope, EnvironmentHttpApi } from "@cz/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import { annotateEnvironmentRequest, requireEnvironmentScope } from "../auth/http.ts";
import * as HostWakeService from "./HostWakeService.ts";

export const hostWakeHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "hostWake",
  Effect.fnUntraced(function* (handlers) {
    const hostWake = yield* HostWakeService.HostWakeService;
    return handlers.handle("wake", (args) =>
      Effect.gen(function* () {
        yield* annotateEnvironmentRequest(args.endpoint.name);
        yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
        return yield* hostWake.wake(args.payload.host);
      }),
    );
  }),
);

/** This machine's wake details, or 404 when it doesn't sleep when idle. */
export const hostWakeInfoRouteLayer = HttpRouter.add(
  "GET",
  "/.well-known/cz-wake",
  Effect.gen(function* () {
    const hostWake = yield* HostWakeService.HostWakeService;
    return Option.match(hostWake.ownWakeInfo, {
      onNone: () => HttpServerResponse.text("Not Found", { status: 404 }),
      onSome: (info) => HttpServerResponse.jsonUnsafe(info),
    });
  }),
);
