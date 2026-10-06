/**
 * `cz thread`: list threads and stop runs, on this machine or (`--host`) a
 * paired one, without opening an app.
 *
 * @module ThreadCli
 */
import type { ThreadControlSummary } from "@cz/contracts";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag } from "effect/cli";

import { baseDirFlag } from "./config.ts";
import { hostFlag, withServer } from "./serverClient.ts";

export class ThreadCliError extends Schema.TaggedError<ThreadCliError>()("ThreadCliError", {
  message: Schema.String,
}) {}

const encodeJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const sessionLabel = "cz thread cli";

/** The last part of a thread id, enough to tell threads apart in a list. */
export const shortThreadId = (threadId: string) => threadId.split(":").at(-1)!.slice(0, 8);

/** The one thread whose id (or short id) matches, or why none does. */
export function matchThread(
  threads: ReadonlyArray<ThreadControlSummary>,
  wanted: string,
): ThreadControlSummary | string {
  const exact = threads.find((thread) => thread.threadId === wanted);
  if (exact) return exact;
  const matches = threads.filter((thread) => thread.threadId.split(":").at(-1)!.startsWith(wanted));
  if (matches.length === 1) return matches[0]!;
  return matches.length === 0
    ? `No thread ${wanted}. See cz thread list.`
    : `${wanted} matches ${matches.length} threads; give more of the id.`;
}

const describe = (thread: ThreadControlSummary) =>
  `${shortThreadId(thread.threadId)}  ${thread.running ? "running" : "idle   "}  ${thread.model}  ${thread.projectTitle ?? "?"} / ${thread.title}`;

const listCommand = Command.make("list", {
  baseDir: baseDirFlag,
  host: hostFlag,
  all: Flag.Boolean("all").pipe(
    Flag.withDescription("Include archived threads and every idle one, not just the latest 20."),
    Flag.withDefault(false),
  ),
  json: Flag.Boolean("json").pipe(Flag.withDefault(false)),
}).pipe(
  Command.withDescription("Threads, running first, then the most recently active."),
  Command.withHandler((flags) =>
    withServer({ baseDir: flags.baseDir, host: flags.host, sessionLabel }, ({ client, headers }) =>
      Effect.gen(function* () {
        const { threads } = yield* client.threads.list({ headers });
        const shown = flags.all
          ? threads
          : threads.filter((thread) => !thread.archived).slice(0, 20);
        if (flags.json) return yield* Console.log(encodeJson(shown));
        yield* Console.log(shown.length === 0 ? "No threads." : shown.map(describe).join("\n"));
      }),
    ),
  ),
);

const stopCommand = Command.make("stop", {
  baseDir: baseDirFlag,
  host: hostFlag,
  ids: Argument.String("thread").pipe(
    Argument.withDescription("Thread id or the short id cz thread list shows."),
    Argument.atLeast(1),
  ),
}).pipe(
  Command.withDescription("Stop the running turn in each thread."),
  Command.withHandler((flags) =>
    withServer({ baseDir: flags.baseDir, host: flags.host, sessionLabel }, ({ client, headers }) =>
      Effect.gen(function* () {
        const { threads } = yield* client.threads.list({ headers });
        for (const wanted of flags.ids) {
          const thread = matchThread(threads, wanted);
          if (typeof thread === "string") return yield* new ThreadCliError({ message: thread });
          const result = yield* client.threads.stop({
            headers,
            payload: { threadId: thread.threadId },
          });
          yield* Console.log(
            `${shortThreadId(thread.threadId)}  ${result.status === "stopping" ? "stopping" : "was not running"}  ${thread.title}`,
          );
        }
      }),
    ),
  ),
);

export const threadCommand = Command.make("thread").pipe(
  Command.withDescription("List threads and stop runs, here or on a paired machine."),
  Command.withSubcommands([listCommand, stopCommand]),
);
