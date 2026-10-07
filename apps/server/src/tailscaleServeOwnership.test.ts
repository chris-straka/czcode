import { EnvironmentId, type ExecutionEnvironmentDescriptor } from "@cz/contracts";
import { describe, expect, it } from "vite-plus/test";

import { decideServePortOwner } from "./tailscaleServeOwnership.ts";

const HOST = EnvironmentId.make("host-env");
const DEV = EnvironmentId.make("dev-env");
const descriptor = (environmentId: EnvironmentId) => ({
  _tag: "descriptor" as const,
  descriptor: { environmentId } as unknown as ExecutionEnvironmentDescriptor,
});

describe("decideServePortOwner", () => {
  // The owner's machine: cz-host serves :443 → 127.0.0.1:3773; a dev server
  // started from an agent inherits CZ_TAILSCALE_SERVE and runs on 47913.
  const dev = { ownLocalUrl: "http://127.0.0.1:47913", ownEnvironmentId: DEV };

  it("leaves the running host's route alone", () => {
    expect(
      decideServePortOwner({ ...dev, proxy: "http://127.0.0.1:3773", probe: descriptor(HOST) }),
    ).toEqual({ _tag: "other-environment", proxy: "http://127.0.0.1:3773" });
  });

  it("takes a free port, or one whose server is gone", () => {
    expect(decideServePortOwner({ ...dev, proxy: null, probe: null })).toEqual({ _tag: "free" });
    expect(
      decideServePortOwner({
        ...dev,
        proxy: "http://127.0.0.1:3773",
        probe: { _tag: "unreachable" },
      }),
    ).toEqual({ _tag: "stale", proxy: "http://127.0.0.1:3773" });
  });

  it("knows its own mapping, by address or by environment", () => {
    expect(decideServePortOwner({ ...dev, proxy: "http://127.0.0.1:47913/", probe: null })).toEqual(
      { _tag: "ours" },
    );
    expect(
      decideServePortOwner({ ...dev, proxy: "http://127.0.0.1:5733", probe: descriptor(DEV) }),
    ).toEqual({ _tag: "ours" });
  });

  it("never overwrites a service that isn't cz", () => {
    expect(
      decideServePortOwner({
        ...dev,
        proxy: "http://127.0.0.1:8080",
        probe: { _tag: "not-a-cz-server" },
      }),
    ).toEqual({ _tag: "occupied", proxy: "http://127.0.0.1:8080" });
  });
});
