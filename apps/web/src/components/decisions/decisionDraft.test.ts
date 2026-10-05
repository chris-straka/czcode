import type { DecisionItem } from "@cz/contracts";
import { describe, expect, it } from "vite-plus/test";

import { answerSummary, draftProblem, draftToAnswer, emptyDraft } from "./decisionDraft";

const item = (overrides: Partial<DecisionItem>): DecisionItem => ({
  id: "d1",
  project: "hll",
  kind: "pick",
  title: "t",
  question: "q",
  body_md: "",
  media: [],
  options: [
    { id: "a", label: "Ember", media_idx: null },
    { id: "b", label: "Frost", media_idx: null },
  ],
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

describe("decision drafts", () => {
  it("won't send a pick, listen, or timeline until it has what the agent needs", () => {
    const pick = item({});
    expect(draftProblem(pick, emptyDraft(pick))).toBe("Pick an option.");
    expect(draftProblem(pick, { ...emptyDraft(pick), optionIds: ["a"] })).toBeNull();

    const listen = item({ kind: "listen" });
    expect(draftProblem(listen, emptyDraft(listen))).not.toBeNull();
    expect(
      draftProblem(listen, {
        ...emptyDraft(listen),
        reactions: { a: { option_id: "a", verdict: "keep" } },
      }),
    ).toBeNull();

    const timeline = item({
      kind: "timeline",
      options: [],
      steps: [{ id: "rig", label: "Rig", media_idx: null, status: "done" }],
    });
    expect(draftProblem(timeline, { ...emptyDraft(timeline), choice: "redo" })).toBe(
      "Pick the step to redo from.",
    );
  });

  it("sends only the fields the kind uses, and summarises them", () => {
    const listen = item({ kind: "listen" });
    const answer = draftToAnswer(listen, {
      ...emptyDraft(listen),
      reactions: {
        a: { option_id: "a", verdict: "keep" },
        b: { option_id: "b", verdict: "kill", note: "too retro" },
      },
      moreLikeThese: true,
      comment: "  more metal ",
    });
    expect(answer).toMatchObject({ comment: "more metal", more_like_these: true });
    expect(answer.reactions).toHaveLength(2);
    expect(answerSummary(listen, answer)).toBe("1 kept, 1 killed");

    const rank = item({ kind: "rank" });
    expect(answerSummary(rank, draftToAnswer(rank, emptyDraft(rank)))).toBe("Ember › Frost");
    expect(draftToAnswer(rank, emptyDraft(rank), true)).toMatchObject({ retry: true });
  });
});
