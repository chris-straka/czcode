import { ScreenScrollView as ScrollView } from "../../components/ScreenScrollView";
import { AppText as Text } from "../../components/AppText";
import { SettingsScreen } from "./components/SettingsScreen";

// Push notifications went through the hosted relay, which czcode removed. Open
// the app to check on threads and decisions; direct push may return later.
export function SettingsNotificationsRouteScreen() {
  return (
    <SettingsScreen title="Notifications">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerClassName="px-5 pt-4">
        <Text className="text-base text-foreground-muted">
          Push notifications are off. Open the app to check on threads and decisions.
        </Text>
      </ScrollView>
    </SettingsScreen>
  );
}
