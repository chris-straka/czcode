/**
 * What the feed shows: which machines, and which decision projects and
 * kinds. The inbox badge reads the same filter, so every count agrees with
 * the cards on screen. Only the machine choice persists; chips reset per
 * session.
 */
import type { MachineFilter } from "@cz/client-runtime/decisions/oneFeed";
import type { EnvironmentId } from "@cz/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

interface FeedFilterState {
  /** null: this machine, the default. */
  readonly machine: MachineFilter | null;
  readonly projects: ReadonlyArray<string>;
  readonly kinds: ReadonlyArray<string>;
  readonly setMachine: (machine: MachineFilter | null) => void;
  readonly setProjects: (projects: ReadonlyArray<string>) => void;
  readonly setKinds: (kinds: ReadonlyArray<string>) => void;
}

export const useFeedFilterStore = create<FeedFilterState>()(
  persist(
    (set) => ({
      machine: null,
      projects: [],
      kinds: [],
      setMachine: (machine) => set({ machine }),
      setProjects: (projects) => set({ projects }),
      setKinds: (kinds) => set({ kinds }),
    }),
    {
      name: "czcode:feed-filter:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ machine: state.machine }),
    },
  ),
);

/** The machine filter in effect: the stored one, else this machine. */
export function resolveMachineFilter(
  machine: MachineFilter | null,
  primaryEnvironmentId: EnvironmentId | null,
): MachineFilter {
  if (machine !== null) return machine;
  return primaryEnvironmentId === null
    ? { type: "all" }
    : { type: "one", environmentId: primaryEnvironmentId };
}
