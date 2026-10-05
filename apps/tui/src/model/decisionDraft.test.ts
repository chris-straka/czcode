import { draftProblem, draftToAnswer, emptyDraft } from "@cz/client-runtime/decisions/draft";
import type { DecisionItem } from "@cz/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  addPassageComment,
  moveRank,
  paragraphRanges,
  react,
  togglePick,
} from "./decisionDraft.ts";

const item = (kind: DecisionItem["kind"], extra: Partial<DecisionItem> = {}): DecisionItem => ({
  id: "d1",
  project: "hll",
  kind,
  title: "",
  question: "?",
  body_md: "",
  media: [],
  options: [
    { id: "a", label: "A", media_idx: null },
    { id: "b", label: "B", media_idx: null },
    { id: "c", label: "C", media_idx: null },
  ],
  max_choices: 1,
  steps: [],
  context_media_idx: null,
  priority: 0,
  created_by: "agent",
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
  ...extra,
});

describe("decision draft keys", () => {
  it("picks one option, replacing the last, or up to max_choices", () => {
    const single = item("pick");
    let draft = togglePick(single, emptyDraft(single), "a");
    draft = togglePick(single, draft, "b");
    expect(draft.optionIds).toEqual(["b"]);
    expect(draftToAnswer(single, draft).option_ids).toEqual(["b"]);

    const multi = item("pick", { max_choices: 2 });
    let many = emptyDraft(multi);
    for (const id of ["a", "b", "c"]) many = togglePick(multi, many, id);
    expect(many.optionIds).toEqual(["a", "b"]);
    expect(togglePick(multi, many, "a").optionIds).toEqual(["b"]);
  });

  it("moves ranks within bounds and the server rules accept the order", () => {
    const rank = item("rank");
    const moved = moveRank(emptyDraft(rank), 2, -1);
    expect(moved.draft.rank).toEqual(["a", "c", "b"]);
    expect(moved.index).toBe(1);
    expect(moveRank(moved.draft, 0, -1).index).toBe(0);
    expect(draftProblem(rank, moved.draft)).toBeNull();
  });

  it("toggles a sound's verdict and sends only reacted sounds", () => {
    const listen = item("listen");
    let draft = react(emptyDraft(listen), "a", "keep");
    draft = react(draft, "b", "kill");
    draft = react(draft, "b", "kill");
    expect(draftToAnswer(listen, draft).reactions).toEqual([{ option_id: "a", verdict: "keep" }]);
  });

  it("comments on a paragraph by its character range", () => {
    const body = "First line.\n\nSecond para\nstill second.\n\n\nThird.";
    expect(paragraphRanges(body).map((range) => body.slice(range.start, range.end))).toEqual([
      "First line.",
      "Second para\nstill second.",
      "Third.",
    ]);
    const read = item("read", { body_md: body });
    const draft = addPassageComment(emptyDraft(read), body, 1, "too slow");
    expect(draft.passageComments).toEqual([
      { start: 13, end: 38, quote: "Second para\nstill second.", note: "too slow" },
    ]);
  });
});
