/**
 * Ordering and filtering for the Decisions feed and review session.
 *
 * @module feed
 */
import type { DecisionKind, Item } from "./schema.ts";

/** Projects that sort ahead of the rest, highest first (ccez/DECISIONS.md). */
export const DEFAULT_PROJECT_ORDER: readonly string[] = ["hll"];

// "hll", "hll-bevy", and "hll:art" all belong to the hll project.
function projectRank(project: string, order: readonly string[]): number {
  const base = project.toLowerCase().split(/[:/]/)[0] ?? "";
  const index = order.findIndex((key) => base === key || base.startsWith(`${key}-`));
  return index === -1 ? order.length : index;
}

/**
 * Open items in the order the owner sees them: blocking first, then project
 * priority, then the item's own priority, then oldest first.
 */
export function orderFeed(
  items: readonly Item[],
  projectOrder: readonly string[] = DEFAULT_PROJECT_ORDER,
): Item[] {
  return items
    .filter((item) => item.status === "open")
    .toSorted(
      (a, b) =>
        Number(b.blocking) - Number(a.blocking) ||
        projectRank(a.project, projectOrder) - projectRank(b.project, projectOrder) ||
        b.priority - a.priority ||
        a.created_at - b.created_at,
    );
}

export interface FeedFilter {
  readonly projects?: ReadonlySet<string>;
  readonly kinds?: ReadonlySet<DecisionKind>;
}

export function filterFeed(items: readonly Item[], filter: FeedFilter): Item[] {
  return items.filter(
    (item) =>
      (!filter.projects?.size || filter.projects.has(item.project)) &&
      (!filter.kinds?.size || filter.kinds.has(item.kind)),
  );
}

/** Chip values for the feed's filter row, most common first. */
export function filterChips(items: readonly Item[]): {
  readonly projects: readonly string[];
  readonly kinds: readonly DecisionKind[];
} {
  const count = <K>(keys: readonly K[]) => {
    const counts = new Map<K, number>();
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
    return [...counts].toSorted((a, b) => b[1] - a[1]).map(([key]) => key);
  };
  return {
    projects: count(items.map((item) => item.project)),
    kinds: count(items.map((item) => item.kind)),
  };
}
