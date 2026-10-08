import { shortMachineLabel, shortModelLabel } from "@cz/client-runtime/decisions/oneFeed";
import type { EnvironmentThreadShell } from "@cz/client-runtime/state/models";
import { formatModelSlugName } from "@cz/shared/model";
import { Link } from "@tanstack/react-router";
import { MonitorIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";

export type FeedThreadStatus = "needs-you" | "running" | "done" | "failed" | "idle";

/** What a thread is doing, in the words a card shows. */
export function feedThreadStatus(
  thread: EnvironmentThreadShell,
  needsYou: boolean,
): FeedThreadStatus {
  if (needsYou) return "needs-you";
  const status = thread.latestRun?.status;
  if (
    status === "running" ||
    status === "starting" ||
    status === "preparing" ||
    status === "queued"
  )
    return "running";
  if (status === "failed" || status === "interrupted") return "failed";
  if (status === "completed") return "done";
  return "idle";
}

const STATUS_BADGE: Record<
  FeedThreadStatus,
  { label: string; variant: "warning" | "info" | "success" | "error" | "secondary" }
> = {
  "needs-you": { label: "Needs you", variant: "warning" },
  running: { label: "Running", variant: "info" },
  done: { label: "Done", variant: "success" },
  failed: { label: "Failed", variant: "error" },
  idle: { label: "Idle", variant: "secondary" },
};

export function FeedStatusBadge({ status }: { readonly status: FeedThreadStatus }) {
  const { label, variant } = STATUS_BADGE[status];
  return (
    <Badge variant={variant} size="sm">
      {label}
    </Badge>
  );
}

/** "f · games/hll · Opus 5.5": where a thread runs, the folder it works in, and its model. */
export function FeedMeta({
  machine,
  folder,
  model,
  age,
}: {
  readonly machine: string;
  readonly folder: string;
  readonly model: string | null;
  readonly age?: string | null;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <MonitorIcon className="size-3 shrink-0" aria-hidden="true" />
      <span className="shrink-0">{shortMachineLabel(machine)}</span>
      <span aria-hidden="true">·</span>
      <span className="truncate">{folder}</span>
      {model ? (
        <>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">{model}</span>
        </>
      ) : null}
      {age ? <span className="ms-auto shrink-0 ps-2">{age}</span> : null}
    </div>
  );
}

export function threadModelLabel(thread: EnvironmentThreadShell): string {
  return shortModelLabel(formatModelSlugName(thread.modelSelection.model));
}

/** A thread that needs the owner: its header, then its decisions answerable in place. */
export function FeedThreadCard({
  thread,
  machine,
  folder,
  age,
  status,
  excerpt,
  children,
}: {
  readonly thread: EnvironmentThreadShell;
  readonly machine: string;
  readonly folder: string;
  readonly age: string;
  readonly status: FeedThreadStatus;
  readonly excerpt: string | null;
  readonly children?: ReactNode;
}) {
  return (
    <article
      className="space-y-3 rounded-lg border border-warning/40 bg-card p-4"
      data-feed-thread-card=""
    >
      <Link
        to="/$environmentId/$threadId"
        params={{ environmentId: thread.environmentId, threadId: thread.id }}
        data-feed-item=""
        className="block space-y-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-center gap-2">
          <FeedMeta machine={machine} folder={folder} model={threadModelLabel(thread)} age={age} />
          <FeedStatusBadge status={status} />
        </div>
        <h2 className="font-medium text-foreground">{thread.title}</h2>
        {excerpt && !children ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">{excerpt}</p>
        ) : null}
      </Link>
      {children}
    </article>
  );
}

/** A finished or running thread as one compact row: status, title, latest result, meta. */
export function FeedThreadRow({
  thread,
  machine,
  folder,
  age,
  status,
  excerpt,
  tries = 1,
  hoverTarget,
}: {
  readonly thread: EnvironmentThreadShell;
  readonly machine: string;
  readonly folder: string;
  readonly age: string;
  readonly status: FeedThreadStatus;
  readonly excerpt: string | null;
  /** Retries of the same title folded into this row. */
  readonly tries?: number;
  /** Names the row to the hover keys. */
  readonly hoverTarget?: string;
}) {
  return (
    <Link
      data-hover-target={hoverTarget}
      to="/$environmentId/$threadId"
      params={{ environmentId: thread.environmentId, threadId: thread.id }}
      className={cn(
        "block space-y-0.5 border-t border-border px-4 py-3 outline-none first:border-t-0 hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
      )}
      data-feed-thread-row=""
      data-feed-item=""
    >
      <div className="flex min-w-0 items-center gap-2">
        <FeedStatusBadge status={status} />
        <span className="truncate font-medium text-foreground">{thread.title}</span>
        {tries > 1 ? (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">×{tries}</span>
        ) : null}
      </div>
      {excerpt ? <p className="truncate text-sm text-muted-foreground">{excerpt}</p> : null}
      <FeedMeta machine={machine} folder={folder} model={threadModelLabel(thread)} age={age} />
    </Link>
  );
}
