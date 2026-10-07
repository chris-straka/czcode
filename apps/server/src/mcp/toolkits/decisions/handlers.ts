import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as DecisionService from "../../../decisions/DecisionService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { DecisionMediaReadError, DecisionsToolkit } from "./tools.ts";

const make = Effect.gen(function* () {
  const decisions = yield* DecisionService.DecisionService;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  return {
    ask_owner: McpToolAccess.writes((input) =>
      Effect.gen(function* () {
        const scope = yield* McpInvocationContext.McpInvocationContext;
        // A client caller (not an agent in a thread) has no thread to link.
        const threadId = scope.thread?.threadId ?? null;
        return yield* decisions.submit({
          ...input,
          thread: threadId,
          created_by: threadId ? `thread/${threadId}` : "mcp",
        });
      }),
    ),
    upload_decision_media: McpToolAccess.writes((input) =>
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
    ),
    wait_for_decision: McpToolAccess.reads((input) =>
      decisions.wait(input.id, Duration.seconds(Math.min(Math.max(input.timeout_s ?? 60, 0), 300))),
    ),
    get_decision: McpToolAccess.reads((input) => decisions.get(input.id)),
    decision_history: McpToolAccess.reads((input) =>
      decisions.history(input).pipe(Effect.map((items) => ({ items }))),
    ),
    withdraw_decision: McpToolAccess.writes((input) => decisions.withdraw(input.id)),
  } satisfies McpToolAccess.Handlers<typeof DecisionsToolkit.tools>;
});

export const DecisionsToolkitHandlersLive = McpToolAccess.toLayer(DecisionsToolkit, make);
