import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@cz/client-runtime/environment";
import {
  type BriefJob,
  type BriefLine,
  buildMorningBrief,
  formatBriefSince,
  morningBriefIsEmpty,
  morningBriefReadToday,
} from "@cz/client-runtime/decisions/morningBrief";
import type { EnvironmentThreadShell } from "@cz/client-runtime/state/models";
import { type EnvironmentId, ThreadId } from "@cz/contracts";
import { Link } from "@tanstack/react-router";
import { SunriseIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { undoLatestThreadAction } from "~/hooks/showThreadUndoNotice";
import { useThreadActions } from "~/hooks/useThreadActions";
import { type DecisionEntry, decisionEnvironment, useMachineBriefs } from "~/state/decisions";
import { useAtomCommand } from "~/state/use-atom-command";
import { fleetAtom } from "../fleet/MachineLoad";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";

const UNDO_WINDOW_MS = 5_000;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** When Done was pressed in this session, so the brief stays gone before the servers say so. */
let readHereAt: number | null = null;

/**
 * The Morning brief, at the top of Home once a day: a few written lines on
 * what happened since the owner last read one, on the machines the filter
 * shows. It never lists threads; lines link to projects and Decisions.
 * Done hides it on every device until tomorrow.
 */
export function MorningBriefCard({
  environmentIds,
  decisions,
  threads,
  jobs,
  now,
  projectOf,
  onOpenDecision,
}: {
  readonly environmentIds: ReadonlyArray<EnvironmentId>;
  readonly decisions: ReadonlyArray<DecisionEntry>;
  /** Threads on the machines the filter shows. */
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly jobs: ReadonlyArray<BriefJob>;
  readonly now: number;
  /** The Threads page project a thread belongs to. */
  readonly projectOf: (thread: EnvironmentThreadShell) => string;
  readonly onOpenDecision: (key: string) => void;
}) {
  const machines = useMachineBriefs(environmentIds);
  const fleet = useAtomValue(fleetAtom);
  const markRead = useAtomCommand(decisionEnvironment.briefRead, "mark the brief read");
  const [readHere, setReadHere] = useState(readHereAt);
  const brief = useMemo(
    () =>
      buildMorningBrief({
        machines,
        decisions,
        threads,
        jobs,
        fleet: fleet.filter((machine) => environmentIds.includes(machine.environmentId)),
      }),
    [machines, decisions, threads, jobs, fleet, environmentIds],
  );
  const shellByKey = useMemo(
    () => new Map(threads.map((thread) => [`${thread.environmentId}:${thread.id}`, thread])),
    [threads],
  );

  const readToday =
    morningBriefReadToday(brief, now) ||
    (readHere !== null && morningBriefReadToday({ ...brief, readAt: readHere }, now));
  if (readToday || morningBriefIsEmpty(brief)) return null;

  const done = () => {
    readHereAt = Date.now();
    setReadHere(readHereAt);
    for (const environmentId of environmentIds) {
      void markRead({ environmentId, input: undefined });
    }
  };
  /** The project a line is about, when its threads share one. */
  const projectFor = (line: BriefLine) => {
    const projects = new Set(
      line.threads.flatMap((ref) => {
        const shell = shellByKey.get(`${ref.environmentId}:${ref.threadId}`);
        return shell ? [projectOf(shell)] : [];
      }),
    );
    return projects.size === 1 ? [...projects][0]! : null;
  };

  const top = brief.decisions.top;
  return (
    <section
      aria-label="Morning brief"
      className="space-y-3 rounded-xl border border-border bg-card px-4 py-3"
    >
      <header className="flex items-center gap-2">
        <SunriseIcon className="size-4 shrink-0 text-muted-foreground" />
        <h2 className="text-sm font-medium text-foreground">Morning brief</h2>
        <span className="flex-1 truncate text-xs text-muted-foreground">
          {brief.since === null ? null : `since ${formatBriefSince(brief.since, now)}`}
          {brief.writing ? " · writing…" : null}
        </span>
        <Button size="xs" variant="ghost" onClick={done}>
          Done
        </Button>
      </header>

      {brief.done.length > 0 ? (
        <BriefSection title="Done">
          {brief.done.map((line) => (
            <BriefLineRow key={line.key} line={line} project={projectFor(line)} />
          ))}
        </BriefSection>
      ) : null}

      {brief.failed.length > 0 ? (
        <BriefSection title="Failed or stopped">
          {brief.failed.map((line) => (
            <BriefLineRow key={line.key} line={line} project={projectFor(line)} />
          ))}
        </BriefSection>
      ) : null}

      {brief.decisions.total > 0 || brief.waiting > 0 ? (
        <BriefSection title="Needs you">
          {top ? (
            <li>
              <button
                type="button"
                className="block w-full rounded-md px-1 py-0.5 text-left text-sm hover:bg-accent/40"
                onClick={() => onOpenDecision(`${top.environmentId}:${top.item.id}`)}
              >
                <span className="font-medium text-foreground">
                  {plural(brief.decisions.total, "Decision")}
                </span>
                <span className="text-muted-foreground">
                  {": "}
                  {brief.decisions.byProject
                    .map(({ project, count }) => `${count} ${project}`)
                    .join(", ")}
                </span>
              </button>
            </li>
          ) : null}
          {brief.waiting > 0 ? (
            <li className="px-1 py-0.5 text-sm text-muted-foreground">
              {brief.waiting === 1
                ? "1 agent is waiting on an answer, below"
                : `${brief.waiting} agents are waiting on an answer, below`}
            </li>
          ) : null}
        </BriefSection>
      ) : null}

      {brief.machines.length > 0 ? (
        <BriefSection title="Machines">
          {brief.machines.map((machine) => (
            <li key={machine.environmentId}>
              <Link to="/fleet" className="block rounded-md px-1 py-0.5 text-sm hover:bg-accent/40">
                <span className="font-medium text-foreground">{machine.label}</span>
                <span className="text-muted-foreground"> {machine.problem}</span>
              </Link>
            </li>
          ))}
        </BriefSection>
      ) : null}
    </section>
  );
}

function BriefSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <h3 className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}

/**
 * "hll: Andras rigged in game; level editor merged", linking to the project
 * (or Schedules, for jobs). Failed and stopped lines carry their one action.
 */
function BriefLineRow({
  line,
  project,
}: {
  readonly line: BriefLine;
  readonly project: string | null;
}) {
  const retry = useAtomCommand(decisionEnvironment.retryThreads, "retry threads");
  const { archiveThread } = useThreadActions();

  const onRetry = async () => {
    const byMachine = new Map<EnvironmentId, string[]>();
    for (const thread of line.threads) {
      byMachine.set(thread.environmentId, [
        ...(byMachine.get(thread.environmentId) ?? []),
        thread.threadId,
      ]);
    }
    let sent = 0;
    for (const [environmentId, threadIds] of byMachine) {
      const result = await retry({ environmentId, input: { threadIds } });
      if (result._tag === "Success") sent += result.value;
    }
    if (sent > 0) {
      toastManager.add({ type: "success", title: `Asked ${plural(sent, "thread")} to try again` });
    }
  };
  const onDismiss = async () => {
    const results = await Promise.all(
      line.threads.map((thread) =>
        archiveThread(scopeThreadRef(thread.environmentId, ThreadId.make(thread.threadId))),
      ),
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

  const text = (
    <>
      <span className="font-medium text-foreground">{line.label}</span>
      <span className="text-muted-foreground">: </span>
      <span className="text-foreground">{line.text}</span>
    </>
  );
  const rowClass = "block min-w-0 flex-1 rounded-md px-1 py-0.5 text-sm";
  return (
    <li className="flex items-start gap-1">
      {line.jobs.length > 0 ? (
        <Link to="/schedules" className={`${rowClass} hover:bg-accent/40`}>
          {text}
        </Link>
      ) : project !== null ? (
        <Link to="/threads" search={{ project }} className={`${rowClass} hover:bg-accent/40`}>
          {text}
        </Link>
      ) : (
        <p className={rowClass}>{text}</p>
      )}
      {line.action === "open" || line.threads.length === 0 ? null : (
        <Button
          size="xs"
          variant="outline"
          className="shrink-0"
          onClick={() => void (line.action === "retry" ? onRetry() : onDismiss())}
        >
          {line.action === "retry" ? "Retry" : "Dismiss"}
        </Button>
      )}
    </li>
  );
}
