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

/**
 * The Morning brief, pinned above Needs you: the night since 18:00 for the
 * machines the filter shows. It starts as one line, because the Decisions
 * it counts are the cards right under it; tapping it opens what finished
 * and failed overnight.
 */
export function MorningBriefCard({
  brief,
  placement,
  machineLabel,
}: {
  readonly brief: MorningBrief<DecisionEntry, EnvironmentThreadShell>;
  readonly placement: (thread: EnvironmentThreadShell) => { readonly excerpt: string | null };
  readonly machineLabel: (environmentId: string) => string;
}) {
  const [open, setOpen] = useState(false);
  if (morningBriefIsEmpty(brief)) return null;
  const summary = morningBriefSummary(brief);
  const { threads, failedJobs } = brief;
  const overnight = [...threads.failed, ...threads.finished];

  if (!open || (overnight.length === 0 && failedJobs.length === 0)) {
    return (
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent/40"
        onClick={() => setOpen((current) => !current)}
      >
        <SunriseIcon className="size-4 shrink-0" />
        <span className="shrink-0 font-medium text-foreground">Morning brief</span>
        <span className="truncate">{summary}</span>
      </button>
    );
  }

  return (
    <section
      aria-label="Morning brief"
      className="space-y-4 rounded-xl border border-border bg-card px-4 py-3"
    >
      <header className="flex items-center gap-2">
        <SunriseIcon className="size-4 shrink-0 text-muted-foreground" />
        <h2 className="text-sm font-medium text-foreground">Morning brief</h2>
        <span className="flex-1 truncate text-xs text-muted-foreground">since 18:00</span>
        <Button size="xs" variant="ghost" onClick={() => setOpen(false)}>
          Fold
        </Button>
      </header>

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
