/**
 * The TUI's connection runtime: client-runtime's connection stack on Node,
 * shaped like the web and mobile runtimes.
 *
 * @module connection
 */
import { Connection } from "@cz/client-runtime/connection";
import { DecisionsHttp } from "@cz/client-runtime/state/decisions";
import { QueueHttp } from "@cz/client-runtime/state/queue";
import * as HostWakeHttp from "@cz/client-runtime/state/hostWake";
import { ManagedRelay } from "@cz/client-runtime/relay";
import { layerRemoteHttpClient } from "@cz/client-runtime/rpc";
import { ShellSnapshotLoader } from "@cz/client-runtime/state/shell";
import {
  BoundedThreadSnapshotLoader,
  ThreadHistoryController,
} from "@cz/client-runtime/state/threads";
import { RelayWebClientId } from "@cz/contracts/relay";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Socket from "effect/socket/Socket";
import { Atom, AtomRegistry } from "effect/reactivity";
import * as NodeCrypto from "node:crypto";

import type { RunTuiOptions } from "../api.ts";
import {
  capabilitiesLayer,
  connectivityLayer,
  platformSourceLayer,
  wakeupsLayer,
} from "./platform.ts";
import { connectionStorageLayer, memoryCacheLayer } from "./storage.ts";

export type TuiRuntimeOptions = RunTuiOptions;

const cryptoLayer = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => NodeCrypto.webcrypto.getRandomValues(new Uint8Array(size)),
    digest: (algorithm, data) =>
      Effect.promise(
        async () => new Uint8Array(await NodeCrypto.webcrypto.subtle.digest(algorithm, data)),
      ),
  }),
);

// cz Connect is gone from this fork; the relay client exists only because the
// connection stack is shared with clients that still carry it.
const relaySignerLayer = Layer.succeed(
  ManagedRelay.ManagedRelayDpopSigner,
  ManagedRelay.ManagedRelayDpopSigner.of({
    thumbprint: Effect.die("cz Connect isn't available in the terminal app."),
    createProof: () => Effect.die("cz Connect isn't available in the terminal app."),
  }),
);

/** Everything the TUI's atoms run on: the shared connection stack on Node. */
export function makeTuiConnectionLayer(options: TuiRuntimeOptions) {
  const httpClientLayer = layerRemoteHttpClient(fetch);
  const baseLayer = Layer.mergeAll(
    httpClientLayer,
    cryptoLayer,
    Socket.layerWebSocketConstructorGlobal,
    NodeServices.layer,
    relaySignerLayer,
    ManagedRelay.layer({ relayUrl: "http://relay.invalid", clientId: RelayWebClientId }).pipe(
      Layer.provide(Layer.mergeAll(httpClientLayer, cryptoLayer, relaySignerLayer)),
    ),
  );
  const platformLayer = Layer.mergeAll(
    connectionStorageLayer(options.configDir),
    memoryCacheLayer,
    connectivityLayer,
    wakeupsLayer,
    capabilitiesLayer(options.appVersion),
    platformSourceLayer(options.local),
  ).pipe(Layer.provideMerge(baseLayer));
  const loaders = Layer.mergeAll(
    BoundedThreadSnapshotLoader.layer,
    ShellSnapshotLoader.layer,
    ThreadHistoryController.layer,
    DecisionsHttp.layer,
    QueueHttp.layer,
    HostWakeHttp.layer,
  );
  return loaders.pipe(
    Layer.provideMerge(
      Connection.layerWithOptions({ usageLimitSources: true, usageLimitsCommand: true }),
    ),
    Layer.provideMerge(platformLayer),
  );
}

export function makeTuiRuntime(options: TuiRuntimeOptions) {
  const registry = AtomRegistry.make();
  const runtime = Atom.runtime(makeTuiConnectionLayer(options));
  return { registry, runtime };
}

export type TuiRuntime = ReturnType<typeof makeTuiRuntime>;
