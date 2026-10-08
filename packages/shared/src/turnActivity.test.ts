import type { OrchestrationV2TurnItem } from "@cz/contracts";
import { describe, expect, it } from "vite-plus/test";

import { runActivity, turnItemActivity, type TurnActivityInput } from "./turnActivity.ts";

// Both shapes: runActivity reads whole items, turnItemActivity only the activity fields.
type Item = OrchestrationV2TurnItem & TurnActivityInput;

const item = (fields: Record<string, unknown>) =>
  ({ runId: "run-1", ordinal: 0, title: null, ...fields }) as unknown as Item;

describe("turnItemActivity", () => {
  it("names a command by its first line, clipped", () => {
    expect(
      turnItemActivity(item({ type: "command_execution", input: "\nvp test run\n--watch" })),
    ).toBe("$ vp test run");
    const long = turnItemActivity(item({ type: "command_execution", input: "x".repeat(300) }));
    expect(long).toHaveLength(100);
    expect(long?.endsWith("…")).toBe(true);
  });

  it("names an edit by its file", () => {
    expect(
      turnItemActivity(item({ type: "file_change", fileName: "apps/web/src/Sidebar.tsx" })),
    ).toBe("editing Sidebar.tsx");
  });
});

describe("runActivity", () => {
  it("takes the run's latest step that says something, ignoring other runs", () => {
    const items = [
      item({ type: "reasoning", ordinal: 1 }),
      item({ type: "command_execution", input: "git status", ordinal: 2 }),
      item({ type: "user_message", ordinal: 3 }),
      item({ type: "file_change", fileName: "x.ts", ordinal: 9, runId: "run-2" }),
    ];
    expect(runActivity(items, "run-1")).toBe("$ git status");
    expect(runActivity(items, "run-3")).toBe(null);
  });
});
