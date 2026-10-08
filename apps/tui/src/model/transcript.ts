/**
 * A thread's turn items as terminal lines: messages in full, tools as one
 * summary line each, so a long run stays readable in a 60-column float.
 *
 * @module transcript
 */
import type { OrchestrationV2ProjectedTurnItem, OrchestrationV2TurnItem } from "@cz/contracts";

export type LineTone = "user" | "assistant" | "tool" | "dim" | "warn" | "error";

export interface TranscriptLine {
  readonly key: string;
  readonly tone: LineTone;
  readonly text: string;
}

const firstLine = (text: string) => text.split("\n").find((line) => line.trim() !== "") ?? "";

/** The last `count` non-empty lines of tool output, indented under the tool's line. */
function outputTail(output: string | undefined, count: number): Array<Omit<TranscriptLine, "key">> {
  const lines = (output ?? "").split("\n").filter((line) => line.trim() !== "");
  const tail = lines.slice(-count);
  return [
    ...(lines.length > count
      ? [{ tone: "dim" as const, text: `  … ${lines.length - count} more lines` }]
      : []),
    ...tail.map((line) => ({ tone: "dim" as const, text: `  ${line}` })),
  ];
}

const VERBOSE_OUTPUT_LINES = 8;

/**
 * One item's lines, or none for items the terminal doesn't show. `verbose`
 * adds what the desktop shows when a tool row is expanded: command output,
 * the full command, edits, and finished reasoning.
 */
export function itemLines(
  item: OrchestrationV2TurnItem,
  options: { readonly verbose?: boolean } = {},
): ReadonlyArray<Omit<TranscriptLine, "key">> {
  const verbose = options.verbose ?? false;
  switch (item.type) {
    case "user_message":
      return [{ tone: "user", text: `› ${item.text}` }];
    case "assistant_message":
      return [{ tone: "assistant", text: item.text + (item.streaming ? " ▍" : "") }];
    case "reasoning":
      if (verbose && item.text.trim() !== "")
        return [{ tone: "dim", text: `∴ ${item.text.trim()}` }];
      return item.streaming ? [{ tone: "dim", text: "thinking…" }] : [];
    case "proposed_plan":
      return [{ tone: "assistant", text: `Plan:\n${item.markdown}` }];
    case "command_execution": {
      const failed = item.outputIndicatesFailure || (item.exitCode ?? 0) !== 0;
      const head = {
        tone: failed ? ("error" as const) : ("tool" as const),
        text: `$ ${verbose ? item.input.trim() : firstLine(item.input)}${failed ? `  (exit ${item.exitCode ?? "?"})` : ""}`,
      };
      return verbose ? [head, ...outputTail(item.output, VERBOSE_OUTPUT_LINES)] : [head];
    }
    case "file_change": {
      const counts =
        item.additions !== undefined || item.deletions !== undefined
          ? ` +${item.additions ?? 0} -${item.deletions ?? 0}`
          : "";
      const head = { tone: "tool" as const, text: `✎ ${item.fileName}${counts}` };
      return verbose && item.diffStr
        ? [head, ...outputTail(item.diffStr, VERBOSE_OUTPUT_LINES * 2)]
        : [head];
    }
    case "file_search":
      return [{ tone: "tool", text: `⌕ ${item.pattern ?? item.title ?? "search"}` }];
    case "web_search":
      return [
        { tone: "tool", text: `⌕ web: ${(item.patterns ?? []).join(", ") || (item.title ?? "")}` },
      ];
    case "todo_list":
      return item.steps.map((step) => ({
        tone: "dim" as const,
        text: `${step.status === "completed" ? "☑" : "☐"} ${step.text}`,
      }));
    case "approval_request":
      return [
        { tone: "warn", text: `? ${item.prompt ?? item.title ?? `approve ${item.requestKind}`}` },
      ];
    case "user_input_request":
      return item.questions.map((question) => ({
        tone: "warn" as const,
        text: `? ${question.question}`,
      }));
    case "error":
      return [{ tone: "error", text: `! ${item.failure.message}` }];
    case "system_notice":
    case "run_interrupt_request":
    case "run_interrupt_result":
      return [{ tone: "dim", text: item.message }];
    case "notification":
      return [{ tone: item.outcome === "failed" ? "error" : "dim", text: item.summary }];
    case "compaction":
      return [{ tone: "dim", text: "· context compacted" }];
    case "handoff":
      return [
        { tone: "dim", text: `· handed off to ${item.toModel ?? item.toProviderInstanceId}` },
      ];
    default:
      return item.title ? [{ tone: "tool", text: item.title }] : [];
  }
}

const ACTIVE_RUN_STATUSES = new Set(["preparing", "queued", "starting", "running", "waiting"]);

/** Whether any run on the thread is still going (what `s` would stop). */
export function hasActiveRun(projection: {
  readonly runs: ReadonlyArray<{ readonly status: string }>;
}): boolean {
  return projection.runs.some((run) => ACTIVE_RUN_STATUSES.has(run.status));
}

export function transcriptLines(
  items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
  options: { readonly verbose?: boolean } = {},
): ReadonlyArray<TranscriptLine> {
  return items.flatMap(({ item }) =>
    itemLines(item, options).map((line, index) => ({ ...line, key: `${item.id}:${index}` })),
  );
}
