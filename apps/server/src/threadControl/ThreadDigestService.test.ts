import { describe, expect, it } from "vite-plus/test";

import { cdTargets, excerptOf } from "./ThreadDigestService.ts";

describe("thread digests", () => {
  it("reads the folders a command cds into", () => {
    expect(cdTargets("cd ~/SWE/games/hll && cargo test", "/home/f")).toEqual([
      "/home/f/SWE/games/hll",
    ]);
    expect(cdTargets('git status; cd "/home/f/SWE/ccez llm/" && ls', "/home/f")).toEqual([
      "/home/f/SWE/ccez llm",
    ]);
    expect(cdTargets("cd src && abcd /tmp", "/home/f")).toEqual([]);
  });

  it("keeps the start of a result as plain text without images", () => {
    expect(
      excerptOf(
        "**Done.** Five games built.\n\n![shot](/home/f/a.png)\nSee [the PR](https://x/1).",
      ),
    ).toBe("Done. Five games built. See the PR.");
    expect(excerptOf("![only](/a.png)")).toBeNull();
    expect(excerptOf("a".repeat(400))?.length).toBe(320);
  });
});
