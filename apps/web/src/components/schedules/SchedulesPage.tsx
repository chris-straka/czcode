import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  isSystemTimer,
  scheduleJobNextRunLabel,
  scheduleJobRunLabel,
  sortScheduleJobs,
} from "@cz/client-runtime/state/jobs";
import { type EnvironmentId, type ScheduleJob, scheduleJobFailing } from "@cz/contracts";
import { Link } from "@tanstack/react-router";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { CircleAlertIcon, CopyIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";

import { isElectron } from "~/env";
import { resolveMachineFilter, useFeedFilterStore } from "~/feedFilterStore";
import { useEscapeToGoBack } from "~/hooks/useNavigateBack";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { jobsEnvironment } from "~/state/jobs";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { WorkspacePageHeader } from "../WorkspacePageHeader";

/**
 * Every recurring job on the machines the feed shows: cz's scheduled tasks,
 * the timers registered in each host's jobs.toml, and timers someone set up
 * by hand. The OS's own timers hide behind a toggle. Failures come first.
 */
export function SchedulesPage() {
  useEscapeToGoBack();
  const machine = useFeedFilterStore((state) => state.machine);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const resolved = resolveMachineFilter(machine, primaryEnvironmentId);
  const shown =
    resolved.type === "all"
      ? environments
      : environments.filter((environment) => environment.environmentId === resolved.environmentId);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
      <WorkspacePageHeader electron={isElectron}>
        <h1 className="text-sm font-medium">Schedules</h1>
      </WorkspacePageHeader>
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-(--chat-content-max-width) flex-col gap-8 px-4 py-6">
          {shown.map((environment) => (
            <MachineJobs
              key={environment.environmentId}
              environmentId={environment.environmentId}
              label={
                shown.length > 1 || environment.environmentId !== primaryEnvironmentId
                  ? environment.label
                  : null
              }
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function MachineJobs({
  environmentId,
  label,
}: {
  readonly environmentId: EnvironmentId;
  readonly label: string | null;
}) {
  const listAtom = jobsEnvironment.list({ environmentId, input: null });
  const result = useAtomValue(listAtom);
  const refresh = useAtomRefresh(listAtom);
  const [showSystem, setShowSystem] = useState(false);
  const jobs = sortScheduleJobs(
    Option.getOrElse(AsyncResult.value(result), (): ReadonlyArray<ScheduleJob> => []),
  );
  const ours = jobs.filter((job) => !isSystemTimer(job));
  const system = jobs.filter(isSystemTimer);
  const [now] = useState(Date.now);
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 truncate text-sm font-medium">{label ?? "This machine"}</h2>
        <Button size="icon-sm" variant="ghost" aria-label="Refresh" onClick={refresh}>
          <RefreshCwIcon />
        </Button>
      </div>
      {AsyncResult.isFailure(result) && jobs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Couldn't read this machine's jobs. Its cz may be older than Schedules.
        </p>
      ) : ours.length === 0 && AsyncResult.isSuccess(result) ? (
        <p className="text-sm text-muted-foreground">No recurring jobs.</p>
      ) : (
        <JobList jobs={ours} environmentId={environmentId} now={now} />
      )}
      {system.length > 0 ? (
        <>
          <Button
            size="sm"
            variant="ghost-muted"
            className="self-start"
            onClick={() => setShowSystem((shown) => !shown)}
          >
            {showSystem ? "Hide" : "Show"} {system.length} system timers
          </Button>
          {showSystem ? <JobList jobs={system} environmentId={environmentId} now={now} /> : null}
        </>
      ) : null}
    </section>
  );
}

function JobList({
  jobs,
  environmentId,
  now,
}: {
  readonly jobs: ReadonlyArray<ScheduleJob>;
  readonly environmentId: EnvironmentId;
  readonly now: number;
}) {
  return (
    <ul className="flex flex-col divide-y divide-border/60 rounded-lg border border-border/60">
      {jobs.map((job) => (
        <JobRow key={job.id} job={job} environmentId={environmentId} now={now} />
      ))}
    </ul>
  );
}

function JobRow({
  job,
  environmentId,
  now,
}: {
  readonly job: ScheduleJob;
  readonly environmentId: EnvironmentId;
  readonly now: number;
}) {
  const failing = scheduleJobFailing(job);
  const missed = job.lastScheduledRun;
  const next = scheduleJobNextRunLabel(job, now);
  return (
    <li className={cn("flex flex-col gap-1 px-4 py-3", failing && "bg-destructive/8")}>
      <div className="flex min-w-0 items-start gap-2">
        {failing ? <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" /> : null}
        <span className="min-w-0 flex-1 text-sm text-foreground">{job.what}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{job.schedule}</span>
      </div>
      <div className="flex min-w-0 flex-wrap gap-x-3 text-xs text-muted-foreground">
        <span
          className={cn(
            job.lastRun.status === "failed" && "font-medium text-destructive",
            job.lastRun.status === "attention" && "text-warning",
          )}
        >
          {scheduleJobRunLabel(job.lastRun, now)}
        </span>
        {next ? <span>next {next}</span> : null}
        {job.project ? <span>{job.project}</span> : null}
        <span className="truncate">{job.unit ?? "cz task"}</span>
      </div>
      {job.lastRun.reason ? (
        <p
          className={cn(
            "text-xs break-words",
            job.lastRun.status === "failed" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {job.lastRun.reason}
        </p>
      ) : null}
      {missed ? (
        <p className="text-xs break-words text-destructive">
          The scheduled run failed ({scheduleJobRunLabel(missed, now)})
          {missed.reason ? `: ${missed.reason}` : ""}
        </p>
      ) : null}
      {job.output ? <JobOutput output={job.output} environmentId={environmentId} /> : null}
    </li>
  );
}

/** The latest output: a thread to open, a URL, or a path or log command to copy. */
function JobOutput({
  output,
  environmentId,
}: {
  readonly output: NonNullable<ScheduleJob["output"]>;
  readonly environmentId: EnvironmentId;
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  if (output.kind === "thread") {
    return (
      <Link
        to="/$environmentId/$threadId"
        params={{ environmentId, threadId: output.ref }}
        className="self-start text-xs text-primary hover:underline"
      >
        Open latest run
      </Link>
    );
  }
  if (output.kind === "url") {
    return (
      <a
        href={output.ref}
        target="_blank"
        rel="noreferrer"
        className="self-start truncate text-xs text-primary hover:underline"
      >
        {output.ref}
      </a>
    );
  }
  return (
    <button
      type="button"
      className="flex min-w-0 items-center gap-1.5 self-start text-xs text-muted-foreground hover:text-foreground"
      onClick={() => copyToClipboard(output.ref, undefined)}
    >
      <CopyIcon className="size-3 shrink-0" />
      <code className="truncate">{isCopied ? "Copied" : output.ref}</code>
    </button>
  );
}

/**
 * The red dot on the top bar's Schedules button: one per machine shown,
 * stacked in the same spot, so any failing job on any of them lights it.
 */
export function SchedulesFailureDot({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const result = useAtomValue(jobsEnvironment.list({ environmentId, input: null }));
  const jobs = Option.getOrElse(AsyncResult.value(result), (): ReadonlyArray<ScheduleJob> => []);
  if (!jobs.some((job) => job.registered && scheduleJobFailing(job))) return null;
  return (
    <span
      aria-hidden="true"
      className="absolute top-0.5 right-0.5 size-2 rounded-full bg-destructive"
    />
  );
}
