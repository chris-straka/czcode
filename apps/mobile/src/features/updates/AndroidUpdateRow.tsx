import { useAtomValue } from "@effect/atom-react";
import { resolveAssetUrl } from "@cz/client-runtime/state/assets";
import type { EnvironmentId } from "@cz/contracts";
import Constants from "expo-constants";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { useState } from "react";
import { Alert, Linking, Platform } from "react-native";

import { downloadAndInstallApk } from "../../lib/installApk";
import { mobileReleaseEnvironment } from "../../state/mobileRelease";
import { usePreparedConnection } from "../../state/session";
import { SettingsRow } from "../settings/components/SettingsRow";

/** This build's Android versionCode, stamped by `ccez/release/android.sh`. */
const installedVersionCode = Number(Constants.expoConfig?.extra?.androidVersionCode ?? 0);

/**
 * "Install update" when a paired machine has a newer APK. Tapping downloads it
 * in the app and opens Android's installer on it.
 */
export function AndroidUpdateRows({
  environmentIds,
}: {
  readonly environmentIds: ReadonlyArray<EnvironmentId>;
}) {
  if (Platform.OS !== "android") return null;
  return environmentIds.map((environmentId) => (
    <AndroidUpdateRow key={environmentId} environmentId={environmentId} />
  ));
}

function AndroidUpdateRow({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const result = useAtomValue(mobileReleaseEnvironment.android({ environmentId, input: null }));
  const connection = usePreparedConnection(environmentId);
  const release = Option.getOrNull(AsyncResult.value(result));
  const httpBaseUrl = connection._tag === "Some" ? connection.value.httpBaseUrl : null;
  const url = httpBaseUrl && release ? resolveAssetUrl(httpBaseUrl, release.url) : null;
  const [downloading, setDownloading] = useState(false);
  if (!release || release.versionCode <= installedVersionCode || !url) return null;
  const install = async () => {
    setDownloading(true);
    try {
      await downloadAndInstallApk(url, `czcode-${release.versionCode}.apk`);
    } catch (error) {
      Alert.alert(
        "Couldn't install the update",
        `${error instanceof Error ? error.message : String(error)}\n\nDownload it in the browser instead?`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open browser", onPress: () => void Linking.openURL(url) },
        ],
      );
    } finally {
      setDownloading(false);
    }
  };
  return (
    <SettingsRow
      icon="arrow.down.circle"
      label={downloading ? "Downloading update…" : "Install update"}
      value={`${release.version} (${release.versionCode})`}
      valuePosition="trailing"
      onPress={downloading ? undefined : () => void install()}
    />
  );
}
