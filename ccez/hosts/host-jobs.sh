#!/usr/bin/env bash
# Installs this host's scheduled jobs as systemd user timers. linux.sh runs
# it, and so does each cz update; to (re)install by hand:
#
#   bash ~/SWE/czcode/ccez/hosts/host-jobs.sh
#
# Set CZ_HOST_PR_AUTOMERGE=1 on the one host that should merge the owner's
# green PRs; it stays on through later runs until CZ_HOST_PR_AUTOMERGE=0.
#
# Each job is a cz-job-<name> service and timer, listed with its schedule in
# ~/.config/cz-host/jobs.toml for czcode's Schedules view. job-run.sh records
# every run in ~/.local/state/cz-host/jobs; fleet-status.sh shows them for
# every host. Every host wakes at 03:30 (CZ_HOST_WAKE_TIMES, read by cz's
# idle sleep) and stays up while a job runs, so the nightly jobs find the
# other hosts awake.
set -euo pipefail
# fleet (~/SWE/fleet) runs the host jobs and owns idle sleep once it's
# installed: turn the cz-job timers off and leave.
if [ -f "$HOME/.fleet/config.toml" ]; then
  for t in "$HOME"/.config/systemd/user/cz-job-*.timer; do
    [ -e "$t" ] && systemctl --user disable --now "$(basename "$t")" > /dev/null 2>&1 || true
  done
  echo "fleet runs this host's jobs (~/SWE/fleet/hosts/cron.toml)."
  exit 0
fi
# Jobs run the scripts next to this one: the installed release's copy when a
# cz update reruns it, the checkout's when linux.sh or a person does.
hosts=$(cd "$(dirname "$0")" && pwd)
units="$HOME/.config/systemd/user"
config="$HOME/.config/cz-host"
wake=03:30

# name | systemd OnCalendar | script and arguments | description
jobs=(
  "health|*-*-* 03:30|health.sh|Disk, SMART, logs, failed units, memory, and the other hosts"
  "backup|*-*-* 03:35|backup-userdata.sh|Copy ~/.cz/userdata to the backup host in hosts.txt (7 days kept)"
  "sync|*-*-* 03:45|repo-sync.sh|Clone missing repos from repos.txt, fast-forward clean ones, list the rest"
  "drive|*-*-* 03:50|agent-drive.sh|Move model caches, media and big venvs to the agent drive, when idle"
  "sweep|Sun *-*-* 03:55|sweep-builds.sh|Delete build output and finished worktrees untouched for 7 days (not ccez-llm)"
  "update|*-*-* 04:00|cz-update.sh|Build origin/main and restart cz into it when no agent is working"
)
automerge=0
[ -e "$units/cz-job-pr-automerge.timer" ] && automerge=1
[ "${CZ_HOST_PR_AUTOMERGE:-$automerge}" = 1 ] && jobs+=(
  "pr-automerge|*:0/10|pr-automerge.sh|Merge the owner's green PRs; ask Dependabot to rebase conflicting ones"
)

mkdir -p "$units" "$config" "$units/cz-host.service.d"

toml="# Scheduled jobs on this host, for czcode's Schedules view. host-jobs.sh
# writes the cz-job-* entries; agents add theirs with \`cz jobs add\`. The last
# run of a job run through job-run.sh is in ~/.local/state/cz-host/jobs/<name>.json.
"
wanted=()
for job in "${jobs[@]}"; do
  IFS='|' read -r name calendar script description <<< "$job"
  wanted+=("cz-job-$name.timer")
  cat > "$units/cz-job-$name.service" << UNIT
[Unit]
Description=cz host job: $description

[Service]
Type=oneshot
# 2 means the job ran and found something for the owner, not that it failed.
SuccessExitStatus=2
Nice=10
IOSchedulingClass=idle
TimeoutStartSec=4h
Environment=PATH=%h/.local/bin:%h/.cargo/bin:%h/.local/go/bin:/usr/local/bin:/usr/bin:/bin
EnvironmentFile=-%h/.config/cz-host/environment
ExecStart=/usr/bin/env bash $hosts/job-run.sh $name bash $hosts/$script
UNIT
  cat > "$units/cz-job-$name.timer" << UNIT
[Unit]
Description=cz host job: $name

[Timer]
OnCalendar=$calendar
# Runs on wake when the host slept through its time.
Persistent=true

[Install]
WantedBy=timers.target
UNIT
  toml+="
[[job]]
name = \"$name\"
description = \"$description\"
schedule = \"$calendar\"
command = \"$hosts/$script\"
unit = \"cz-job-$name.timer\"
"
done
# Keep the jobs agents registered (every [[job]] not on a cz-job-* timer).
if [ -f "$config/jobs.toml" ]; then
  toml+=$(awk '
    /^\[\[job\]\]/ { if (block != "" && !mine) printf "\n%s", block; block = ""; mine = 0; inside = 1 }
    inside { block = block $0 "\n"; if ($0 ~ /^unit = "cz-job-/) mine = 1 }
    END { if (block != "" && !mine) printf "\n%s", block }
  ' "$config/jobs.toml")
  toml+=$'\n'
fi
printf '%s' "$toml" > "$config/jobs.toml"

# Jobs that were dropped (pr-automerge turned off, say).
for timer in "$units"/cz-job-*.timer; do
  name=$(basename "$timer")
  printf '%s\n' "${wanted[@]}" | grep -qxF "$name" && continue
  systemctl --user disable --now "$name" > /dev/null 2>&1 || true
  rm -f "$timer" "${timer%.timer}.service"
done

# The nightly wake time; the server reads it at its next restart.
printf '[Service]\nEnvironment=CZ_HOST_WAKE_TIMES=%s\n' "$wake" > "$units/cz-host.service.d/host-jobs.conf"
systemctl --user daemon-reload
systemctl --user enable --now "${wanted[@]}" > /dev/null
systemctl --user list-timers --no-pager 'cz-job-*'
