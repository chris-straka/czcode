// @effect-diagnostics nodeBuiltinImport:off - the probe needs a real socket that stalls or refuses.
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";

import { EnvironmentId, type ExecutionEnvironmentDescriptor } from "@cz/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/http";

import { decideServePortOwner, probeEnvironmentDescriptor } from "./tailscaleServeOwnership.ts";

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

  it("leaves a host too busy to answer the probe alone", () => {
    expect(
      decideServePortOwner({ ...dev, proxy: "http://127.0.0.1:3773", probe: { _tag: "busy" } }),
    ).toEqual({ _tag: "occupied", proxy: "http://127.0.0.1:3773" });
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

describe("probeEnvironmentDescriptor", () => {
  // A local server on a free port; `answer: false` accepts and never replies.
  const listen = (answer: boolean) =>
    Effect.acquireRelease(
      Effect.promise(
        () =>
          new Promise<NodeHttp.Server>((resolve) => {
            const server = NodeHttp.createServer((_request, response) => {
              if (answer) response.end();
            });
            server.listen(0, "127.0.0.1", () => resolve(server));
          }),
      ),
      (server) =>
        Effect.sync(() => {
          server.closeAllConnections();
          server.close();
        }),
    ).pipe(Effect.map((server) => (server.address() as NodeNet.AddressInfo).port));

  const probe = (port: number) =>
    probeEnvironmentDescriptor(`http://127.0.0.1:${port}`).pipe(
      Effect.provide(FetchHttpClient.layer),
    );

  it.live("calls a server that accepts but doesn't answer busy, not gone", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const port = yield* listen(false);
        expect(yield* probe(port)).toEqual({ _tag: "busy" });
      }),
    ),
  );

  it.live("calls a refused connection unreachable", () =>
    Effect.gen(function* () {
      // Take a free port, then close it so nothing listens there.
      const port = yield* Effect.scoped(listen(true));
      expect(yield* probe(port)).toEqual({ _tag: "unreachable" });
    }),
  );
});
