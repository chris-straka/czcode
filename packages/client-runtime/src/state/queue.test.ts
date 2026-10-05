import { ProjectId, ProviderInstanceId, type QueuedRun } from "@cz/contracts";
import { describe, expect, it } from "vite-plus/test";

import { queuedRunStartLabel } from "./queue.ts";

const NOW = Date.parse("2026-10-05T22:00:00Z");
const run = (overrides: Partial<QueuedRun>): QueuedRun => ({
  id: "r1",
  title: "Refresh badges",
  prompt: "Refresh badges",
  projectId: ProjectId.make("p1"),
  modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "opus" },
  runtimeMode: "auto",
  interactionMode: "default",
  workspaceStrategy: { type: "root" },
  dueAt: NOW,
  dueReason: "reset",
  source: "composer",
  status: "queued",
  createdAt: NOW,
  startedAt: null,
  threadId: null,
  error: null,
  ...overrides,
});

describe("queuedRunStartLabel", () => {
  it("reads as a phrase after 'It'", () => {
    expect(queuedRunStartLabel(run({ dueAt: NOW + 2 * 3_600_000 }), NOW)).toMatch(
      /^starts at the reset, in /,
    );
    expect(queuedRunStartLabel(run({ dueReason: "chosen", dueAt: NOW + 60_000 }), NOW)).toMatch(
      /^starts in /,
    );
    expect(queuedRunStartLabel(run({ dueReason: "chosen", dueAt: NOW + 4_000 }), NOW)).toBe(
      "starts now",
    );
    expect(queuedRunStartLabel(run({ dueReason: "unknown-reset", dueAt: NOW + 4_000 }), NOW)).toBe(
      "starts now (this model reports no quota reset)",
    );
    expect(queuedRunStartLabel(run({ status: "failed" }), NOW)).toBe("couldn't start");
  });
});
