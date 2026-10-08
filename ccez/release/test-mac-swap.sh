#!/bin/sh
# Exercises the Mac updater's bundle swap (MAC_SWAP_SCRIPT in
# apps/desktop/src/updates/macReleaseFeed.ts) on throwaway copies, never on
# /Applications. With a release zip (CI, on macOS) the new app is the real
# build; without one it uses stand-in bundles, so it also runs on Linux.
#
#   ccez/release/test-mac-swap.sh [<zip>]
set -eu
repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
swap=$(cd "$repo" && node -e 'import("./apps/desktop/src/updates/macReleaseFeed.ts").then((m) => process.stdout.write(m.MAC_SWAP_SCRIPT))')
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

fake_app() {
  mkdir -p "$1/Contents/MacOS"
  echo "$2" > "$1/Contents/marker"
}

# A copy of the installed app plus a staged update, as MacReleaseUpdater leaves them.
setup() {
  rm -rf "$work/Applications" "$work/failed"
  mkdir -p "$work/Applications/.czcode-update"
  fake_app "$work/Applications/czcode.app" old
  if [ -n "${1:-}" ]; then
    ditto -x -k "$1" "$work/Applications/.czcode-update"
    echo new > "$work/Applications/.czcode-update/czcode.app/Contents/marker"
  else
    fake_app "$work/Applications/.czcode-update/czcode.app" new
  fi
}

run_swap() {
  # Stands in for the quitting app: the script waits for it to exit.
  sleep 1 &
  sh -c "$swap" sh $! "$work/Applications/czcode.app" "$work/Applications/.czcode-update/czcode.app" 0 "$work/failed"
}

echo "swap succeeds"
setup "${1:-}"
run_swap
[ "$(cat "$work/Applications/czcode.app/Contents/marker")" = new ] || fail "new app not in place"
[ ! -e "$work/Applications/.czcode-update" ] || fail "staging left behind"
ls -a "$work/Applications" | grep -q czcode-old && fail "old app left behind"
[ ! -e "$work/failed" ] || fail "failure reported: $(cat "$work/failed")"
if [ -n "${1:-}" ]; then
  rm "$work/Applications/czcode.app/Contents/marker"
  # The build is unsigned (only its binaries carry linker signatures), so
  # compare the swapped app with a fresh unpack of the zip instead.
  mkdir "$work/fresh"
  ditto -x -k "$1" "$work/fresh"
  diff -r "$work/fresh/czcode.app" "$work/Applications/czcode.app" > /dev/null || fail "swapped app differs from the zip"
  rm -rf "$work/fresh"
  # What the cz shim runs: the app's own Node on its bundled server.
  app="$work/Applications/czcode.app"
  ELECTRON_RUN_AS_NODE=1 "$app/Contents/MacOS/czcode" \
    "$app/Contents/Resources/app.asar/apps/server/dist/bin.mjs" --version ||
    fail "the swapped app's server doesn't run"
fi

echo "missing update keeps the old app"
setup
rm -rf "$work/Applications/.czcode-update/czcode.app"
run_swap
[ "$(cat "$work/Applications/czcode.app/Contents/marker")" = old ] || fail "old app not kept"
grep -q "kept\|missing" "$work/failed" || fail "no failure sentence"

echo "unreadable update keeps the old app"
setup
chmod 000 "$work/Applications/.czcode-update"
run_swap || true
chmod 755 "$work/Applications/.czcode-update"
[ "$(cat "$work/Applications/czcode.app/Contents/marker")" = old ] || fail "old app not kept"
[ -s "$work/failed" ] || fail "no failure sentence"

echo "ok"
