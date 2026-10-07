import { describe, expect, it } from "vite-plus/test";

import { readmeBlurb } from "./ProjectBlurbService.ts";

describe("readmeBlurb", () => {
  it("takes the opening sentences of the first prose paragraph", () => {
    const readme = [
      "# courtroom (working title)",
      "",
      "Investigation + trial adventure. You play a newly licensed public defender in a",
      "fictional coastal city-state whose courts run on public, televised trials.",
      "Each case: investigate scenes, collect evidence and testimony.",
      "",
      "## IP guardrails",
    ].join("\n");
    expect(readmeBlurb(readme)).toBe(
      "Investigation + trial adventure. You play a newly licensed public defender in a fictional coastal city-state whose courts run on public, televised trials.",
    );
  });

  it("skips badges and images, and keeps link text", () => {
    expect(
      readmeBlurb(
        "[![ci](https://x/badge.svg)](https://x)\n\n![shot](a.png)\n\nA [Bevy](https://bevyengine.org) horror game set in one apartment block during a blackout.",
      ),
    ).toBe("A Bevy horror game set in one apartment block during a blackout.");
  });

  it("returns null when there is no prose", () => {
    expect(readmeBlurb("# title\n\n## only headings\n")).toBeNull();
  });
});
