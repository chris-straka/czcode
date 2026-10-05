import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as DecisionService from "../../../decisions/DecisionService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { DecisionMediaReadError, DecisionsToolkit } from "./tools.ts";

const make = Effect.gen(function* () {
  const decisions = yield* DecisionService.DecisionService;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  return DecisionsToolkit.of({
    ask_owner: (input) =>
      Effect.gen(function* () {
        const scope = yield* McpInvocationContext.McpInvocationContext;
        return yield* decisions.submit({
          ...input,
          thread: scope.threadId,
          created_by: `thread/${scope.threadId}`,
        });
      }),
    upload_decision_media: (input) =>
      Effect.gen(function* () {
        const bytes = yield* fs
          .readFile(input.path)
          .pipe(
            Effect.mapError((cause) => new DecisionMediaReadError({ path: input.path, cause })),
          );
        return yield* decisions.putMedia(
          {
            name: path.basename(input.path),
            mime: input.mime,
            type: input.type,
            ...(input.caption ? { caption: input.caption } : {}),
          },
          bytes,
        );
      }),
    wait_for_decision: (input) =>
      decisions.wait(input.id, Duration.seconds(Math.min(Math.max(input.timeout_s ?? 60, 0), 300))),
    get_decision: (input) => decisions.get(input.id),
    decision_history: (input) => decisions.history(input).pipe(Effect.map((items) => ({ items }))),
    withdraw_decision: (input) => decisions.withdraw(input.id),
  });
});

export const DecisionsToolkitHandlersLive = DecisionsToolkit.toLayer(make);
