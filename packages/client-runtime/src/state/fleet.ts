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
  OrchestrationV2ShellSnapshot,
} from "@cz/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import type { ConnectionCatalogEntry } from "../connection/catalog.ts";
import { connectionCatalogDisplayUrl } from "../connection/presentation.ts";
import type { SupervisorConnectionState } from "../connection/index.ts";
import { type FleetMachine, type FleetMachineInput, fleetMachines } from "../fleet.ts";
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
    const inputs: Array<FleetMachineInput> = entries.map(([environmentId, entry]) => ({
      environmentId,
      label: entry.target.label,
      phase: phases.get(environmentId) ?? null,
      wakeable:
        wakeHostFromUrl(connectionCatalogDisplayUrl(entry)) !== null && anyConnected(environmentId),
      // The last reading survives a failed refresh, so a machine that just went
      // quiet still shows where it stood.
      resources: Option.getOrNull(AsyncResult.value(get(sources.hostResourcesAtom(environmentId)))),
      shell: get(sources.shellSnapshotAtom(environmentId)),
    }));
    return fleetMachines(inputs);
  });
}
