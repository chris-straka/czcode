import { describe, expect, it } from "vite-plus/test";

import { parseMouse } from "./input.ts";

describe("parseMouse", () => {
  it("reads wheel and left-click reports, as Ink passes them (ESC stripped)", () => {
    expect(parseMouse("[<64;10;5M")).toEqual([{ kind: "wheel-up", x: 9, y: 4 }]);
    expect(parseMouse("\u001b[<65;1;1M\u001b[<0;3;7M")).toEqual([
      { kind: "wheel-down", x: 0, y: 0 },
      { kind: "click", x: 2, y: 6 },
    ]);
  });

  it("swallows releases and other buttons, and leaves typed text alone", () => {
    expect(parseMouse("[<0;3;7m")).toEqual([]);
    expect(parseMouse("[<2;3;7M")).toEqual([]);
    expect(parseMouse("q")).toBeNull();
    expect(parseMouse("[<")).toBeNull();
  });
});
