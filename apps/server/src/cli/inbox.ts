/**
 * `cz inbox`: ask the owner and read answers from scripts and agents that
 * don't run inside a cz thread (thread agents use the MCP tools). Works on
 * this machine's cz.sqlite directly, with or without a running server.
 *
 * @module InboxCli
 */
import {
  type DecisionAnswer,
  type DecisionItem,
  type DecisionItemWithAnswer,
  DecisionKind,
  DecisionItemStatus,
  type DecisionMediaRef,
  type DecisionMediaType,
  type DecisionOption,
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
import { Argument, Command, Flag, GlobalFlag } from "effect/unstable/cli";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

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

// --- One-time import from the retired ccez-inbox Worker -------------------

const LegacyMedia = Schema.Struct({
  type: Schema.String,
  r2_key: Schema.String,
  name: Schema.String,
  mime: Schema.String,
  caption: Schema.optionalKey(Schema.String),
});
type LegacyMedia = typeof LegacyMedia.Type;
const LegacyItem = Schema.Struct({
  id: Schema.String,
  project: Schema.String,
  kind: Schema.String,
  title: Schema.String,
  question: Schema.String,
  body_md: Schema.String,
  media: Schema.Array(LegacyMedia),
  options: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      label: Schema.String,
      media_idx: Schema.NullOr(Schema.Number),
    }),
  ),
  priority: Schema.Number,
  created_by: Schema.String,
  thread_url: Schema.NullOr(Schema.String),
  status: Schema.String,
  created_at: Schema.Number,
  updated_at: Schema.Number,
  answered_at: Schema.NullOr(Schema.Number),
});
const LegacyDecision = Schema.Struct({
  choice: Schema.NullOr(Schema.String),
  option_ids: Schema.NullOr(Schema.Array(Schema.String)),
  rank: Schema.NullOr(Schema.Array(Schema.String)),
  comment: Schema.NullOr(Schema.String),
  voice_r2_key: Schema.NullOr(Schema.String),
  decided_at: Schema.Number,
});
const decodeLegacyList = Schema.decodeUnknownEffect(
  Schema.Struct({ items: Schema.Array(LegacyItem) }),
);
const decodeLegacyDetail = Schema.decodeUnknownEffect(
  Schema.Struct({ decision: Schema.NullOr(LegacyDecision) }),
);

const LEGACY_MEDIA_TYPES = new Set(["image", "glb", "audio", "video", "voice", "apk", "file"]);

/** A pitch's old verdicts were approve/reject. */
function legacyChoice(kind: string, choice: string | null): string | null {
  if (kind !== "trend" || choice === null) return choice;
  return choice === "approve" ? "yes" : choice === "reject" ? "never" : choice;
}

const readKeychainToken = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* spawner
    .string(
      ChildProcess.make("security", [
        "find-generic-password",
        "-s",
        "ccez-inbox",
        "-a",
        "agent",
        "-w",
      ]),
    )
    .pipe(
      Effect.map((out) => out.trim()),
      Effect.orElseSucceed(() => ""),
    );
});

const importCommand = Command.make("import", {
  baseDir: baseDirFlag,
  from: Flag.String("from").pipe(Flag.withDefault("https://inbox.ccez.uk")),
  token: Flag.String("token").pipe(
    Flag.withDescription(
      "Agent token; defaults to INBOX_TOKEN, then the ccez-inbox Keychain item.",
    ),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription(
    "Copy every item, answer, and file from the old ccez-inbox Worker into this machine's decisions. Safe to re-run.",
  ),
  Command.withHandler((flags) =>
    withDecisions(flags.baseDir, (decisions) =>
      Effect.gen(function* () {
        const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
        const token = Option.isSome(flags.token)
          ? flags.token.value
          : process.env.INBOX_TOKEN || (yield* readKeychainToken);
        if (!token) return yield* fail("No ccez-inbox token: pass --token or set INBOX_TOKEN.");
        const base = flags.from.replace(/\/+$/, "");
        const getJson = (url: string) =>
          http
            .execute(
              HttpClientRequest.get(`${base}${url}`).pipe(HttpClientRequest.bearerToken(token)),
            )
            .pipe(Effect.flatMap((response) => response.json));
        const getBytes = (key: string) =>
          http
            .execute(
              HttpClientRequest.get(`${base}/api/media/${key}`).pipe(
                HttpClientRequest.bearerToken(token),
              ),
            )
            .pipe(
              Effect.flatMap((response) => response.arrayBuffer),
              Effect.map((buffer) => new Uint8Array(buffer)),
            );
        const copyMedia = (ref: LegacyMedia) =>
          getBytes(ref.r2_key).pipe(
            Effect.flatMap((bytes) =>
              decisions.putMedia(
                {
                  name: ref.name,
                  mime: ref.mime,
                  type: (LEGACY_MEDIA_TYPES.has(ref.type) ? ref.type : "file") as DecisionMediaType,
                  ...(ref.caption ? { caption: ref.caption } : {}),
                },
                bytes,
              ),
            ),
          );

        let imported = 0;
        let skipped = 0;
        for (const status of ["open", "answered", "expired", "withdrawn"]) {
          const listed = yield* getJson(`/api/items?status=${status}&limit=500`).pipe(
            Effect.flatMap(decodeLegacyList),
          );
          for (const legacy of listed.items) {
            const kind = normalizeDecisionKind(legacy.kind);
            if (!kind) {
              skipped += 1;
              continue;
            }
            const existing = yield* decisions.get(legacy.id).pipe(Effect.option);
            if (Option.isSome(existing)) continue;
            const { decision } = yield* getJson(`/api/items/${legacy.id}`).pipe(
              Effect.flatMap(decodeLegacyDetail),
            );
            const media = yield* Effect.forEach(legacy.media, copyMedia);
            const item: DecisionItem = {
              id: legacy.id,
              project: legacy.project,
              kind,
              title: legacy.title,
              question: legacy.question,
              body_md: legacy.body_md,
              media,
              options: legacy.options,
              max_choices: 1,
              steps: [],
              context_media_idx: null,
              priority: legacy.priority,
              created_by: legacy.created_by,
              thread: legacy.thread_url,
              blocking: false,
              default: null,
              expires_at: null,
              cost_note: null,
              resume: null,
              status: isDecisionItemStatus(legacy.status) ? legacy.status : "open",
              created_at: legacy.created_at,
              updated_at: legacy.updated_at,
              answered_at: legacy.answered_at,
            };
            const answer: DecisionAnswer | null = decision
              ? {
                  item_id: legacy.id,
                  choice: legacyChoice(legacy.kind, decision.choice),
                  option_ids: decision.option_ids,
                  rank: decision.rank,
                  comment: decision.comment,
                  voice_key: decision.voice_r2_key
                    ? (yield* copyMedia({
                        type: "voice",
                        r2_key: decision.voice_r2_key,
                        name: "voice-note.webm",
                        mime: "audio/webm",
                      })).key
                    : null,
                  decided_by: "owner",
                  decided_at: decision.decided_at,
                }
              : null;
            if (yield* decisions.importItem(item, answer)) imported += 1;
          }
        }
        yield* Console.log(
          `inbox import: ${imported} imported${skipped ? `, ${skipped} skipped (kinds with no cz equivalent)` : ""}.`,
        );
      }).pipe(Effect.provide(FetchHttpClient.layer)),
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
    importCommand,
  ]),
);
