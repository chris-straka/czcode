import { useAtomValue } from "@effect/atom-react";
import { resolveAssetUrl } from "@cz/client-runtime/state/assets";
import type { AndroidRelease, EnvironmentId } from "@cz/contracts";
import Constants from "expo-constants";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { Linking, Platform } from "react-native";

import { mobileReleaseEnvironment } from "../../state/mobileRelease";
import { usePreparedConnection } from "../../state/session";
import { SettingsRow } from "../settings/components/SettingsRow";

/** This build's Android versionCode, stamped by `ccez/release/android.sh`. */
const installedVersionCode = Number(Constants.expoConfig?.extra?.androidVersionCode ?? 0);

/**
 * "Install update" when a paired machine has a newer APK. Tapping hands the
 * signed download to the browser, which passes it to the system installer.
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
  if (!release || release.versionCode <= installedVersionCode || !url) return null;
  return (
    <SettingsRow
      icon="arrow.down.circle"
      label="Install update"
      value={releaseLabel(release)}
      valuePosition="trailing"
      onPress={() => void Linking.openURL(url)}
    />
  );
}

function releaseLabel(release: AndroidRelease): string {
  return `${release.version} (${release.versionCode}) · ${Math.round(release.sizeBytes / 1_000_000)} MB`;
}
