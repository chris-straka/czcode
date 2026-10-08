import type { DecisionItem } from "@cz/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  answerSummary,
  contextMedia,
  draftProblem,
  draftToAnswer,
  emptyDraft,
  optionMedia,
  toggleOptionId,
} from "./draft.ts";

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

describe("option pictures", () => {
  const image = (key: string, url = `/m/${key}`) => ({
    type: "image" as const,
    key,
    name: key,
    mime: "image/png",
    size: 1,
    ...(url ? { url } : {}),
  });

  it("shows an option's own picture, none for a shared or missing one, and the shared one once above", () => {
    const decision = item({
      media: [image("plan"), image("ember"), image("gone", "")],
      options: [
        { id: "a", label: "Ember", media_idx: 1 },
        { id: "b", label: "Frost", media_idx: 0 },
        { id: "c", label: "Ash", media_idx: 0 },
        { id: "d", label: "Smoke", media_idx: 2 },
      ],
    });
    expect(decision.options.map((option) => optionMedia(decision, option)?.key ?? null)).toEqual([
      "ember",
      null,
      null,
      null,
    ]);
    expect(contextMedia(decision).map((media) => media.key)).toEqual(["plan"]);
  });
});

describe("none of these", () => {
  it("sends only the note and asks for new options", () => {
    const pick = item({});
    const draft = { ...emptyDraft(pick), optionIds: ["a"], comment: " darker " };
    const answer = draftToAnswer(pick, draft, true);
    expect(answer).toMatchObject({ retry: true, option_ids: null, comment: "darker" });
    expect(answerSummary(pick, answer)).toBe("None of these");
  });
});

describe("toggleOptionId", () => {
  it("clears a selected option and replaces or adds the rest", () => {
    const single = item({});
    expect(toggleOptionId(single, ["a"], "a")).toEqual([]);
    expect(toggleOptionId(single, ["a"], "b")).toEqual(["b"]);
    const multi = item({ max_choices: 2 });
    expect(toggleOptionId(multi, ["a"], "b")).toEqual(["a", "b"]);
    expect(toggleOptionId(multi, ["a", "b"], "a")).toEqual(["b"]);
  });
});
