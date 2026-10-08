import {
  latestRuns,
  type ProjectSummary,
  summarizeProjects,
  type ThreadRun,
} from "@cz/client-runtime/decisions/threadBoard";
import {
  type EnvironmentThreadShell,
  threadRuntimeCanArchive,
} from "@cz/client-runtime/state/models";
import { scopeThreadRef } from "@cz/client-runtime/environment";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  LayoutGridIcon,
  ListIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { useFeedFilterStore } from "~/feedFilterStore";
import { undoLatestThreadAction } from "~/hooks/showThreadUndoNotice";
import { useNavigateBack } from "~/hooks/useNavigateBack";
import { useThreadActions } from "~/hooks/useThreadActions";
import { cn } from "~/lib/utils";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  FeedStatusBadge,
  FeedThreadRow,
  type FeedThreadStatus,
  feedThreadStatus,
} from "./FeedThreadCard";
import { HOVER_TARGET_ATTRIBUTE, useHoverKeys } from "./threadHoverKeys";

export interface ThreadPlace {
  readonly machine: string;
  readonly folder: string;
  readonly excerpt: string | null;
  readonly age: string;
  /** The project the thread is grouped under. */
  readonly project: string;
}

/** How long an archive or delete can be undone. */
const UNDO_WINDOW_MS = 5_000;

type Summary = ProjectSummary<EnvironmentThreadShell>;
type Run = ThreadRun<EnvironmentThreadShell>;

const threadKey = (thread: EnvironmentThreadShell) => `${thread.environmentId}:${thread.id}`;
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
const hoverTarget = (value: string) => ({ [HOVER_TARGET_ATTRIBUTE]: value });

/**
 * The Threads page. By default a grid of project cards, busiest first; a
 * card opens that project's threads. The list view keeps every project as a
 * collapsible group, all collapsed until opened. Retries of one title fold
 * into one row, and hover keys (`threadHoverKeys.ts`) open, archive, delete,
 * or stop the row or card under the pointer.
 */
export function FeedThreadGroups({
  threads,
  place,
  needsYou,
  project,
  now,
  enabled,
}: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly place: (thread: EnvironmentThreadShell) => ThreadPlace;
  readonly needsYou: (thread: EnvironmentThreadShell) => boolean;
  /** The project opened from its card, or null for every project. */
  readonly project: string | null;
  readonly now: number;
  /** Hover keys listen only while the page is on screen. */
  readonly enabled: boolean;
}) {
  const navigate = useNavigate();
  const navigateBack = useNavigateBack();
  const view = useFeedFilterStore((state) => state.threadsView);
  const { archiveThread, deleteThread } = useThreadActions();
  const interrupt = useAtomCommand(threadEnvironment.interruptTurn, "stop thread");
  // Deleted threads hide at once and are deleted when the undo window closes.
  const [deleting, setDeleting] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
    };
  }, []);

  const statusOf = (thread: EnvironmentThreadShell): FeedThreadStatus =>
    feedThreadStatus(thread, needsYou(thread));
  const summaries = summarizeProjects(
    threads.filter((thread) => !deleting.has(threadKey(thread))),
    (thread) => place(thread).project,
    statusOf,
  );
  const opened =
    project === null ? null : (summaries.find((summary) => summary.project === project) ?? null);

  const openProject = (name: string) =>
    void navigate({ to: "/threads", search: { project: name } });

  const archive = async (targets: ReadonlyArray<EnvironmentThreadShell>) => {
    const archivable = targets.filter((thread) => threadRuntimeCanArchive(thread.runtime));
    const results = await Promise.all(
      archivable.map((thread) => archiveThread(scopeThreadRef(thread.environmentId, thread.id))),
    );
    const archived = results.filter((result) => result._tag === "Success").length;
    if (archived === 0) return;
    toastManager.add({
      type: "success",
      title: `Archived ${plural(archived, "thread")}`,
      timeout: UNDO_WINDOW_MS,
      actionProps: { children: "Undo", onClick: () => undoLatestThreadAction() },
    });
  };

  const remove = (targets: ReadonlyArray<EnvironmentThreadShell>) => {
    if (targets.length === 0) return;
    const keys = new Set(targets.map(threadKey));
    setDeleting((current) => new Set([...current, ...keys]));
    const restore = () =>
      setDeleting((current) => new Set([...current].filter((key) => !keys.has(key))));
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      void Promise.all(
        targets.map((thread) => deleteThread(scopeThreadRef(thread.environmentId, thread.id))),
      ).then(restore);
    }, UNDO_WINDOW_MS);
    timers.current.add(timer);
    toastManager.add({
      type: "success",
      title: `Deleted ${plural(targets.length, "thread")}`,
      timeout: UNDO_WINDOW_MS,
      actionProps: {
        children: "Undo",
        onClick: () => {
          clearTimeout(timer);
          timers.current.delete(timer);
          restore();
        },
      },
    });
  };

  const stop = (targets: ReadonlyArray<EnvironmentThreadShell>) => {
    for (const thread of targets) {
      if (statusOf(thread) !== "running") continue;
      void interrupt({ environmentId: thread.environmentId, input: { threadId: thread.id } });
    }
  };

  useHoverKeys((action, target) => {
    if (target.startsWith("project:")) {
      const name = target.slice("project:".length);
      const summary = summaries.find((candidate) => candidate.project === name);
      if (!summary) return;
      const tries = summary.runs.flatMap((run) => run.tries);
      if (action === "open") openProject(name);
      else if (action === "archive") void archive(summary.finished);
      // On a card, delete clears the failed threads, the clutter retries leave.
      else if (action === "delete") remove(tries.filter((thread) => statusOf(thread) === "failed"));
      else stop(tries);
      return;
    }
    const lead = target.slice("thread:".length);
    const run = summaries
      .flatMap((summary) => summary.runs)
      .find((candidate) => threadKey(candidate.lead) === lead);
    if (!run) return;
    if (action === "open") {
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: run.lead.environmentId, threadId: run.lead.id },
      });
    } else if (action === "archive") void archive(run.tries);
    else if (action === "delete") remove(run.tries);
    else stop(run.tries);
  }, enabled);

  const rows = (runs: ReadonlyArray<Run>) =>
    runs.map((run) => (
      <FeedThreadRow
        key={threadKey(run.lead)}
        thread={run.lead}
        {...place(run.lead)}
        status={run.status}
        tries={run.tries.length}
        hoverTarget={`thread:${threadKey(run.lead)}`}
      />
    ));

  if (project !== null) {
    return (
      <div className="space-y-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button size="icon-sm" variant="ghost" aria-label="All projects" onClick={navigateBack}>
            <ArrowLeftIcon />
          </Button>
          <h2 className="min-w-0 flex-1 truncate font-medium text-foreground">{project}</h2>
          {opened && opened.finished.length > 0 ? (
            <Button size="xs" variant="outline" onClick={() => void archive(opened.finished)}>
              Archive {opened.finished.length} finished
            </Button>
          ) : null}
        </div>
        {opened ? (
          <>
            <ProjectCounts summary={opened} />
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              {rows(opened.runs)}
            </div>
          </>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">No threads here.</p>
        )}
      </div>
    );
  }

  return (
    <>
      {view === "grid" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {summaries.map((summary) => (
            <ProjectCard key={summary.project} summary={summary} now={now} />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {summaries.map((summary) => (
            <ProjectGroup
              key={summary.project}
              summary={summary}
              onArchiveFinished={() => void archive(summary.finished)}
            >
              {rows(summary.runs)}
            </ProjectGroup>
          ))}
        </div>
      )}
    </>
  );
}

/** Grid or list, and in the list Collapse all / Expand all; sits beside the page tabs. */
export function ThreadsViewControls({ projects }: { readonly projects: ReadonlyArray<string> }) {
  const view = useFeedFilterStore((state) => state.threadsView);
  const setView = useFeedFilterStore((state) => state.setThreadsView);
  return (
    <div className="ms-auto flex items-center gap-1">
      {view === "list" ? <ExpandAll projects={projects} /> : null}
      <ToggleGroup
        aria-label="Threads view"
        value={[view]}
        onValueChange={(value) => {
          const next = value[0];
          if (next === "grid" || next === "list") setView(next);
        }}
      >
        <Toggle size="sm" value="grid" aria-label="Grid">
          <LayoutGridIcon />
        </Toggle>
        <Toggle size="sm" value="list" aria-label="List">
          <ListIcon />
        </Toggle>
      </ToggleGroup>
    </div>
  );
}

function ageLabel(epoch: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - epoch) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

/** "1 needs you · 2 running · 1 failed · 9 threads", leaving out the zeros. */
function ProjectCounts({ summary }: { readonly summary: Summary }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs tabular-nums">
      {summary.needsYou > 0 ? (
        <span className="text-warning-foreground">{summary.needsYou} needs you</span>
      ) : null}
      {summary.running > 0 ? (
        <span className="text-info-foreground">{summary.running} running</span>
      ) : null}
      {summary.failed > 0 ? (
        <span className="text-destructive-foreground">{summary.failed} failed</span>
      ) : null}
      <span className="text-muted-foreground">{plural(summary.threadCount, "thread")}</span>
    </div>
  );
}

/** A project at a glance: name, what needs attention, and its newest two tasks. */
function ProjectCard({ summary, now }: { readonly summary: Summary; readonly now: number }) {
  return (
    <Link
      to="/threads"
      search={{ project: summary.project }}
      {...hoverTarget(`project:${summary.project}`)}
      data-feed-item=""
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-4 outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring",
        summary.needsYou > 0 ? "border-warning/40" : "border-border",
      )}
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <h3 className="min-w-0 flex-1 truncate font-medium text-foreground">{summary.project}</h3>
        <span className="shrink-0 text-xs text-muted-foreground">
          {ageLabel(summary.latest, now)}
        </span>
      </div>
      <ProjectCounts summary={summary} />
      <ul className="space-y-1">
        {latestRuns(summary, 2).map((run) => (
          <li key={threadKey(run.lead)} className="flex min-w-0 items-center gap-2">
            <FeedStatusBadge status={run.status} />
            <span className="truncate text-sm text-muted-foreground">{run.lead.title}</span>
          </li>
        ))}
      </ul>
    </Link>
  );
}

/** One project in the list view: a header that opens and closes it, then its rows. */
function ProjectGroup({
  summary,
  onArchiveFinished,
  children,
}: {
  readonly summary: Summary;
  readonly onArchiveFinished: () => void;
  readonly children: ReactNode;
}) {
  const expandedProjects = useFeedFilterStore((state) => state.expandedProjects);
  const setExpandedProjects = useFeedFilterStore((state) => state.setExpandedProjects);
  const expanded = expandedProjects.includes(summary.project);
  return (
    <section
      aria-label={summary.project}
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <button
        type="button"
        aria-expanded={expanded}
        data-feed-item=""
        {...hoverTarget(`project:${summary.project}`)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left outline-none hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={() =>
          setExpandedProjects(
            expanded
              ? expandedProjects.filter((name) => name !== summary.project)
              : [...expandedProjects, summary.project],
          )
        }
      >
        {expanded ? (
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {summary.project}
        </span>
        <span className="shrink-0">
          <ProjectCounts summary={summary} />
        </span>
      </button>
      {expanded ? (
        <div className="border-t border-border">
          {children}
          {summary.finished.length > 0 ? (
            <div className="flex justify-end border-t border-border px-2 py-1.5">
              <Button size="xs" variant="ghost-muted" onClick={onArchiveFinished}>
                Archive {summary.finished.length} finished
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** Collapse all while any project is open, else Expand all. */
function ExpandAll({ projects }: { readonly projects: ReadonlyArray<string> }) {
  const expandedProjects = useFeedFilterStore((state) => state.expandedProjects);
  const setExpandedProjects = useFeedFilterStore((state) => state.setExpandedProjects);
  const anyOpen = projects.some((name) => expandedProjects.includes(name));
  return (
    <Button
      size="xs"
      variant="ghost-muted"
      onClick={() => setExpandedProjects(anyOpen ? [] : projects)}
    >
      {anyOpen ? "Collapse all" : "Expand all"}
    </Button>
  );
}
