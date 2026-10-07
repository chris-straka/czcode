import { describe, expect, it } from "vite-plus/test";

import { fitCells } from "./kitty.ts";
import { letterbox, tileGrid } from "./decisionTiles.ts";

describe("tileGrid", () => {
  it("fits several equal tiles across a wide window", () => {
    const grid = tileGrid(100, 4);
    expect(grid.perRow).toBe(4);
    expect(grid.tileColumns * 4 + 3).toBeLessThanOrEqual(100);
    // 4:3 in cells that are twice as tall as wide.
    expect(grid.frameRows).toBe(Math.round((grid.frameColumns * 3) / 8));
  });

  it("falls back to fewer tiles per row in a 60-column float", () => {
    expect(tileGrid(60, 4).perRow).toBe(2);
    expect(tileGrid(30, 4).perRow).toBe(1);
  });

  it("doesn't stretch one or two options across a wide window", () => {
    expect(tileGrid(200, 2).tileColumns).toBe(40);
  });
});

describe("letterbox", () => {
  it("contains a tall image and centres it sideways", () => {
    const frame = tileGrid(100, 4);
    const tall = fitCells({ width: 600, height: 1200 }, frame.frameColumns, frame.frameRows);
    expect(tall.rows).toBe(frame.frameRows);
    expect(tall.columns).toBeLessThan(frame.frameColumns);
    expect(letterbox(tall, frame)).toEqual({
      left: Math.floor((frame.frameColumns - tall.columns) / 2),
      top: 0,
    });
  });

  it("contains a wide image and centres it vertically", () => {
    const frame = tileGrid(100, 4);
    const wide = fitCells({ width: 1600, height: 400 }, frame.frameColumns, frame.frameRows);
    expect(wide.columns).toBe(frame.frameColumns);
    expect(letterbox(wide, frame).left).toBe(0);
    expect(letterbox(wide, frame).top).toBeGreaterThan(0);
  });
});
