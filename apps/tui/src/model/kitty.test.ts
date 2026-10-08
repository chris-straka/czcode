import { describe, expect, it } from "vite-plus/test";

import {
  fitCells,
  idColor,
  inlineImagesSupported,
  MAX_PLACEHOLDER_CELLS,
  placeholderRows,
  pngSize,
  transmitSequence,
} from "./kitty.ts";

describe("placeholderRows", () => {
  it("draws images wider and taller than 64 cells (full screen in a big window)", () => {
    const rows = placeholderRows(150, 70);
    expect(rows).toHaveLength(70);
    // Each cell: the placeholder plus a row and a column mark (3 code points).
    expect([...rows[69]!]).toHaveLength(150 * 3);
    // Row 69 and column 149 get their own marks from the spec's 297.
    expect([...rows[69]!][1]).not.toBe([...rows[63]!][1]);
    expect(MAX_PLACEHOLDER_CELLS).toBe(297);
  });
});

describe("kitty placeholders", () => {
  it("transmits in 4096-byte chunks, flagging all but the last", () => {
    const png = new Uint8Array(5000).fill(7);
    const sequence = transmitSequence(42, png, 10, 4);
    const chunks = sequence.split("\u001b\\").filter(Boolean);
    expect(chunks.length).toBe(Math.ceil(Buffer.from(png).toString("base64").length / 4096));
    expect(chunks[0]).toMatch(/^\u001b_Ga=T,U=1,i=42,f=100,q=2,c=10,r=4,m=1;/);
    expect(chunks.at(-1)).toMatch(/^\u001b_Gm=0;/);
  });

  it("builds one placeholder cell per column with row and column diacritics", () => {
    const rows = placeholderRows(3, 2);
    expect(rows).toHaveLength(2);
    expect([...rows[1]!].map((char) => char.codePointAt(0)!.toString(16))).toEqual([
      "10eeee",
      "30d",
      "305",
      "10eeee",
      "30d",
      "30d",
      "10eeee",
      "30d",
      "30e",
    ]);
    expect(idColor(42)).toBe("#00002a");
  });

  it("fits an image to the cells it may use", () => {
    expect(fitCells({ width: 480, height: 320 }, 40, 30)).toEqual({ columns: 40, rows: 13 });
    expect(fitCells({ width: 100, height: 800 }, 40, 10)).toEqual({ columns: 3, rows: 10 });
  });

  it("reads PNG dimensions from the header", () => {
    const header = new Uint8Array(24);
    header.set([0x89, 0x50, 0x4e, 0x47]);
    new DataView(header.buffer).setUint32(16, 480);
    new DataView(header.buffer).setUint32(20, 320);
    expect(pngSize(header)).toEqual({ width: 480, height: 320 });
    expect(pngSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("draws in Ghostty and kitty, not inside tmux", () => {
    expect(inlineImagesSupported({ TERM_PROGRAM: "ghostty" })).toBe(true);
    expect(inlineImagesSupported({ TERM: "xterm-kitty" })).toBe(true);
    expect(inlineImagesSupported({ TERM_PROGRAM: "ghostty", TMUX: "/tmp/x" })).toBe(false);
    expect(inlineImagesSupported({ TERM_PROGRAM: "Apple_Terminal" })).toBe(false);
    // Over ssh: Ghostty's TERM comes along; a phone ssh app's doesn't name a graphics terminal.
    expect(inlineImagesSupported({ TERM: "xterm-ghostty", SSH_CONNECTION: "1 2 3 4" })).toBe(true);
    expect(inlineImagesSupported({ TERM: "xterm-256color", SSH_CONNECTION: "1 2 3 4" })).toBe(
      false,
    );
    // Inside neovim, only when that neovim forwards the images.
    const inNvim = { TERM_PROGRAM: "ghostty", NVIM: "/tmp/nvim.sock" };
    expect(inlineImagesSupported(inNvim, () => true)).toBe(true);
    expect(inlineImagesSupported(inNvim, () => false)).toBe(false);
  });
});
