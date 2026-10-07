import { useNavigation } from "@react-navigation/native";
import { View } from "react-native";

import { AndroidHeaderIconButton } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import { useFilteredOpenDecisions } from "../../state/decisions";

/** Header button to the Decisions feed, badged with the open count. */
export function DecisionsHeaderButton() {
  const navigation = useNavigation();
  // Counts what the feed shows under its filters, so the two agree.
  const count = useFilteredOpenDecisions().entries.length;
  return (
    <View>
      <AndroidHeaderIconButton
        accessibilityLabel={count > 0 ? `Decisions, ${count} open` : "Decisions"}
        icon="tray"
        onPress={() => navigation.navigate("Decisions")}
      />
      {count > 0 ? (
        <View
          pointerEvents="none"
          className="absolute right-1.5 top-1.5 min-w-4 items-center rounded-full bg-primary px-1"
        >
          <Text className="text-3xs text-primary-foreground">{count}</Text>
        </View>
      ) : null}
    </View>
  );
}
