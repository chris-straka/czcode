import {
  briefWindow,
  buildMorningBrief,
  morningBriefIsEmpty,
  morningBriefSummary,
} from "@cz/client-runtime/decisions/morningBrief";
import { useNavigation } from "@react-navigation/native";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";
import {
  useFilteredOpenDecisions,
  useProjectBlurbs,
  useThreadDigests,
} from "../../state/decisions";
import { useThreadShells } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useJobsOn } from "../../state/jobs";

const LIST_LIMIT = 5;

/**
 * The Morning brief at the top of the phone's feed: the night since 18:00 on
 * every machine. It starts as one line, because the Decisions it counts are
 * the cards right under it; tapping it opens what finished and failed overnight.
 */
export function MorningBrief() {
  const navigation = useNavigation();
  const [now] = useState(Date.now);
  const day = briefWindow(now);
  const { entries } = useFilteredOpenDecisions();
  const threads = useThreadShells();
  const blurbs = useProjectBlurbs();
  const { environments } = useEnvironments();
  const jobs = useJobsOn(environments.map((environment) => environment.environmentId));
  const [open, setOpen] = useState(false);

  const since = day?.since ?? null;
  const brief = useMemo(
    () =>
      since === null
        ? null
        : buildMorningBrief({
            decisions: entries,
            threads,
            jobs,
            groupOf: (project) => blurbs.get(project)?.group ?? "software",
            since,
          }),
    [since, entries, threads, jobs, blurbs],
  );
  const overnight = brief ? [...brief.threads.failed, ...brief.threads.finished] : [];
  const digests = useThreadDigests(overnight.slice(0, LIST_LIMIT));
  if (!day || !brief || morningBriefIsEmpty(brief)) return null;

  const machine = (environmentId: string) =>
    environments.find((environment) => environment.environmentId === environmentId)?.label ?? "";
  const { failedJobs } = brief;

  if (!open || (overnight.length === 0 && failedJobs.length === 0)) {
    return (
      <Pressable
        className="mx-4 mb-2 flex-row gap-2 rounded-xl border border-border px-4 py-3"
        onPress={() => setOpen(true)}
      >
        <Text className="font-cz-medium text-sm text-foreground">Morning brief</Text>
        <Text className="flex-1 text-sm text-foreground-muted" numberOfLines={1}>
          {morningBriefSummary(brief)}
        </Text>
      </Pressable>
    );
  }

  return (
    <View className="mx-4 mb-2 gap-4 rounded-xl border border-border bg-subtle p-4">
      <View className="flex-row items-center gap-2">
        <Text className="font-cz-medium text-base text-foreground">Morning brief</Text>
        <Text className="flex-1 text-xs text-foreground-muted">since 18:00</Text>
        <Pressable onPress={() => setOpen(false)} hitSlop={8}>
          <Text className="text-sm text-primary">Fold</Text>
        </Pressable>
      </View>

      {overnight.length > 0 ? (
        <View className="gap-2">
          <Text className="text-xs font-cz-medium uppercase tracking-wide text-foreground-muted">
            Threads overnight
          </Text>
          {overnight.slice(0, LIST_LIMIT).map((thread) => {
            const failed = brief.threads.failed.includes(thread);
            const excerpt = digests.get(`${thread.environmentId}:${thread.id}`)?.excerpt;
            return (
              <Pressable
                key={`${thread.environmentId}:${thread.id}`}
                className="gap-0.5"
                onPress={() =>
                  navigation.navigate("Thread", {
                    environmentId: String(thread.environmentId),
                    threadId: thread.id,
                  })
                }
              >
                <Text
                  className={cn("text-sm", failed ? "text-danger-foreground" : "text-foreground")}
                  numberOfLines={1}
                >
                  {failed ? "Failed · " : "Done · "}
                  {thread.title}
                </Text>
                {excerpt ? (
                  <Text className="text-xs text-foreground-muted" numberOfLines={1}>
                    {excerpt}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
          {overnight.length > LIST_LIMIT ? (
            <Text className="text-xs text-foreground-muted">
              and {overnight.length - LIST_LIMIT} more below
            </Text>
          ) : null}
        </View>
      ) : null}

      {failedJobs.length > 0 ? (
        <View className="gap-2">
          <Text className="text-xs font-cz-medium uppercase tracking-wide text-foreground-muted">
            Scheduled jobs that failed
          </Text>
          {failedJobs.map(({ environmentId, job, run }) => (
            <Pressable
              key={`${environmentId}:${job.id}`}
              className="gap-0.5"
              onPress={() =>
                navigation.navigate("SettingsSheet", {
                  screen: "SettingsContent",
                  params: { screen: "SettingsSchedules" },
                })
              }
            >
              <Text className="text-sm text-foreground" numberOfLines={1}>
                {job.what} · {machine(environmentId)}
              </Text>
              {run.reason ? (
                <Text className="text-xs text-danger-foreground" numberOfLines={2}>
                  {run.reason}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
