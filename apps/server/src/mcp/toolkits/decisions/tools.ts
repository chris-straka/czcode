import {
  DecisionClosedError,
  DecisionInvalidError,
  DecisionItem,
  DecisionItemWithAnswer,
  DecisionKind,
  DecisionMediaRef,
  DecisionMediaType,
  DecisionNotFoundError,
  DecisionStorageError,
  DecisionSubmitInput,
  OrchestratorMcpFailure,
} from "@cz/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/ai/Tool";
import * as Toolkit from "effect/ai/Toolkit";

import * as DecisionService from "../../../decisions/DecisionService.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  DecisionService.DecisionService,
];

/** ccez/DECISIONS.md, "When agents should ask", in the words agents read before asking. */
const WHEN_TO_ASK = `Ask the owner only for: a taste call (art, animation, sound, music, story, names, game feel, UI look); anything that spends money or is outward-facing (publishing, deploying, deleting); materially different directions where a wrong guess wastes real work; a finished batch that needs judging; input only the owner has. Don't ask when a sensible default exists for a technical choice (decide and log it in the repo's docs/decisions.md), for status updates (say them in the thread), or when a check could answer it (tests, screenshots). Batch: one listen with 8 sounds, not 8 decisions; keep at most about 5 open decisions per project. Don't block if anything else can be done: submit with blocking=false and a resume plan, then continue or end the thread. Mark your recommended option and give the reason in one line. Read decision_history first to learn the owner's past taste.`;

export class DecisionMediaReadError extends Schema.TaggedError<DecisionMediaReadError>()(
  "DecisionMediaReadError",
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not read ${this.path}.`;
  }
}

export const DecisionToolError = Schema.Union([
  DecisionInvalidError,
  DecisionNotFoundError,
  DecisionClosedError,
  DecisionStorageError,
  DecisionMediaReadError,
  OrchestratorMcpFailure,
]);

const DecisionId = Schema.Struct({
  id: Schema.String.annotate({ description: "The decision id returned by ask_owner." }),
});

const AskOwnerTool = Tool.make("ask_owner", {
  description: `Ask the owner a judgment call with media; it appears in czcode's Decisions tab on their phone and desktop. ${WHEN_TO_ASK} Upload files with upload_decision_media first and pass the returned refs in media; options point at them with media_idx. Kinds: pick (choose one or max_choices), review (approve/reject/changes, redlines on images), listen (sound board: keep/kill/favourite per option), look (3D model), read (long text in body_md, passage comments), playtest (an apk in media), rank (order options), pitch (yes/later/never), request (owner uploads or writes something), timeline (genforge steps with redo-from-here). Returns the item; poll or wait_for_decision for the answer.`,
  parameters: DecisionSubmitInput.mapFields(
    ({ thread: _thread, created_by: _createdBy, ...fields }) => fields,
  ),
  success: DecisionItem,
  failure: DecisionToolError,
  dependencies,
})
  .annotate(Tool.Title, "Ask the owner")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const UploadDecisionMediaTool = Tool.make("upload_decision_media", {
  description:
    "Upload a file from this machine (an image, GLB, sound, video, APK, or text) for a decision. Returns the media ref to put in ask_owner's media list.",
  parameters: Schema.Struct({
    path: Schema.String.annotate({ description: "Absolute path of the file on this machine." }),
    type: DecisionMediaType,
    mime: Schema.String.annotate({ description: "MIME type, e.g. image/png or audio/wav." }),
    caption: Schema.optionalKey(Schema.String),
  }),
  success: DecisionMediaRef,
  failure: DecisionToolError,
  dependencies,
})
  .annotate(Tool.Title, "Upload decision media")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const WaitForDecisionTool = Tool.make("wait_for_decision", {
  description:
    "Wait up to timeout_s seconds (max 300) for the owner to answer, then return the item and answer (answer is null while still open). Only for blocking decisions; otherwise continue other work.",
  parameters: Schema.Struct({
    ...DecisionId.fields,
    timeout_s: Schema.optionalKey(Schema.Number),
  }),
  success: DecisionItemWithAnswer,
  failure: DecisionToolError,
  dependencies,
})
  .annotate(Tool.Title, "Wait for a decision")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const GetDecisionTool = Tool.make("get_decision", {
  description: "Read a decision and its answer (null while open).",
  parameters: DecisionId,
  success: DecisionItemWithAnswer,
  failure: DecisionToolError,
  dependencies,
})
  .annotate(Tool.Title, "Get a decision")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const DecisionHistoryTool = Tool.make("decision_history", {
  description:
    "The owner's past answers, most recent first: their taste history. Read it before proposing, e.g. project=hll kind=listen to see which sounds they kept and killed.",
  parameters: Schema.Struct({
    project: Schema.optionalKey(Schema.String),
    kind: Schema.optionalKey(DecisionKind),
    limit: Schema.optionalKey(Schema.Number),
  }),
  success: Schema.Struct({ items: Schema.Array(DecisionItemWithAnswer) }),
  failure: DecisionToolError,
  dependencies,
})
  .annotate(Tool.Title, "Decision history")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const WithdrawDecisionTool = Tool.make("withdraw_decision", {
  description: "Withdraw an open decision you asked, e.g. when it no longer matters.",
  parameters: DecisionId,
  success: DecisionItem,
  failure: DecisionToolError,
  dependencies,
})
  .annotate(Tool.Title, "Withdraw a decision")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const DecisionsToolkit = Toolkit.make(
  AskOwnerTool,
  UploadDecisionMediaTool,
  WaitForDecisionTool,
  GetDecisionTool,
  DecisionHistoryTool,
  WithdrawDecisionTool,
);
