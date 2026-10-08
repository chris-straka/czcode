import type { DecisionItem, EnvironmentId } from "@cz/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildOneFeed,
  feedFolderLabel,
  feedProjectGroup,
  feedProjectKey,
  waitingOnOtherDevice,
  oneFeedBadgeCount,
  shortMachineLabel,
  shortModelLabel,
} from "./oneFeed.ts";

const here = "env-f" as EnvironmentId;
const art = "env-art" as EnvironmentId;

const thread = (
  id: string,
  overrides: Partial<Parameters<typeof buildOneFeed>[0]["threads"][number]> = {},
) => ({
  environmentId: here,
  id,
  projectId: "swe",
  updatedAt: "2026-10-07T10:00:00Z",
  settledAt: null,
  archivedAt: null,
  deletedAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  lineage: { relationshipToParent: null },
  ...overrides,
});

const decision = (id: string, overrides: Partial<DecisionItem> = {}, environmentId = here) => ({
  environmentId,
  item: {
    id,
    project: "games",
    kind: "pick",
    status: "open",
    media: [],
    blocking: false,
    priority: 0,
    thread: null,
    created_at: 1,
    ...overrides,
  } as DecisionItem,
});

const all = { machine: { type: "all" } } as const;

describe("buildOneFeed", () => {
  it("puts a thread's decision on its card, needs-you first, and keeps standalone decisions", () => {
    const cards = buildOneFeed({
      threads: [
        thread("old", { updatedAt: "2026-10-07T09:00:00Z" }),
        thread("asking", { updatedAt: "2026-10-07T08:00:00Z" }),
        thread("new", { updatedAt: "2026-10-07T11:00:00Z" }),
      ],
      decisions: [decision("d1", { thread: "asking" }), decision("d2", { created_at: 2 })],
      filter: all,
    });
    expect(
      cards.map((card) => (card.kind === "thread" ? card.thread.id : card.decision.item.id)),
    ).toEqual(["asking", "d2", "new", "old"]);
    expect(cards[0]).toMatchObject({ kind: "thread", needsYou: true });
  });

  it("shows settled threads as ordinary rows and hides subagents", () => {
    const cards = buildOneFeed({
      threads: [
        thread("settled", { settledAt: "2026-10-07T10:00:00Z" }),
        thread("child", { lineage: { relationshipToParent: "subagent" } }),
      ],
      decisions: [],
      filter: all,
    });
    expect(cards).toEqual([expect.objectContaining({ kind: "thread", needsYou: false })]);
  });

  it("follows the machine filter, and the badge counts what the filter shows", () => {
    const input = {
      threads: [thread("t", { environmentId: art })],
      decisions: [
        decision("d-here"),
        decision("d-art", { thread: "t" }, art),
        decision("d-art2", {}, art),
      ],
    };
    const onlyHere = buildOneFeed({
      ...input,
      filter: { machine: { type: "one", environmentId: here } },
    });
    expect(oneFeedBadgeCount(onlyHere)).toBe(1);
    expect(oneFeedBadgeCount(buildOneFeed({ ...input, filter: all }))).toBe(3);
  });

  it("narrows to decision projects and drops threads without one", () => {
    const cards = buildOneFeed({
      threads: [thread("quiet"), thread("asking")],
      decisions: [
        decision("d1", { thread: "asking", project: "hll" }),
        decision("d2", { project: "courtroom" }),
      ],
      filter: { ...all, projects: new Set(["hll"]) },
    });
    expect(cards.map((card) => card.key)).toEqual([`thread\u0000${here}\u0000asking`]);
    expect(oneFeedBadgeCount(cards)).toBe(1);
  });
});

describe("device targeting", () => {
  it("treats an old playtest with an apk as a phone item", () => {
    const apk = { type: "apk", key: "a", name: "hll.apk", mime: "x", size: 1 } as const;
    const decisions = [decision("play", { kind: "playtest", media: [apk] })];
    expect(buildOneFeed({ threads: [], decisions, filter: { ...all, device: "desktop" } })).toEqual(
      [],
    );
  });

  it("keeps phone playtests off the desktop and counts them for one quiet line", () => {
    const decisions = [
      decision("play", { kind: "playtest", target_device: "phone" }),
      decision("pick"),
    ];
    const filter = { ...all, device: "desktop" } as const;
    const cards = buildOneFeed({ threads: [], decisions, filter });
    expect(cards.map((card) => card.key)).toEqual([`decision\u0000${here}\u0000pick`]);
    expect(waitingOnOtherDevice(decisions, filter)).toBe(1);
    expect(
      buildOneFeed({ threads: [], decisions, filter: { ...all, device: "phone" } }),
    ).toHaveLength(2);
  });
});

describe("card labels", () => {
  it("names the folder and model briefly", () => {
    expect(feedFolderLabel("SWE", "games/hll")).toBe("games/hll");
    expect(feedFolderLabel("czcode", null)).toBe("czcode");
    expect(shortModelLabel("Claude Opus 5.5")).toBe("Opus 5.5");
    expect(shortModelLabel("GPT-5.5 Codex")).toBe("GPT-5.5 Codex");
    expect(shortMachineLabel("f-ms-7917")).toBe("f");
  });
});

describe("project groups", () => {
  it("keeps only games, matching threads by their folder when they asked nothing", () => {
    const folders: Record<string, string> = { t1: "games/blackout", t2: "czcode" };
    const cards = buildOneFeed({
      threads: [thread("t1"), thread("t2")],
      decisions: [decision("d1", { project: "hll" }), decision("d2", { project: "czcode" })],
      filter: {
        ...all,
        group: "games",
        groupOf: (project) => (project === "hll" || project === "blackout" ? "games" : "software"),
        threadProject: (candidate) => feedProjectKey(folders[candidate.id] ?? ""),
      },
    });
    expect(cards.map((card) => card.key.split("\u0000").pop())).toEqual(["d1", "t1"]);
    expect(feedProjectGroup("games/blackout")).toBe("games");
    expect(feedProjectGroup("software/gamesdb")).toBe("software");
  });
});
