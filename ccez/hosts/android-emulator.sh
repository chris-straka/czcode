#!/usr/bin/env bash
# The Android emulator agents test on. Android testing happens on emulators
# only; the owner's phone is theirs.
#
#   bash ~/SWE/czcode/ccez/hosts/android-emulator.sh start   # prints the adb serial
#   bash ~/SWE/czcode/ccez/hosts/android-emulator.sh stop
#   bash ~/SWE/czcode/ccez/hosts/android-emulator.sh setup   # build-tools-linux.sh runs it
#
# One AVD per host, "cz", on Android 36 with KVM. Hosts tagged `emulator` in
# hosts.txt (art-ms-7917, RTX 2060 SUPER) get 4 cores, 4 GB and the host GPU,
# for realistic frame rates; the others get 2 cores, 3 GB and SwiftShader (a
# software GPU), for correctness only. The host GPU needs a display session
# on the host; without one the emulator falls back to SwiftShader there too,
# and `start` says so. `setup` boots it once and saves a snapshot, so `start`
# resumes in seconds instead of cold-booting. `stop` saves it again.
#
# `start` reuses the emulator when it's already running, so several agents
# can share it. Run headless (no window); use `adb -s <serial>` for
# screenshots and input.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
emulator="$ANDROID_HOME/emulator/emulator"
adb="$ANDROID_HOME/platform-tools/adb"
avd=cz
port=5554
serial="emulator-$port"
image="system-images;android-36;google_apis;x86_64"
config="$HOME/.android/avd/$avd.avd/config.ini"

fast=false
[[ ",$(host_field "$(this_host)" 4)," == *,emulator,* ]] && fast=true

# A display the host GPU can render through: this user's desktop session.
find_display() {
  local socket
  [ -n "${DISPLAY:-}" ] && return 0
  for socket in /tmp/.X11-unix/X*; do
    [ -O "$socket" ] || continue
    export DISPLAY=":${socket##*/X}"
    XAUTHORITY=$(find "/run/user/$(id -u)" -maxdepth 1 -name '.mutter-Xwaylandauth.*' 2> /dev/null | head -1)
    export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"
    return 0
  done
  return 1
}

gpu_mode() {
  if $fast && find_display; then echo host; else echo swiftshader_indirect; fi
}

booted() { [ "$("$adb" -s "$serial" shell getprop sys.boot_completed 2> /dev/null | tr -d '\r')" = 1 ]; }

start() {
  [ -f "$config" ] || setup_avd
  if ! booted; then
    "$adb" start-server > /dev/null 2>&1
    local gpu log="$HOME/.cache/cz-emulator.log"
    gpu=$(gpu_mode)
    $fast && [ "$gpu" != host ] &&
      echo "No display session here, so the emulator uses SwiftShader, not the GPU." >&2
    mkdir -p "$(dirname "$log")"
    nohup "$emulator" -avd "$avd" -port "$port" -no-window -no-audio -no-boot-anim \
      -gpu "$gpu" > "$log" 2>&1 &
    for _ in $(seq 120); do
      booted && break
      sleep 2
    done
    booted || { echo "The emulator didn't boot; see $log." >&2 && exit 1; }
  fi
  echo "$serial"
}

stop() {
  # Saves the quick-boot snapshot on the way out.
  "$adb" -s "$serial" emu kill > /dev/null 2>&1 || true
  for _ in $(seq 30); do
    pgrep -f -- "-avd $avd -port $port" > /dev/null || return 0
    sleep 2
  done
}

setup_avd() {
  local cores=2 ram=3072
  $fast && cores=4 ram=4096
  echo no | "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" -s create avd \
    -n "$avd" -k "$image" -d pixel_7 --force > /dev/null
  sed -i -e "s/^hw.cpu.ncore=.*/hw.cpu.ncore=$cores/" -e "s/^hw.ramSize=.*/hw.ramSize=$ram/" \
    -e "s/^hw.gpu.enabled=.*/hw.gpu.enabled=yes/" -e "s/^hw.gpu.mode=.*/hw.gpu.mode=auto/" "$config"
  grep -q '^fastboot.forceColdBoot' "$config" || echo 'fastboot.forceColdBoot=no' >> "$config"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  setup)
    [ -e /dev/kvm ] && [ -w /dev/kvm ] || { echo "No KVM access; log in again after build-tools-linux.sh adds you to the kvm group." >&2 && exit 1; }
    stop
    setup_avd
    # Boot once and save the snapshot `start` resumes from.
    start > /dev/null
    stop
    echo "AVD $avd ready ($([ "$fast" = true ] && echo "4 cores, 4 GB, host GPU when a display is up" || echo "2 cores, 3 GB, SwiftShader"))."
    ;;
  *) echo "usage: $0 start|stop|setup" >&2 && exit 2 ;;
esac
