import type { DecisionItem } from "@cz/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  answerSummary,
  canAnswerFromCard,
  contextMedia,
  draftProblem,
  draftToAnswer,
  emptyDraft,
  optionMedia,
  unseenMediaProblem,
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

describe("seeing before approving", () => {
  const media = (type: string, key: string) =>
    ({ type, key, name: key, mime: "x", size: 1 }) as DecisionItem["media"][number];

  it("keeps verdicts off until the video was played and the build installed", () => {
    const item = { kind: "review", media: [media("video", "v"), media("image", "i")] } as const;
    expect(unseenMediaProblem(item, new Set())).toBe("Watch the video first.");
    expect(unseenMediaProblem(item, new Set(["v"]))).toBeNull();
    expect(unseenMediaProblem({ kind: "playtest", media: [media("apk", "a")] }, new Set())).toBe(
      "Install the build first.",
    );
  });

  it("answers from a card only when nothing on it needs opening", () => {
    expect(canAnswerFromCard({ kind: "review", media: [] })).toBe(true);
    expect(canAnswerFromCard({ kind: "review", media: [media("video", "v")] })).toBe(false);
    expect(canAnswerFromCard({ kind: "review", media: [media("image", "i")] })).toBe(false);
    expect(canAnswerFromCard({ kind: "pick", media: [media("image", "i")] })).toBe(true);
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
  it("turns a pick down with or without asking for another round, note optional", () => {
    const pick = item({});
    const draft = emptyDraft(pick);
    expect(draftToAnswer(pick, draft, "none")).toMatchObject({ declined: true, option_ids: null });
    expect(draftToAnswer(pick, draft, "retry")).toMatchObject({ retry: true });
    expect(draftToAnswer(pick, draft, true)).toMatchObject({ retry: true });
    expect(answerSummary(pick, draftToAnswer(pick, draft, "none"))).toBe("None of these");
  });
});
