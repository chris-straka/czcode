import { describe, expect, it } from "vite-plus/test";

import { mediaTypeForFile, optionsFor, parseWhen } from "./inbox.ts";

describe("cz inbox submit helpers", () => {
  it("makes one option per file for media kinds, and uses given labels otherwise", () => {
    expect(optionsFor("pick", [], ["a.png", "b.png"])).toEqual([
      { id: "opt-1", label: "a.png", media_idx: 0 },
      { id: "opt-2", label: "b.png", media_idx: 1 },
    ]);
    expect(optionsFor("review", ["yes"], ["shot.png"])).toEqual([
      { id: "opt-1", label: "yes", media_idx: null },
    ]);
    expect(optionsFor("request", [], ["brief.md"])).toEqual([]);
  });

  it("reads media types from file names", () => {
    expect(mediaTypeForFile("brute.GLB")).toEqual({ type: "glb", mime: "model/gltf-binary" });
    expect(mediaTypeForFile("whoosh-3.wav").type).toBe("audio");
    expect(mediaTypeForFile("hll-b2.apk").type).toBe("apk");
    expect(mediaTypeForFile("notes.bin").type).toBe("file");
  });

  it("reads relative and absolute times", () => {
    expect(parseWhen("2h", 1_000)).toBe(1_000 + 2 * 3_600_000);
    expect(parseWhen("2026-10-09T00:00:00Z", 0)).toBe(Date.parse("2026-10-09T00:00:00Z"));
    expect(parseWhen("soon", 0)).toBeNull();
  });
});
