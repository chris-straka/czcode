import { useNavigation } from "@react-navigation/native";
import type { EnvironmentId } from "@cz/contracts";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { useThreadDecisions } from "../../state/decisions";

/** Above the composer: decisions this thread's agent asked that are still open. */
export function ThreadDecisionsBanner(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: string;
}) {
  const navigation = useNavigation();
  const decisions = useThreadDecisions(props.environmentId, props.threadId);
  const first = decisions[0];
  if (!first) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Opens the decision"
      onPress={() =>
        navigation.navigate("Decision", { environmentId: first.environmentId, id: first.item.id })
      }
      className="mx-3 mb-2 flex-row items-center gap-3 rounded-2xl bg-subtle px-4 py-3 active:opacity-70"
    >
      <SymbolView name="tray" size={16} tintColorClassName="accent-icon" type="monochrome" />
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-cz-medium text-foreground">
          {decisions.length === 1
            ? "A decision is waiting on you"
            : `${decisions.length} decisions are waiting on you`}
        </Text>
        <Text className="text-xs text-foreground-muted" numberOfLines={1}>
          {first.item.question}
        </Text>
      </View>
      <Text className="text-sm text-primary">Answer</Text>
    </Pressable>
  );
}
