import { describe, expect, it } from "vite-plus/test";
import type {
  EnvironmentId,
  OrchestrationV2ShellSnapshot,
  OrchestrationV2ThreadShell,
} from "@cz/contracts";
import * as DateTime from "effect/DateTime";

import { threadListItems, threadRows, threadSection } from "./threadList.ts";

const NOW = Date.parse("2026-10-06T12:00:00Z");
const at = (iso: string) => DateTime.makeUnsafe(iso);

const thread = (id: string, fields: Partial<Record<string, unknown>> = {}) =>
  ({
    id,
    projectId: "p",
    title: `Thread ${id}`,
    updatedAt: at("2026-10-06T10:00:00Z"),
    deletedAt: null,
    archivedAt: null,
    settledOverride: null,
    snoozedUntil: null,
    pinnedAt: null,
    pendingRuntimeRequest: null,
    ...fields,
  }) as unknown as OrchestrationV2ThreadShell;

const rowsOf = (threads: ReadonlyArray<OrchestrationV2ThreadShell>) =>
  threadRows([
    {
      environmentId: "mac" as EnvironmentId,
      label: "mac",
      snapshot: {
        projects: [{ id: "p", title: "czcode" }],
        threads,
      } as unknown as OrchestrationV2ShellSnapshot,
    },
  ]);

describe("threadSection", () => {
  it("puts a snoozed thread on the snoozed shelf until it wakes", () => {
    const snoozed = thread("a", {
      snoozedUntil: at("2026-10-06T13:00:00Z"),
      pinnedAt: at("2026-10-01T00:00:00Z"),
    });
    expect(threadSection(snoozed, NOW)).toBe("snoozed");
    expect(threadSection(snoozed, Date.parse("2026-10-06T14:00:00Z"))).toBe("pinned");
  });

  it("wakes a snoozed thread early when it needs the user", () => {
    const asking = thread("a", {
      snoozedUntil: at("2026-10-06T13:00:00Z"),
      pendingRuntimeRequest: { kind: "approval" },
    });
    expect(threadSection(asking, NOW)).toBe("active");
  });

  it("lets settled win over a stale pin", () => {
    const settled = thread("a", {
      settledOverride: "settled",
      pinnedAt: at("2026-10-01T00:00:00Z"),
    });
    expect(threadSection(settled, NOW)).toBe("settled");
  });
});

describe("threadListItems", () => {
  const rows = rowsOf([
    thread("pinned", { pinnedAt: at("2026-10-01T00:00:00Z") }),
    thread("active"),
    thread("done", { settledOverride: "settled" }),
    thread("later", { snoozedUntil: at("2026-10-07T09:00:00Z") }),
  ]);
  const ids = (items: ReturnType<typeof threadListItems>) =>
    items.map((item) =>
      item.kind === "header" ? `[${item.section} ${item.count}]` : item.row.thread.id,
    );

  it("folds the snoozed and settled shelves by default", () => {
    expect(ids(threadListItems(rows, { nowMs: NOW, unfolded: new Set() }))).toEqual([
      "pinned",
      "active",
      "[snoozed 1]",
      "[settled 1]",
    ]);
  });

  it("shows a shelf's threads once unfolded", () => {
    expect(ids(threadListItems(rows, { nowMs: NOW, unfolded: new Set(["settled"]) }))).toEqual([
      "pinned",
      "active",
      "[snoozed 1]",
      "[settled 1]",
      "done",
    ]);
  });

  it("flattens to matches across every shelf while searching", () => {
    const items = threadListItems(rows, {
      nowMs: NOW,
      unfolded: new Set(),
      query: "Thread d",
      messageMatches: new Set(["mac:later"]),
    });
    expect(ids(items)).toEqual(["done", "later"]);
  });
});

describe("threadRows", () => {
  it("lists only archived threads in the archived view", () => {
    const threads = [thread("live"), thread("old", { archivedAt: at("2026-10-01T00:00:00Z") })];
    expect(rowsOf(threads).map((row) => row.thread.id)).toEqual(["live"]);
    const archived = threadRows(
      [
        {
          environmentId: "mac" as EnvironmentId,
          label: "mac",
          snapshot: { projects: [], threads } as unknown as OrchestrationV2ShellSnapshot,
        },
      ],
      { archived: true },
    );
    expect(archived.map((row) => row.thread.id)).toEqual(["old"]);
  });
});
