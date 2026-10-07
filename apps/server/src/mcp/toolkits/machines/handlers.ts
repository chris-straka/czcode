import * as Effect from "effect/Effect";

import * as MachineDirectory from "../../../machines/MachineDirectory.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { MachinesToolkit } from "./tools.ts";

const make = Effect.gen(function* () {
  const machines = yield* MachineDirectory.MachineDirectory;
  return {
    cz_machine_list: McpToolAccess.reads(() =>
      machines.list.pipe(Effect.map((list) => ({ machines: list }))),
    ),
    // The started thread runs with the caller's modes at most, on any machine.
    cz_machine_queue: McpToolAccess.startsThreads(
      (input) => input.run,
      (input, modes) =>
        machines.enqueue({
          ...input,
          run: {
            ...input.run,
            runtimeMode: modes.runtimeMode,
            interactionMode: modes.interactionMode,
            source: input.run.source ?? "cli",
          },
        }),
    ),
  } satisfies McpToolAccess.Handlers<typeof MachinesToolkit.tools>;
});

export const MachinesToolkitHandlersLive = McpToolAccess.toLayer(MachinesToolkit, make);
