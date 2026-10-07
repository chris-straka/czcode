import { describe, expect, it } from "vite-plus/test";

import { anyLoading, hostLoad, hostLoadSummary, SLOW_HOST_MS } from "./hostLoad.ts";

describe("hostLoad", () => {
  it("is ready once data arrived, whatever the connection does next", () => {
    expect(hostLoad({ phase: "backoff", hasValue: true, failed: true, waitedMs: 0 })).toBe("ready");
  });

  it("stops waiting on a host that can't be reached", () => {
    expect(hostLoad({ phase: "backoff", hasValue: false, failed: false, waitedMs: 0 })).toBe(
      "retrying",
    );
    expect(hostLoad({ phase: "offline", hasValue: false, failed: false, waitedMs: 0 })).toBe(
      "offline",
    );
    expect(hostLoad({ phase: "connected", hasValue: false, failed: true, waitedMs: 0 })).toBe(
      "offline",
    );
  });

  it("calls a host slow once it has loaded past the threshold", () => {
    const connecting = { phase: "connecting" as const, hasValue: false, failed: false };
    expect(hostLoad({ ...connecting, waitedMs: 1000 })).toBe("loading");
    expect(hostLoad({ ...connecting, waitedMs: SLOW_HOST_MS })).toBe("slow");
  });
});

describe("host load summary", () => {
  it("waits only on hosts still loading, and names the rest", () => {
    const hosts = [
      { label: "z", load: "ready" as const },
      { label: "f-ms-7917", load: "retrying" as const },
    ];
    expect(anyLoading(hosts)).toBe(false);
    expect(hostLoadSummary(hosts)).toBe("f-ms-7917 unreachable, retrying");
    expect(anyLoading([...hosts, { label: "art", load: "loading" }])).toBe(true);
    expect(hostLoadSummary([{ label: "z", load: "ready" }])).toBe(null);
  });
});
