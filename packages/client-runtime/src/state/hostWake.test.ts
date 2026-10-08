import { describe, expect, it } from "vite-plus/test";

import { attemptWake, wakeHostFromUrl } from "./hostWake.ts";

describe("attemptWake", () => {
  it("doesn't try when nothing is connected to send the packet", async () => {
    expect(
      await attemptWake({
        host: "art",
        through: [],
        wake: async () => ({ sent: true, hostName: null }),
      }),
    ).toEqual({
      kind: "nothing-to-send-through",
    });
  });

  it("stops at the first machine that sent it", async () => {
    const asked: Array<string> = [];
    const attempt = await attemptWake({
      host: "art",
      through: ["z", "f", "win"],
      wake: async (id) => {
        asked.push(id);
        return { sent: id === "f", hostName: "art" };
      },
    });
    expect(attempt).toEqual({ kind: "sent", through: "f" });
    expect(asked).toEqual(["z", "f"]);
  });

  it("says why each machine couldn't", async () => {
    const attempt = await attemptWake({
      host: "art",
      through: ["z", "f", "win"],
      wake: async (id) => {
        if (id === "win") throw new Error("connection reset");
        return id === "z" ? { sent: false, hostName: null } : null;
      },
    });
    expect(attempt).toEqual({
      kind: "failed",
      attempts: [
        { through: "z", reason: "off-network" },
        { through: "f", reason: "error" },
        { through: "win", reason: "error", message: "connection reset" },
      ],
    });
  });
});

describe("wakeHostFromUrl", () => {
  it("has nothing to wake for this machine's own server", () => {
    expect(wakeHostFromUrl("http://127.0.0.1:3773")).toBe(null);
    expect(wakeHostFromUrl("https://art-ms-7917.tail.ts.net/")).toBe("art-ms-7917.tail.ts.net");
  });
});
