#!/bin/sh
# Builds the unsigned arm64 Mac desktop app (no Apple Developer ID: the first
# launch of a downloaded copy needs right-click → Open; a local build doesn't).
# It has no update feed, because an unsigned app can't apply updates from
# one: updating means running this again on a newer main.
#
#   ccez/release/mac.sh [--install]
#     writes release/<name>-<version>-arm64.{dmg,zip}
#     --install   replaces /Applications/czcode.app (quit czcode first) and
#                 points ~/.local/bin/cz at the installed app's server, so
#                 `cz inbox`, `cz queue`, and `cz serve` match the app
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
env -u CZ_DESKTOP_UPDATE_REPOSITORY -u GITHUB_REPOSITORY \
  node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch arm64
zip=$(ls -t release/*-arm64.zip | head -1)
if [ "$(stat -f %m "$zip")" -lt "$started" ]; then
  echo "no new build in release/" >&2
  exit 1
fi
echo "mac: $zip"
$install || exit 0

staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT
ditto -x -k "$zip" "$staging"
rm -rf /Applications/czcode.app
ditto "$staging/czcode.app" /Applications/czcode.app

mkdir -p "$HOME/.local/bin"
cat > "$HOME/.local/bin/cz" <<'SHIM'
#!/bin/sh
# The cz CLI, run by the installed czcode app's own Node (ccez/release/mac.sh).
app=/Applications/czcode.app
ELECTRON_RUN_AS_NODE=1 exec "$app/Contents/MacOS/czcode" \
  "$app/Contents/Resources/app.asar/apps/server/dist/bin.mjs" "$@"
SHIM
chmod +x "$HOME/.local/bin/cz"
echo "installed: /Applications/czcode.app, $HOME/.local/bin/cz"
