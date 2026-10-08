/**
 * What the feed shows: which machines, and which decision projects and
 * kinds. The inbox badge reads the same filter, so every count agrees with
 * the cards on screen. The machine choice and "show phone items" persist;
 * chips reset per session.
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
  /** Desktop only: phone playtests and other phone items stay hidden unless this is on. */
  readonly showPhoneItems: boolean;
  readonly setShowPhoneItems: (show: boolean) => void;
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
      showPhoneItems: false,
      setShowPhoneItems: (showPhoneItems) => set({ showPhoneItems }),
      setMachine: (machine) => set({ machine }),
      setProjects: (projects) => set({ projects }),
      setKinds: (kinds) => set({ kinds }),
    }),
    {
      name: "czcode:feed-filter:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ machine: state.machine, showPhoneItems: state.showPhoneItems }),
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
