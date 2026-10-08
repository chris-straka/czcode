#!/usr/bin/env bash
# Copies this host's cz userdata (threads, the Decisions database and its
# media, settings, secrets) to the host hosts.txt names for it. Runs nightly
# as the cz-job-backup host job (host-jobs.sh), and by hand:
#
#   bash ~/SWE/czcode/ccez/hosts/backup-userdata.sh
#
# The databases are copied with SQLite's online backup from a read-only
# connection, so cz keeps running. The backup host keeps one folder per day,
# ~/cz-backups/<this host>/<date>, for 7 days; unchanged files are hard links
# to the day before, so a day costs about the size of the databases. Wakes
# the backup host if it's asleep. Restoring is in README.md.
#
# Exit status: 0 backed up, 1 failed.
set -uo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
keep=7
src="${CZ_HOME:-$HOME/.cz}/userdata"
me=$(this_host)
to=$(host_field "$me" 3)
[ -n "$to" ] && [ "$to" != - ] || { echo "hosts.txt names no backup host for $me." && exit 1; }
login=$(host_field "$to" 2)

stage="$HOME/.cache/cz-host/backup"
rm -rf "$stage" && mkdir -p "$stage"
for db in statev2.sqlite cz.sqlite; do
  [ -f "$src/$db" ] || continue
  sqlite3 "file:$src/$db?mode=ro" ".backup '$stage/$db'" &&
    [ "$(sqlite3 "$stage/$db" 'PRAGMA quick_check')" = ok ] ||
    { echo "Couldn't snapshot $db." && exit 1; }
done

wake_host "$to" || { echo "$to didn't answer, even after Wake-on-LAN." && exit 1; }
day=$(date +%F)
dest="cz-backups/$me"
# shellcheck disable=SC2029 # expands here on purpose
ssh "${ssh_opts[@]}" "$login" "mkdir -p '$dest' && chmod 700 cz-backups && rm -rf '$dest/$day.partial'" || exit 1
# shellcheck disable=SC2029
latest=$(ssh "${ssh_opts[@]}" "$login" "ls -1d $dest/20??-??-?? 2> /dev/null | tail -1")
link=()
[ -z "$latest" ] || link=(--link-dest="../$(basename "$latest")")
rsync_to() { rsync -a "${link[@]}" -e "ssh ${ssh_opts[*]}" "$@"; }
if ! rsync_to --exclude logs --exclude '*.sqlite' --exclude '*.sqlite-*' "$src/" "$login:$dest/$day.partial/" ||
  ! rsync_to "$stage/" "$login:$dest/$day.partial/"; then
  echo "Copying to $to failed." && exit 1
fi
# shellcheck disable=SC2029
ssh "${ssh_opts[@]}" "$login" "cd '$dest' && rm -rf '$day' && mv '$day.partial' '$day' &&
  ls -1d 20??-??-?? | head -n -$keep | xargs -r rm -rf --" || exit 1
rm -rf "$stage"
echo "Backed up $(du -sh --exclude logs "$src" | cut -f1) of userdata to $to:~/$dest/$day (keeps $keep days)."
