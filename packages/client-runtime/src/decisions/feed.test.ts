import { describe, expect, it } from "vite-plus/test";

import { filterChips, filterFeed, orderFeed } from "./feed.ts";
import { normalizeDecisionKind, type DecisionItem } from "@cz/contracts";

const item = (overrides: Partial<DecisionItem> & Pick<DecisionItem, "id">): DecisionItem => ({
  project: "misc",
  kind: "pick",
  title: overrides.id,
  question: "?",
  body_md: "",
  media: [],
  options: [],
  max_choices: 1,
  steps: [],
  context_media_idx: null,
  priority: 0,
  created_by: "test",
  thread: null,
  blocking: false,
  default: null,
  expires_at: null,
  cost_note: null,
  resume: null,
  status: "open",
  created_at: 0,
  updated_at: 0,
  answered_at: null,
  ...overrides,
});

describe("orderFeed", () => {
  it("puts blocking first, then the priority project, then oldest", () => {
    const feed = orderFeed([
      item({ id: "old-misc", created_at: 1 }),
      item({ id: "new-hll", project: "hll", created_at: 5 }),
      item({ id: "hll-art", project: "hll:art", created_at: 3 }),
      item({ id: "blocking-misc", blocking: true, created_at: 9 }),
      item({ id: "answered", project: "hll", status: "answered" }),
    ]);
    expect(feed.map((entry) => entry.id)).toEqual([
      "blocking-misc",
      "hll-art",
      "new-hll",
      "old-misc",
    ]);
  });
});

describe("filters", () => {
  const items = [
    item({ id: "a", project: "hll", kind: "listen" }),
    item({ id: "b", project: "hll", kind: "pick" }),
    item({ id: "c", project: "genforge", kind: "listen" }),
  ];

  it("keeps items matching every non-empty filter", () => {
    expect(filterFeed(items, { kinds: new Set(["listen"]) }).map((entry) => entry.id)).toEqual([
      "a",
      "c",
    ]);
    expect(
      filterFeed(items, { projects: new Set(["hll"]), kinds: new Set(["listen"]) }).map(
        (entry) => entry.id,
      ),
    ).toEqual(["a"]);
  });

  it("offers chips most common first", () => {
    expect(filterChips(items)).toEqual({
      projects: ["hll", "genforge"],
      kinds: ["listen", "pick"],
    });
  });
});

describe("normalizeDecisionKind", () => {
  it("maps pre-redesign kinds and rejects unknown ones", () => {
    expect(normalizeDecisionKind("approve")).toBe("review");
    expect(normalizeDecisionKind("trend")).toBe("pitch");
    expect(normalizeDecisionKind("listen")).toBe("listen");
    expect(normalizeDecisionKind("fleet")).toBeNull();
  });
});
