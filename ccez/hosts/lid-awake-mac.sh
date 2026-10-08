#!/usr/bin/env bash
# Lets a MacBook agent host keep working with its lid closed while it's on
# power, and makes it a normal laptop again off power. mac.sh installs it on
# Macs with a battery; run it alone to install, check or remove it:
#
#   sudo bash ~/SWE/czcode/ccez/hosts/lid-awake-mac.sh install
#   bash ~/SWE/czcode/ccez/hosts/lid-awake-mac.sh status
#   sudo bash ~/SWE/czcode/ccez/hosts/lid-awake-mac.sh uninstall
#
# A root launchd daemon (uk.ccez.cz-lid-awake) checks the power source every
# 10 seconds. On power it sets `pmset disablesleep 1`, so closing the lid
# doesn't sleep the Mac (cz's caffeinate already stops idle sleep). On battery
# it sets `disablesleep 0` again, and if the lid is already shut (unplugged
# closed, on the way into a bag) it sleeps the Mac at once. The display still
# sleeps either way. Setting disablesleep by hand gets overridden within 10s.
set -euo pipefail

LABEL=uk.ccez.cz-lid-awake
BIN=/usr/local/sbin/cz-lid-awake
PLIST=/Library/LaunchDaemons/$LABEL.plist
LOG=/var/log/cz-lid-awake.log
INTERVAL=10
PATH=/usr/bin:/bin:/usr/sbin:/sbin

die() { printf '%s\n' "$@" >&2; exit 1; }
need_root() { [ "$(id -u)" -eq 0 ] || die "Needs root: sudo bash $0 $1"; }
log() { printf '%s %s\n' "$(date '+%F %T')" "$1"; }

on_ac() { pmset -g ps | head -1 | grep -q "'AC Power'"; }
lid_closed() { ioreg -r -k AppleClamshellState -d 4 | grep -q '"AppleClamshellState" = Yes'; }
# pmset lists SleepDisabled only while it's set.
sleep_disabled() { [ "$(pmset -g | awk '$1 == "SleepDisabled" {print $2}')" = 1 ]; }

# One check: match the sleep setting to the power source.
apply() {
  if on_ac; then
    if ! sleep_disabled; then
      pmset -a disablesleep 1
      log "on power: keeps running with the lid closed"
    fi
  elif sleep_disabled; then
    pmset -a disablesleep 0
    log "on battery: sleeps normally"
    if lid_closed; then
      log "lid already closed: sleeping now"
      pmset sleepnow > /dev/null
    fi
  fi
}

cmd_run() {
  need_root run
  # Stopping the daemon (uninstall, shutdown) leaves a normal laptop behind.
  trap 'pmset -a disablesleep 0; log "stopped: sleeps normally"; exit 0' TERM INT
  log "started"
  while :; do
    apply
    sleep "$INTERVAL" &
    wait $! # so TERM is handled at once, not after the sleep
  done
}

cmd_install() {
  need_root install
  pmset -g batt | grep -q InternalBattery || die "No battery: this Mac doesn't sleep on a lid, so it doesn't need this."
  mkdir -p "$(dirname "$BIN")"
  cp "$0" "$BIN.tmp" && chown root:wheel "$BIN.tmp" && chmod 755 "$BIN.tmp" && mv "$BIN.tmp" "$BIN"
  cat > "$PLIST" << PLISTFILE
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- Lid closed on power (ccez/hosts/lid-awake-mac.sh). Re-installing rewrites this file. -->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$BIN</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$LOG</string>
  <key>StandardErrorPath</key>
  <string>$LOG</string>
</dict>
</plist>
PLISTFILE
  chown root:wheel "$PLIST"
  chmod 644 "$PLIST"
  plutil -lint -s "$PLIST"
  launchctl bootout "system/$LABEL" 2> /dev/null || true
  # bootout finishes in the background; bootstrap fails until it has.
  for try in 1 2 3 4 5 6 7 8 9 10; do
    launchctl bootstrap system "$PLIST" 2> /dev/null && break
    [ "$try" -lt 10 ] || die "launchctl couldn't start $LABEL; see $LOG"
    sleep 1
  done
  echo "Installed: on power this Mac keeps running with the lid closed; on battery it sleeps as usual."
}

cmd_uninstall() {
  need_root uninstall
  launchctl bootout "system/$LABEL" 2> /dev/null || true
  rm -f "$PLIST" "$BIN"
  pmset -a disablesleep 0
  echo "Removed: the Mac sleeps on lid close again."
}

cmd_status() {
  local state
  # launchctl exits 113 when the daemon isn't installed.
  state=$(launchctl print "system/$LABEL" 2> /dev/null | awk '$1 == "state" {print $3; exit}' || true)
  echo "daemon:       ${state:-not installed}"
  echo "power:        $(on_ac && echo AC || echo battery)"
  echo "lid:          $(lid_closed && echo closed || echo open)"
  echo "lid sleeps:   $(sleep_disabled && echo no || echo yes)"
  [ -r "$LOG" ] && tail -n 5 "$LOG" | sed 's/^/log:          /'
  return 0
}

case "${1:-}" in
  install) cmd_install ;;
  uninstall) cmd_uninstall ;;
  run) cmd_run ;;
  status) cmd_status ;;
  *) die "usage: $0 install|status|uninstall  (run is for launchd)" ;;
esac
