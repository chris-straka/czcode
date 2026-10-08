import { describe, expect, it } from "vite-plus/test";

import { playingCue } from "./draft.ts";

describe("playingCue", () => {
  const cues = [
    { at: 0, section: "intro", plays: "piano" },
    { at: 6.2, section: "calm", plays: "piano, pad" },
    { at: 40, section: "tense", plays: "drums join" },
  ];

  it("is the last part that started", () => {
    expect(playingCue(cues, 0)).toBe(0);
    expect(playingCue(cues, 10)).toBe(1);
    expect(playingCue(cues, 84)).toBe(2);
  });

  it("is none before the first part, whatever order the rows came in", () => {
    expect(playingCue([{ at: 2, section: "a", plays: "x" }], 1)).toBe(-1);
    expect(playingCue([cues[2]!, cues[0]!, cues[1]!], 10)).toBe(2);
  });
});
