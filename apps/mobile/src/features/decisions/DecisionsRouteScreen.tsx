import { answerSummary, VERDICT_BUTTONS, optionMedia } from "@cz/client-runtime/decisions/draft";
import { filterChips } from "@cz/client-runtime/decisions/feed";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { MaterialButton } from "../../components/MaterialButton";
import {
  type DecisionEntry,
  decisionEnvironment,
  feedProjectsAtom,
  useAnsweredDecisions,
  useFilteredOpenDecisions,
  useOpenDecisions,
  useProjectBlurbs,
} from "../../state/decisions";
import { useAtomCommand } from "../../state/use-atom-command";
import { DecisionMedia } from "./DecisionMedia";

/** The Decisions feed: every open decision from every paired host. */
export function DecisionsRouteScreen() {
  const navigation = useNavigation();
  const feed = useOpenDecisions();
  const filtered = useFilteredOpenDecisions();
  const answeredFeed = useAnsweredDecisions();
  const blurbs = useProjectBlurbs();
  const projects = useAtomValue(feedProjectsAtom);
  const setProjects = useAtomSet(feedProjectsAtom);
  const [tab, setTab] = useState<"open" | "answered">("open");
  const [peek, setPeek] = useState<string | null>(null);
  const answerCommand = useAtomCommand(decisionEnvironment.answer, "answer decision");
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const entries = filtered.entries.filter((entry) => !answered.has(entry.item.id));
  const chips = useMemo(
    () => filterChips(feed.entries.map((entry) => entry.item)).projects,
    [feed.entries],
  );
  const toggleProject = (project: string) =>
    setProjects(
      projects.includes(project)
        ? projects.filter((value) => value !== project)
        : [...projects, project],
    );
  // Lines for one or two picked projects; a whole group would be a wall of text.
  const described = [
    ...new Set([...(projects.length <= 2 ? projects : []), ...(peek ? [peek] : [])]),
  ];
  const open = (entry: DecisionEntry) =>
    navigation.navigate("Decision", { environmentId: entry.environmentId, id: entry.item.id });

  return (
    <View className="flex-1 bg-screen">
      <AndroidScreenHeader
        title="Decisions"
        subtitle={entries.length > 0 ? `${entries.length} open` : null}
        onBack={() => navigation.goBack()}
        {...(entries.length > 0
          ? {
              actions: [
                {
                  accessibilityLabel: "Review all",
                  icon: "play",
                  onPress: () => open(entries[0]!),
                },
              ],
            }
          : {})}
      />
      <View className="flex-row gap-2 px-4 pt-3">
        {(["open", "answered"] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === value }}
            onPress={() => setTab(value)}
            className={
              tab === value
                ? "rounded-full bg-primary px-3 py-1.5"
                : "rounded-full bg-subtle px-3 py-1.5"
            }
          >
            <Text
              className={
                tab === value ? "text-sm text-primary-foreground" : "text-sm text-foreground"
              }
            >
              {value === "open"
                ? `Open${entries.length > 0 ? ` ${entries.length}` : ""}`
                : "Answered"}
            </Text>
          </Pressable>
        ))}
      </View>
      {tab === "open" && chips.length > 1
        ? (["games", "software"] as const).map((group) => {
            const groupProjects = chips.filter(
              (project) => (blurbs.get(project)?.group ?? "software") === group,
            );
            if (groupProjects.length === 0) return null;
            const all = groupProjects.every((project) => projects.includes(project));
            const label = group === "games" ? "Games" : "Software";
            return (
              <ScrollView
                key={group}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerClassName="gap-2 px-4 pt-3"
                className="shrink-0 grow-0"
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: all }}
                  accessibilityLabel={`All ${label.toLowerCase()} projects`}
                  onPress={() =>
                    setProjects(
                      all
                        ? projects.filter((project) => !groupProjects.includes(project))
                        : [...new Set([...projects, ...groupProjects])],
                    )
                  }
                  className={
                    all
                      ? "rounded-full border border-primary bg-primary px-3 py-1.5"
                      : "rounded-full border border-subtle-strong px-3 py-1.5"
                  }
                >
                  <Text
                    className={
                      all
                        ? "font-cz-medium text-sm text-primary-foreground"
                        : "font-cz-medium text-sm text-foreground"
                    }
                  >
                    {label}
                  </Text>
                </Pressable>
                {groupProjects.map((project) => {
                  const selected = projects.includes(project);
                  return (
                    <Pressable
                      key={project}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityHint={blurbs.get(project)?.description ?? undefined}
                      onPress={() => toggleProject(project)}
                      onLongPress={() => setPeek(peek === project ? null : project)}
                      className={
                        selected
                          ? "rounded-full bg-primary px-3 py-1.5"
                          : "rounded-full bg-subtle px-3 py-1.5"
                      }
                    >
                      <Text
                        className={
                          selected ? "text-sm text-primary-foreground" : "text-sm text-foreground"
                        }
                      >
                        {project}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            );
          })
        : null}
      {tab === "open"
        ? described.map((project) => (
            <Text key={project} className="px-4 pt-2 text-sm text-foreground-muted">
              <Text className="font-cz-medium text-foreground">{project}</Text>
              {blurbs.get(project)?.description
                ? `: ${blurbs.get(project)?.description}`
                : ": no description yet"}
            </Text>
          ))
        : null}
      <ScrollView contentContainerClassName="gap-3 p-4">
        {tab === "answered" ? (
          answeredFeed.entries.length === 0 ? (
            <EmptyState title="No answers yet" detail="Decisions you answer show up here." />
          ) : (
            answeredFeed.entries.map((entry) => {
              const { item, answer } = entry;
              const pictures = item.options.flatMap((option) => {
                const media = answer?.option_ids?.includes(option.id)
                  ? optionMedia(item, option)
                  : null;
                return media?.type === "image" ? [media] : [];
              });
              return (
                <View
                  key={`${entry.environmentId}:${item.id}`}
                  className="gap-2 rounded-xl bg-subtle p-4"
                >
                  <Text className="text-xs text-foreground-muted">
                    {item.kind} · {item.project} · {entry.environmentLabel}
                  </Text>
                  <Text className="font-cz-medium text-base text-foreground">
                    {item.title || item.question}
                  </Text>
                  {pictures.length > 0 ? (
                    <View className="flex-row gap-2">
                      {pictures.slice(0, 3).map((media, index) => (
                        <View key={`${media.key}:${index}`} className="flex-1">
                          <DecisionMedia environmentId={entry.environmentId} media={media} framed />
                        </View>
                      ))}
                    </View>
                  ) : null}
                  {answer ? (
                    <Text className="text-sm text-foreground">{answerSummary(item, answer)}</Text>
                  ) : null}
                  {answer?.comment ? (
                    <Text className="text-sm text-foreground-muted">“{answer.comment}”</Text>
                  ) : null}
                </View>
              );
            })
          )
        ) : feed.isPending ? (
          <>
            <View className="h-28 rounded-xl bg-subtle" />
            <View className="h-28 rounded-xl bg-subtle" />
          </>
        ) : entries.length === 0 ? (
          <EmptyState title="Nothing to decide" detail="Agents' questions show up here." />
        ) : (
          entries.map((entry) => {
            const { item } = entry;
            // A review or pitch answers right on the card; tapping elsewhere opens it.
            const quick =
              item.kind === "review" || item.kind === "pitch" ? VERDICT_BUTTONS[item.kind] : null;
            const thumbs = item.options.flatMap((option) => {
              const media = optionMedia(item, option);
              return item.kind === "pick" && media?.type === "image" ? [media] : [];
            });
            const apk =
              item.kind === "playtest"
                ? item.media.find((media) => media.type === "apk")
                : undefined;
            return (
              <View
                key={`${entry.environmentId}:${item.id}`}
                className="gap-3 rounded-xl bg-subtle p-4"
              >
                <Pressable accessibilityRole="button" onPress={() => open(entry)} className="gap-1">
                  <Text className="text-xs text-foreground-muted">
                    {item.kind} · {item.project}
                    {item.blocking ? " · agent waiting" : ""}
                  </Text>
                  {/* Agents often reuse one question across a batch; the title tells them apart. */}
                  {item.title && item.title !== item.question ? (
                    <>
                      <Text className="font-cz-medium text-base text-foreground">{item.title}</Text>
                      <Text className="text-sm text-foreground-muted">{item.question}</Text>
                    </>
                  ) : (
                    <Text className="font-cz-medium text-base text-foreground">
                      {item.question}
                    </Text>
                  )}
                  {item.cost_note ? (
                    <Text className="text-xs text-warning">{item.cost_note}</Text>
                  ) : null}
                </Pressable>
                {thumbs.length > 0 ? (
                  <Pressable onPress={() => open(entry)} className="flex-row gap-2">
                    {thumbs.slice(0, 3).map((media, index) => (
                      <View key={`${media.key}:${index}`} className="flex-1">
                        <DecisionMedia environmentId={entry.environmentId} media={media} compact />
                      </View>
                    ))}
                  </Pressable>
                ) : null}
                {apk ? <DecisionMedia environmentId={entry.environmentId} media={apk} /> : null}
                {quick ? (
                  <View className="flex-row flex-wrap gap-2">
                    {quick.map((button) => (
                      <MaterialButton
                        key={button.value}
                        tone={
                          button.value === "approve" || button.value === "yes"
                            ? "primary"
                            : "secondary"
                        }
                        label={button.label}
                        onPress={() => {
                          if (button.value === "changes") return open(entry);
                          setAnswered((current) => new Set(current).add(item.id));
                          void answerCommand({
                            environmentId: entry.environmentId,
                            input: {
                              id: item.id,
                              answer: {
                                choice: button.value,
                                option_ids: null,
                                rank: null,
                                comment: null,
                                voice_key: null,
                              },
                            },
                          });
                        }}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })
        )}
        {tab === "open" && filtered.elsewhere > 0 ? (
          <Text className="text-xs text-foreground-muted">
            {filtered.elsewhere} waiting on your desktop
          </Text>
        ) : null}
        {feed.unreachable.length > 0 ? (
          <Text className="text-xs text-foreground-muted">
            Couldn't reach {feed.unreachable.join(", ")}; their decisions show up when they're back.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}
