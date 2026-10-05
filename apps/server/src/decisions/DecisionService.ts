/**
 * DecisionService - the decisions agents ask the owner (ccez/DECISIONS.md).
 *
 * Items and answers live in the fork database (`cz.sqlite`), uploaded media
 * in a `decisions-media/` folder under the state dir. Transports (HTTP, MCP, the `cz inbox` CLI) call these methods only.
 *
 * @module DecisionService
 */
import {
  DECISION_LIMITS,
  DecisionAnswer,
  type DecisionAnswerInput,
  DecisionClosedError,
  DecisionInvalidError,
  DecisionItem,
  type DecisionItemWithAnswer,
  type DecisionKind,
  type DecisionListQuery,
  type DecisionMediaRef,
  type DecisionMediaUploadQuery,
  DecisionNotFoundError,
  DecisionStorageError,
  type DecisionSubmitInput,
} from "@cz/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import * as ForkDatabase from "../forkDatabase/ForkDatabase.ts";

/** Verdicts each kind accepts in `choice`. */
const VERDICTS: Partial<Record<DecisionKind, readonly string[]>> = {
  review: ["approve", "reject", "changes"],
  look: ["approve", "reject", "changes"],
  read: ["approve", "send_back"],
  pitch: ["yes", "later", "never"],
  timeline: ["approve", "redo"],
};

const EXPIRY_SWEEP_INTERVAL = Duration.seconds(30);
const MEDIA_KEY = /^[0-9a-f-]{36}(\.[a-z0-9]{1,10})?$/;

export class DecisionService extends Context.Service<
  DecisionService,
  {
    readonly submit: (
      input: DecisionSubmitInput,
    ) => Effect.Effect<DecisionItem, DecisionInvalidError | DecisionStorageError>;
    /** Newest first. Status defaults to open. */
    readonly list: (
      query: DecisionListQuery,
    ) => Effect.Effect<ReadonlyArray<DecisionItemWithAnswer>, DecisionStorageError>;
    /** Answered items, most recently answered first: the owner's taste history. */
    readonly history: (
      query: DecisionListQuery,
    ) => Effect.Effect<ReadonlyArray<DecisionItemWithAnswer>, DecisionStorageError>;
    readonly get: (
      id: string,
    ) => Effect.Effect<DecisionItemWithAnswer, DecisionNotFoundError | DecisionStorageError>;
    readonly answer: (
      id: string,
      input: DecisionAnswerInput,
    ) => Effect.Effect<
      DecisionAnswer,
      DecisionNotFoundError | DecisionInvalidError | DecisionClosedError | DecisionStorageError
    >;
    readonly withdraw: (
      id: string,
    ) => Effect.Effect<
      DecisionItem,
      DecisionNotFoundError | DecisionClosedError | DecisionStorageError
    >;
    /** Returns once the item leaves `open`, or as it is when `timeout` passes. */
    readonly wait: (
      id: string,
      timeout: Duration.Duration,
    ) => Effect.Effect<DecisionItemWithAnswer, DecisionNotFoundError | DecisionStorageError>;
    readonly putMedia: (
      meta: DecisionMediaUploadQuery,
      bytes: Uint8Array,
    ) => Effect.Effect<DecisionMediaRef, DecisionInvalidError | DecisionStorageError>;
    /** Absolute path of an uploaded file, if the key exists. */
    readonly mediaPath: (key: string) => Effect.Effect<Option.Option<string>>;
    /** Applies defaults to (or expires) open items past `expires_at`. Returns how many. */
    readonly expireDue: Effect.Effect<number, DecisionStorageError>;
    /** Inserts an item (and answer) as-is, keeping its id and times. Skips ids already present. */
    readonly importItem: (
      item: DecisionItem,
      answer: DecisionAnswer | null,
    ) => Effect.Effect<boolean, DecisionStorageError>;
  }
>()("cz/decisions/DecisionService") {}

const ItemJson = Schema.fromJsonString(DecisionItem);
const AnswerJson = Schema.fromJsonString(DecisionAnswer);
const decodeItemJson = Schema.decodeEffect(ItemJson);
const decodeAnswerJson = Schema.decodeEffect(AnswerJson);
const encodeItemJson = Schema.encodeEffect(ItemJson);
const encodeAnswerJson = Schema.encodeEffect(AnswerJson);

function invalid(reason: string) {
  return new DecisionInvalidError({ reason });
}

/** Checks a submission against its own media and options. Returns a reason, or null. */
function submissionProblem(input: DecisionSubmitInput): string | null {
  const media = input.media ?? [];
  const options = input.options ?? [];
  if (media.length > DECISION_LIMITS.maxMedia) return `At most ${DECISION_LIMITS.maxMedia} media.`;
  if (options.length > DECISION_LIMITS.maxOptions) {
    return `At most ${DECISION_LIMITS.maxOptions} options.`;
  }
  if (new Set(options.map((option) => option.id)).size !== options.length) {
    return "Option ids must be unique.";
  }
  const inMedia = (idx: number | null | undefined) =>
    idx === null || idx === undefined || (Number.isInteger(idx) && idx >= 0 && idx < media.length);
  if (!options.every((option) => inMedia(option.media_idx))) {
    return "An option points past the media list.";
  }
  if (!(input.steps ?? []).every((step) => inMedia(step.media_idx))) {
    return "A timeline step points past the media list.";
  }
  if (!inMedia(input.context_media_idx)) return "context_media_idx points past the media list.";
  if ((input.kind === "pick" || input.kind === "rank") && options.length < 2) {
    return `A ${input.kind} needs at least two options.`;
  }
  if (input.kind === "listen" && options.length === 0) return "A listen needs options to play.";
  if (input.kind === "timeline" && (input.steps ?? []).length === 0) {
    return "A timeline needs steps.";
  }
  const maxChoices = input.max_choices ?? 1;
  if (!Number.isInteger(maxChoices) || maxChoices < 1) return "max_choices must be at least 1.";
  if (input.default !== undefined && input.default !== null) {
    const verdicts = VERDICTS[input.kind] ?? [];
    const known = options.some((option) => option.id === input.default);
    if (!known && !verdicts.includes(input.default)) {
      return "default must be an option id or one of this kind's verdicts.";
    }
  }
  if (input.expires_at && input.default == null && input.blocking) {
    return "A blocking item that expires needs a default.";
  }
  return null;
}

/** Checks an answer against its item. Returns a reason, or null. */
function answerProblem(item: DecisionItem, input: DecisionAnswerInput): string | null {
  if ((input.comment?.length ?? 0) > DECISION_LIMITS.maxCommentLength) return "Comment too long.";
  if (input.retry) return null;
  const optionIds = new Set(item.options.map((option) => option.id));
  const hasNote = Boolean(input.comment?.trim() || input.voice_key);
  const verdicts = VERDICTS[item.kind];
  if (verdicts) {
    if (!input.choice || !verdicts.includes(input.choice)) {
      return `Choose one of: ${verdicts.join(", ")}.`;
    }
    if (item.kind === "timeline" && input.choice === "redo") {
      const steps = new Set(item.steps.map((step) => step.id));
      if (!input.redo_from || !steps.has(input.redo_from)) return "Pick the step to redo from.";
    }
    return null;
  }
  switch (item.kind) {
    case "pick": {
      const chosen = input.option_ids ?? [];
      if (chosen.length === 0) return "Pick at least one option.";
      if (chosen.length > item.max_choices) return `Pick at most ${item.max_choices}.`;
      if (!chosen.every((id) => optionIds.has(id))) return "Unknown option.";
      return null;
    }
    case "rank": {
      const rank = input.rank ?? [];
      const complete =
        rank.length === optionIds.size &&
        new Set(rank).size === rank.length &&
        rank.every((id) => optionIds.has(id));
      return complete ? null : "Rank every option exactly once.";
    }
    case "listen": {
      const reactions = input.reactions ?? [];
      if (!reactions.every((reaction) => optionIds.has(reaction.option_id))) {
        return "Unknown option.";
      }
      return reactions.length > 0 || input.more_like_these || hasNote
        ? null
        : "React to at least one sound, or leave a note.";
    }
    case "request":
      return (input.uploads?.length ?? 0) > 0 || hasNote
        ? null
        : "Add a file, text, or a voice note.";
    case "playtest":
      return input.playtest || hasNote ? null : "Fill in the form or leave a note.";
    default:
      return null;
  }
}

/** The answer recorded when an item expires with a default. */
function defaultAnswer(item: DecisionItem, now: number): DecisionAnswer {
  const isOption = item.options.some((option) => option.id === item.default);
  return {
    item_id: item.id,
    choice: isOption && item.kind === "pick" ? null : item.default,
    option_ids: isOption ? [item.default as string] : null,
    rank: null,
    comment: null,
    voice_key: null,
    decided_by: "default",
    decided_at: now,
  };
}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;

  const mediaDir = path.join(config.stateDir, "decisions-media");
  yield* fs.makeDirectory(mediaDir, { recursive: true });

  const { sql } = yield* ForkDatabase.ForkDatabase;

  const changes = yield* PubSub.unbounded<string>();
  const storage = (operation: string) =>
    Effect.mapError((cause: unknown) => new DecisionStorageError({ operation, cause }));

  interface Row {
    readonly item_json: string;
    readonly answer_json: string | null;
  }
  const readRow = (row: Row) =>
    Effect.all({
      item: decodeItemJson(row.item_json),
      answer: row.answer_json === null ? Effect.succeed(null) : decodeAnswerJson(row.answer_json),
    });

  const selectRows = (
    where: ReturnType<typeof sql.and>,
    order: "created" | "answered",
    limit: number,
  ) => sql<Row>`
      SELECT item_json, answer_json FROM decision_items
      WHERE ${where}
      ORDER BY ${order === "created" ? sql`created_at DESC` : sql`answered_at DESC`}
      LIMIT ${limit}
    `;

  const filters = (query: DecisionListQuery, status: string | null) =>
    sql.and([
      ...(status ? [sql`status = ${status}`] : []),
      ...(query.project ? [sql`project = ${query.project}`] : []),
      ...(query.kind ? [sql`kind = ${query.kind}`] : []),
    ]);

  const list: DecisionService["Service"]["list"] = (query) => {
    const status = query.status === "all" ? null : (query.status ?? "open");
    return selectRows(filters(query, status), "created", Math.min(query.limit ?? 200, 1000)).pipe(
      Effect.flatMap(Effect.forEach(readRow)),
      storage("list"),
    );
  };

  const history: DecisionService["Service"]["history"] = (query) =>
    selectRows(filters(query, "answered"), "answered", Math.min(query.limit ?? 50, 500)).pipe(
      Effect.flatMap(Effect.forEach(readRow)),
      storage("history"),
    );

  const get: DecisionService["Service"]["get"] = Effect.fn("DecisionService.get")(function* (id) {
    const rows = yield* selectRows(sql.and([sql`id = ${id}`]), "created", 1).pipe(storage("get"));
    const row = rows[0];
    if (!row) return yield* new DecisionNotFoundError({ id });
    return yield* readRow(row).pipe(storage("get"));
  });

  /** Writes the item (and answer) documents and their index columns. */
  const writeItem = (item: DecisionItem, answer: DecisionAnswer | null) =>
    Effect.gen(function* () {
      const stored = { ...item, media: item.media.map(({ url: _url, ...ref }) => ref) };
      const itemJson = yield* encodeItemJson(stored);
      const answerJson = answer === null ? null : yield* encodeAnswerJson(answer);
      yield* sql`
        INSERT INTO decision_items ${sql.insert({
          id: item.id,
          project: item.project,
          kind: item.kind,
          status: item.status,
          created_at: item.created_at,
          answered_at: item.answered_at,
          expires_at: item.expires_at,
          item_json: itemJson,
          answer_json: answerJson,
        })}
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          answered_at = excluded.answered_at,
          item_json = excluded.item_json,
          answer_json = excluded.answer_json
      `;
    });

  const mediaPath: DecisionService["Service"]["mediaPath"] = (key) =>
    MEDIA_KEY.test(key)
      ? fs.exists(path.join(mediaDir, key)).pipe(
          Effect.orElseSucceed(() => false),
          Effect.map((exists) => (exists ? Option.some(path.join(mediaDir, key)) : Option.none())),
        )
      : Effect.succeed(Option.none());

  const submit: DecisionService["Service"]["submit"] = Effect.fn("DecisionService.submit")(
    function* (input) {
      const problem = submissionProblem(input);
      if (problem) return yield* invalid(problem);
      for (const ref of input.media ?? []) {
        if (Option.isNone(yield* mediaPath(ref.key))) {
          return yield* invalid(`Media ${ref.key} was not uploaded here.`);
        }
      }
      const now = yield* Clock.currentTimeMillis;
      const id = yield* crypto.randomUUIDv4.pipe(storage("submit"));
      const item: DecisionItem = {
        id,
        project: input.project,
        kind: input.kind,
        title: input.title || input.question,
        question: input.question,
        body_md: input.body_md ?? "",
        media: input.media ?? [],
        options: input.options ?? [],
        max_choices: input.max_choices ?? 1,
        steps: input.steps ?? [],
        context_media_idx: input.context_media_idx ?? null,
        priority: input.priority ?? 0,
        created_by: input.created_by ?? "agent",
        thread: input.thread ?? null,
        blocking: input.blocking ?? false,
        default: input.default ?? null,
        expires_at: input.expires_at ?? null,
        cost_note: input.cost_note ?? null,
        resume: input.resume ?? null,
        status: "open",
        created_at: now,
        updated_at: now,
        answered_at: null,
      };
      yield* writeItem(item, null).pipe(storage("submit"));
      yield* PubSub.publish(changes, id);
      return item;
    },
  );

  /**
   * Moves an open item to `status` (with an answer when answered). Returns
   * false when it was no longer open, so a concurrent answer can't be lost.
   */
  const close = (
    id: string,
    status: "answered" | "withdrawn" | "expired",
    answer: DecisionAnswer | null,
    now: number,
  ) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const rows = yield* sql<Row>`
            SELECT item_json, answer_json FROM decision_items WHERE id = ${id} AND status = 'open'
          `;
          const row = rows[0];
          if (!row) return false;
          const { item } = yield* readRow(row);
          yield* writeItem({ ...item, status, answered_at: now, updated_at: now }, answer);
          return true;
        }),
      )
      .pipe(
        storage(status),
        Effect.tap((closed) => (closed ? PubSub.publish(changes, id) : Effect.void)),
      );

  const answer: DecisionService["Service"]["answer"] = Effect.fn("DecisionService.answer")(
    function* (id, input) {
      const { item } = yield* get(id);
      if (item.status !== "open") {
        return yield* new DecisionClosedError({ id, status: item.status });
      }
      const problem = answerProblem(item, input);
      if (problem) return yield* invalid(problem);
      const now = yield* Clock.currentTimeMillis;
      const recorded: DecisionAnswer = {
        ...input,
        item_id: id,
        decided_by: "owner",
        decided_at: now,
      };
      if (!(yield* close(id, "answered", recorded, now))) {
        const latest = yield* get(id);
        return yield* new DecisionClosedError({ id, status: latest.item.status });
      }
      return recorded;
    },
  );

  const withdraw: DecisionService["Service"]["withdraw"] = Effect.fn("DecisionService.withdraw")(
    function* (id) {
      const { item } = yield* get(id);
      if (item.status !== "open") {
        return yield* new DecisionClosedError({ id, status: item.status });
      }
      yield* close(id, "withdrawn", null, yield* Clock.currentTimeMillis);
      return (yield* get(id)).item;
    },
  );

  const wait: DecisionService["Service"]["wait"] = (id, timeout) =>
    Effect.scoped(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(changes);
        const current = yield* get(id);
        if (current.item.status !== "open") return current;
        const changed = Effect.gen(function* () {
          while ((yield* PubSub.take(subscription)) !== id) {
            // Another item changed; keep listening.
          }
        });
        yield* Effect.timeoutOption(changed, timeout);
        return yield* get(id);
      }),
    );

  const putMedia: DecisionService["Service"]["putMedia"] = Effect.fn("DecisionService.putMedia")(
    function* (meta, bytes) {
      if (bytes.byteLength > DECISION_LIMITS.maxUploadBytes) {
        return yield* invalid("File is too large.");
      }
      const ext = /\.([a-z0-9]{1,10})$/i.exec(meta.name)?.[1]?.toLowerCase();
      const key = `${yield* crypto.randomUUIDv4.pipe(storage("upload"))}${ext ? `.${ext}` : ""}`;
      yield* fs.writeFile(path.join(mediaDir, key), bytes).pipe(storage("upload"));
      return {
        type: meta.type,
        key,
        name: meta.name,
        mime: meta.mime,
        size: bytes.byteLength,
        ...(meta.caption ? { caption: meta.caption } : {}),
      } satisfies DecisionMediaRef;
    },
  );

  const expireDue: DecisionService["Service"]["expireDue"] = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const rows = yield* sql<Row>`
      SELECT item_json, answer_json FROM decision_items
      WHERE status = 'open' AND expires_at IS NOT NULL AND expires_at <= ${now}
    `.pipe(storage("expire"));
    for (const row of rows) {
      const { item } = yield* readRow(row).pipe(storage("expire"));
      yield* item.default === null
        ? close(item.id, "expired", null, now)
        : close(item.id, "answered", defaultAnswer(item, now), now);
    }
    return rows.length;
  });

  const importItem: DecisionService["Service"]["importItem"] = (item, answer) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const existing = yield* sql`SELECT id FROM decision_items WHERE id = ${item.id}`;
          if (existing.length > 0) return false;
          yield* writeItem(item, answer);
          return true;
        }),
      )
      .pipe(storage("import"));

  yield* Effect.forkScoped(
    Effect.forever(
      Effect.sleep(EXPIRY_SWEEP_INTERVAL).pipe(
        Effect.andThen(expireDue),
        Effect.catch((error) => Effect.logWarning("Decision expiry sweep failed.", error)),
      ),
    ),
  );

  return DecisionService.of({
    submit,
    list,
    history,
    get,
    answer,
    withdraw,
    wait,
    putMedia,
    mediaPath,
    expireDue,
    importItem,
  });
});

export const layer = Layer.effect(DecisionService, make);
