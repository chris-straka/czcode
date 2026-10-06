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
