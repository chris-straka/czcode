import type { DecisionMediaRef } from "@cz/contracts";
import { describe, expect, it } from "vite-plus/test";

import { decisionMediaUrl } from "./mediaUrl.ts";

const media = (exp: number): DecisionMediaRef => ({
  type: "audio",
  key: "song.mp3",
  name: "song.mp3",
  mime: "audio/mpeg",
  size: 1,
  url: `/api/decisions/media?key=song.mp3&exp=${exp}&sig=s${exp}`,
});

describe("decisionMediaUrl", () => {
  it("keeps the first signed URL while it is valid and renews it near expiry", () => {
    const hour = 3_600_000;
    const first = decisionMediaUrl("http://host", media(6 * hour), 0);
    expect(decisionMediaUrl("http://host", media(7 * hour), hour)).toBe(first);
    expect(decisionMediaUrl("http://host", media(12 * hour), 6 * hour - 60_000)).toContain(
      "exp=43200000",
    );
  });
});
