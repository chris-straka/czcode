/**
 * Listing and stopping threads over HTTP (fork), so `cz thread` can manage
 * runs on this machine or a paired one without a client app.
 *
 * @module threadControl
 */
import * as Schema from "effect/Schema";

export const ThreadControlSummary = Schema.Struct({
  threadId: Schema.String,
  projectId: Schema.String,
  projectTitle: Schema.NullOr(Schema.String),
  title: Schema.String,
  /** instance/model, like claudeAgent/claude-opus-5-5. */
  model: Schema.String,
  running: Schema.Boolean,
  /**
   * Running, about to start a turn, or still running background tasks: a
   * server restart would cut it off. Absent from older servers.
   */
  busy: Schema.optional(Schema.Boolean),
  archived: Schema.Boolean,
  updatedAt: Schema.String,
});
export type ThreadControlSummary = typeof ThreadControlSummary.Type;

export const ThreadControlListResult = Schema.Struct({
  threads: Schema.Array(ThreadControlSummary),
});
export type ThreadControlListResult = typeof ThreadControlListResult.Type;

export const ThreadStopInput = Schema.Struct({
  threadId: Schema.String,
});
export type ThreadStopInput = typeof ThreadStopInput.Type;

export const ThreadStopResult = Schema.Struct({
  /** "stopping" when a run was asked to stop, "idle" when nothing was running. */
  status: Schema.Literals(["stopping", "idle"]),
});
export type ThreadStopResult = typeof ThreadStopResult.Type;

export class ThreadControlNotFoundError extends Schema.TaggedError<ThreadControlNotFoundError>()(
  "ThreadControlNotFoundError",
  { message: Schema.String },
  { httpApiStatus: 404 },
) {}

/** At most this many threads per digest request; the feed asks for visible cards. */
export const THREAD_DIGEST_MAX_THREADS = 100;

export const ThreadDigestInput = Schema.Struct({
  threadIds: Schema.Array(Schema.String).check(Schema.isMaxLength(THREAD_DIGEST_MAX_THREADS)),
});
export type ThreadDigestInput = typeof ThreadDigestInput.Type;

/**
 * What a feed card shows for a thread beyond its shell: the latest result
 * and the folder it worked in. Kept out of shells, which stay free of
 * message bodies so they hydrate and stream cheaply.
 */
export const ThreadDigest = Schema.Struct({
  threadId: Schema.String,
  /** The start of the latest finished agent message, as plain text. */
  excerpt: Schema.NullOr(Schema.String),
  /**
   * The folder under the project root the thread worked in, like
   * "games/hll", when that isn't the project itself.
   */
  workingSubpath: Schema.NullOr(Schema.String),
});
export type ThreadDigest = typeof ThreadDigest.Type;

export const ThreadDigestResult = Schema.Struct({ digests: Schema.Array(ThreadDigest) });
export type ThreadDigestResult = typeof ThreadDigestResult.Type;
