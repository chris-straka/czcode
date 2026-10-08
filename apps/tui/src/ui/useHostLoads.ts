import { useAtomValue } from "@effect/atom-react";
import type { SupervisorConnectionState } from "@cz/client-runtime/connection";
import type { EnvironmentId } from "@cz/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { Text } from "ink";
import { createElement as h, useEffect, useMemo, useState } from "react";

import { type HostLoadEntry, hostLoad, hostLoadSummary, SLOW_HOST_MS } from "../model/hostLoad.ts";
import type { TuiAtoms } from "../state/atoms.ts";

export interface HostResult {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly hasValue: boolean;
  readonly failed: boolean;
}

function connectionPhasesAtom(atoms: TuiAtoms) {
  return Atom.make((get) => {
    const phases = new Map<EnvironmentId, SupervisorConnectionState["phase"]>();
    for (const [environmentId, entry] of get(atoms.catalog.catalogValueAtom).entries) {
      if (!entry.enabled) continue;
      const state = Option.getOrNull(
        AsyncResult.value(get(atoms.catalog.stateAtom(environmentId))),
      );
      if (state) phases.set(environmentId, state.phase);
    }
    return phases;
  });
}

/** Each host's progress on a screen's data; hosts still loading turn "slow" after a while. */
export function useHostLoads(
  atoms: TuiAtoms,
  results: ReadonlyArray<HostResult>,
): ReadonlyArray<HostLoadEntry> {
  const phases = useAtomValue(useMemo(() => connectionPhasesAtom(atoms), [atoms]));
  const [openedAt] = useState(() => Date.now());
  const [, rerender] = useState(0);
  const waiting = results.some((result) => !result.hasValue && !result.failed);
  // One repaint at the threshold, only while something is still loading.
  useEffect(() => {
    if (!waiting) return;
    const remaining = SLOW_HOST_MS - (Date.now() - openedAt);
    if (remaining <= 0) return;
    const timer = setTimeout(() => rerender((count) => count + 1), remaining);
    return () => clearTimeout(timer);
  }, [waiting, openedAt]);
  const waitedMs = Date.now() - openedAt;
  return results.map((result) => ({
    label: result.label,
    load: hostLoad({
      phase: phases.get(result.environmentId) ?? null,
      hasValue: result.hasValue,
      failed: result.failed,
      waitedMs,
    }),
  }));
}

/** One dim line naming the hosts a screen isn't showing yet, or nothing. */
export function HostLoadLine({ hosts }: { readonly hosts: ReadonlyArray<HostLoadEntry> }) {
  const summary = hostLoadSummary(hosts);
  return summary
    ? h(Text, { color: "yellow", dimColor: true, wrap: "truncate" }, `⚠ ${summary}`)
    : null;
}
