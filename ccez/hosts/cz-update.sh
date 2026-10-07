#!/usr/bin/env bash
# Updates this host's cz to origin/main without cutting off running agents.
# Runs nightly as the cz-job-update host job (host-jobs.sh); to update now:
#
#   systemctl --user start --no-block cz-job-update.service
#
# cz runs from one of two release checkouts, ~/.local/lib/cz-host/cz/a and
# .../b, through the `current` symlink that ~/.local/bin/cz executes. This
# script builds origin/main into the other one in the background, then
# switches `current` and restarts cz-host only when cz is idle: no thread
# running, starting, or running background tasks, no queued run or scheduled
# task due within 10 minutes. It checks every 2 minutes for up to --wait
# minutes (default 180), then leaves the build staged for the next run. If the
# new build doesn't come up, it switches back and restarts the old one.
#
#   cz-update.sh [--wait <minutes>] [--now | --no-restart]
#
# --now restarts without waiting for idle (agents mid-turn are cut off).
# --no-restart only builds (linux.sh, which starts the service itself).
# Never run this from a cz thread directly: the restart ends the process
# tree it runs in. Start the systemd job instead.
#
# Exit status: 0 up to date, 2 built but still waiting for idle, 1 failed.
set -uo pipefail
wait_minutes=180
now=false
restart=true
while [ $# -gt 0 ]; do
  case "$1" in
    --wait) wait_minutes=$2 && shift ;;
    --now) now=true ;;
    --no-restart) restart=false ;;
    *) echo "unknown option: $1" >&2 && exit 1 ;;
  esac
  shift
done

repo="$HOME/SWE/czcode"
releases="$HOME/.local/lib/cz-host/cz"
current="$releases/current"
shim="$HOME/.local/bin/cz"
unit=cz-host.service
# shellcheck disable=SC1091
[ -f "$HOME/.config/vite-plus/env" ] && . "$HOME/.config/vite-plus/env"
export PATH="$HOME/.local/bin:$HOME/.local/share/vite-plus/bin:$PATH"
mkdir -p "$releases"

release_sha() { cat "$1/.cz-release" 2> /dev/null; }
short() { printf '%s' "${1:0:10}"; }

git -C "$repo" fetch -q origin main || { echo "Couldn't fetch origin/main in $repo." && exit 1; }
target=$(git -C "$repo" rev-parse origin/main)

if [ -L "$current" ]; then
  active=$(readlink -f "$current")
  case "$active" in */a) slot="$releases/b" ;; *) slot="$releases/a" ;; esac
else
  active=""
  slot="$releases/a"
fi
active_sha=$(release_sha "$active")

# Build origin/main into the spare slot unless it's already running or staged.
if [ "$target" != "$active_sha" ] && [ "$target" != "$(release_sha "$slot")" ]; then
  echo "Building $(short "$target") in $slot"
  rm -f "$slot/.cz-release"
  if [ -e "$slot/.git" ]; then
    git -C "$slot" reset -q --hard && git -C "$slot" checkout -q --detach "$target"
  else
    rm -rf "$slot" && git -C "$repo" worktree add -q --detach "$slot" "$target"
  fi || { echo "Couldn't check out $(short "$target") in $slot." && exit 1; }
  if ! (cd "$slot" && nice -n 10 vp i && nice -n 10 vp run --filter @cz/web --filter cz build); then
    echo "Build of $(short "$target") failed; cz stays on $(short "${active_sha:-the checkout build}")."
    exit 1
  fi
  echo "$target" > "$slot/.cz-release"
fi

point_shim_at_current() {
  [ -f "$shim" ] && ! grep -q "$current/" "$shim" && cp "$shim" "$shim.before-releases"
  cat > "$shim" << SHIM
#!/usr/bin/env bash
# The cz CLI from the release ccez/hosts/cz-update.sh installed last.
exec /usr/bin/node "$current/apps/server/dist/bin.mjs" "\$@"
SHIM
  chmod +x "$shim"
}
switch_to() { ln -sfn "$1" "$current.new" && mv -Tf "$current.new" "$current"; }

# First release on this host: nothing runs from the slots yet, so switch now.
# The server still runs the old build until the restart below.
if [ -z "$active" ] && [ "$(release_sha "$slot")" = "$target" ]; then
  switch_to "$slot"
  point_shim_at_current
  active=$(readlink -f "$current")
  active_sha=$target
fi

$restart || { echo "Built $(short "$target")." && exit 0; }
staged=false
[ "$(release_sha "$slot")" = "$target" ] && [ "$active_sha" != "$target" ] && staged=true
# A restart is also due when the service started before `current` last moved.
service_started() {
  date -d "$(systemctl --user show -p ExecMainStartTimestamp --value "$unit")" +%s 2> /dev/null || echo 0
}
stale_server=false
if systemctl --user is-active -q "$unit" && [ "$(service_started)" -lt "$(stat -c %Y "$current" 2> /dev/null || echo 0)" ]; then
  stale_server=true
fi
if ! $staged && ! $stale_server; then
  echo "cz is up to date at $(short "$active_sha")."
  exit 0
fi

# Why cz isn't idle, or nothing when it is.
busy_reason() {
  systemctl --user is-active -q "$unit" || return 0
  local threads queue soon_ms soon_iso db="$HOME/.cz/userdata/statev2.sqlite" n
  threads=$(cz thread list --all --json 2> /dev/null) || {
    echo "cz isn't answering"
    return
  }
  n=$(jq '[.[] | select(.busy // .running)] | length' <<< "$threads")
  [ "$n" -eq 0 ] || { echo "$n thread(s) working" && return; }
  soon_ms=$((($(date +%s) + 600) * 1000))
  queue=$(cz queue list --json 2> /dev/null) || queue='[]'
  n=$(jq --argjson soon "$soon_ms" '[.[] | select(.status == "queued" and .dueAt <= $soon)] | length' <<< "$queue")
  [ "$n" -eq 0 ] || { echo "$n queued run(s) due within 10 minutes" && return; }
  if command -v sqlite3 > /dev/null && [ -f "$db" ]; then
    soon_iso=$(date -u -d '+10 minutes' +%Y-%m-%dT%H:%M:%S)
    n=$(sqlite3 "file:$db?mode=ro" "SELECT count(*) FROM scheduled_tasks WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= '$soon_iso'" 2> /dev/null || echo 0)
    [ "$n" -eq 0 ] || { echo "$n scheduled task(s) due within 10 minutes" && return; }
  fi
}

deadline=$(($(date +%s) + wait_minutes * 60))
while ! $now; do
  reason=$(busy_reason)
  [ -z "$reason" ] && break
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "Built $(short "$target"); still waiting for idle ($reason). The next run tries again."
    exit 2
  fi
  echo "Waiting for idle: $reason"
  sleep 120
done

previous=$active
$staged && switch_to "$slot"
point_shim_at_current
echo "Restarting cz-host on $(short "$(release_sha "$(readlink -f "$current")")")"
systemctl --user restart "$unit"

healthy() {
  for _ in $(seq 24); do
    sleep 5
    systemctl --user is-active -q "$unit" && cz thread list --json > /dev/null 2>&1 && break
  done
  # Still up a little later, not crash-looping.
  sleep 15
  systemctl --user is-active -q "$unit" && cz thread list --json > /dev/null 2>&1
}
if healthy; then
  echo "Updated cz to $(short "$(release_sha "$(readlink -f "$current")")")."
  exit 0
fi
if [ -n "$previous" ] && [ "$previous" != "$(readlink -f "$current")" ]; then
  switch_to "$previous"
elif [ -f "$shim.before-releases" ]; then
  # The first release failed: back to the build in the checkout.
  cp "$shim.before-releases" "$shim"
  rm -f "$current"
fi
systemctl --user restart "$unit"
echo "The new build didn't start; rolled back. See: journalctl --user -u $unit"
exit 1
