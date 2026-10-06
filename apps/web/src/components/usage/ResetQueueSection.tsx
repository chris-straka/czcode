import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { queuedRunStartLabel } from "@cz/client-runtime/state/queue";
import type { EnvironmentId, QueuedRun } from "@cz/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";

import { queueEnvironment } from "~/state/queue";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";

/** Runs from "Run at next reset", per environment, beside the limits they wait on. */
export function ResetQueueSection({
  environments,
  now,
}: {
  readonly environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly label: string;
  }>;
  readonly now: number;
}) {
  return (
    <>
      {environments.map((environment) => (
        <EnvironmentResetQueue
          key={environment.environmentId}
          environmentId={environment.environmentId}
          label={environments.length > 1 ? environment.label : null}
          now={now}
        />
      ))}
    </>
  );
}

function EnvironmentResetQueue({
  environmentId,
  label,
  now,
}: {
  readonly environmentId: EnvironmentId;
  readonly label: string | null;
  readonly now: number;
}) {
  const listAtom = queueEnvironment.list({ environmentId, input: null });
  const result = useAtomValue(listAtom);
  const refresh = useAtomRefresh(listAtom);
  const cancel = useAtomCommand(queueEnvironment.cancel, "cancel queued run");
  const runNow = useAtomCommand(queueEnvironment.runNow, "start queued run now");
  const runs = Option.getOrElse(AsyncResult.value(result), (): ReadonlyArray<QueuedRun> => []);
  // Started runs are threads now; the list keeps what's waiting and the last day's failures.
  const shown = runs.filter(
    (run) =>
      run.status === "queued" ||
      (run.status === "failed" && (run.startedAt ?? 0) > now - 24 * 60 * 60 * 1000),
  );
  if (shown.length === 0) return null;
  return (
    <section className="mt-8 flex flex-col gap-3">
      <h2 className="text-sm font-medium text-foreground">
        Queued for the next reset{label ? ` on ${label}` : ""}
      </h2>
      <ul className="flex flex-col divide-y divide-border/60 rounded-lg border border-border/60">
        {shown.map((run) => (
          <li key={run.id} className="flex items-center gap-3 px-4 py-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-sm text-foreground">{run.title}</span>
              <span className="truncate text-xs text-muted-foreground">
                {run.modelSelection.model} · {queuedRunStartLabel(run, now)}
                {run.error ? ` · ${run.error.split("\n")[0]}` : ""}
              </span>
            </div>
            {run.status === "queued" ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void runNow({ environmentId, input: { id: run.id } }).then(refresh)
                  }
                >
                  Run now
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void cancel({ environmentId, input: { id: run.id } }).then(refresh)
                  }
                >
                  Cancel
                </Button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
