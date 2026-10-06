import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { queuedRunStartLabel } from "@cz/client-runtime/state/queue";
import type { EnvironmentId, QueuedRun } from "@cz/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { MaterialButton } from "../../components/MaterialButton";
import { queueEnvironment } from "../../state/queue";
import { useAtomCommand } from "../../state/use-atom-command";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Runs from "Run at next reset", per environment, under the limits they wait on. */
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
      run.status === "queued" || (run.status === "failed" && (run.startedAt ?? 0) > now - DAY_MS),
  );
  if (shown.length === 0) return null;
  return (
    <View className="gap-3">
      <Text className="px-1 text-base font-cz-medium text-foreground">
        Queued for the next reset{label ? ` · ${label}` : ""}
      </Text>
      <View className="gap-4 rounded-[24px] border-continuous bg-grouped-card p-4">
        {shown.map((run) => (
          <View key={run.id} className="gap-2">
            <Text className="text-sm text-foreground" numberOfLines={2}>
              {run.title}
            </Text>
            <Text className="text-xs text-foreground-muted" numberOfLines={2}>
              {run.modelSelection.model} · {queuedRunStartLabel(run, now)}
              {run.error ? ` · ${run.error.split("\n")[0]}` : ""}
            </Text>
            {run.status === "queued" ? (
              <View className="flex-row gap-2">
                <MaterialButton
                  tone="secondary"
                  label="Run now"
                  onPress={() =>
                    void runNow({ environmentId, input: { id: run.id } }).then(refresh)
                  }
                />
                <MaterialButton
                  tone="text"
                  label="Cancel"
                  onPress={() =>
                    void cancel({ environmentId, input: { id: run.id } }).then(refresh)
                  }
                />
              </View>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}
