import type { PairedHost } from "@cz/tui/api";
import { describe, expect, it } from "vite-plus/test";

import { findHost } from "./serverClient.ts";

const basement: PairedHost = {
  label: "basement",
  environmentId: "env-basement",
  httpBaseUrl: "https://basement.tailfe37c2.ts.net",
  bearerToken: "token",
  enabled: true,
};

describe("--host", () => {
  it("finds a paired machine by label, id, or address", () => {
    for (const wanted of ["basement", "Basement", "env-basement", "basement.tailfe37c2.ts.net"]) {
      expect(findHost([basement], wanted)).toBe(basement);
    }
    expect(findHost([basement], "z")).toBeUndefined();
  });
});
