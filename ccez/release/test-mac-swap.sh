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

# run_swap [relaunch 0|1]. Stands in for the quitting app: the script waits
# for it to exit. CZ_UPDATE_OPEN stands in for `open`.
run_swap() {
  rm -f "$work/launched" "$work/log"
  sleep 1 &
  sh -c "$swap" sh $! "$work/Applications/czcode.app" "$work/Applications/.czcode-update/czcode.app" \
    "${1:-0}" "$work/failed" "$work/launched" "$work/log" test-version
}

# Openers: one whose app comes up (writes the launched file with the marker
# of the app it opened), one whose app never does.
cat > "$work/open-ok" <<OPEN
#!/bin/sh
cat "\$1/Contents/marker" > "$work/launched"
echo "\$1" >> "$work/opened"
OPEN
cat > "$work/open-dead" <<OPEN
#!/bin/sh
echo "\$1" >> "$work/opened"
# Only the old app (put back by the watchdog) comes up.
[ "\$(cat "\$1/Contents/marker")" = old ] && echo old > "$work/launched"
exit 0
OPEN
cat > "$work/open-slow" <<OPEN
#!/bin/sh
# Comes up a few seconds later, like a real app.
(sleep 3; cat "\$1/Contents/marker" > "$work/launched") &
OPEN
chmod +x "$work/open-ok" "$work/open-dead" "$work/open-slow"

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

echo "relaunch: the new app comes up"
setup
CZ_UPDATE_OPEN="$work/open-ok" run_swap 1
[ "$(cat "$work/Applications/czcode.app/Contents/marker")" = new ] || fail "new app not in place"
[ "$(cat "$work/launched")" = new ] || fail "new app not opened"
ls -a "$work/Applications" | grep -q czcode-old && fail "old app kept after a good relaunch"
[ ! -e "$work/failed" ] || fail "failure reported: $(cat "$work/failed")"
grep -q "relaunched: new" "$work/log" || fail "relaunch not logged"

echo "relaunch: the new app takes a few seconds to come up"
setup
CZ_UPDATE_OPEN="$work/open-slow" run_swap 1
[ "$(cat "$work/Applications/czcode.app/Contents/marker")" = new ] || fail "a slow start was rolled back"
[ ! -e "$work/failed" ] || fail "failure reported: $(cat "$work/failed")"
grep -q "relaunched: new" "$work/log" || fail "relaunch not logged"

echo "relaunch: the new app never comes up, so the old one comes back"
setup
rm -f "$work/opened"
CZ_UPDATE_OPEN="$work/open-dead" CZ_UPDATE_LAUNCH_TRIES=6 run_swap 1
[ "$(cat "$work/Applications/czcode.app/Contents/marker")" = old ] || fail "old app not restored"
[ "$(wc -l < "$work/opened")" -eq 2 ] || fail "old app not reopened"
[ ! -e "$work/Applications/.czcode-update" ] || fail "broken update left behind"
ls -a "$work/Applications" | grep -q czcode-old && fail "old app left aside"
grep -q "didn't start, so it went back" "$work/failed" || fail "no failure sentence"
cat "$work/log"

echo "ok"
