/**
 * The one feed: threads and decisions merged, so the owner reads each thing
 * once. A decision is a thread waiting on the owner, so it rides on its
 * thread's card; decisions from outside a thread get cards of their own.
 * Cards that need the owner come first. Shared by web and mobile.
 *
 * @module oneFeed
 */
import type { DecisionItem, EnvironmentId } from "@cz/contracts";

import { compareFeedItems, DEFAULT_PROJECT_ORDER } from "./feed.ts";

export interface OneFeedThread {
  readonly environmentId: EnvironmentId;
  readonly id: string;
  readonly projectId: string;
  readonly updatedAt: string;
  readonly settledAt: string | null;
  readonly archivedAt: string | null;
  readonly deletedAt: string | null;
  readonly hasPendingApprovals: boolean;
  readonly hasPendingUserInput: boolean;
  readonly lineage: { readonly relationshipToParent: "fork" | "subagent" | null };
}

export interface OneFeedDecision {
  readonly environmentId: EnvironmentId;
  readonly item: DecisionItem;
}

export type OneFeedCard<T extends OneFeedThread, D extends OneFeedDecision> =
  | {
      readonly kind: "thread";
      readonly key: string;
      readonly thread: T;
      /** Open decisions this thread asked, in feed order. */
      readonly decisions: ReadonlyArray<D>;
      readonly needsYou: boolean;
    }
  | {
      readonly kind: "decision";
      readonly key: string;
      readonly decision: D;
      readonly needsYou: true;
    };

/** Which machines the feed shows: one environment, or every connected one. */
export type MachineFilter =
  | { readonly type: "all" }
  | { readonly type: "one"; readonly environmentId: EnvironmentId };

export interface OneFeedFilter {
  readonly machine: MachineFilter;
  /** Decision projects to keep; empty keeps all. Threads stay unless they have none of them. */
  readonly projects?: ReadonlySet<string>;
}

export function machineMatches(filter: MachineFilter, environmentId: EnvironmentId): boolean {
  return filter.type === "all" || filter.environmentId === environmentId;
}

const threadKey = (environmentId: string, threadId: string) => `${environmentId}\u0000${threadId}`;

/**
 * Builds the feed: needs-you cards first (decision order, then threads
 * waiting on approvals or input, newest first), then the rest newest first.
 * Settled, archived, deleted, and subagent threads stay out; a settled
 * thread with an open decision comes back, since it needs the owner.
 */
export function buildOneFeed<T extends OneFeedThread, D extends OneFeedDecision>(input: {
  readonly threads: ReadonlyArray<T>;
  readonly decisions: ReadonlyArray<D>;
  readonly filter: OneFeedFilter;
  readonly projectOrder?: readonly string[];
}): ReadonlyArray<OneFeedCard<T, D>> {
  const { filter } = input;
  const projectOrder = input.projectOrder ?? DEFAULT_PROJECT_ORDER;
  const decisions = input.decisions
    .filter(
      (entry) =>
        entry.item.status === "open" &&
        machineMatches(filter.machine, entry.environmentId) &&
        (!filter.projects?.size || filter.projects.has(entry.item.project)),
    )
    .toSorted((a, b) => compareFeedItems(a.item, b.item, projectOrder));

  const threadsByKey = new Map(
    input.threads
      .filter(
        (thread) =>
          thread.deletedAt === null &&
          thread.archivedAt === null &&
          thread.lineage.relationshipToParent !== "subagent" &&
          machineMatches(filter.machine, thread.environmentId),
      )
      .map((thread) => [threadKey(thread.environmentId, thread.id), thread] as const),
  );

  const asked = new Map<string, D[]>();
  const standalone: D[] = [];
  for (const entry of decisions) {
    const key = entry.item.thread ? threadKey(entry.environmentId, entry.item.thread) : null;
    if (key !== null && threadsByKey.has(key)) {
      const list = asked.get(key) ?? [];
      list.push(entry);
      asked.set(key, list);
    } else {
      standalone.push(entry);
    }
  }

  const decisionRank = new Map(decisions.map((entry, index) => [entry, index] as const));
  const needsYou: Array<{ readonly rank: number; readonly card: OneFeedCard<T, D> }> = [];
  const rest: Array<OneFeedCard<T, D> & { readonly kind: "thread" }> = [];

  for (const entry of standalone) {
    needsYou.push({
      rank: decisionRank.get(entry)!,
      card: {
        kind: "decision",
        key: `decision\u0000${entry.environmentId}\u0000${entry.item.id}`,
        decision: entry,
        needsYou: true,
      },
    });
  }
  for (const [key, thread] of threadsByKey) {
    const threadDecisions = asked.get(key) ?? [];
    const waiting = thread.hasPendingApprovals || thread.hasPendingUserInput;
    if (threadDecisions.length === 0 && thread.settledAt !== null) continue;
    if (filter.projects?.size && threadDecisions.length === 0) continue;
    const card = {
      kind: "thread",
      key: `thread\u0000${key}`,
      thread,
      decisions: threadDecisions,
      needsYou: threadDecisions.length > 0 || waiting,
    } as const;
    if (threadDecisions.length > 0)
      needsYou.push({ rank: decisionRank.get(threadDecisions[0]!)!, card });
    else if (waiting) needsYou.push({ rank: decisions.length, card });
    else rest.push(card);
  }

  const updatedAt = (card: OneFeedCard<T, D>) =>
    card.kind === "thread" ? Date.parse(card.thread.updatedAt) : card.decision.item.created_at;
  return [
    ...needsYou
      .toSorted((a, b) => a.rank - b.rank || updatedAt(b.card) - updatedAt(a.card))
      .map(({ card }) => card),
    ...rest.toSorted((a, b) => updatedAt(b) - updatedAt(a)),
  ];
}

/** The inbox badge: open decisions the current filter shows, so every client agrees. */
export function oneFeedBadgeCount(
  cards: ReadonlyArray<OneFeedCard<OneFeedThread, OneFeedDecision>>,
): number {
  return cards.reduce(
    (count, card) => count + (card.kind === "decision" ? 1 : card.decisions.length),
    0,
  );
}

/**
 * The folder a card names: the subfolder a thread worked in when its project
 * is a workspace of many repos (like ~/SWE), else the project's title.
 */
export function feedFolderLabel(
  projectTitle: string,
  workingSubpath: string | null | undefined,
): string {
  return workingSubpath || projectTitle;
}

/** A short model name for card headers: "Claude Opus 5.5" reads as "Opus 5.5". */
export function shortModelLabel(displayName: string): string {
  return displayName.replace(/^Claude\s+/i, "").trim() || displayName;
}

/** A machine's short name for card headers: "f-ms-7917" reads as "f". */
export function shortMachineLabel(label: string): string {
  return label.split(/[-.\s]/)[0] || label;
}
