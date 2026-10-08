/**
 * The Mac update feed: GitHub releases that `.github/workflows/mac-release.yml`
 * publishes from every push to main. The app is unsigned, so Squirrel.Mac
 * (and electron-updater on top of it) refuses to apply updates; the Mac
 * build reads this feed and swaps its own bundle instead (MacReleaseUpdater).
 *
 * A release is tagged `v<version>`, where the version is
 * `<package version>-mac.<build>` and `<build>` is the workflow's run number,
 * and carries `<zip>` plus `<zip>.sha256`. A local `ccez/release/mac.sh`
 * build has no build number and counts as build 0, so it updates to the
 * newest release.
 */

export interface MacRelease {
  readonly version: string;
  readonly build: number;
  readonly zipUrl: string;
  readonly zipSize: number;
  readonly sha256Url: string;
}

interface GitHubReleaseAsset {
  readonly name?: unknown;
  readonly browser_download_url?: unknown;
  readonly size?: unknown;
}

interface GitHubRelease {
  readonly tag_name?: unknown;
  readonly draft?: unknown;
  readonly assets?: unknown;
}

const MAC_VERSION_PATTERN = /-mac\.(\d+)$/;

/** The build number in a Mac release version, or 0 for a local build. */
export function macBuildNumber(version: string): number {
  const match = MAC_VERSION_PATTERN.exec(version.trim());
  return match?.[1] ? Number(match[1]) : 0;
}

/** The newest arm64 Mac release in a GitHub `GET /releases` response. */
export function newestMacRelease(releases: unknown): MacRelease | null {
  if (!Array.isArray(releases)) return null;
  let newest: MacRelease | null = null;
  for (const release of releases as ReadonlyArray<GitHubRelease>) {
    if (release.draft === true || typeof release.tag_name !== "string") continue;
    if (!release.tag_name.startsWith("v")) continue;
    const version = release.tag_name.slice(1);
    const build = macBuildNumber(version);
    if (build === 0 || (newest && newest.build >= build)) continue;
    const assets = Array.isArray(release.assets)
      ? (release.assets as ReadonlyArray<GitHubReleaseAsset>)
      : [];
    const zip = assets.find(
      (asset) => typeof asset.name === "string" && asset.name.endsWith("-arm64.zip"),
    );
    const sha256 = assets.find(
      (asset) => typeof asset.name === "string" && asset.name === `${String(zip?.name)}.sha256`,
    );
    if (
      typeof zip?.browser_download_url !== "string" ||
      typeof sha256?.browser_download_url !== "string"
    ) {
      continue;
    }
    newest = {
      version,
      build,
      zipUrl: zip.browser_download_url,
      zipSize: typeof zip.size === "number" ? zip.size : 0,
      sha256Url: sha256.browser_download_url,
    };
  }
  return newest;
}

/** The hex digest in a `shasum -a 256` line (`<hex>  <file>`). */
export function parseSha256File(contents: string): string | null {
  const digest = contents.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return /^[0-9a-f]{64}$/.test(digest) ? digest : null;
}

/**
 * The detached script that swaps the bundle once the app has exited:
 * `sh -c <script> sh <pid> <app> <staged app> <relaunch 0|1> <failure file>
 * <launched file> <log file> <version>`.
 *
 * The staged app sits next to the installed one, so both moves are renames
 * on one volume. If either move fails, the old app goes back in place. On a
 * relaunch the old app is kept until the new one proves it came up by
 * writing the launched file (markMacUpdateLaunched); if it doesn't within
 * 90 seconds, the new app is stopped, the old one goes back and opens.
 * Every failure leaves one plain sentence in the failure file for the next
 * launch to show, and every step is appended to the log file. An app that
 * hasn't exited after two minutes is killed, so a hung quit still relaunches.
 * The app's path never changes, so the `cz` shim that `mac.sh --install`
 * writes keeps running the installed app's server. `CZ_UPDATE_OPEN` replaces
 * `open` and `CZ_UPDATE_LAUNCH_TRIES` (half seconds) shortens the wait, for
 * tests.
 */
export const MAC_SWAP_SCRIPT = `
pid=$1 app=$2 staged=$3 relaunch=$4 failed=$5 launched=$6 log=$7 version=$8
opener=\${CZ_UPDATE_OPEN:-open}
say() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$log"; }
fail() { echo "$1" > "$failed"; say "failed: $1"; }
waited=0
while kill -0 "$pid" 2>/dev/null; do
  sleep 0.5
  waited=$((waited + 1))
  if [ "$waited" = 240 ]; then say "the app hadn't quit after 2 minutes; stopping it"; kill -9 "$pid" 2>/dev/null; fi
done
old="$(dirname "$app")/.czcode-old-$$.app"
swapped=0
if [ ! -d "$staged" ]; then
  fail "The downloaded update went missing before it could be installed."
elif ! mv "$app" "$old"; then
  fail "czcode couldn't move the old app aside, so it kept the current version."
elif ! mv "$staged" "$app"; then
  mv "$old" "$app"
  fail "czcode couldn't put the new app in place, so it kept the current version."
else
  swapped=1
  say "installed $version"
fi
if [ "$relaunch" != 1 ]; then
  if [ "$swapped" = 1 ]; then rm -rf "$old" "$(dirname "$staged")"; fi
  exit 0
fi
rm -f "$launched"
say "relaunching"
"$opener" "$app" || say "open failed"
tries=0
while [ ! -f "$launched" ] && [ "$tries" -lt "$launch_tries" ]; do sleep 0.5; tries=$((tries + 1)); done
if [ -f "$launched" ]; then
  say "relaunched: $(cat "$launched")"
  if [ "$swapped" = 1 ]; then rm -rf "$old" "$(dirname "$staged")"; fi
  exit 0
fi
if [ "$swapped" != 1 ]; then
  say "the app didn't come back up after a failed install"
  exit 1
fi
# The new app never came up: stop it (its main process runs the bundle's
# executable with no server script) and put the old one back.
exe="$app/Contents/MacOS/czcode"
for p in $(ps -axo pid=,args= | awk -v exe="$exe" '$2 == exe && index($0, "bin.mjs") == 0 { print $1 }'); do
  kill "$p" 2>/dev/null
done
sleep 2
broken="$(dirname "$staged")/broken-$$.app"
mkdir -p "$(dirname "$staged")"
if mv "$app" "$broken" && mv "$old" "$app"; then
  rm -rf "$(dirname "$staged")"
  fail "czcode $version didn't start, so it went back to the previous version."
  "$opener" "$app" || say "open failed"
else
  fail "czcode $version didn't start, and the previous version couldn't be put back; reinstall with ccez/release/mac-install.sh."
fi
`;

/** A Mac update failure whose message is one plain sentence for the user. */
export class MacUpdateError extends Error {
  override readonly name = "MacUpdateError";
}

/** The user-facing sentence for an updater failure, if it carries one. */
export function plainUpdateFailureMessage(cause: unknown): string | null {
  return cause instanceof MacUpdateError ? cause.message : null;
}
