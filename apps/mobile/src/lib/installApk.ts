import { File, Paths } from "expo-file-system";
import { getContentUriAsync } from "expo-file-system/legacy";
import { startActivityAsync } from "expo-intent-launcher";

const APK_MIME = "application/vnd.android.package-archive";
// Intent.FLAG_GRANT_READ_URI_PERMISSION: lets the installer read our cached file.
const GRANT_READ_URI_PERMISSION = 1;

/**
 * Downloads an APK into the app's cache and opens Android's installer on it,
 * so updates and playtest builds install without a trip through the browser.
 * Android asks once to allow czcode to install apps.
 */
export async function downloadAndInstallApk(url: string, fileName: string): Promise<void> {
  const target = new File(Paths.cache, fileName);
  if (target.exists) target.delete();
  const downloaded = await File.downloadFileAsync(url, target);
  const contentUri = await getContentUriAsync(downloaded.uri);
  await startActivityAsync("android.intent.action.VIEW", {
    data: contentUri,
    type: APK_MIME,
    flags: GRANT_READ_URI_PERMISSION,
  });
}
