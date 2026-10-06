/**
 * `cz inbox`: ask the owner and read answers from scripts and agents that
 * don't run inside a cz thread (thread agents use the MCP tools). Works on
 * this machine's cz.sqlite directly, with or without a running server.
 *
 * @module InboxCli
 */
import {
  type DecisionItemWithAnswer,
  DecisionKind,
  DecisionItemStatus,
  type DecisionMediaRef,
  type DecisionMediaType,
  type DecisionOption,
  type DecisionTimelineStep,
  normalizeDecisionKind,
} from "@cz/contracts";
import * as Clock from "effect/Clock";
import * as Console from "effect/Console";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag, GlobalFlag } from "effect/cli";

import * as ServerConfig from "../config.ts";
import * as DecisionService from "../decisions/DecisionService.ts";
import * as ForkDatabase from "../forkDatabase/ForkDatabase.ts";
import { baseDirFlag, resolveCliAuthConfig } from "./config.ts";

export class InboxCliError extends Schema.TaggedError<InboxCliError>()("InboxCliError", {
  message: Schema.String,
}) {}

const fail = (message: string) => new InboxCliError({ message });

const isDecisionItemStatus = Schema.is(DecisionItemStatus);
const encodeJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const printJson = (value: unknown) => Console.log(encodeJson(value));

/** Runs `run` against this machine's decisions (the same store the server uses). */
const withDecisions = <A, E, R>(
  baseDir: Option.Option<string>,
  run: (decisions: DecisionService.DecisionService["Service"]) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const logLevel = yield* GlobalFlag.LogLevel;
    const config = yield* resolveCliAuthConfig({ baseDir }, logLevel);
    return yield* DecisionService.DecisionService.pipe(
      Effect.flatMap(run),
      Effect.provide(
        DecisionService.layer.pipe(
          Layer.provideMerge(ForkDatabase.layer),
          Layer.provide(ServerConfig.layer(config)),
        ),
      ),
    );
  });

const MEDIA_TYPES: ReadonlyArray<readonly [RegExp, DecisionMediaType, string]> = [
  [/\.png$/i, "image", "image/png"],
  [/\.jpe?g$/i, "image", "image/jpeg"],
  [/\.webp$/i, "image", "image/webp"],
  [/\.gif$/i, "image", "image/gif"],
  [/\.glb$/i, "glb", "model/gltf-binary"],
  [/\.wav$/i, "audio", "audio/wav"],
  [/\.mp3$/i, "audio", "audio/mpeg"],
  [/\.ogg$/i, "audio", "audio/ogg"],
  [/\.flac$/i, "audio", "audio/flac"],
  [/\.m4a$/i, "audio", "audio/mp4"],
  [/\.mp4$/i, "video", "video/mp4"],
  [/\.mov$/i, "video", "video/quicktime"],
  [/\.webm$/i, "video", "video/webm"],
  [/\.apk$/i, "apk", "application/vnd.android.package-archive"],
  [/\.(md|txt)$/i, "text", "text/plain"],
];

/** Media type and MIME type from a filename. */
export function mediaTypeForFile(name: string): { type: DecisionMediaType; mime: string } {
  const match = MEDIA_TYPES.find(([pattern]) => pattern.test(name));
  return match
    ? { type: match[1], mime: match[2] }
    : { type: "file", mime: "application/octet-stream" };
}

/** Options for a submission: given labels, or one per file for media kinds. */
export function optionsFor(
  kind: DecisionKind,
  labels: ReadonlyArray<string>,
  fileNames: ReadonlyArray<string>,
): DecisionOption[] {
  const perFile = labels.length === 0 && ["pick", "listen", "look", "rank"].includes(kind);
  const count = perFile ? fileNames.length : labels.length;
  return Array.from({ length: count }, (_, index) => ({
    id: `opt-${index + 1}`,
    label: labels[index] ?? fileNames[index] ?? `Option ${index + 1}`,
    media_idx: index < fileNames.length && (perFile || kind === "pick") ? index : null,
  }));
}

const StepsFile = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      id: Schema.String,
      label: Schema.String,
      status: Schema.Literals(["done", "failed", "skipped"]),
      media_idx: Schema.optionalKey(Schema.NullOr(Schema.Number)),
    }),
  ),
);

/**
 * Timeline steps from a `--steps-file` (a JSON array of {id, label, status,
 * media_idx?}). A step without `media_idx` shows the file at its own position.
 */
export const stepsFromFile = (text: string, fileCount: number) =>
  Schema.decodeEffect(StepsFile)(text).pipe(
    Effect.map((steps): DecisionTimelineStep[] =>
      steps.map((step, index) => ({
        ...step,
        media_idx: step.media_idx !== undefined ? step.media_idx : index < fileCount ? index : null,
      })),
    ),
    Effect.mapError((error) => fail(`Can't read --steps-file: ${error.message}`)),
  );

/** "2h", "3d", "30m" after `now`, or an absolute date. */
export const parseWhen = (value: string, now: number): number | null => {
  const relative = /^(\d+)(m|h|d)$/i.exec(value.trim());
  if (relative) {
    const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[relative[2]!.toLowerCase() as "m"];
    return now + Number(relative[1]) * unit;
  }
  const absolute = Date.parse(value);
  return Number.isFinite(absolute) ? absolute : null;
};

const summary = ({ item, answer }: DecisionItemWithAnswer) => {
  const verdict = answer
    ? (answer.choice ?? answer.option_ids?.join(",") ?? answer.rank?.join(">") ?? "answered")
    : "";
  return `${item.id}  ${item.status.padEnd(9)} ${item.project.padEnd(16)} ${item.kind.padEnd(8)} ${item.title}${verdict ? `  -> ${verdict}` : ""}${answer?.comment ? `  "${answer.comment}"` : ""}`;
};

const jsonFlag = Flag.Boolean("json").pipe(
  Flag.withDescription("Print JSON."),
  Flag.withDefault(false),
);
const projectFlag = Flag.String("project").pipe(Flag.optional);
const kindFlag = Flag.String("kind").pipe(Flag.optional);
const limitFlag = Flag.String("limit").pipe(Flag.optional);
const idArgument = Argument.String("id").pipe(Argument.withDescription("Decision id."));

const kindOf = (value: Option.Option<string>) =>
  Option.isNone(value)
    ? Effect.succeed(undefined)
    : Option.fromNullishOr(normalizeDecisionKind(value.value)).pipe(
        Option.match({
          onNone: () =>
            Effect.fail(
              fail(`Unknown kind ${value.value}. Kinds: ${DecisionKind.literals.join(", ")}.`),
            ),
          onSome: Effect.succeed,
        }),
      );

const submitCommand = Command.make("submit", {
  baseDir: baseDirFlag,
  json: jsonFlag,
  project: Flag.String("project"),
  kind: Flag.String("kind").pipe(Flag.withDefault("pick")),
  question: Flag.String("question"),
  title: Flag.String("title").pipe(Flag.optional),
  body: Flag.String("body").pipe(Flag.optional),
  bodyFile: Flag.String("body-file").pipe(Flag.optional),
  option: Flag.String("option").pipe(Flag.atLeast(0)),
  stepsFile: Flag.String("steps-file").pipe(
    Flag.withDescription(
      "Timeline: a JSON array of {id, label, status: done|failed|skipped, media_idx?}.",
    ),
    Flag.optional,
  ),
  priority: Flag.String("priority").pipe(Flag.optional),
  createdBy: Flag.String("created-by").pipe(Flag.optional),
  thread: Flag.String("thread").pipe(Flag.optional),
  blocking: Flag.Boolean("blocking").pipe(
    Flag.withDescription("An agent is waiting on the answer right now."),
    Flag.withDefault(false),
  ),
  defaultOption: Flag.String("default").pipe(Flag.optional),
  expires: Flag.String("expires").pipe(
    Flag.withDescription("When the default is taken: 2h, 3d, or a date."),
    Flag.optional,
  ),
  costNote: Flag.String("cost-note").pipe(Flag.optional),
  resumePrompt: Flag.String("resume-prompt").pipe(
    Flag.withDescription("If you won't be waiting: what a new thread should do with the answer."),
    Flag.optional,
  ),
  files: Argument.String("files").pipe(Argument.variadic()),
}).pipe(
  Command.withDescription("Ask the owner. Uploads the files as media and prints the new id."),
  Command.withHandler((flags) =>
    withDecisions(flags.baseDir, (decisions) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const kind = (yield* kindOf(Option.some(flags.kind)))!;
        const body = Option.isSome(flags.bodyFile)
          ? yield* fs.readFileString(flags.bodyFile.value)
          : Option.getOrElse(flags.body, () => "");
        const media: DecisionMediaRef[] = [];
        for (const file of flags.files) {
          const name = path.basename(file);
          media.push(
            yield* decisions.putMedia(
              { name, ...mediaTypeForFile(name) },
              yield* fs.readFile(file),
            ),
          );
        }
        const steps = Option.isSome(flags.stepsFile)
          ? yield* stepsFromFile(yield* fs.readFileString(flags.stepsFile.value), media.length)
          : [];
        const now = yield* Clock.currentTimeMillis;
        const expiresAt = Option.isSome(flags.expires) ? parseWhen(flags.expires.value, now) : null;
        if (Option.isSome(flags.expires) && expiresAt === null) {
          return yield* fail(`Can't read --expires ${flags.expires.value}.`);
        }
        const item = yield* decisions.submit({
          project: flags.project,
          kind,
          question: flags.question,
          title: Option.getOrElse(flags.title, () => flags.question),
          body_md: body,
          media,
          options: optionsFor(
            kind,
            flags.option,
            flags.files.map((file) => path.basename(file)),
          ),
          steps,
          priority: Number(Option.getOrElse(flags.priority, () => "0")) || 0,
          created_by: Option.getOrElse(flags.createdBy, () => "cli"),
          thread: Option.getOrNull(flags.thread),
          blocking: flags.blocking,
          default: Option.getOrNull(flags.defaultOption),
          expires_at: expiresAt,
          cost_note: Option.getOrNull(flags.costNote),
          resume: Option.isSome(flags.resumePrompt)
            ? { project: flags.project, prompt: flags.resumePrompt.value }
            : null,
        });
        yield* flags.json ? printJson({ item }) : Console.log(item.id);
      }),
    ),
  ),
);

const waitCommand = Command.make("wait", {
  baseDir: baseDirFlag,
  json: jsonFlag,
  timeout: Flag.String("timeout").pipe(Flag.withDefault("6h")),
  id: idArgument,
}).pipe(
  Command.withDescription(
    "Wait for the answer. Exit 0 answered, 2 withdrawn or expired, 3 timed out.",
  ),
  Command.withHandler((flags) =>
    withDecisions(flags.baseDir, (decisions) =>
      Effect.gen(function* () {
        const deadline = parseWhen(flags.timeout, yield* Clock.currentTimeMillis);
        if (deadline === null) return yield* fail(`Can't read --timeout ${flags.timeout}.`);
        let current = yield* decisions.get(flags.id);
        // The server may answer it in another process, so poll the shared store.
        while (current.item.status === "open" && (yield* Clock.currentTimeMillis) < deadline) {
          yield* Effect.sleep(Duration.seconds(2));
          current = yield* decisions.get(flags.id);
        }
        yield* flags.json ? printJson(current) : Console.log(summary(current));
        const exitCode =
          current.item.status === "answered" ? 0 : current.item.status === "open" ? 3 : 2;
        if (exitCode !== 0) {
          // oxlint-disable-next-line czcode/no-global-process-runtime -- the CLI reports the outcome as its exit status.
          yield* Effect.sync(() => (process.exitCode = exitCode));
        }
      }),
    ),
  ),
);

const getCommand = Command.make("get", {
  baseDir: baseDirFlag,
  json: jsonFlag,
  id: idArgument,
}).pipe(
  Command.withDescription("Show a decision and its answer."),
  Command.withHandler((flags) =>
    withDecisions(flags.baseDir, (decisions) =>
      decisions
        .get(flags.id)
        .pipe(
          Effect.flatMap((entry) => (flags.json ? printJson(entry) : Console.log(summary(entry)))),
        ),
    ),
  ),
);

const listingCommand = (name: "list" | "history") =>
  Command.make(name, {
    baseDir: baseDirFlag,
    json: jsonFlag,
    project: projectFlag,
    kind: kindFlag,
    status: Flag.String("status").pipe(Flag.optional),
    limit: limitFlag,
  }).pipe(
    Command.withDescription(
      name === "list"
        ? "List decisions (open by default; --status answered|expired|withdrawn|all)."
        : "The owner's past answers, newest first: read before proposing.",
    ),
    Command.withHandler((flags) =>
      withDecisions(flags.baseDir, (decisions) =>
        Effect.gen(function* () {
          const kind = yield* kindOf(flags.kind);
          const status = Option.getOrUndefined(flags.status);
          if (status !== undefined && status !== "all" && !isDecisionItemStatus(status)) {
            return yield* fail(`Unknown status ${status}.`);
          }
          const query = {
            ...(Option.isSome(flags.project) ? { project: flags.project.value } : {}),
            ...(kind ? { kind } : {}),
            ...(status ? { status: status as DecisionItemStatus | "all" } : {}),
            ...(Option.isSome(flags.limit) ? { limit: Number(flags.limit.value) } : {}),
          };
          const items =
            name === "list" ? yield* decisions.list(query) : yield* decisions.history(query);
          if (flags.json) return yield* printJson({ items });
          for (const entry of items) yield* Console.log(summary(entry));
        }),
      ),
    ),
  );

const withdrawCommand = Command.make("withdraw", { baseDir: baseDirFlag, id: idArgument }).pipe(
  Command.withDescription("Withdraw an open decision."),
  Command.withHandler((flags) =>
    withDecisions(flags.baseDir, (decisions) =>
      decisions
        .withdraw(flags.id)
        .pipe(Effect.flatMap((item) => Console.log(`withdrawn: ${item.id}`))),
    ),
  ),
);

export const inboxCommand = Command.make("inbox").pipe(
  Command.withDescription("Ask the owner and read their answers (the Decisions tab)."),
  Command.withSubcommands([
    submitCommand,
    waitCommand,
    getCommand,
    listingCommand("list"),
    listingCommand("history"),
    withdrawCommand,
  ]),
);
