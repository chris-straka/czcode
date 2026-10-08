import type { EnvironmentThreadShell } from "@cz/client-runtime/state/models";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../ui/button";
import { FeedThreadRow, type FeedThreadStatus, feedThreadStatus } from "./FeedThreadCard";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Finished threads older than this fold under "older" in their group; the server archives them later. */
const FOLD_AFTER_MS = 3 * DAY_MS;

export interface ThreadPlace {
  readonly machine: string;
  readonly folder: string;
  readonly excerpt: string | null;
  readonly age: string;
  /** The project the thread is grouped under. */
  readonly project: string;
}

const STATUS_RANK: Record<FeedThreadStatus, number> = {
  running: 0,
  "needs-you": 1,
  failed: 2,
  done: 3,
  idle: 3,
};

interface Group {
  readonly project: string;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly latest: number;
  readonly running: number;
  readonly lively: boolean;
}

/** Threads by project, newest project first; running threads lead each group. */
function groupThreads(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  place: (thread: EnvironmentThreadShell) => ThreadPlace,
  needsYou: (thread: EnvironmentThreadShell) => boolean,
  now: number,
): Group[] {
  const byProject = new Map<string, EnvironmentThreadShell[]>();
  for (const thread of threads) {
    const project = place(thread).project;
    const list = byProject.get(project) ?? [];
    list.push(thread);
    byProject.set(project, list);
  }
  const status = (thread: EnvironmentThreadShell) => feedThreadStatus(thread, needsYou(thread));
  return [...byProject]
    .map(([project, list]) => {
      const sorted = [...list].sort(
        (a, b) =>
          STATUS_RANK[status(a)] - STATUS_RANK[status(b)] ||
          Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
      );
      const latest = Math.max(...list.map((thread) => Date.parse(thread.updatedAt)));
      const running = list.filter((thread) => status(thread) === "running").length;
      return {
        project,
        threads: sorted,
        latest,
        running,
        lively: running > 0 || list.some((thread) => needsYou(thread)) || now - latest < DAY_MS,
      };
    })
    .sort((a, b) => b.latest - a.latest);
}

/**
 * Every thread, grouped by project in collapsible groups: groups with
 * something running, waiting on the owner, or touched in the last day open;
 * the rest fold to one line. Each row reads its last summary line, so the
 * list makes sense without opening anything.
 */
export function FeedThreadGroups({
  threads,
  place,
  needsYou,
  now,
}: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly place: (thread: EnvironmentThreadShell) => ThreadPlace;
  readonly needsYou: (thread: EnvironmentThreadShell) => boolean;
  readonly now: number;
}) {
  const [open, setOpen] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [olderShown, setOlderShown] = useState<ReadonlySet<string>>(new Set());
  const groups = groupThreads(threads, place, needsYou, now);
  return (
    <div className="space-y-2">
      {groups.map((group) => {
        const expanded = open.get(group.project) ?? group.lively;
        const recent = group.threads.filter((thread) => {
          const status = feedThreadStatus(thread, needsYou(thread));
          return (
            status === "running" ||
            status === "needs-you" ||
            now - Date.parse(thread.updatedAt) < FOLD_AFTER_MS
          );
        });
        const older = group.threads.length - recent.length;
        const rows = olderShown.has(group.project) ? group.threads : recent;
        return (
          <section
            key={group.project}
            aria-label={group.project}
            className="overflow-hidden rounded-lg border border-border bg-card"
          >
            <button
              type="button"
              aria-expanded={expanded}
              data-feed-item=""
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left outline-none hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              onClick={() => setOpen((current) => new Map(current).set(group.project, !expanded))}
            >
              {expanded ? (
                <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                {group.project}
              </span>
              {group.running > 0 ? (
                <span className="text-xs text-info-foreground">{group.running} running</span>
              ) : null}
              <span className="text-xs tabular-nums text-muted-foreground">
                {group.threads.length}
              </span>
            </button>
            {expanded ? (
              <div className="border-t border-border">
                {rows.map((thread) => (
                  <FeedThreadRow
                    key={`${thread.environmentId}:${thread.id}`}
                    thread={thread}
                    {...place(thread)}
                    status={feedThreadStatus(thread, needsYou(thread))}
                  />
                ))}
                {older > 0 && !olderShown.has(group.project) ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    className="m-2"
                    onClick={() => setOlderShown((current) => new Set(current).add(group.project))}
                  >
                    {older} older
                  </Button>
                ) : null}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
