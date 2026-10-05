/**
 * The decision contract between agents (via the ccez-inbox Worker, `inbox`
 * CLI, and MCP) and the czcode Decisions tab. ccez/DECISIONS.md is the design;
 * the Worker implements the same shapes. Wire names are snake_case to match
 * the Worker's JSON.
 *
 * @module schema
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
export const LEGACY_KIND_MAP = {
  approve: "review",
  freeform: "request",
  build: "playtest",
  trend: "pitch",
} as const satisfies Record<string, DecisionKind>;

/** Reads a stored kind, mapping pre-redesign names. Unknown kinds give null. */
export function normalizeKind(kind: string): DecisionKind | null {
  if (kind in LEGACY_KIND_MAP) return LEGACY_KIND_MAP[kind as keyof typeof LEGACY_KIND_MAP];
  return Schema.is(DecisionKind)(kind) ? kind : null;
}

export const ItemStatus = Schema.Literals(["open", "answered", "expired", "withdrawn"]);
export type ItemStatus = typeof ItemStatus.Type;

export const MediaType = Schema.Literals([
  "image",
  "glb",
  "audio",
  "video",
  "voice",
  "apk",
  "file",
  "text",
]);
export type MediaType = typeof MediaType.Type;

export const MediaRef = Schema.Struct({
  type: MediaType,
  /** Worker-minted object key (`media/...`); fetched through the API, never a URL. */
  r2_key: Schema.String,
  name: Schema.String,
  mime: Schema.String,
  size: Schema.Number,
  caption: Schema.optionalKey(Schema.String),
});
export type MediaRef = typeof MediaRef.Type;

export const ItemOption = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  /** Index into `item.media`, or null for a text-only option. */
  media_idx: Schema.NullOr(Schema.Number),
  /** The agent's recommendation, with its one-line reason. */
  recommended: Schema.optionalKey(Schema.Boolean),
  reason: Schema.optionalKey(Schema.String),
});
export type ItemOption = typeof ItemOption.Type;

/** One step of a genforge production run (Timeline). */
export const TimelineStep = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  media_idx: Schema.NullOr(Schema.Number),
  status: Schema.Literals(["done", "failed", "skipped"]),
});
export type TimelineStep = typeof TimelineStep.Type;

/** How work continues after the answer when the agent has moved on. */
export const ResumePlan = Schema.Struct({
  project: Schema.String,
  prompt: Schema.String,
  thread_id: Schema.optionalKey(Schema.String),
  provider: Schema.optionalKey(Schema.String),
});
export type ResumePlan = typeof ResumePlan.Type;

export const Item = Schema.Struct({
  id: Schema.String,
  project: Schema.String,
  kind: DecisionKind,
  title: Schema.String,
  question: Schema.String,
  body_md: Schema.String,
  media: Schema.Array(MediaRef),
  options: Schema.Array(ItemOption),
  /** Pick: how many options may be chosen (default 1). */
  max_choices: Schema.optionalKey(Schema.Number),
  /** Timeline: the run's steps in order. */
  steps: Schema.optionalKey(Schema.Array(TimelineStep)),
  /** Listen: a clip to play each sound over ("in context"). */
  context_media_idx: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  priority: Schema.Number,
  created_by: Schema.String,
  /** czcode deep link to the thread that asked, or null. */
  thread: Schema.NullOr(Schema.String),
  /** An agent is waiting on this right now. */
  blocking: Schema.Boolean,
  /** Option id taken when `expires_at` passes unanswered. */
  default: Schema.NullOr(Schema.String),
  expires_at: Schema.NullOr(Schema.Number),
  /** What answering yes spends, e.g. "runs Tripo, about $0.40". */
  cost_note: Schema.NullOr(Schema.String),
  resume: Schema.NullOr(ResumePlan),
  status: ItemStatus,
  created_at: Schema.Number,
  updated_at: Schema.Number,
  answered_at: Schema.NullOr(Schema.Number),
});
export type Item = typeof Item.Type;

/** A stroke drawn on a Review image, in 0..1 image coordinates. */
export const Redline = Schema.Struct({
  media_idx: Schema.Number,
  points: Schema.Array(Schema.Tuple([Schema.Number, Schema.Number])),
  note: Schema.optionalKey(Schema.String),
});
export type Redline = typeof Redline.Type;

export const Reaction = Schema.Struct({
  option_id: Schema.String,
  verdict: Schema.NullOr(Schema.Literals(["keep", "kill", "favourite"])),
  note: Schema.optionalKey(Schema.String),
});
export type Reaction = typeof Reaction.Type;

/** A comment on a selected passage of a Read item's body. */
export const PassageComment = Schema.Struct({
  start: Schema.Number,
  end: Schema.Number,
  quote: Schema.String,
  note: Schema.String,
});
export type PassageComment = typeof PassageComment.Type;

export const PlaytestForm = Schema.Struct({
  good: Schema.String,
  bad: Schema.String,
  bugs: Schema.String,
});
export type PlaytestForm = typeof PlaytestForm.Type;

/**
 * The owner's answer. `choice` carries the verdict for kinds that have one
 * (review/look: approve|reject|changes, read: approve|send_back, pitch:
 * yes|later|never, timeline: approve|redo). Each kind fills only its fields.
 */
export const Decision = Schema.Struct({
  item_id: Schema.String,
  choice: Schema.NullOr(Schema.String),
  option_ids: Schema.NullOr(Schema.Array(Schema.String)),
  rank: Schema.NullOr(Schema.Array(Schema.String)),
  reactions: Schema.optionalKey(Schema.Array(Reaction)),
  /** Listen: send the kept sounds back for another round. */
  more_like_these: Schema.optionalKey(Schema.Boolean),
  redlines: Schema.optionalKey(Schema.Array(Redline)),
  passage_comments: Schema.optionalKey(Schema.Array(PassageComment)),
  playtest: Schema.optionalKey(PlaytestForm),
  /** Request: files the owner supplied. */
  uploads: Schema.optionalKey(Schema.Array(MediaRef)),
  /** Timeline: redo from this step. */
  redo_from: Schema.optionalKey(Schema.NullOr(Schema.String)),
  /** "None of these, try again". */
  retry: Schema.optionalKey(Schema.Boolean),
  comment: Schema.NullOr(Schema.String),
  voice_r2_key: Schema.NullOr(Schema.String),
  decided_by: Schema.String,
  decided_at: Schema.Number,
});
export type Decision = typeof Decision.Type;

/** What the client sends; the Worker stamps `item_id`, `decided_by`, `decided_at`. */
export const DecisionInput = Decision.mapFields(
  Struct.omit(["item_id", "decided_by", "decided_at"]),
);
export type DecisionInput = typeof DecisionInput.Type;

export const ItemWithDecision = Schema.Struct({
  item: Item,
  decision: Schema.NullOr(Decision),
});
export type ItemWithDecision = typeof ItemWithDecision.Type;
