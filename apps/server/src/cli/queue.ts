/**
 * `cz queue`: runs that start at a provider's next quota reset (replaces
 * nightshift's `ns`). Talks to the running server, since only it can start
 * threads and knows each provider's reset times.
 *
 * @module QueueCli
 */
import {
  AuthAdministrativeScopes,
  EnvironmentHttpApi,
  ProviderInstanceId,
  type QueuedRun,
} from "@cz/contracts";
import * as Clock from "effect/Clock";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag, GlobalFlag } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import * as HttpApiClient from "effect/http-api/HttpApiClient";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import { readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import { baseDirFlag, resolveCliAuthConfig } from "./config.ts";

export class QueueCliError extends Schema.TaggedError<QueueCliError>()("QueueCliError", {
  message: Schema.String,
}) {}

const fail = (message: string) => new QueueCliError({ message });
const encodeJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const jsonFlag = Flag.Boolean("json").pipe(Flag.withDefault(false));
const idArgument = Argument.String("id");

type ServerClient = HttpApiClient.ForApi<typeof EnvironmentHttpApi>;

/** Runs `run` against the running server with a short-lived admin session. */
const withServer = <A, E, R>(
  baseDir: Option.Option<string>,
  run: (api: {
    readonly queue: ServerClient["queue"];
    readonly projects: ServerClient["projects"];
    readonly headers: { readonly authorization: string };
  }) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const logLevel = yield* GlobalFlag.LogLevel;
    const config = yield* resolveCliAuthConfig({ baseDir }, logLevel);
    return yield* Effect.gen(function* () {
      const runtimeState = yield* readPersistedServerRuntimeState(config.serverRuntimeStatePath);
      if (Option.isNone(runtimeState)) {
        return yield* fail("cz isn't running. Start it (cz or the desktop app), then try again.");
      }
      const auth = yield* EnvironmentAuth.EnvironmentAuth;
      const client = yield* HttpApiClient.make(EnvironmentHttpApi, {
        baseUrl: runtimeState.value.origin,
      });
      return yield* Effect.acquireUseRelease(
        auth.issueSession({ scopes: AuthAdministrativeScopes, label: "cz queue cli" }),
        (issued) =>
          run({
            queue: client.queue,
            projects: client.projects,
            headers: { authorization: `Bearer ${issued.token}` },
          }),
        (issued) => auth.revokeSession(issued.sessionId).pipe(Effect.ignore({ log: true })),
      );
    }).pipe(
      Effect.provide(
        EnvironmentAuth.layerRuntime.pipe(
          Layer.provideMerge(FetchHttpClient.layer),
          Layer.provide(ServerConfig.layer(config)),
        ),
      ),
    );
  });

const describeRun = (run: QueuedRun, now: number) => {
  const when =
    run.status !== "queued"
      ? run.status
      : run.dueAt <= now
        ? "starting"
        : `${run.dueReason === "reset" ? "at reset" : "at"} ${DateTime.formatIso(DateTime.makeUnsafe(run.dueAt))}`;
  return `${run.id}  ${when}  ${run.modelSelection.instanceId}/${run.modelSelection.model}  ${run.title}${run.threadId ? `  thread ${run.threadId}` : ""}${run.error ? `  (${run.error.split("\n")[0]})` : ""}`;
};

const addCommand = Command.make("add", {
  baseDir: baseDirFlag,
  json: jsonFlag,
  project: Flag.String("project").pipe(
    Flag.withDescription("Project path or id (default: the current directory)."),
    Flag.optional,
  ),
  model: Flag.String("model").pipe(
    Flag.withDescription("Provider instance and model, like claude/claude-opus-5-5."),
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
    withServer(flags.baseDir, ({ queue, projects, headers }) =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const slash = flags.model.indexOf("/");
        if (slash <= 0)
          return yield* fail("--model is instance/model, like claude/claude-opus-5-5.");
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
        const snapshot = yield* projects.snapshot({ headers });
        const live = snapshot.projects.filter((project) => project.deletedAt === null);
        const project =
          live.find((candidate) => candidate.id === wanted) ??
          live.find((candidate) => candidate.workspaceRoot === path.resolve(wanted));
        if (!project) return yield* fail(`No cz project at ${wanted}. Add it with cz project add.`);
        const firstLine = flags.prompt.trim().split("\n")[0] ?? "";
        const run = yield* queue.enqueue({
          headers,
          payload: {
            title: Option.getOrElse(flags.title, () => firstLine.slice(0, 80)),
            prompt: flags.prompt,
            projectId: project.id,
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

const listCommand = Command.make("list", { baseDir: baseDirFlag, json: jsonFlag }).pipe(
  Command.withDescription("Queued runs by start time, then recent ones."),
  Command.withHandler((flags) =>
    withServer(flags.baseDir, ({ queue, headers }) =>
      Effect.gen(function* () {
        const { runs } = yield* queue.list({ headers });
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
  Command.make(name, { baseDir: baseDirFlag, id: idArgument }).pipe(
    Command.withDescription(description),
    Command.withHandler((flags) =>
      withServer(flags.baseDir, ({ queue, headers }) =>
        Effect.gen(function* () {
          const request = { headers, params: { id: flags.id } };
          const run = yield* name === "cancel" ? queue.cancel(request) : queue.runNow(request);
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
    mutationCommand("cancel", "Cancel a queued run."),
    mutationCommand("run-now", "Start a queued run now instead of at the reset."),
  ]),
);
