/**
 * The fleet dashboard's data as one atom: each enabled machine's connection,
 * latest host reading, and shell, joined by `fleetMachines`. Each client
 * passes its own atoms in, the way it builds the rest of its state.
 *
 * @module state/fleet
 */
import type {
  EnvironmentId,
  HostResourcesSnapshot,
  OnlinePeers,
  OrchestrationV2ShellSnapshot,
} from "@cz/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import type { ConnectionCatalogEntry } from "../connection/catalog.ts";
import { connectionCatalogDisplayUrl } from "../connection/presentation.ts";
import type { SupervisorConnectionState } from "../connection/index.ts";
import {
  type FleetMachine,
  type FleetMachineInput,
  fleetMachines,
  isPeerOnline,
} from "../fleet.ts";
import { wakeHostFromUrl } from "./hostWake.ts";

export interface FleetAtomSources {
  readonly catalogValueAtom: Atom.Atom<{
    readonly entries: ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>;
  }>;
  readonly connectionStateAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<AsyncResult.AsyncResult<SupervisorConnectionState, unknown>>;
  readonly shellSnapshotAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<OrchestrationV2ShellSnapshot | null>;
  readonly hostResourcesAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<AsyncResult.AsyncResult<HostResourcesSnapshot, unknown>>;
  /** Tailnet peers a connected machine sees online; refresh it with `hostResourcesAtom`. */
  readonly onlinePeersAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<AsyncResult.AsyncResult<OnlinePeers, unknown>>;
}

/** Every enabled machine, ready to draw. Refresh `hostResourcesAtom` per machine to keep it live. */
export function createFleetAtom(sources: FleetAtomSources): Atom.Atom<ReadonlyArray<FleetMachine>> {
  return Atom.make((get) => {
    const entries = [...get(sources.catalogValueAtom).entries].filter(([, entry]) => entry.enabled);
    const phases = new Map(
      entries.map(([environmentId]) => [
        environmentId,
        Option.getOrNull(AsyncResult.value(get(sources.connectionStateAtom(environmentId))))
          ?.phase ?? null,
      ]),
    );
    // A wake packet needs another machine on the LAN that is connected now.
    const anyConnected = (except: EnvironmentId) =>
      [...phases].some(
        ([environmentId, phase]) => environmentId !== except && phase === "connected",
      );
    // What the connected machines see on the tailnet: a machine they see
    // online but can't reach is busy, not asleep.
    const peersSeenBy = new Map(
      [...phases].flatMap(([environmentId, phase]) =>
        phase === "connected"
          ? [
              [
                environmentId,
                Option.getOrNull(AsyncResult.value(get(sources.onlinePeersAtom(environmentId))))
                  ?.peers ?? [],
              ] as const,
            ]
          : [],
      ),
    );
    const seenOnline = (environmentId: EnvironmentId, host: string | null) =>
      [...peersSeenBy].some(([seer, peers]) => seer !== environmentId && isPeerOnline(host, peers));
    const inputs: Array<FleetMachineInput> = entries.map(([environmentId, entry]) => ({
      environmentId,
      label: entry.target.label,
      phase: phases.get(environmentId) ?? null,
      wakeable:
        wakeHostFromUrl(connectionCatalogDisplayUrl(entry)) !== null && anyConnected(environmentId),
      peerOnline: seenOnline(environmentId, wakeHostFromUrl(connectionCatalogDisplayUrl(entry))),
      // The last reading survives a failed refresh, so a machine that just went
      // quiet still shows where it stood.
      resources: Option.getOrNull(AsyncResult.value(get(sources.hostResourcesAtom(environmentId)))),
      shell: get(sources.shellSnapshotAtom(environmentId)),
    }));
    // Atoms recompute on every host reading, so "now" stays fresh enough to judge a stuck start.
    // @effect-diagnostics-next-line globalDate:off
    return fleetMachines(inputs, Date.now());
  });
}
