import { RegistryContext } from "@effect/atom-react";
import { connectionCatalogDisplayUrl } from "@cz/client-runtime/connection";
import { wakeHostFromUrl, wakeHostThroughAny } from "@cz/client-runtime/state/hostWake";
import { runAtomCommand } from "@cz/client-runtime/state/runtime";
import type { EnvironmentId } from "@cz/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useCallback, useContext } from "react";

import type { TuiAtoms } from "../state/atoms.ts";

/**
 * Wakes a sleeping host through the other connected hosts on its LAN, and
 * resolves to a line for the status bar, or null when it has no address to
 * wake by (such as this machine's own server).
 */
export function useWakeHost(atoms: TuiAtoms) {
  const registry = useContext(RegistryContext);
  return useCallback(
    async (target: EnvironmentId): Promise<string | null> => {
      const catalog = registry.get(atoms.catalog.catalogValueAtom);
      const entry = catalog.entries.get(target);
      if (!entry) return "Unknown host.";
      const host = wakeHostFromUrl(connectionCatalogDisplayUrl(entry));
      if (!host) return null;
      const through = [...catalog.entries.keys()].filter((environmentId) => {
        if (environmentId === target) return false;
        const state = AsyncResult.value(registry.get(atoms.catalog.stateAtom(environmentId)));
        return Option.isSome(state) && state.value.phase === "connected";
      });
      const sentBy = await wakeHostThroughAny({
        host,
        through,
        wake: async (environmentId, wakeHost) => {
          const result = await runAtomCommand(
            registry,
            atoms.hostWake.wake,
            { environmentId, input: { host: wakeHost } },
            { label: atoms.hostWake.wake.label, reportFailure: false, reportDefect: false },
          );
          return AsyncResult.isSuccess(result) ? result.value : null;
        },
      });
      return sentBy === null
        ? `No connected host can wake ${entry.target.label}.`
        : `Waking ${entry.target.label}; it reconnects in about 30 seconds.`;
    },
    [atoms, registry],
  );
}
