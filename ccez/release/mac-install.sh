#!/bin/sh
# Installs a czcode Mac build as /Applications/czcode.app and points
# ~/.local/bin/cz at the installed app's server, so `cz inbox`, `cz queue`,
# and `cz serve` match the app. Quit czcode first.
#
#   ccez/release/mac-install.sh [<zip>]
#
# With no zip it installs the newest build from the release feed that
# .github/workflows/mac-release.yml publishes. Only the first install needs
# this; after that the app updates itself. Without a checkout:
#
#   curl -fsSL https://raw.githubusercontent.com/chris-straka/czcode/main/ccez/release/mac-install.sh | sh
set -eu
repo=chris-straka/czcode
app=/Applications/czcode.app

# The app itself, not `cz`/`ct`, which run the server through the same binary
# (their argv carries bin.mjs) and keep working across the swap.
if pgrep -fl "$app/Contents/MacOS/czcode" | grep -qv "bin.mjs"; then
  echo "czcode is running; quit it first" >&2
  exit 1
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
zip=${1:-}
if [ -z "$zip" ]; then
  # Tags are v<version>-mac.<build>; take the highest build.
  tag=$(curl -fsSL "https://api.github.com/repos/$repo/releases?per_page=30" |
    grep -o '"tag_name": *"v[^"]*-mac\.[0-9]*"' | sed 's/.*"\(v[^"]*\)"/\1/' |
    awk -F'-mac.' '{ print $NF, $0 }' | sort -n | tail -1 | cut -d' ' -f2)
  [ -n "$tag" ] || { echo "no Mac release found in $repo" >&2; exit 1; }
  name="Czcode-${tag#v}-arm64.zip"
  echo "downloading $tag"
  curl -fsSL -o "$work/$name" "https://github.com/$repo/releases/download/$tag/$name"
  curl -fsSL -o "$work/$name.sha256" "https://github.com/$repo/releases/download/$tag/$name.sha256"
  (cd "$work" && shasum -a 256 -c "$name.sha256")
  zip="$work/$name"
fi

mkdir "$work/app"
ditto -x -k "$zip" "$work/app"
rm -rf "$app"
ditto "$work/app/czcode.app" "$app"

mkdir -p "$HOME/.local/bin"
cat > "$HOME/.local/bin/cz" <<'SHIM'
#!/bin/sh
# The cz CLI, run by the installed czcode app's own Node (ccez/release/mac-install.sh).
app=/Applications/czcode.app
ELECTRON_RUN_AS_NODE=1 exec "$app/Contents/MacOS/czcode" \
  "$app/Contents/Resources/app.asar/apps/server/dist/bin.mjs" "$@"
SHIM
chmod +x "$HOME/.local/bin/cz"
echo "installed: $app, $HOME/.local/bin/cz"
