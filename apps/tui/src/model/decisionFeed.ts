/**
 * Open decisions from every connected host as one feed, in the order the web
 * and mobile feeds use, optionally limited to the current project.
 *
 * @module decisionFeed
 */
import { compareFeedItems } from "@cz/client-runtime/decisions/feed";
import type { DecisionItemWithAnswer, EnvironmentId } from "@cz/contracts";

export interface DecisionEntry extends DecisionItemWithAnswer {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
}

export function decisionFeed(
  hosts: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly label: string;
    readonly items: ReadonlyArray<DecisionItemWithAnswer>;
  }>,
  /** Lower-case project names in scope, or null for every project. */
  scopeNames: ReadonlySet<string> | null,
): Array<DecisionEntry> {
  return (
    hosts
      .flatMap((host) =>
        host.items.map((entry) => ({
          ...entry,
          environmentId: host.environmentId,
          environmentLabel: host.label,
        })),
      )
      // "hll:art" and "hll/sfx" belong to the hll project, as in the feed's ordering.
      .filter(
        (entry) =>
          scopeNames === null ||
          scopeNames.has(entry.item.project.toLowerCase().split(/[:/]/)[0] ?? ""),
      )
      .sort((left, right) => compareFeedItems(left.item, right.item))
  );
}

/** Short kind tags for a 60-column list. */
export const KIND_TAG: Record<DecisionItemWithAnswer["item"]["kind"], string> = {
  pick: "pick",
  review: "review",
  listen: "listen",
  look: "3D",
  read: "read",
  playtest: "play",
  rank: "rank",
  pitch: "pitch",
  request: "ask",
  timeline: "steps",
};
