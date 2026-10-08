import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  scheduleJobNextRunLabel,
  scheduleJobRunLabel,
  sortScheduleJobs,
} from "@cz/client-runtime/state/jobs";
import { type EnvironmentId, type ScheduleJob, scheduleJobFailing } from "@cz/contracts";
import { useNavigation } from "@react-navigation/native";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { Linking, Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { ScreenScrollView as ScrollView } from "../../components/ScreenScrollView";
import { cn } from "../../lib/cn";
import { tryCopyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import { useEnvironments } from "../../state/environments";
import { jobsEnvironment } from "../../state/jobs";
import { SettingsScreen } from "../settings/components/SettingsScreen";

/**
 * Every recurring job on each connected machine: cz's scheduled tasks and
 * the timers registered in the host's jobs.toml. Failures come first.
 */
export function SchedulesRouteScreen() {
  const { environments } = useEnvironments();
  const [now] = useState(Date.now);
  return (
    <SettingsScreen title="Schedules">
      <ScrollView contentContainerClassName="gap-6 p-4">
        {environments.map((environment) => (
          <MachineJobs
            key={environment.environmentId}
            environmentId={environment.environmentId}
            label={environment.label}
            now={now}
          />
        ))}
      </ScrollView>
    </SettingsScreen>
  );
}

function MachineJobs({
  environmentId,
  label,
  now,
}: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly now: number;
}) {
  const listAtom = jobsEnvironment.list({ environmentId, input: null });
  const result = useAtomValue(listAtom);
  const refresh = useAtomRefresh(listAtom);
  const [showUnregistered, setShowUnregistered] = useState(false);
  const jobs = sortScheduleJobs(
    Option.getOrElse(AsyncResult.value(result), (): ReadonlyArray<ScheduleJob> => []),
  );
  const shown = jobs.filter((job) => showUnregistered || job.registered);
  const unregistered = jobs.length - jobs.filter((job) => job.registered).length;
  return (
    <View className="gap-3">
      <Pressable onLongPress={refresh} accessibilityHint="Long-press to refresh">
        <Text className="px-1 text-base font-cz-medium text-foreground">{label}</Text>
      </Pressable>
      {AsyncResult.isFailure(result) && jobs.length === 0 ? (
        <Text className="px-1 text-sm text-foreground-muted">
          Couldn't read this machine's jobs. Its cz may be older than Schedules.
        </Text>
      ) : shown.length === 0 && AsyncResult.isSuccess(result) ? (
        <Text className="px-1 text-sm text-foreground-muted">No recurring jobs registered.</Text>
      ) : shown.length > 0 ? (
        <View className="gap-4 rounded-[24px] border-continuous bg-grouped-card p-4">
          {shown.map((job) => (
            <JobRow key={job.id} job={job} environmentId={environmentId} now={now} />
          ))}
        </View>
      ) : null}
      {unregistered > 0 && !showUnregistered ? (
        <Pressable onPress={() => setShowUnregistered(true)} className="px-1">
          <Text className="text-sm text-foreground-muted">Show {unregistered} other timers</Text>
        </Pressable>
      ) : null}
    </View>
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
  const navigation = useNavigation();
  const failing = scheduleJobFailing(job);
  const next = scheduleJobNextRunLabel(job, now);
  const missed = job.lastScheduledRun;
  const output = job.output;
  return (
    <View className="gap-1">
      <View className="flex-row items-start gap-2">
        <Text
          className={cn(
            "flex-1 text-sm",
            failing ? "font-cz-medium text-danger-foreground" : "text-foreground",
          )}
        >
          {job.what}
        </Text>
        <Text className="text-xs text-foreground-muted">{job.schedule}</Text>
      </View>
      <Text
        className={cn(
          "text-xs",
          job.lastRun.status === "failed" ? "text-danger-foreground" : "text-foreground-muted",
        )}
      >
        {scheduleJobRunLabel(job.lastRun, now)}
        {next ? ` · next ${next}` : ""}
        {job.project ? ` · ${job.project}` : ""}
      </Text>
      {job.lastRun.reason ? (
        <Text
          className={cn(
            "text-xs",
            job.lastRun.status === "failed" ? "text-danger-foreground" : "text-foreground-muted",
          )}
        >
          {job.lastRun.reason}
        </Text>
      ) : null}
      {missed ? (
        <Text className="text-xs text-danger-foreground">
          The scheduled run failed ({scheduleJobRunLabel(missed, now)})
          {missed.reason ? `: ${missed.reason}` : ""}
        </Text>
      ) : null}
      {output ? (
        <Pressable
          onPress={() =>
            output.kind === "thread"
              ? navigation.navigate("Thread", {
                  environmentId: String(environmentId),
                  threadId: output.ref,
                })
              : output.kind === "url"
                ? void Linking.openURL(output.ref)
                : void tryCopyTextWithHaptic(output.ref)
          }
        >
          <Text className="text-xs text-primary" numberOfLines={1}>
            {output.kind === "thread" ? "Open latest run" : output.ref}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
