import { describe, expect, it } from "vite-plus/test";

import { vimMotion } from "./useVimKeys";

const press = (key: string, modifiers: { ctrlKey?: boolean; shiftKey?: boolean } = {}) =>
  vimMotion({ key, ctrlKey: false, shiftKey: false, ...modifiers });

describe("vimMotion", () => {
  it("maps ccez-llm's motions: lines, skips, half pages and the ends", () => {
    expect(press("j")).toEqual([1, "line"]);
    expect(press("k")).toEqual([-1, "line"]);
    expect(press("d")).toEqual([1, "skip"]);
    expect(press("u")).toEqual([-1, "skip"]);
    expect(press("d", { ctrlKey: true })).toEqual([1, "half"]);
    expect(press("U", { ctrlKey: true })).toEqual([-1, "half"]);
    expect(press("g")).toBe("g");
    expect(press("G")).toBe("bottom");
    expect(press("l")).toBe("open");
    expect(press("h")).toBe("back");
  });

  it("leaves Shift+D (delete on the Threads page) and other chords alone", () => {
    expect(press("D")).toBeNull();
    expect(press("d", { ctrlKey: true, shiftKey: true })).toBeNull();
    expect(press("j", { ctrlKey: true })).toBeNull();
    expect(press("x")).toBeNull();
  });
});
