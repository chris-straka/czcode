/**
 * The reset queue: runs that wait for a provider's next quota reset, then
 * start as ordinary threads (ccez/DECISIONS.md, "Reset queue"; replaces
 * nightshift).
 *
 * @module resetQueue
 */
import * as Schema from "effect/Schema";

import { ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import { OrchestrationV2ThreadLaunchWorkspaceStrategy } from "./orchestrationV2.ts";
import { ProviderInteractionMode, RuntimeMode } from "./providerPolicy.ts";

export const QueuedRunStatus = Schema.Literals(["queued", "started", "failed", "cancelled"]);
export type QueuedRunStatus = typeof QueuedRunStatus.Type;

/** Where a queued run came from. */
export const QueuedRunSource = Schema.Literals(["composer", "pitch", "resume", "cli"]);
export type QueuedRunSource = typeof QueuedRunSource.Type;

/**
 * When a run starts: at the provider's next reset (the default), or now when
 * its quota isn't spent (resume threads; the owner is waiting on those).
 */
export const QueuedRunStart = Schema.Literals(["reset", "when-available"]);
export type QueuedRunStart = typeof QueuedRunStart.Type;

export const QueuedRunInput = Schema.Struct({
  title: TrimmedNonEmptyString,
  prompt: TrimmedNonEmptyString,
  projectId: ProjectId,
  modelSelection: ModelSelection,
  runtimeMode: Schema.optionalKey(RuntimeMode),
  interactionMode: Schema.optionalKey(ProviderInteractionMode),
  workspaceStrategy: Schema.optionalKey(OrchestrationV2ThreadLaunchWorkspaceStrategy),
  /** Unix epoch ms. Omitted: decided by `start`. */
  dueAt: Schema.optionalKey(Schema.Number),
  start: Schema.optionalKey(QueuedRunStart),
  source: Schema.optionalKey(QueuedRunSource),
  /** The decision this run follows up (a resume or an approved pitch). */
  decisionId: Schema.optionalKey(Schema.String),
});
export type QueuedRunInput = typeof QueuedRunInput.Type;

export const QueuedRun = Schema.Struct({
  id: Schema.String,
  title: TrimmedNonEmptyString,
  prompt: TrimmedNonEmptyString,
  projectId: ProjectId,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  workspaceStrategy: OrchestrationV2ThreadLaunchWorkspaceStrategy,
  dueAt: Schema.Number,
  /** Why it starts then: a provider reset, a time the owner chose, or quota to spare. */
  dueReason: Schema.Literals(["reset", "chosen", "unknown-reset", "available"]),
  source: QueuedRunSource,
  decisionId: Schema.optionalKey(Schema.String),
  status: QueuedRunStatus,
  createdAt: Schema.Number,
  startedAt: Schema.NullOr(Schema.Number),
  threadId: Schema.NullOr(ThreadId),
  error: Schema.NullOr(Schema.String),
});
export type QueuedRun = typeof QueuedRun.Type;

export const QueuedRunListResult = Schema.Struct({ runs: Schema.Array(QueuedRun) });
export type QueuedRunListResult = typeof QueuedRunListResult.Type;

export class QueuedRunNotFoundError extends Schema.TaggedError<QueuedRunNotFoundError>()(
  "QueuedRunNotFoundError",
  { id: Schema.String },
  { httpApiStatus: 404 },
) {
  override get message(): string {
    return `No queued run ${this.id}.`;
  }
}

export class QueuedRunError extends Schema.TaggedError<QueuedRunError>()(
  "QueuedRunError",
  { reason: Schema.String, cause: Schema.optionalKey(Schema.Defect()) },
  { httpApiStatus: 500 },
) {
  override get message(): string {
    return this.reason;
  }
}
