import { describe, expect, it } from "vite-plus/test";
import type { OrchestrationV2TurnItem } from "@cz/contracts";

import { itemLines } from "./transcript.ts";

const command = {
  id: "c1",
  type: "command_execution",
  input: "vp test run\n--reporter dot",
  output: Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n"),
  exitCode: 1,
} as unknown as OrchestrationV2TurnItem;

describe("itemLines", () => {
  it("shows a command as one line, with its exit code when it failed", () => {
    expect(itemLines(command)).toEqual([{ tone: "error", text: "$ vp test run  (exit 1)" }]);
  });

  it("adds the full command and its output's tail when verbose", () => {
    const lines = itemLines(command, { verbose: true }).map((line) => line.text);
    expect(lines[0]).toBe("$ vp test run\n--reporter dot  (exit 1)");
    expect(lines[1]).toBe("  … 4 more lines");
    expect(lines.at(-1)).toBe("  line 12");
    expect(lines).toHaveLength(10);
  });

  it("shows finished reasoning only when verbose", () => {
    const reasoning = {
      id: "r1",
      type: "reasoning",
      text: "Check the tests first.",
      streaming: false,
    } as unknown as OrchestrationV2TurnItem;
    expect(itemLines(reasoning)).toEqual([]);
    expect(itemLines(reasoning, { verbose: true })).toEqual([
      { tone: "dim", text: "∴ Check the tests first." },
    ]);
  });
});

describe("image attachments", () => {
  it("adds a line for each image a message carries, naming it", () => {
    const message = {
      id: "m1",
      type: "user_message",
      text: "Does this look right?",
      attachments: [
        { type: "image", id: "att-1", name: "sidebar.png" },
        { type: "file", id: "att-2", name: "notes.txt" },
      ],
    } as unknown as OrchestrationV2TurnItem;
    expect(itemLines(message)).toEqual([
      { tone: "user", text: "› Does this look right?" },
      {
        tone: "dim",
        text: "🖼 sidebar.png",
        image: { attachmentId: "att-1", name: "sidebar.png" },
      },
    ]);
  });
});
