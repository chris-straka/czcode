/**
 * Decisions: judgment calls with media that agents ask the owner, stored by
 * the cz server next to its threads. ccez/DECISIONS.md is the design. Wire
 * names are snake_case, matching the inbox items imported from ccez-inbox.
 *
 * @module decisions
 */
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

/** The ten decision types, each with its own full-screen view. */
export const DecisionKind = Schema.Literals([
  "pick",
  "review",
  "listen",
  "look",
  "read",
  "playtest",
  "rank",
  "pitch",
  "request",
  "timeline",
]);
export type DecisionKind = typeof DecisionKind.Type;

/** Kinds stored before the Decisions redesign, and what each became. */
const LEGACY_DECISION_KIND_MAP = {
  approve: "review",
  freeform: "request",
  build: "playtest",
  trend: "pitch",
} as const satisfies Record<string, DecisionKind>;

const isDecisionKind = Schema.is(DecisionKind);

/** Reads a stored kind, mapping pre-redesign names. Unknown kinds give null. */
export function normalizeDecisionKind(kind: string): DecisionKind | null {
  if (Object.hasOwn(LEGACY_DECISION_KIND_MAP, kind)) {
    return LEGACY_DECISION_KIND_MAP[kind as keyof typeof LEGACY_DECISION_KIND_MAP];
  }
  return isDecisionKind(kind) ? kind : null;
}

export const DecisionItemStatus = Schema.Literals(["open", "answered", "expired", "withdrawn"]);
export type DecisionItemStatus = typeof DecisionItemStatus.Type;

export const DecisionMediaType = Schema.Literals([
  "image",
  "glb",
  "audio",
  "video",
  "voice",
  "apk",
  "file",
  "text",
]);
export type DecisionMediaType = typeof DecisionMediaType.Type;

export const DecisionMediaRef = Schema.Struct({
  type: DecisionMediaType,
  /** Server storage key from an upload. Never a URL. */
  key: Schema.String,
  name: Schema.String,
  mime: Schema.String,
  size: Schema.Number,
  caption: Schema.optionalKey(Schema.String),
  /** Short-lived signed URL, filled in by the server when it returns an item. */
  url: Schema.optionalKey(Schema.String),
});
export type DecisionMediaRef = typeof DecisionMediaRef.Type;

export const DecisionOption = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  /** Index into `item.media`, or null for a text-only option. */
  media_idx: Schema.NullOr(Schema.Number),
  /** The agent's recommendation, with its one-line reason. */
  recommended: Schema.optionalKey(Schema.Boolean),
  reason: Schema.optionalKey(Schema.String),
});
export type DecisionOption = typeof DecisionOption.Type;

/** One step of a genforge production run (Timeline). */
export const DecisionTimelineStep = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  media_idx: Schema.NullOr(Schema.Number),
  status: Schema.Literals(["done", "failed", "skipped"]),
});
export type DecisionTimelineStep = typeof DecisionTimelineStep.Type;

/** How work continues after the answer when the asking agent has moved on. */
export const DecisionResumePlan = Schema.Struct({
  project: Schema.String,
  prompt: Schema.String,
  thread_id: Schema.optionalKey(Schema.String),
  provider: Schema.optionalKey(Schema.String),
});
export type DecisionResumePlan = typeof DecisionResumePlan.Type;

/** What an agent sends to ask. The server stamps id, status, and times. */
export const DecisionSubmitInput = Schema.Struct({
  project: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(120)),
  kind: DecisionKind,
  title: Schema.String.check(Schema.isMaxLength(200)),
  question: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(500)),
  body_md: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(100_000))),
  media: Schema.optionalKey(Schema.Array(DecisionMediaRef)),
  options: Schema.optionalKey(Schema.Array(DecisionOption)),
  /** Pick: how many options may be chosen (default 1). */
  max_choices: Schema.optionalKey(Schema.Number),
  /** Timeline: the run's steps in order. */
  steps: Schema.optionalKey(Schema.Array(DecisionTimelineStep)),
  /** Listen: a clip to play each sound over ("in context"). */
  context_media_idx: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  priority: Schema.optionalKey(Schema.Number),
  created_by: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200))),
  /** czcode deep link to the thread that asked. */
  thread: Schema.optionalKey(Schema.NullOr(Schema.String)),
  /** An agent is waiting on this right now. */
  blocking: Schema.optionalKey(Schema.Boolean),
  /** Option id taken when `expires_at` passes unanswered. */
  default: Schema.optionalKey(Schema.NullOr(Schema.String)),
  /** Unix epoch ms. */
  expires_at: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  /** What answering yes spends, e.g. "runs Tripo, about $0.40". */
  cost_note: Schema.optionalKey(Schema.NullOr(Schema.String)),
  resume: Schema.optionalKey(Schema.NullOr(DecisionResumePlan)),
});
export type DecisionSubmitInput = typeof DecisionSubmitInput.Type;

export const DecisionItem = Schema.Struct({
  id: Schema.String,
  project: Schema.String,
  kind: DecisionKind,
  title: Schema.String,
  question: Schema.String,
  body_md: Schema.String,
  media: Schema.Array(DecisionMediaRef),
  options: Schema.Array(DecisionOption),
  max_choices: Schema.Number,
  steps: Schema.Array(DecisionTimelineStep),
  context_media_idx: Schema.NullOr(Schema.Number),
  priority: Schema.Number,
  created_by: Schema.String,
  thread: Schema.NullOr(Schema.String),
  blocking: Schema.Boolean,
  default: Schema.NullOr(Schema.String),
  expires_at: Schema.NullOr(Schema.Number),
  cost_note: Schema.NullOr(Schema.String),
  resume: Schema.NullOr(DecisionResumePlan),
  status: DecisionItemStatus,
  created_at: Schema.Number,
  updated_at: Schema.Number,
  answered_at: Schema.NullOr(Schema.Number),
});
export type DecisionItem = typeof DecisionItem.Type;

/** A stroke drawn on a Review image, in 0..1 image coordinates. */
export const DecisionRedline = Schema.Struct({
  media_idx: Schema.Number,
  points: Schema.Array(Schema.Tuple([Schema.Number, Schema.Number])),
  note: Schema.optionalKey(Schema.String),
});
export type DecisionRedline = typeof DecisionRedline.Type;

export const DecisionReaction = Schema.Struct({
  option_id: Schema.String,
  verdict: Schema.NullOr(Schema.Literals(["keep", "kill", "favourite"])),
  note: Schema.optionalKey(Schema.String),
});
export type DecisionReaction = typeof DecisionReaction.Type;

/** A comment on a selected passage of a Read item's body. */
export const DecisionPassageComment = Schema.Struct({
  start: Schema.Number,
  end: Schema.Number,
  quote: Schema.String,
  note: Schema.String,
});
export type DecisionPassageComment = typeof DecisionPassageComment.Type;

export const DecisionPlaytestForm = Schema.Struct({
  good: Schema.String,
  bad: Schema.String,
  bugs: Schema.String,
});
export type DecisionPlaytestForm = typeof DecisionPlaytestForm.Type;

/**
 * The owner's answer. `choice` carries the verdict for kinds that have one
 * (review/look: approve|reject|changes, read: approve|send_back, pitch:
 * yes|later|never, timeline: approve|redo). Each kind fills only its fields.
 */
export const DecisionAnswer = Schema.Struct({
  item_id: Schema.String,
  choice: Schema.NullOr(Schema.String),
  option_ids: Schema.NullOr(Schema.Array(Schema.String)),
  rank: Schema.NullOr(Schema.Array(Schema.String)),
  reactions: Schema.optionalKey(Schema.Array(DecisionReaction)),
  /** Listen: send the kept sounds back for another round. */
  more_like_these: Schema.optionalKey(Schema.Boolean),
  redlines: Schema.optionalKey(Schema.Array(DecisionRedline)),
  passage_comments: Schema.optionalKey(Schema.Array(DecisionPassageComment)),
  playtest: Schema.optionalKey(DecisionPlaytestForm),
  /** Request: files the owner supplied. */
  uploads: Schema.optionalKey(Schema.Array(DecisionMediaRef)),
  /** Timeline: redo from this step. */
  redo_from: Schema.optionalKey(Schema.NullOr(Schema.String)),
  /** "None of these, try again". */
  retry: Schema.optionalKey(Schema.Boolean),
  comment: Schema.NullOr(Schema.String),
  /** Media key of a recorded voice note. */
  voice_key: Schema.NullOr(Schema.String),
  /** "owner", or "default" when `expires_at` passed and the default was taken. */
  decided_by: Schema.String,
  decided_at: Schema.Number,
});
export type DecisionAnswer = typeof DecisionAnswer.Type;

/** What a client sends; the server stamps `item_id`, `decided_by`, `decided_at`. */
export const DecisionAnswerInput = DecisionAnswer.mapFields(
  Struct.omit(["item_id", "decided_by", "decided_at"]),
);
export type DecisionAnswerInput = typeof DecisionAnswerInput.Type;

export const DecisionItemWithAnswer = Schema.Struct({
  item: DecisionItem,
  answer: Schema.NullOr(DecisionAnswer),
});
export type DecisionItemWithAnswer = typeof DecisionItemWithAnswer.Type;

export const DecisionListQuery = Schema.Struct({
  /** "open" (default), a single status, or "all". */
  status: Schema.optionalKey(Schema.Union([DecisionItemStatus, Schema.Literal("all")])),
  project: Schema.optionalKey(Schema.String),
  kind: Schema.optionalKey(DecisionKind),
  limit: Schema.optionalKey(Schema.NumberFromString),
});
export type DecisionListQuery = typeof DecisionListQuery.Type;

export const DecisionListResult = Schema.Struct({
  items: Schema.Array(DecisionItemWithAnswer),
});
export type DecisionListResult = typeof DecisionListResult.Type;

export const DecisionWaitQuery = Schema.Struct({
  /** Seconds to hold the request open before returning the item as it is. */
  timeout_s: Schema.optionalKey(Schema.NumberFromString),
});
export type DecisionWaitQuery = typeof DecisionWaitQuery.Type;

export const DecisionMediaUploadQuery = Schema.Struct({
  name: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(255)),
  mime: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(255)),
  type: DecisionMediaType,
  caption: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200))),
});
export type DecisionMediaUploadQuery = typeof DecisionMediaUploadQuery.Type;

/** Per-item and upload limits, shared by the server and clients. */
export const DECISION_LIMITS = {
  maxMedia: 24,
  maxOptions: 24,
  maxUploadBytes: 200 * 1024 * 1024,
  maxCommentLength: 20_000,
  maxWaitSeconds: 300,
} as const;

export class DecisionNotFoundError extends Schema.TaggedError<DecisionNotFoundError>()(
  "DecisionNotFoundError",
  { id: Schema.String },
  { httpApiStatus: 404 },
) {
  override get message(): string {
    return `No decision ${this.id}.`;
  }
}

export class DecisionInvalidError extends Schema.TaggedError<DecisionInvalidError>()(
  "DecisionInvalidError",
  { reason: Schema.String },
  { httpApiStatus: 400 },
) {
  override get message(): string {
    return this.reason;
  }
}

/** The item is no longer open (answered, withdrawn, or expired). */
export class DecisionClosedError extends Schema.TaggedError<DecisionClosedError>()(
  "DecisionClosedError",
  { id: Schema.String, status: DecisionItemStatus },
  { httpApiStatus: 409 },
) {
  override get message(): string {
    return `Decision ${this.id} is ${this.status}.`;
  }
}

export class DecisionStorageError extends Schema.TaggedError<DecisionStorageError>()(
  "DecisionStorageError",
  { operation: Schema.String, cause: Schema.Defect() },
  { httpApiStatus: 500 },
) {
  override get message(): string {
    return `Decision storage failed (${this.operation}).`;
  }
}
