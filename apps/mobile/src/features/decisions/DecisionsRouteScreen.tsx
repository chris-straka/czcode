import { VERDICT_BUTTONS } from "@cz/client-runtime/decisions/draft";
import { useNavigation } from "@react-navigation/native";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { MaterialButton } from "../../components/MaterialButton";
import { type DecisionEntry, decisionEnvironment, useOpenDecisions } from "../../state/decisions";
import { useAtomCommand } from "../../state/use-atom-command";
import { DecisionMedia } from "./DecisionMedia";

/** The Decisions feed: every open decision from every paired host. */
export function DecisionsRouteScreen() {
  const navigation = useNavigation();
  const feed = useOpenDecisions();
  const answerCommand = useAtomCommand(decisionEnvironment.answer, "answer decision");
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const entries = feed.entries.filter((entry) => !answered.has(entry.item.id));
  const open = (entry: DecisionEntry, session = false) =>
    navigation.navigate("Decision", {
      environmentId: entry.environmentId,
      id: entry.item.id,
      ...(session ? { session: "1" } : {}),
    });

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
                  onPress: () => open(entries[0]!, true),
                },
              ],
            }
          : {})}
      />
      <ScrollView contentContainerClassName="gap-3 p-4">
        {feed.isPending ? (
          <>
            <View className="h-28 rounded-xl bg-subtle" />
            <View className="h-28 rounded-xl bg-subtle" />
          </>
        ) : entries.length === 0 ? (
          <EmptyState title="Nothing to decide" detail="Agents' questions show up here." />
        ) : (
          entries.map((entry) => {
            const { item } = entry;
            const quick =
              item.kind === "review" || item.kind === "pitch" ? VERDICT_BUTTONS[item.kind] : null;
            const thumbs = item.options.flatMap((option) => {
              const media = option.media_idx === null ? undefined : item.media[option.media_idx];
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
                    {thumbs.slice(0, 3).map((media) => (
                      <View key={media.key} className="flex-1">
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
        {feed.unreachable.length > 0 ? (
          <Text className="text-xs text-foreground-muted">
            Couldn't reach {feed.unreachable.join(", ")}; their decisions show up when they're back.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}
