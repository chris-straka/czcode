import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  briefWindow,
  buildMorningBrief,
  morningBriefIsEmpty,
  morningBriefSummary,
} from "@cz/client-runtime/decisions/morningBrief";
import { useNavigation } from "@react-navigation/native";
import { AsyncResult } from "effect/reactivity";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";
import {
  type DecisionEntry,
  useFilteredOpenDecisions,
  useProjectBlurbs,
  useThreadDigests,
} from "../../state/decisions";
import { useThreadShells } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useJobsOn } from "../../state/jobs";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";

const LIST_LIMIT = 5;

/**
 * The Morning brief at the top of the phone's feed: the night since 18:00 on
 * every machine. "Done reading" folds it to one line until the next morning.
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
  const preferences = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const doneDay = AsyncResult.isSuccess(preferences)
    ? preferences.value.morningBriefDoneDay
    : undefined;

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
  const openDecision = (entry: DecisionEntry, session = false) =>
    navigation.navigate("Decision", {
      environmentId: entry.environmentId,
      id: entry.item.id,
      ...(session ? { session: "1" } : {}),
    });

  if (doneDay === day.day) {
    return (
      <Pressable
        className="mx-4 mb-2 flex-row gap-2 rounded-xl border border-border px-4 py-3"
        onPress={() => savePreferences({ morningBriefDoneDay: "" })}
      >
        <Text className="font-cz-medium text-sm text-foreground">Morning brief</Text>
        <Text className="flex-1 text-sm text-foreground-muted" numberOfLines={1}>
          {morningBriefSummary(brief)}
        </Text>
      </Pressable>
    );
  }

  const { decisions, failedJobs } = brief;
  return (
    <View className="mx-4 mb-2 gap-4 rounded-xl border border-border bg-subtle p-4">
      <View className="flex-row items-center gap-2">
        <Text className="font-cz-medium text-base text-foreground">Morning brief</Text>
        <Text className="flex-1 text-xs text-foreground-muted">since 18:00</Text>
        <Pressable onPress={() => savePreferences({ morningBriefDoneDay: day.day })} hitSlop={8}>
          <Text className="text-sm text-primary">Done reading</Text>
        </Pressable>
      </View>

      {decisions.total > 0 ? (
        <View className="gap-2">
          <View className="flex-row items-center gap-2">
            <Text className="flex-1 text-xs font-cz-medium uppercase tracking-wide text-foreground-muted">
              Decisions waiting {decisions.total}
            </Text>
            {entries[0] ? (
              <Pressable onPress={() => openDecision(entries[0]!, true)} hitSlop={8}>
                <Text className="text-sm text-primary">Review all</Text>
              </Pressable>
            ) : null}
          </View>
          {decisions.top.map((entry) => (
            <Pressable
              key={`${entry.environmentId}:${entry.item.id}`}
              onPress={() => openDecision(entry)}
              className="gap-0.5"
            >
              <Text className="text-sm text-foreground" numberOfLines={1}>
                {entry.item.title || entry.item.question}
              </Text>
              <Text className="text-xs text-foreground-muted" numberOfLines={1}>
                {entry.item.blocking
                  ? "agent waiting · "
                  : entry.item.cost_note
                    ? "costs money · "
                    : ""}
                {entry.item.project} · {entry.item.kind}
              </Text>
            </Pressable>
          ))}
          <Text className="text-xs text-foreground-muted" numberOfLines={2}>
            Games {decisions.byGroup.games} · Software {decisions.byGroup.software} —{" "}
            {decisions.byProject
              .slice(0, 6)
              .map(({ project, count }) => `${project} ${count}`)
              .join(", ")}
          </Text>
        </View>
      ) : null}

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
