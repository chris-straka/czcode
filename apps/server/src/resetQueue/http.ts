/**
 * HTTP transport for the reset queue (`/api/queue`).
 *
 * @module ResetQueueHttp
 */
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
} from "@cz/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { annotateEnvironmentRequest, requireEnvironmentScope } from "../auth/http.ts";
import * as ResetQueueService from "./ResetQueueService.ts";

export const queueHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "queue",
  Effect.fnUntraced(function* (handlers) {
    const queue = yield* ResetQueueService.ResetQueueService;
    return handlers
      .handle("list", (args) =>
        Effect.gen(function* () {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return { runs: yield* queue.list };
        }),
      )
      .handle("enqueue", (args) =>
        Effect.gen(function* () {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* queue.enqueue(args.payload);
        }),
      )
      .handle("cancel", (args) =>
        Effect.gen(function* () {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* queue.cancel(args.params.id);
        }),
      )
      .handle("runNow", (args) =>
        Effect.gen(function* () {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* queue.runNow(args.params.id);
        }),
      );
  }),
);
