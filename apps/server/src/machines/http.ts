/**
 * HTTP transport for the machine list (`/api/machines`).
 *
 * Minting a link and pairing act with this computer's credentials for other
 * machines, so they need the terminal scope: a device that can run a shell
 * here could already run `cz pair` on those machines through it.
 *
 * @module MachinesHttp
 */
import {
  AuthOrchestrationReadScope,
  AuthTerminalOperateScope,
  EnvironmentHttpApi,
} from "@cz/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import { annotateEnvironmentRequest, requireEnvironmentScope } from "../auth/http.ts";
import * as MachineDirectory from "./MachineDirectory.ts";

export const machinesHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "machines",
  Effect.fnUntraced(function* (handlers) {
    const machines = yield* MachineDirectory.MachineDirectory;
    return handlers
      .handle("list", (args) =>
        Effect.gen(function* () {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return { machines: yield* machines.list };
        }),
      )
      .handle("pairingLink", (args) =>
        Effect.gen(function* () {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthTerminalOperateScope);
          return yield* machines.pairingLink(args.payload);
        }),
      )
      .handle("pair", (args) =>
        Effect.gen(function* () {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthTerminalOperateScope);
          return yield* machines.pair(args.payload);
        }),
      );
  }),
);
