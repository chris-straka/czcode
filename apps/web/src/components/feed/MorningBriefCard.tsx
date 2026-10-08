import {
  type MorningBrief,
  morningBriefIsEmpty,
  morningBriefSummary,
} from "@cz/client-runtime/decisions/morningBrief";
import type { EnvironmentThreadShell } from "@cz/client-runtime/state/models";
import { Link } from "@tanstack/react-router";
import { SunriseIcon } from "lucide-react";
import { useState } from "react";

import type { DecisionEntry } from "~/state/decisions";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

/** Rows per overnight list before "and N more". */
const LIST_LIMIT = 5;
const DONE_KEY = "cz:morning-brief-done";

function readDoneDay(): string | null {
  try {
    return localStorage.getItem(DONE_KEY);
  } catch {
    return null;
  }
}

/**
 * The Morning brief, pinned above the feed: the night since 18:00 for the
 * machines the filter shows. "Done reading" folds it to one line for the
 * rest of the day; the next morning's brief opens again.
 */
export function MorningBriefCard({
  day,
  brief,
  placement,
  machineLabel,
  onOpenDecision,
  onReviewAll,
}: {
  readonly day: string;
  readonly brief: MorningBrief<DecisionEntry, EnvironmentThreadShell>;
  readonly placement: (thread: EnvironmentThreadShell) => { readonly excerpt: string | null };
  readonly machineLabel: (environmentId: string) => string;
  readonly onOpenDecision: (entry: DecisionEntry) => void;
  readonly onReviewAll: () => void;
}) {
  const [doneDay, setDoneDay] = useState(readDoneDay);
  const setDone = (value: string | null) => {
    setDoneDay(value);
    try {
      if (value) localStorage.setItem(DONE_KEY, value);
      else localStorage.removeItem(DONE_KEY);
    } catch {
      // Private mode: the fold lasts until reload.
    }
  };
  if (morningBriefIsEmpty(brief)) return null;
  const summary = morningBriefSummary(brief);

  if (doneDay === day) {
    return (
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent/40"
        onClick={() => setDone(null)}
      >
        <SunriseIcon className="size-4 shrink-0" />
        <span className="shrink-0 font-medium text-foreground">Morning brief</span>
        <span className="truncate">{summary}</span>
      </button>
    );
  }

  const { decisions, threads, failedJobs } = brief;
  const groups = [
    decisions.byGroup.games > 0 ? `Games ${decisions.byGroup.games}` : null,
    decisions.byGroup.software > 0 ? `Software ${decisions.byGroup.software}` : null,
  ].filter((part) => part !== null);
  const overnight = [...threads.failed, ...threads.finished];

  return (
    <section
      aria-label="Morning brief"
      className="space-y-4 rounded-xl border border-border bg-card px-4 py-3"
    >
      <header className="flex items-center gap-2">
        <SunriseIcon className="size-4 shrink-0 text-muted-foreground" />
        <h2 className="text-sm font-medium text-foreground">Morning brief</h2>
        <span className="flex-1 truncate text-xs text-muted-foreground">since 18:00</span>
        <Button size="xs" variant="ghost" onClick={() => setDone(day)}>
          Done reading
        </Button>
      </header>

      {decisions.total > 0 ? (
        <div className="space-y-1.5">
          <div className="flex items-baseline gap-2">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Decisions waiting
            </h3>
            <span className="text-xs tabular-nums text-warning-foreground">{decisions.total}</span>
            <span className="flex-1" />
            <Button size="xs" variant="outline" onClick={onReviewAll}>
              Review all
            </Button>
          </div>
          <ol className="space-y-1">
            {decisions.top.map((entry) => (
              <li key={`${entry.environmentId}:${entry.item.id}`}>
                <button
                  type="button"
                  className="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left hover:bg-accent/40"
                  onClick={() => onOpenDecision(entry)}
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {entry.item.title || entry.item.question}
                  </span>
                  {entry.item.blocking ? (
                    <Badge size="sm" variant="warning">
                      agent waiting
                    </Badge>
                  ) : entry.item.cost_note ? (
                    <Badge size="sm" variant="info">
                      costs money
                    </Badge>
                  ) : null}
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {entry.item.project} · {entry.item.kind}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <p className="truncate px-1 text-xs text-muted-foreground">
            {[
              groups.join(" · "),
              decisions.byProject
                .slice(0, 6)
                .map(({ project, count }) => `${project} ${count}`)
                .join(", "),
            ]
              .filter(Boolean)
              .join(" — ")}
          </p>
        </div>
      ) : null}

      {overnight.length > 0 ? (
        <div className="space-y-1.5">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Threads overnight
          </h3>
          <ul className="space-y-1">
            {overnight.slice(0, LIST_LIMIT).map((thread) => {
              const failed = threads.failed.includes(thread);
              const excerpt = placement(thread).excerpt;
              return (
                <li key={`${thread.environmentId}:${thread.id}`}>
                  <Link
                    to="/$environmentId/$threadId"
                    params={{ environmentId: thread.environmentId, threadId: thread.id }}
                    className="block rounded-md px-1 py-0.5 hover:bg-accent/40"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Badge size="sm" variant={failed ? "error" : "success"}>
                        {failed ? "Failed" : "Done"}
                      </Badge>
                      <span className="truncate text-sm text-foreground">{thread.title}</span>
                    </span>
                    {excerpt ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {excerpt}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
          {overnight.length > LIST_LIMIT ? (
            <p className="px-1 text-xs text-muted-foreground">
              and {overnight.length - LIST_LIMIT} more below
            </p>
          ) : null}
        </div>
      ) : null}

      {failedJobs.length > 0 ? (
        <div className="space-y-1.5">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Scheduled jobs that failed
          </h3>
          <ul className="space-y-1">
            {failedJobs.map(({ environmentId, job, run }) => (
              <li key={`${environmentId}:${job.id}`}>
                <Link to="/schedules" className="block rounded-md px-1 py-0.5 hover:bg-accent/40">
                  <span className="block truncate text-sm text-foreground">
                    {job.what}
                    <span className="text-muted-foreground"> · {machineLabel(environmentId)}</span>
                  </span>
                  {run.reason ? (
                    <span className="block truncate text-xs text-destructive">{run.reason}</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
