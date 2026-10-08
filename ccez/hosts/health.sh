#!/usr/bin/env bash
# Checks this host and prints one line per problem. Runs nightly as the
# cz-job-health host job (host-jobs.sh), and by hand:
#
#   bash ~/SWE/czcode/ccez/hosts/health.sh
#
# Disk space; SMART health (udisks2) and kernel disk errors (a dying drive once filled a
# host's disk with 106 GB of kernel log); log sizes; failed systemd units and
# timers whose program is missing; memory and swap pressure and recent
# out-of-memory kills; cz-host itself; and whether the other hosts in
# hosts.txt answer. Nightly, every host has just woken (CZ_HOST_WAKE_TIMES),
# so one that doesn't answer is down, not asleep.
#
# Exit status: 0 healthy, 2 problems found.
set -uo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

problems=()
problem() { problems+=("$1") && echo "problem: $1"; }

# Disk space on every real filesystem, flagged at 80% so there's time to act
# before 85%.
while read -r use avail mount; do
  use=${use%\%}
  if [ "$use" -ge 90 ]; then
    problem "disk $mount is $use% full ($avail free)"
  elif [ "$use" -ge 80 ]; then
    problem "disk $mount is $use% full ($avail free); free space before it passes 85% (agent-drive.sh moves build output and caches to a second drive)"
  fi
done < <(df -h --output=pcent,avail,target -x tmpfs -x devtmpfs -x squashfs -x overlay -x efivarfs -x vfat 2> /dev/null | tail -n +2)
# Folders agent-drive.sh moved are symlinks into the agent drive; they break
# if it isn't mounted.
drive=${CZ_AGENT_DRIVE:-/data}
if [ -d "$drive/$USER" ] || find "$HOME" "$HOME/.cache" -maxdepth 1 -type l -lname "$drive/*" 2> /dev/null | grep -q .; then
  mountpoint -q "$drive" || problem "the agent drive $drive isn't mounted; folders moved there are unreachable"
fi

# SMART, from udisks2 (it reads every drive's SMART data every 10 minutes and
# shares it without root).
smart() { busctl --system get-property org.freedesktop.UDisks2 "$1" "$2" "$3" 2> /dev/null | awk '{print $2}'; }
while read -r drive; do
  name=${drive##*/}
  if [ "$(smart "$drive" org.freedesktop.UDisks2.Drive.Ata SmartEnabled)" = true ]; then
    [ "$(smart "$drive" org.freedesktop.UDisks2.Drive.Ata SmartFailing)" != true ] ||
      problem "SMART says drive $name is failing"
    bad=$(smart "$drive" org.freedesktop.UDisks2.Drive.Ata SmartNumBadSectors)
    [ "${bad:-0}" -le 0 ] || problem "drive $name has $bad bad sectors (SMART)"
    failing=$(smart "$drive" org.freedesktop.UDisks2.Drive.Ata SmartNumAttributesFailing)
    [ "${failing:-0}" -le 0 ] || problem "drive $name: $failing SMART attributes failing"
  fi
  warning=$(smart "$drive" org.freedesktop.UDisks2.NVMe.Controller SmartCriticalWarning)
  [ -z "$warning" ] || [ "$warning" = 0 ] || problem "NVMe drive $name reports a critical warning"
done < <(busctl --system tree org.freedesktop.UDisks2 --list 2> /dev/null | grep '/drives/')

# Kernel disk errors in the last day (the journal is readable to the adm group).
disk_errors=$(journalctl -k --since -24h --no-pager -q 2> /dev/null |
  grep -E 'I/O error|Medium Error|UNC|failed command|blk_update_request|Buffer I/O' |
  grep -oE '(sd[a-z]+|nvme[0-9]+n[0-9]+|ata[0-9.]+)' | sort | uniq -c | sort -rn | head -3 |
  awk '{printf "%s%s (%s)", (NR > 1 ? ", " : ""), $2, $1}')
[ -z "$disk_errors" ] || problem "kernel disk errors in the last day: $disk_errors"

# Logs.
journal_mb=$(journalctl --disk-usage 2> /dev/null | grep -oE '[0-9.]+[KMGT]' | head -1 | numfmt --from=iec --to-unit=1048576 2> /dev/null || echo 0)
[ "${journal_mb%.*}" -lt 1536 ] || problem "the journal takes ${journal_mb%.*} MB"
varlog_mb=$(du -smx /var/log 2> /dev/null | cut -f1)
[ "${varlog_mb:-0}" -lt 5120 ] || problem "/var/log takes ${varlog_mb} MB"

# Failed units: every system one, and the user ones installed in
# ~/.config/systemd/user or created by name with `systemd-run --user` (the
# desktop's own user units fail on a headless host). Unnamed `systemd-run`
# units (run-*) and scopes are one-off commands, not the host's.
while read -r unit; do
  problem "failed system unit: $unit"
done < <(systemctl --system --failed --plain --no-legend 2> /dev/null |
  awk '{print $1}' | grep -vE '^run-|\.scope$')
while read -r unit; do
  case "$(systemctl --user show -p FragmentPath --value "$unit")" in
    "$HOME/.config/systemd/user/"* | /run/user/*/systemd/transient/*) problem "failed user unit: $unit" ;;
  esac
done < <(systemctl --user --failed --plain --no-legend 2> /dev/null |
  awk '{print $1}' | grep -vE '^run-|\.scope$')
# User timers whose program is gone fail only when they fire; catch them now.
while read -r timer; do
  service=$(systemctl --user show -p Unit --value "$timer")
  program=$(systemctl --user show -p ExecStart --value "$service" | sed -n 's/.*path=\([^ ;]*\).*/\1/p' | head -1)
  [ -z "$program" ] || command -v "$program" > /dev/null || problem "timer $timer runs $program, which is missing"
done < <(systemctl --user list-timers --all --plain --no-legend 2> /dev/null | grep -oE '[^ ]+\.timer')

# Memory and swap.
read -r total avail swap_total swap_free < <(awk '
  /^MemTotal:/ {t = $2} /^MemAvailable:/ {a = $2} /^SwapTotal:/ {st = $2} /^SwapFree:/ {sf = $2}
  END {print t, a, st, sf}' /proc/meminfo)
[ $((avail * 100 / total)) -ge 10 ] || problem "only $((avail / 1024)) MB of memory available"
[ "$swap_total" -eq 0 ] || [ $(((swap_total - swap_free) * 100 / swap_total)) -lt 50 ] ||
  problem "swap is $(((swap_total - swap_free) * 100 / swap_total))% used"
full=$(awk '/^full/ {sub("avg300=", "", $4); print int($4)}' /proc/pressure/memory 2> /dev/null || echo 0)
[ "${full:-0}" -lt 5 ] || problem "memory pressure: tasks stalled ${full}% of the last 5 minutes"
ooms=$(journalctl -k --since -24h --no-pager -q 2> /dev/null | grep -c 'Out of memory: Killed')
[ "$ooms" -eq 0 ] || problem "$ooms out-of-memory kill(s) in the last day"

# cz itself.
systemctl --user is-active -q cz-host.service || problem "cz-host isn't running"

# The other hosts. Wait a little for any that are still waking.
for host in $(other_hosts); do
  login=$(host_field "$host" 2)
  ok=false
  for _ in 1 2 3 4 5 6; do
    if [ "$login" = - ]; then
      online "$host" && ok=true
    else
      ssh "${ssh_opts[@]}" "$login" true 2> /dev/null && ok=true
    fi
    $ok && break
    sleep 30
  done
  $ok || problem "$host can't be reached"
done

if [ "${#problems[@]}" -eq 0 ]; then
  echo "healthy"
else
  joined=$(printf '%s; ' "${problems[@]}")
  echo "${#problems[@]} problem(s): ${joined%; }"
  exit 2
fi
