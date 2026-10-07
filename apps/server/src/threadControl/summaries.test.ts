import type { OrchestrationV2ThreadShell } from "@cz/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { threadSummaries } from "./summaries.ts";

const at = (iso: string) => DateTime.makeUnsafe(iso);
const thread = (id: string, fields: Partial<OrchestrationV2ThreadShell>) =>
  ({
    id,
    projectId: "p1",
    title: id,
    modelSelection: { instanceId: "claudeAgent", model: "claude-opus-5-5" },
    activeRunId: null,
    archivedAt: null,
    deletedAt: null,
    updatedAt: at("2026-10-06T10:00:00Z"),
    ...fields,
  }) as OrchestrationV2ThreadShell;

describe("thread summaries", () => {
  it("puts running threads first, then the newest, and drops deleted ones", () => {
    const rows = threadSummaries(
      [
        thread("old", { updatedAt: at("2026-10-05T10:00:00Z") }),
        thread("new", { updatedAt: at("2026-10-06T12:00:00Z") }),
        thread("busy", { activeRunId: "run-1" as never, updatedAt: at("2026-10-01T00:00:00Z") }),
        thread("gone", { deletedAt: at("2026-10-06T00:00:00Z") }),
      ],
      [{ id: "p1" as never, title: "ResumeProjects" as never }],
      0,
    );
    expect(rows.map((row) => row.threadId)).toEqual(["busy", "new", "old"]);
    expect(rows[0]).toMatchObject({
      running: true,
      busy: true,
      projectTitle: "ResumeProjects",
      model: "claudeAgent/claude-opus-5-5",
    });
  });

  it("marks a finished turn with background tasks still going as busy", () => {
    const [row] = threadSummaries([thread("bg", { pendingBackgroundTasks: [{}] as never })], [], 0);
    expect(row).toMatchObject({ running: false, busy: true });
  });
});
