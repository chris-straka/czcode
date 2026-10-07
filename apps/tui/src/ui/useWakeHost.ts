import { RegistryContext } from "@effect/atom-react";
import { connectionCatalogDisplayUrl } from "@cz/client-runtime/connection";
import { attemptWake, wakeHostFromUrl } from "@cz/client-runtime/state/hostWake";
import { runAtomCommand } from "@cz/client-runtime/state/runtime";
import type { EnvironmentId } from "@cz/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useCallback, useContext } from "react";

import { type WakeOutcome, wakeMessage } from "../model/wake.ts";
import type { TuiAtoms } from "../state/atoms.ts";
import { failureMessage } from "./command.ts";

/**
 * Wakes a sleeping host through the other connected hosts on its LAN, and
 * resolves to a line for the status bar, or null when there's nothing worth
 * saying. `userInitiated` (the w key) always explains; an automatic wake
 * only reports a wake that was actually tried.
 */
export function useWakeHost(atoms: TuiAtoms) {
  const registry = useContext(RegistryContext);
  return useCallback(
    async (
      target: EnvironmentId,
      options: { readonly userInitiated: boolean },
    ): Promise<string | null> => {
      const catalog = registry.get(atoms.catalog.catalogValueAtom);
      const entry = catalog.entries.get(target);
      if (!entry) return options.userInitiated ? "Unknown host." : null;
      const labelOf = (id: EnvironmentId) => catalog.entries.get(id)?.target.label ?? id;
      const host = wakeHostFromUrl(connectionCatalogDisplayUrl(entry));
      const outcome: WakeOutcome<EnvironmentId> = host
        ? await attemptWake({
            host,
            through: [...catalog.entries.keys()].filter((environmentId) => {
              if (environmentId === target) return false;
              const state = AsyncResult.value(registry.get(atoms.catalog.stateAtom(environmentId)));
              return Option.isSome(state) && state.value.phase === "connected";
            }),
            wake: async (environmentId, wakeHost) => {
              const result = await runAtomCommand(
                registry,
                atoms.hostWake.wake,
                { environmentId, input: { host: wakeHost } },
                { label: atoms.hostWake.wake.label, reportFailure: false, reportDefect: false },
              );
              if (AsyncResult.isSuccess(result)) return result.value;
              throw new Error(failureMessage(result.cause));
            },
          })
        : { kind: "no-address" };
      return wakeMessage({
        label: entry.target.label,
        outcome,
        labelOf,
        userInitiated: options.userInitiated,
      });
    },
    [atoms, registry],
  );
}
