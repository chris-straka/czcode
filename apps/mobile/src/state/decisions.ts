/**
 * Decisions from every connected environment, merged into one feed
 * (ccez/DECISIONS.md). Each host keeps the decisions its agents asked; the
 * client reads them all and orders them together.
 *
 * @module state/decisions
 */
import { useAtomValue } from "@effect/atom-react";
import { buildOneFeed, waitingOnOtherDevice } from "@cz/client-runtime/decisions/oneFeed";
import { useMemo } from "react";
import { compareFeedItems } from "@cz/client-runtime/decisions/feed";
import { createDecisionEnvironmentAtoms } from "@cz/client-runtime/state/decisions";
import type { DecisionItemWithAnswer, EnvironmentId } from "@cz/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

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

// Per thread, so a list row re-renders only when its own count changes.
const threadOpenDecisionCount = Atom.family((key: string) =>
  Atom.make(
    (get) =>
      get(openFeedAtom).entries.filter(
        (entry) => `${entry.environmentId}:${entry.item.thread}` === key,
      ).length,
  ),
);

/** How many open decisions a thread has asked (the thread list marks those threads). */
export function useThreadOpenDecisionCount(environmentId: EnvironmentId, threadId: string): number {
  return useAtomValue(threadOpenDecisionCount(`${environmentId}:${threadId}`));
}

/** Decision project chips picked in the feed; the header badge counts the same set. */
export const feedProjectsAtom = Atom.make<ReadonlyArray<string>>([]).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile-decisions:feed-projects"),
);

/** Open decisions this phone shows: every host, the picked projects, and phone-or-any targets. */
export function useFilteredOpenDecisions(): {
  readonly entries: readonly DecisionEntry[];
  readonly elsewhere: number;
} {
  const feed = useOpenDecisions();
  const projects = useAtomValue(feedProjectsAtom);
  return useMemo(() => {
    const filter = {
      machine: { type: "all" },
      device: "phone",
      projects: new Set(projects),
    } as const;
    const cards = buildOneFeed({ threads: [], decisions: feed.entries, filter });
    return {
      entries: cards.flatMap((card) =>
        card.kind === "decision" ? [card.decision] : card.decisions,
      ),
      elsewhere: waitingOnOtherDevice(feed.entries, filter),
    };
  }, [feed.entries, projects]);
}

const answeredFeedAtom = Atom.make((get): DecisionFeed => {
  const entries: DecisionEntry[] = [];
  const unreachable: string[] = [];
  let isPending = false;
  for (const [environmentId, presentation] of get(environmentPresentations.presentationsAtom)) {
    const label = presentation.entry.target.label;
    const result = get(
      decisionEnvironment.list({ environmentId, input: { status: "answered", limit: 50 } }),
    );
    const items = Option.getOrNull(AsyncResult.value(result));
    if (items === null) {
      if (result._tag === "Failure") unreachable.push(label);
      else isPending = true;
      continue;
    }
    for (const entry of items) entries.push({ ...entry, environmentId, environmentLabel: label });
  }
  entries.sort((a, b) => (b.item.answered_at ?? 0) - (a.item.answered_at ?? 0));
  return { entries, isPending: isPending && entries.length === 0, unreachable };
}).pipe(Atom.withLabel("mobile-decisions:answered-feed"));

/** Recently answered decisions on every host, newest first. */
export function useAnsweredDecisions(): DecisionFeed {
  return useAtomValue(answeredFeedAtom);
}

const projectBlurbsAtom = Atom.make((get): ReadonlyMap<string, string> => {
  const blurbs = new Map<string, { readonly text: string; readonly owner: boolean }>();
  for (const [environmentId] of get(environmentPresentations.presentationsAtom)) {
    const result = get(decisionEnvironment.projects({ environmentId, input: "all" }));
    for (const blurb of Option.getOrNull(AsyncResult.value(result)) ?? []) {
      if (blurb.description === null) continue;
      if (!blurbs.has(blurb.project) || blurb.source === "owner") {
        blurbs.set(blurb.project, { text: blurb.description, owner: blurb.source === "owner" });
      }
    }
  }
  return new Map([...blurbs].map(([project, blurb]) => [project, blurb.text] as const));
}).pipe(Atom.withLabel("mobile-decisions:project-blurbs"));

/** One line per decision project to jog the owner's memory. */
export function useProjectBlurbs(): ReadonlyMap<string, string> {
  return useAtomValue(projectBlurbsAtom);
}
