import type { Key } from "ink";
import { describe, expect, it } from "vite-plus/test";

import { vimMotion } from "./vim.ts";

const key = (fields: Partial<Key> = {}) => ({ ...fields }) as Key;
const at = (cursor: number, pendingG = false) => ({ cursor, count: 100, page: 20, pendingG });

describe("vimMotion", () => {
  it("moves by line, half page, and page", () => {
    expect(vimMotion("j", key(), at(5))).toEqual({ kind: "move", cursor: 6 });
    expect(vimMotion("", key({ upArrow: true }), at(5))).toEqual({ kind: "move", cursor: 4 });
    expect(vimMotion("d", key({ ctrl: true }), at(5))).toEqual({ kind: "move", cursor: 15 });
    expect(vimMotion("u", key({ ctrl: true }), at(5))).toEqual({ kind: "move", cursor: 0 });
    expect(vimMotion("f", key({ ctrl: true }), at(5))).toEqual({ kind: "move", cursor: 24 });
  });

  it("needs gg for the top, while G goes to the end", () => {
    expect(vimMotion("g", key(), at(50))).toEqual({ kind: "pending" });
    expect(vimMotion("g", key(), at(50, true))).toEqual({ kind: "move", cursor: 0 });
    expect(vimMotion("G", key(), at(50))).toEqual({ kind: "move", cursor: 99 });
  });

  it("goes back on q, and on h unless h is taken", () => {
    expect(vimMotion("q", key(), at(0))).toEqual({ kind: "back" });
    expect(vimMotion("h", key(), at(0))).toEqual({ kind: "back" });
    expect(vimMotion("h", key(), { ...at(0), backOnH: false })).toBe(null);
  });

  it("leaves other keys and ctrl combos to the screen", () => {
    expect(vimMotion("x", key(), at(0))).toBe(null);
    expect(vimMotion("r", key({ ctrl: true }), at(0))).toBe(null);
  });
});
