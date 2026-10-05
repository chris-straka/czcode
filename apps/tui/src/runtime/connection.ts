/**
 * The TUI's connection runtime: client-runtime's connection stack on Node,
 * shaped like the web and mobile runtimes.
 *
 * @module connection
 */
import { Connection } from "@cz/client-runtime/connection";
import { DecisionsHttp } from "@cz/client-runtime/state/decisions";
import { QueueHttp } from "@cz/client-runtime/state/queue";
import { ManagedRelay } from "@cz/client-runtime/relay";
import { remoteHttpClientLayer } from "@cz/client-runtime/rpc";
import { ShellSnapshotLoader } from "@cz/client-runtime/state/shell";
import {
  boundedThreadSnapshotLoaderLayer,
  ThreadHistoryController,
} from "@cz/client-runtime/state/threads";
import { RelayWebClientId } from "@cz/contracts/relay";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Socket from "effect/unstable/socket/Socket";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { webcrypto } from "node:crypto";

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
    randomBytes: (size) => webcrypto.getRandomValues(new Uint8Array(size)),
    digest: (algorithm, data) =>
      Effect.promise(async () => new Uint8Array(await webcrypto.subtle.digest(algorithm, data))),
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

export function makeTuiRuntime(options: TuiRuntimeOptions) {
  const httpClientLayer = remoteHttpClientLayer(fetch);
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
    boundedThreadSnapshotLoaderLayer,
    ShellSnapshotLoader.layer,
    ThreadHistoryController.layer,
    DecisionsHttp.layer,
    QueueHttp.layer,
  );
  const connectionLayer = loaders.pipe(
    Layer.provideMerge(
      Connection.layerWithOptions({ usageLimitSources: true, usageLimitsCommand: true }),
    ),
    Layer.provideMerge(platformLayer),
  );
  const registry = AtomRegistry.make();
  const runtime = Atom.runtime(connectionLayer);
  return { registry, runtime };
}

export type TuiRuntime = ReturnType<typeof makeTuiRuntime>;
