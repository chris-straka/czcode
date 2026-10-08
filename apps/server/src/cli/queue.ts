/**
 * `cz queue`: runs that start at a provider's next quota reset (replaces
 * nightshift's `ns`). Talks to the running server, since only it can start
 * threads and knows each provider's reset times.
 *
 * @module QueueCli
 */
import { CommandId, ProjectId, ProviderInstanceId, type QueuedRun } from "@cz/contracts";
import * as Clock from "effect/Clock";
import * as Console from "effect/Console";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag } from "effect/cli";

import { baseDirFlag } from "./config.ts";
import { hostFlag, type ServerAccess, type ServerClient, withServer } from "./serverClient.ts";

export class QueueCliError extends Schema.TaggedError<QueueCliError>()("QueueCliError", {
  message: Schema.String,
}) {}

const fail = (message: string) => new QueueCliError({ message });
const encodeJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const jsonFlag = Flag.Boolean("json").pipe(Flag.withDefault(false));
const idArgument = Argument.String("id");

const sessionInput = (flags: {
  readonly baseDir: Option.Option<string>;
  readonly host: Option.Option<string>;
}) => ({ baseDir: flags.baseDir, host: flags.host, sessionLabel: "cz queue cli" });

const describeRun = (run: QueuedRun, now: number) => {
  const when =
    run.status !== "queued"
      ? run.status
      : run.dueAt <= now
        ? "starting"
        : `${run.dueReason === "reset" ? "at reset" : "at"} ${DateTime.formatIso(DateTime.makeUnsafe(run.dueAt))}`;
  return `${run.id}  ${when}  ${run.modelSelection.instanceId}/${run.modelSelection.model}  ${run.title}${run.threadId ? `  thread ${run.threadId}` : ""}${run.error ? `  (${run.error.split("\n")[0]})` : ""}`;
};

/**
 * `--project` named a folder that isn't a project yet: add it, the way
 * `cz project add` would, so tasks run in the folder they're about.
 */
export const addFolderProject = Effect.fn("QueueCli.addFolderProject")(function* (
  client: ServerClient,
  headers: ServerAccess["headers"],
  flags: { readonly host: Option.Option<string> },
  wanted: string,
) {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const remote = Option.isSome(flags.host);
  const workspaceRoot = remote ? wanted : path.resolve(wanted);
  const isFolder = remote
    ? path.isAbsolute(wanted)
    : yield* fs.stat(workspaceRoot).pipe(
        Effect.map((info) => info.type === "Directory"),
        Effect.orElseSucceed(() => false),
      );
  if (!isFolder) return yield* fail(`No cz project or folder at ${wanted}.`);
  const crypto = yield* Crypto.Crypto;
  const uuid = crypto.randomUUIDv4.pipe(
    Effect.mapError(() => fail("Could not make a project id.")),
  );
  const projectId = ProjectId.make(yield* uuid);
  yield* client.projects.mutate({
    headers,
    payload: {
      type: "project.create",
      commandId: CommandId.make(yield* uuid),
      projectId,
      title: path.basename(workspaceRoot) || "project",
      workspaceRoot,
    },
  } as Parameters<ServerClient["projects"]["mutate"]>[0]);
  yield* Console.error(`Added ${workspaceRoot} as a cz project.`);
  return projectId;
});

const addCommand = Command.make("add", {
  baseDir: baseDirFlag,
  host: hostFlag,
  json: jsonFlag,
  project: Flag.String("project").pipe(
    Flag.withDescription(
      "Project path, id, or name (default: the current directory). A folder that isn't a project yet is added as one. With --host, a path on that machine.",
    ),
    Flag.optional,
  ),
  model: Flag.String("model").pipe(
    Flag.withDescription(
      "Provider instance and model, like claudeAgent/claude-opus-5-5. A driver name (claude) works when the host has one instance of it.",
    ),
  ),
  title: Flag.String("title").pipe(Flag.optional),
  option: Flag.String("option").pipe(
    Flag.withDescription("A model option as id=value, like variant=max; repeat for more."),
    Flag.atLeast(0),
  ),
  at: Flag.String("at").pipe(
    Flag.withDescription("Start at this time instead of the provider's next reset."),
    Flag.optional,
  ),
  prompt: Argument.String("prompt"),
}).pipe(
  Command.withDescription("Queue a task to start as a thread when the model's quota resets."),
  Command.withHandler((flags) =>
    withServer(sessionInput(flags), ({ client, headers }) =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const slash = flags.model.indexOf("/");
        if (slash <= 0)
          return yield* fail("--model is instance/model, like claudeAgent/claude-opus-5-5.");
        const options = flags.option.map((entry) => {
          const equals = entry.indexOf("=");
          const value = entry.slice(equals + 1).trim();
          return {
            id: entry.slice(0, equals).trim(),
            value: value === "true" ? true : value === "false" ? false : value,
          };
        });
        const badOption = flags.option.find((entry, index) => {
          const parsed = options[index]!;
          return entry.indexOf("=") <= 0 || parsed.value === "";
        });
        if (badOption !== undefined) {
          return yield* fail(`--option is id=value, like variant=max (got ${badOption}).`);
        }
        const dueAt = Option.map(flags.at, Date.parse);
        if (Option.isSome(dueAt) && !Number.isFinite(dueAt.value)) {
          return yield* fail(`Can't read --at ${Option.getOrElse(flags.at, () => "")} as a time.`);
        }
        const wanted = Option.getOrElse(flags.project, () => process.cwd());
        const snapshot = yield* client.projects.snapshot({ headers });
        const live = snapshot.projects.filter((project) => project.deletedAt === null);
        const project =
          live.find((candidate) => candidate.id === wanted) ??
          live.find((candidate) => candidate.workspaceRoot === wanted) ??
          (Option.isNone(flags.host)
            ? live.find((candidate) => candidate.workspaceRoot === path.resolve(wanted))
            : undefined) ??
          live.find((candidate) => candidate.title === wanted);
        const projectId = project?.id ?? (yield* addFolderProject(client, headers, flags, wanted));
        const firstLine = flags.prompt.trim().split("\n")[0] ?? "";
        const run = yield* client.queue.enqueue({
          headers,
          payload: {
            title: Option.getOrElse(flags.title, () => firstLine.slice(0, 80)),
            prompt: flags.prompt,
            projectId,
            modelSelection: {
              instanceId: ProviderInstanceId.make(flags.model.slice(0, slash)),
              model: flags.model.slice(slash + 1),
              ...(options.length > 0 ? { options } : {}),
            },
            source: "cli",
            ...(Option.isSome(dueAt) ? { dueAt: dueAt.value } : {}),
          },
        });
        yield* Console.log(
          flags.json ? encodeJson(run) : describeRun(run, yield* Clock.currentTimeMillis),
        );
      }),
    ),
  ),
);

const listCommand = Command.make("list", {
  baseDir: baseDirFlag,
  host: hostFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Queued runs by start time, then recent ones."),
  Command.withHandler((flags) =>
    withServer(sessionInput(flags), ({ client, headers }) =>
      Effect.gen(function* () {
        const { runs } = yield* client.queue.list({ headers });
        if (flags.json) return yield* Console.log(encodeJson(runs));
        const now = yield* Clock.currentTimeMillis;
        yield* Console.log(
          runs.length === 0
            ? "Nothing queued."
            : runs.map((run) => describeRun(run, now)).join("\n"),
        );
      }),
    ),
  ),
);

const mutationCommand = (name: "cancel" | "run-now", description: string) =>
  Command.make(name, { baseDir: baseDirFlag, host: hostFlag, id: idArgument }).pipe(
    Command.withDescription(description),
    Command.withHandler((flags) =>
      withServer(sessionInput(flags), ({ client, headers }) =>
        Effect.gen(function* () {
          const request = { headers, params: { id: flags.id } };
          const run = yield* name === "cancel"
            ? client.queue.cancel(request)
            : client.queue.runNow(request);
          yield* Console.log(describeRun(run, yield* Clock.currentTimeMillis));
        }),
      ),
    ),
  );

export const queueCommand = Command.make("queue").pipe(
  Command.withDescription("Run tasks when a provider's quota resets."),
  Command.withSubcommands([
    addCommand,
    listCommand,
    mutationCommand("cancel", "Cancel a queued run, or dismiss one that failed to start."),
    mutationCommand("run-now", "Start a queued run now instead of at the reset."),
  ]),
);
