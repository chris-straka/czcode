import { describe, expect, it } from "vite-plus/test";

import { makeImageStore } from "./imageStore.ts";

const png = new Uint8Array([1, 2, 3]);
const setup = (capacity = 48) => {
  const written: Array<string> = [];
  const store = makeImageStore({
    write: (sequence) => written.push(sequence),
    transmit: (id, _png, columns, rows) => `T${id}:${columns}x${rows}`,
    remove: (id) => `D${id}`,
    firstId: 100,
    capacity,
  });
  return { store, written };
};

describe("imageStore", () => {
  it("sends an image once, however often it is shown again", () => {
    const { store, written } = setup();
    const first = store.acquire("a.png@20x8", { png, columns: 20, rows: 8 });
    store.release("a.png@20x8");
    // A repaint or remount (scrolling back to it) asks again.
    const again = store.acquire("a.png@20x8", { png, columns: 20, rows: 8 });
    expect(again).toBe(first);
    expect(written).toEqual(["T100:20x8"]);
  });

  it("sends a new size as a new image", () => {
    const { store, written } = setup();
    store.acquire("a.png@20x8", { png, columns: 20, rows: 8 });
    store.acquire("a.png@60x24", { png, columns: 60, rows: 24 });
    expect(written).toEqual(["T100:20x8", "T101:60x24"]);
  });

  it("deletes only images nobody shows, oldest first, past capacity", () => {
    const { store, written } = setup(2);
    store.acquire("a", { png, columns: 1, rows: 1 });
    store.acquire("b", { png, columns: 1, rows: 1 });
    store.release("a");
    store.acquire("c", { png, columns: 1, rows: 1 });
    // "a" was free and oldest; "b" is still on screen.
    expect(written).toEqual(["T100:1x1", "T101:1x1", "T102:1x1", "D100"]);
  });

  it("clears every image it sent on exit", () => {
    const { store, written } = setup();
    store.acquire("a", { png, columns: 1, rows: 1 });
    store.acquire("b", { png, columns: 1, rows: 1 });
    store.clear();
    expect(written.slice(-2)).toEqual(["D100", "D101"]);
  });
});
