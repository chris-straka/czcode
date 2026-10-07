/**
 * What an agent is doing right now, as one short line ("$ vp test run",
 * "editing Sidebar.tsx", "thinking"). The server puts it on the thread shell
 * so a fleet view can show every running agent without loading transcripts;
 * it changes when a new step starts, never per streamed token.
 *
 * @module turnActivity
 */
import type { OrchestrationV2TurnItem } from "@cz/contracts";

export const TURN_ACTIVITY_MAX_CHARS = 100;

const firstLine = (text: string) =>
  text
    .split("\n")
    .find((line) => line.trim() !== "")
    ?.trim() ?? "";

const clip = (text: string) =>
  text.length > TURN_ACTIVITY_MAX_CHARS ? `${text.slice(0, TURN_ACTIVITY_MAX_CHARS - 1)}…` : text;

const baseName = (path: string) => path.split(/[\\/]/).pop() || path;

/** The fields a step's activity reads, so a store can pass them without decoding the item. */
export type TurnActivityInput = Pick<OrchestrationV2TurnItem, "type"> & {
  readonly input?: string | null | undefined;
  readonly fileName?: string | null | undefined;
  readonly pattern?: string | null | undefined;
  readonly title?: string | null | undefined;
};

/** One step's activity, or null for steps that say nothing about the moment (a user message). */
export function turnItemActivity(item: TurnActivityInput): string | null {
  switch (item.type) {
    case "user_message":
      return null;
    case "assistant_message":
      return "writing";
    case "reasoning":
      return "thinking";
    case "proposed_plan":
      return "planning";
    case "command_execution":
      return clip(`$ ${firstLine(item.input ?? "")}`);
    case "file_change":
      return item.fileName ? clip(`editing ${baseName(item.fileName)}`) : "editing";
    case "file_search":
      return clip(item.pattern ? `searching ${item.pattern}` : "searching files");
    case "web_search":
      return "searching the web";
    case "approval_request":
      return "waiting for approval";
    case "user_input_request":
      return "asking a question";
    case "compaction":
      return "compacting context";
    default:
      return item.title ? clip(firstLine(item.title)) : null;
  }
}

/** What the run's latest step (other than a user message) is doing, or null. */
export function runActivity(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  runId: string,
): string | null {
  let latest: OrchestrationV2TurnItem | null = null;
  for (const item of items) {
    if (item.runId !== runId || item.type === "user_message") continue;
    if (latest === null || item.ordinal >= latest.ordinal) latest = item;
  }
  if (latest === null) return null;
  const text = (key: string) => {
    const value = (latest as unknown as Record<string, unknown>)[key];
    return typeof value === "string" ? value : null;
  };
  return turnItemActivity({
    type: latest.type,
    input: text("input"),
    fileName: text("fileName"),
    pattern: text("pattern"),
    title: latest.title,
  });
}
