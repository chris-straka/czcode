/**
 * Decisions from every connected environment, merged into one feed
 * (ccez/DECISIONS.md). Each host keeps the decisions its agents asked; the
 * client reads them all and orders them together.
 *
 * @module state/decisions
 */
import { useAtomValue } from "@effect/atom-react";
import { compareFeedItems } from "@cz/client-runtime/decisions/feed";
import { createDecisionEnvironmentAtoms } from "@cz/client-runtime/state/decisions";
import type { DecisionItemWithAnswer, EnvironmentId } from "@cz/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { environmentPresentations } from "./presentation";

/** Decisions on each connected environment. */
export const decisionEnvironment = createDecisionEnvironmentAtoms(connectionAtomRuntime);

export interface DecisionEntry extends DecisionItemWithAnswer {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
}

export interface DecisionFeed {
  readonly entries: readonly DecisionEntry[];
  /** True until every reachable environment has answered once. */
  readonly isPending: boolean;
  /** Environments that couldn't be read (asleep, offline, older server). */
  readonly unreachable: readonly string[];
}

const openFeedAtom = Atom.make((get): DecisionFeed => {
  const presentations = get(environmentPresentations.presentationsAtom);
  const entries: DecisionEntry[] = [];
  const unreachable: string[] = [];
  let isPending = false;
  for (const [environmentId, presentation] of presentations) {
    const label = presentation.entry.target.label;
    const result = get(decisionEnvironment.list({ environmentId, input: { status: "open" } }));
    const items = Option.getOrNull(AsyncResult.value(result));
    if (items === null) {
      if (result._tag === "Failure") unreachable.push(label);
      else isPending = true;
      continue;
    }
    for (const entry of items) entries.push({ ...entry, environmentId, environmentLabel: label });
  }
  entries.sort((a, b) => compareFeedItems(a.item, b.item));
  return { entries, isPending: isPending && entries.length === 0, unreachable };
}).pipe(Atom.withLabel("web-decisions:open-feed"));

export function useOpenDecisions(): DecisionFeed {
  return useAtomValue(openFeedAtom);
}

/** Open decisions asked from one thread (the thread's banner links to them). */
export function useThreadDecisions(
  environmentId: EnvironmentId | null,
  threadId: string | null,
): readonly DecisionEntry[] {
  const feed = useOpenDecisions();
  return threadId === null
    ? []
    : feed.entries.filter(
        (entry) => entry.environmentId === environmentId && entry.item.thread === threadId,
      );
}

// Per thread, so a sidebar row re-renders only when its own count changes.
const threadOpenDecisionCount = Atom.family((key: string) =>
  Atom.make(
    (get) =>
      get(openFeedAtom).entries.filter(
        (entry) => `${entry.environmentId}:${entry.item.thread}` === key,
      ).length,
  ),
);

/** How many open decisions a thread has asked (the sidebar marks those threads). */
export function useThreadOpenDecisionCount(environmentId: EnvironmentId, threadId: string): number {
  return useAtomValue(threadOpenDecisionCount(`${environmentId}:${threadId}`));
}
