#!/usr/bin/env bash
# Brings a host's wired network back when it silently stops passing traffic.
# tune-host-linux.sh installs it as /usr/local/sbin/cz-net-watchdog, run by
# cz-net-watchdog.timer every minute as root, on hosts with an alx chip only.
#
# Why: on 2026-10-07 the router restarted, and f and art (MSI boards with the
# Killer E2200 chip, alx driver) stayed off the network for an hour. The chip
# kept its link and address but passed nothing, until someone turned the
# connection off and on at the PC. basement (a different chip) recovered alone.
#
# Each run pings the router. After 3 failed runs in a row it reconnects the
# interface (what the owner did by hand); after 8 it also reloads the driver.
# A failure is logged with whether other machines on the LAN still answer, so
# the journal tells a stuck chip (nothing answers) from a router or upstream
# problem (the other machines answer):
#
#   journalctl -t cz-net-watchdog
set -uo pipefail
PATH=/usr/sbin:/usr/bin:/sbin:/bin
state=/run/cz-net-watchdog
mkdir -p "$state"
log() { logger -t cz-net-watchdog "$*"; }

read -r gateway device < <(ip -4 route show default | awk '{for (i = 1; i < NF; i++) {if ($i == "via") g = $(i + 1); if ($i == "dev") d = $(i + 1)} print g, d; exit}')
if [ -z "${gateway:-}" ] || [ -z "${device:-}" ]; then
  # No default route at all: use the wired device NetworkManager knows about.
  device=$(nmcli -t -f DEVICE,TYPE device 2> /dev/null | awk -F: '$2 == "ethernet" {print $1; exit}')
  [ -n "$device" ] || exit 0
  gateway=""
fi
[ "$(nmcli -t -g GENERAL.TYPE device show "$device" 2> /dev/null)" = ethernet ] || exit 0

if [ -n "$gateway" ] && ping -c 3 -W 2 -I "$device" "$gateway" > /dev/null 2>&1; then
  if [ -s "$state/fails" ]; then
    log "router $gateway answers again after $(cat "$state/fails") failed checks"
    rm -f "$state/fails"
  fi
  exit 0
fi

fails=$(($(cat "$state/fails" 2> /dev/null || echo 0) + 1))
echo "$fails" > "$state/fails"
# Other LAN machines this host has talked to (not the router).
peers=$(ip -4 neigh show dev "$device" | awk -v g="$gateway" '$1 != g && $0 ~ /lladdr/ {print $1}' | head -5)
answered=0 asked=0
for peer in $peers; do
  asked=$((asked + 1))
  ping -c 1 -W 1 -I "$device" "$peer" > /dev/null 2>&1 && answered=$((answered + 1))
done
carrier=$(cat "/sys/class/net/$device/carrier" 2> /dev/null || echo "?")
log "router ${gateway:-(no route)} not answering on $device (check $fails); link carrier=$carrier; LAN peers answering $answered/$asked"
# No link means a cable, switch or router that's off; resetting the chip won't help.
[ "$carrier" = 1 ] || exit 0

if [ "$fails" -eq 3 ] || [ "$fails" -eq 6 ]; then
  log "reconnecting $device"
  nmcli device disconnect "$device" > /dev/null 2>&1
  sleep 2
  nmcli device connect "$device" > /dev/null 2>&1 || log "reconnecting $device failed"
elif [ "$fails" -eq 8 ]; then
  driver=$(basename "$(readlink "/sys/class/net/$device/device/driver")" 2> /dev/null)
  if [ -n "$driver" ]; then
    log "reloading driver $driver for $device"
    if ! { modprobe -r "$driver" && modprobe "$driver"; }; then log "reloading $driver failed"; fi
    sleep 5
    nmcli device connect "$device" > /dev/null 2>&1 || true
  fi
fi
