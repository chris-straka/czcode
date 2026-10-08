import { Connection } from "@cz/client-runtime/connection";
import { DecisionsHttp } from "@cz/client-runtime/state/decisions";
import * as MobileReleaseHttp from "@cz/client-runtime/state/mobileRelease";
import * as JobsHttp from "@cz/client-runtime/state/jobs";
import { QueueHttp } from "@cz/client-runtime/state/queue";
import * as HostWakeHttp from "@cz/client-runtime/state/hostWake";
import { ShellSnapshotLoader } from "@cz/client-runtime/state/shell";
import {
  BoundedThreadSnapshotLoader,
  ThreadHistoryController,
} from "@cz/client-runtime/state/threads";
import * as Layer from "effect/Layer";
import { Atom } from "effect/reactivity";

import type { FoundationHotModule } from "../lib/foundation-fast-refresh";
import { hotSwappableAtomRuntime } from "../lib/hot-swappable-atom-runtime";
import * as Runtime from "../lib/runtime";
import { appAtomRegistry } from "../state/atom-registry";
import * as BackgroundActivity from "./background-activity";
import * as ConnectionPlatform from "./platform";

declare const module: { readonly hot?: FoundationHotModule } | undefined;

const layerProvidedConnectionPlatform = ConnectionPlatform.layer.pipe(Layer.provide(Runtime.layer));

const layerSnapshotLoader = Layer.mergeAll(
  BoundedThreadSnapshotLoader.layer,
  ShellSnapshotLoader.layer,
  ThreadHistoryController.layer,
  DecisionsHttp.layer,
  QueueHttp.layer,
  JobsHttp.layer,
  HostWakeHttp.layer,
  MobileReleaseHttp.layer,
);

type ConnectionLayerSource =
  | typeof Connection.layer
  | typeof layerSnapshotLoader
  | typeof Runtime.layer
  | typeof ConnectionPlatform.layer
  | typeof BackgroundActivity.layerObserver
  | typeof BackgroundActivity.layerReporter;

const layerProvidedClientConnection = layerSnapshotLoader.pipe(
  Layer.provideMerge(
    Connection.layerWithOptions({ usageLimitSources: true, usageLimitsCommand: true }),
  ),
  Layer.provideMerge(
    Layer.mergeAll(
      Runtime.layer,
      layerProvidedConnectionPlatform,
      BackgroundActivity.layerObserver,
    ),
  ),
);

const layerConnection = BackgroundActivity.layerReporter.pipe(
  Layer.provideMerge(layerProvidedClientConnection),
);

export const connectionAtomRuntime: Atom.AtomRuntime<
  Layer.Success<ConnectionLayerSource>,
  Layer.Error<ConnectionLayerSource>
> = hotSwappableAtomRuntime({
  id: "cz.mobile.connection-runtime",
  hotModule: typeof module === "undefined" ? undefined : module.hot,
  registry: appAtomRegistry,
  layer: layerConnection,
});
