/**
 * `cz thread`: list threads, stop runs, and archive threads, on this machine or (`--host`) a
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

/** "running" for a turn, "busy" for background work left after one, else "idle". */
export const threadStateWord = (thread: Pick<ThreadControlSummary, "running" | "busy">) =>
  thread.running ? "running" : thread.busy ? "busy   " : "idle   ";

const describe = (thread: ThreadControlSummary) =>
  `${shortThreadId(thread.threadId)}  ${threadStateWord(thread)}  ${thread.model}  ${thread.projectTitle ?? "?"} / ${thread.title}`;

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

/** Threads whose title starts with the prefix, archived ones left out. */
export const threadsTitled = (threads: ReadonlyArray<ThreadControlSummary>, prefix: string) =>
  threads.filter((thread) => !thread.archived && thread.title.startsWith(prefix));

const archiveCommand = Command.make("archive", {
  baseDir: baseDirFlag,
  host: hostFlag,
  titled: Flag.String("titled").pipe(
    Flag.withDescription('Archive every thread whose title starts with this, e.g. "Lead: ".'),
    Flag.optional,
  ),
  ids: Argument.String("thread").pipe(
    Argument.withDescription("Thread id or the short id cz thread list shows."),
    Argument.atLeast(0),
  ),
}).pipe(
  Command.withDescription(
    "Archive threads: a running turn stops, and nothing wakes or resumes them after.",
  ),
  Command.withHandler((flags) =>
    withServer({ baseDir: flags.baseDir, host: flags.host, sessionLabel }, ({ client, headers }) =>
      Effect.gen(function* () {
        const { threads } = yield* client.threads.list({ headers });
        const targets: Array<ThreadControlSummary> = [];
        for (const wanted of flags.ids) {
          const thread = matchThread(threads, wanted);
          if (typeof thread === "string") return yield* new ThreadCliError({ message: thread });
          targets.push(thread);
        }
        if (flags.titled._tag === "Some")
          targets.push(...threadsTitled(threads, flags.titled.value));
        if (targets.length === 0) {
          return yield* new ThreadCliError({
            message: "Name threads to archive, or pass --titled.",
          });
        }
        for (const thread of targets) {
          const result = yield* client.threads.archive({
            headers,
            payload: { threadId: thread.threadId },
          });
          yield* Console.log(
            `${shortThreadId(thread.threadId)}  ${result.status === "archived" ? "archived" : "was archived"}  ${thread.title}`,
          );
        }
      }),
    ),
  ),
);

export const threadCommand = Command.make("thread").pipe(
  Command.withDescription("List, stop, and archive threads, here or on a paired machine."),
  Command.withSubcommands([listCommand, stopCommand, archiveCommand]),
);
