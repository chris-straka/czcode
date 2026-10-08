#!/bin/sh
# Builds the unsigned arm64 Mac desktop app (no Apple Developer ID: the first
# launch of a browser-downloaded copy needs right-click → Open; a local build
# or one installed by mac-install.sh doesn't). CI runs this on every push to
# main and publishes the result (.github/workflows/mac-release.yml); the app
# checks those releases and updates itself (apps/desktop/src/electron/
# MacReleaseUpdater.ts), so this is only for testing a local change.
#
#   ccez/release/mac.sh [--install]
#     writes release/<name>-<version>-arm64.{dmg,zip}
#     --install   replaces /Applications/czcode.app (quit czcode first) and
#                 points ~/.local/bin/cz at its server (mac-install.sh)
#
# CZ_DESKTOP_VERSION sets the version; CI uses <package version>-mac.<run>.
# A build without the -mac.<n> suffix updates to the newest release.
set -eu
install=false
for arg in "$@"; do
  case "$arg" in
    --install) install=true ;;
    *) echo "unknown flag: $arg" >&2; exit 64 ;;
  esac
done

repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
cd "$repo"
if $install && pgrep -x czcode > /dev/null; then
  echo "czcode is running; quit it first" >&2
  exit 1
fi

started=$(date +%s)
# The update repository only names the feed in app-update.yml; electron-builder
# never publishes from here.
env -u GITHUB_REPOSITORY CZ_DESKTOP_UPDATE_REPOSITORY=chris-straka/czcode \
  node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch arm64
zip=$(ls -t release/*-arm64.zip | head -1)
if [ "$(stat -f %m "$zip")" -lt "$started" ]; then
  echo "no new build in release/" >&2
  exit 1
fi
echo "mac: $zip"
$install || exit 0
sh ccez/release/mac-install.sh "$zip"
