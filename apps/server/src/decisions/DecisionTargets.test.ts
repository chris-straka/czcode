import { decisionSubmitWarnings, type DecisionSubmitInput } from "@cz/contracts";
import { describe, expect, it } from "vite-plus/test";

import { defaultTargetDevice } from "./DecisionService.ts";

const apk = { type: "apk", key: "b.apk", name: "hll-b2.apk", mime: "x", size: 1 } as const;
const png = { type: "image", key: "a.png", name: "a.png", mime: "image/png", size: 1 } as const;
const ask = (input: Partial<DecisionSubmitInput>): DecisionSubmitInput => ({
  project: "hll",
  kind: "pick",
  title: "t",
  question: "q?",
  ...input,
});

describe("decision targets and warnings", () => {
  it("sends a playtest with an app build to the phone and everything else anywhere", () => {
    expect(defaultTargetDevice(ask({ kind: "playtest", media: [apk] }))).toBe("phone");
    expect(defaultTargetDevice(ask({ kind: "playtest", media: [png] }))).toBe("any");
    expect(defaultTargetDevice(ask({ kind: "pick", media: [apk] }))).toBe("any");
  });

  it("warns when only some options have media", () => {
    const options = [
      { id: "a", label: "A", media_idx: 0 },
      { id: "b", label: "B", media_idx: null },
    ];
    expect(decisionSubmitWarnings(ask({ media: [png], options }))).toHaveLength(1);
    expect(
      decisionSubmitWarnings(ask({ options: options.map((o) => ({ ...o, media_idx: null })) })),
    ).toEqual([]);
  });
});
