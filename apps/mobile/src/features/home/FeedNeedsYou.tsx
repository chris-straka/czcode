import {
  buildOneFeed,
  shortMachineLabel,
  shortModelLabel,
} from "@cz/client-runtime/decisions/oneFeed";
import { optionMedia } from "@cz/client-runtime/decisions/draft";
import { formatModelSlugName } from "@cz/shared/model";
import { useNavigation } from "@react-navigation/native";
import { useMemo } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { type DecisionEntry, useFilteredOpenDecisions } from "../../state/decisions";
import { useThreadShells } from "../../state/entities";
import { DecisionMedia } from "../decisions/DecisionMedia";

/**
 * The top of the one feed on the phone: every card that needs the owner,
 * before the thread rows. A thread's decisions ride on its card; decisions
 * from outside a thread get their own. Tapping opens the decision.
 */
export function FeedNeedsYou() {
  const navigation = useNavigation();
  const { entries } = useFilteredOpenDecisions();
  const threads = useThreadShells();
  const cards = useMemo(
    () =>
      buildOneFeed({
        threads,
        decisions: entries,
        filter: { machine: { type: "all" } },
      }).filter((card) => card.kind === "decision" || card.decisions.length > 0),
    [threads, entries],
  );
  if (cards.length === 0) return null;
  const open = (entry: DecisionEntry) =>
    navigation.navigate("Decision", { environmentId: entry.environmentId, id: entry.item.id });

  return (
    <View className="gap-3 px-4 pb-2 pt-1">
      <Text className="text-xs font-cz-medium uppercase tracking-wide text-foreground-muted">
        Needs you {entries.length}
      </Text>
      {cards.map((card) => {
        const decisions = card.kind === "decision" ? [card.decision] : card.decisions;
        const first = decisions[0]!;
        const meta =
          card.kind === "thread"
            ? `${shortMachineLabel(first.environmentLabel)} · ${first.item.project} · ${shortModelLabel(formatModelSlugName(card.thread.modelSelection.model))}`
            : `${shortMachineLabel(first.environmentLabel)} · ${first.item.project} · ${first.item.kind}`;
        return (
          <View key={card.key} className="gap-2 rounded-xl border border-warning/40 bg-subtle p-4">
            <Text className="text-xs text-foreground-muted">{meta}</Text>
            {card.kind === "thread" ? (
              <Text className="font-cz-medium text-base text-foreground">{card.thread.title}</Text>
            ) : null}
            {decisions.map((entry) => {
              // Keyed by option: two options can show the same image.
              const pictures = entry.item.options.flatMap((option) => {
                const media = optionMedia(entry.item, option);
                return entry.item.kind === "pick" && media?.type === "image"
                  ? [{ key: option.id, media }]
                  : [];
              });
              return (
                <Pressable
                  key={entry.item.id}
                  accessibilityRole="button"
                  onPress={() => open(entry)}
                  className="gap-2"
                >
                  <Text
                    className={
                      card.kind === "thread"
                        ? "text-sm text-foreground"
                        : "font-cz-medium text-base text-foreground"
                    }
                  >
                    {card.kind === "thread"
                      ? entry.item.question
                      : entry.item.title || entry.item.question}
                  </Text>
                  {pictures.length > 0 ? (
                    <View className="flex-row gap-2">
                      {pictures.slice(0, 3).map(({ key, media }) => (
                        <View key={key} className="flex-1">
                          <DecisionMedia environmentId={entry.environmentId} media={media} framed />
                        </View>
                      ))}
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}
