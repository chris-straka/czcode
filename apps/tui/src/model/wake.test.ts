import { describe, expect, it } from "vite-plus/test";

import { wakeMessage } from "./wake.ts";

const labelOf = (id: string) => ({ z: "z", f: "f-ms-7917", win: "win-desktop" })[id] ?? id;
const say = (
  outcome: Parameters<typeof wakeMessage<string>>[0]["outcome"],
  userInitiated: boolean,
) => wakeMessage({ label: "art-ms-7917", outcome, labelOf, userInitiated });

describe("wakeMessage", () => {
  it("stays quiet on an automatic wake that was never tried", () => {
    expect(say({ kind: "nothing-to-send-through" }, false)).toBe(null);
    expect(say({ kind: "no-address" }, false)).toBe(null);
  });

  it("explains a wake you asked for that couldn't be tried", () => {
    expect(say({ kind: "nothing-to-send-through" }, true)).toBe(
      "Can't wake art-ms-7917: no other machine is connected to send it the wake packet.",
    );
  });

  it("says why a tried wake failed, on either path", () => {
    const failed = {
      kind: "failed" as const,
      attempts: [
        { through: "z", reason: "off-network" as const },
        { through: "f", reason: "off-network" as const },
        { through: "win", reason: "error" as const, message: "timed out" },
      ],
    };
    const text =
      "Couldn't wake art-ms-7917: z and f-ms-7917 aren't on its network or don't know its address; win-desktop failed (timed out).";
    expect(say(failed, false)).toBe(text);
    expect(say(failed, true)).toBe(text);
  });

  it("names the machine that sent it", () => {
    expect(say({ kind: "sent", through: "z" }, false)).toBe(
      "Waking art-ms-7917 through z; it reconnects in about 30 seconds.",
    );
  });
});
