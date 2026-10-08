#!/usr/bin/env bash
# Sets up a Mac as a cz agent host. Made for a dedicated macOS account on a
# shared Mac: everything goes in this account's home folder except Homebrew
# and Tailscale, which are machine-wide. It never touches other accounts.
#
# Log in to the dedicated account, open Terminal, and paste this line:
#
# curl -fsSL https://raw.githubusercontent.com/chris-straka/czcode/main/ccez/hosts/mac.sh -o /tmp/cz-host.sh && bash /tmp/cz-host.sh
#
# The first run needs an Administrator account (for Homebrew and Tailscale);
# it can go back to Standard afterwards. It installs Homebrew, git, gh, Node 24,
# Vite+ (vp), and Tailscale, builds cz from this repo, installs the build tools
# in build-tools-mac.sh (Rust, Go, Java, Android, Blender, Docker...; set
# CZ_HOST_TOOLS=0 to skip), and runs `cz serve` as a launchd agent on the
# tailnet that keeps the Mac awake while on power. Then it walks through the
# Claude, Codex, OpenCode, and GitHub logins and prints a pairing link. Safe
# to re-run: finished steps are skipped, and re-running updates cz.
#
# CZ_HOST_DRY_RUN=1 prints every step and command for a fresh Mac without
# running anything. It works on any OS.
set -euo pipefail

dry=false
if [ "${CZ_HOST_DRY_RUN:-0}" = 1 ]; then
  dry=true
  # Show the paths a Mac account would get. Nothing is written in a dry run.
  HOME="/Users/$USER" SHELL=/bin/zsh
fi

REPO_URL=https://github.com/chris-straka/czcode.git
CHECKOUT="$HOME/SWE/czcode"
LABEL=uk.ccez.cz-host
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/cz-host.log"

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
have() { command -v "$1" > /dev/null 2>&1; }
die() { printf '\n%s\n' "$@" >&2; exit 1; }
# Runs a command, or prints it in a dry run.
run() {
  if $dry; then printf '  +'; printf ' %q' "$@"; printf '\n'; else "$@"; fi
}
# Runs a shell snippet (pipes, installers), or prints it in a dry run.
run_sh() {
  if $dry; then printf '  + %s\n' "$1"; else bash -c "$1"; fi
}
# A check that decides whether a step can be skipped. A dry run assumes a
# fresh Mac, so every step shows.
already() {
  if $dry; then return 1; fi
  "$@" > /dev/null 2>&1
}
# Writes stdin to a file, or prints it in a dry run.
write_file() {
  if $dry; then
    printf '  + write %s:\n' "$1"
    sed 's/^/  | /'
  else
    mkdir -p "$(dirname "$1")"
    cat > "$1"
  fi
}
# Asks a question; a dry run prints it and takes the default ($2).
ask() {
  if $dry; then printf '  ? %s (dry run: %s)\n' "$1" "$2"; REPLY=$2; return; fi
  read -r -p "$1 " REPLY < /dev/tty
}

[ "$(id -u)" -ne 0 ] || die "Run as the agent account, not root (sudo is used where needed)."
if $dry; then
  echo "Dry run: printing the macOS steps for a fresh Apple-silicon Mac. Nothing runs."
  arch=arm64
else
  [ "$(uname -s)" = Darwin ] || die "This script is for macOS. Linux and WSL use ccez/hosts/linux.sh."
  arch=$(uname -m)
fi
if [ "$arch" = arm64 ]; then brew_prefix=/opt/homebrew; else brew_prefix=/usr/local; fi
node_bin="$brew_prefix/opt/node@24/bin"
is_admin() { dseditgroup -o checkmember -m "$USER" admin > /dev/null 2>&1; }
need_admin() {
  $dry || is_admin || die "$1 needs an Administrator account once." \
    "In System Settings → Users & Groups, make \"$USER\" an Administrator, run this" \
    "script again, then switch it back to Standard if you like."
}

# The owner's own Mac gets cz from the desktop app (ccez/release/mac.sh), which
# writes the same ~/.local/bin/cz. Don't replace it with a host build.
if ! $dry && [ -e "$HOME/.local/bin/cz" ] && ! grep -q 'ccez/hosts/mac.sh' "$HOME/.local/bin/cz"; then
  die "$HOME/.local/bin/cz here comes from the czcode desktop app, so this account" \
    "already runs cz. This script is for a separate agent account."
fi

step "Homebrew ($brew_prefix, shared by the whole Mac)"
if [ -x "$brew_prefix/bin/brew" ] && ! $dry; then
  # Another account's Homebrew is theirs: installing into it would change
  # their files, and brew refuses anyway.
  [ -w "$brew_prefix/bin" ] || die "Homebrew in $brew_prefix belongs to the account" \
    "\"$(stat -f %Su "$brew_prefix/bin")\". This script won't install into another" \
    "account's Homebrew. Ask the owner how to proceed."
  echo "Already installed."
else
  need_admin "Installing Homebrew"
  # Also installs Apple's Command Line Tools (git, clang), asking for the password.
  # shellcheck disable=SC2016 # expanded by the shell that runs it
  run_sh '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
fi
$dry || eval "$("$brew_prefix/bin/brew" shellenv)"
# New Terminal windows find brew and the tools installed in this home folder.
case "${SHELL:-/bin/zsh}" in */bash) profile="$HOME/.bash_profile" ;; *) profile="$HOME/.zprofile" ;; esac
profile_lines="eval \"\$($brew_prefix/bin/brew shellenv)\"
export PATH=\"\$HOME/.local/bin:\$HOME/.cargo/bin:\$HOME/.bun/bin:$node_bin:\$PATH\""
if ! already grep -q 'ccez/hosts/mac.sh' "$profile"; then
  if $dry; then
    printf '  + append to %s:\n' "$profile"
    printf '# ccez/hosts/mac.sh\n%s\n' "$profile_lines" | sed 's/^/  | /'
  else
    printf '\n# ccez/hosts/mac.sh\n%s\n' "$profile_lines" >> "$profile"
  fi
fi
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$HOME/.bun/bin:$node_bin:$brew_prefix/bin:$PATH"

step "Base tools"
for formula in git gh jq; do
  already brew list --formula "$formula" || run brew install -q "$formula"
done

step "Node 24 and Vite+ (vp)"
already brew list --formula node@24 || run brew install -q node@24
# Global npm tools (the coding agents) go to ~/.local, like on Linux hosts.
run npm config set prefix "$HOME/.local"
already test -x "$HOME/.local/share/vite-plus/bin/vp" || run_sh 'curl -fsSL https://vite.plus | bash'
if ! $dry; then
  # shellcheck disable=SC1091
  . "$HOME/.config/vite-plus/env"
fi
# Node comes from Homebrew above; vp only builds.
run_sh 'vp env off > /dev/null 2>&1 || true'

step "Tailscale (open-source tailscaled, shared by the whole Mac)"
# The Tailscale app and tailscaled can't both run. If anyone on this Mac uses
# the app, it's theirs to keep.
if ! $dry && [ -d /Applications/Tailscale.app ]; then
  die "This Mac already has the Tailscale app, so another account may use" \
    "Tailscale. Two Tailscale clients on one Mac conflict. Ask the owner how to proceed."
fi
already brew list --formula tailscale || run brew install -q tailscale
# tailscaled runs as a system daemon, so the host stays on the tailnet with
# Tailscale SSH even when this account is switched away from. Re-done only
# when brew updated the binary.
if ! already cmp -s "$brew_prefix/bin/tailscaled" /usr/local/bin/tailscaled; then
  need_admin "Starting Tailscale"
  run sudo mkdir -p /usr/local/bin
  run sudo "$brew_prefix/bin/tailscaled" install-system-daemon
  $dry || for _ in 1 2 3 4 5 6 7 8 9 10; do
    tailscale status --json > /dev/null 2>&1 && break
    sleep 1
  done
fi
if ! already tailscale status; then
  need_admin "Signing in to Tailscale"
  echo "Sign this Mac into your tailnet with the link below."
  # --ssh lets you (and agents on your own Mac) open a shell here over the tailnet.
  run sudo tailscale up --ssh
fi
# Lets cz configure Tailscale Serve without root.
if $dry || [ "$(tailscale debug prefs 2> /dev/null | jq -r '.OperatorUser // empty')" != "$USER" ]; then
  need_admin "Letting cz use Tailscale Serve"
  run sudo tailscale set --operator="$USER"
fi
if $dry; then
  tailscale_name="<this-mac>.<tailnet>.ts.net"
else
  tailscale_name=$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')
fi

step "cz (built from $REPO_URL)"
if already test -d "$CHECKOUT/.git"; then
  run git -C "$CHECKOUT" pull --ff-only
else
  run mkdir -p "$(dirname "$CHECKOUT")"
  run git clone "$REPO_URL" "$CHECKOUT"
fi
run_sh "cd '$CHECKOUT' && vp i && vp run --filter @cz/web --filter cz build"
write_file "$HOME/.local/bin/cz" << SHIM
#!/usr/bin/env bash
# The cz CLI from $CHECKOUT (ccez/hosts/mac.sh). Update by re-running that script.
exec "$node_bin/node" "$CHECKOUT/apps/server/dist/bin.mjs" "\$@"
SHIM
run chmod +x "$HOME/.local/bin/cz"

if [ "${CZ_HOST_TOOLS:-1}" = 1 ]; then
  step "Build tools: Rust, Go, Java, Android, Blender, Docker and more (CZ_HOST_TOOLS=0 skips)"
  if $dry; then
    # The dry run prints the build-tools steps from this checkout.
    bash "$(dirname "$0")/build-tools-mac.sh" | sed '1d; /^Dry run done/d'
  else
    bash "$CHECKOUT/ccez/hosts/build-tools-mac.sh"
  fi
fi

step "cz as a launchd agent on the tailnet"
# caffeinate -s keeps the Mac from sleeping while cz runs and the Mac is on
# power (a sleeping Mac drops agents mid-turn). The display still sleeps.
# KeepAlive restarts cz if it exits. launchd's PATH lacks Homebrew and the
# toolchains in this home folder, so it's spelled out, and the tool
# environment from build-tools-mac.sh (JAVA_HOME, ANDROID_HOME, PATH) is
# sourced before cz starts.
write_file "$PLIST" << PLISTFILE
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- cz agent host (ccez/hosts/mac.sh). Re-running that script rewrites this file. -->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string>
    <string>-s</string>
    <string>-i</string>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>[ -f "\$HOME/.config/cz-host/env.sh" ] &amp;&amp; . "\$HOME/.config/cz-host/env.sh"; exec "\$HOME/.local/bin/cz" serve --no-browser</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CZ_TAILSCALE_SERVE</key>
    <string>1</string>
    <key>PATH</key>
    <string>$HOME/.local/bin:$HOME/.cargo/bin:$HOME/.bun/bin:$node_bin:$brew_prefix/bin:$brew_prefix/sbin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>WorkingDirectory</key>
  <string>$HOME</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <!-- Agents and builds open many files; macOS starts processes at 256. -->
  <key>SoftResourceLimits</key>
  <dict>
    <key>NumberOfFiles</key>
    <integer>10240</integer>
  </dict>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>$LOG</string>
  <key>StandardErrorPath</key>
  <string>$LOG</string>
</dict>
</plist>
PLISTFILE
$dry || plutil -lint -s "$PLIST"
run mkdir -p "$(dirname "$LOG")"
# The GUI domain exists while this account is logged in; over SSH alone only
# the user domain does.
domain="gui/$(id -u)"
already launchctl print "$domain" || $dry || domain="user/$(id -u)"
run_sh "launchctl bootout $domain/$LABEL 2> /dev/null || true"
# Settings are edited only while cz is stopped, so it can't write over them.
# Codex uses this account's own `codex login` ("existing"); the welcome wizard
# can otherwise pick "managed", which needs a second sign-in. New threads
# default to Claude Opus.
settings="${CZ_HOME:-$HOME/.cz}/userdata/settings.json"
settings_jq='
  .providerInstances.codex //= {driver: "codex", enabled: true, config: {binaryPath: "codex", homePath: "", shadowHomePath: "", launchArgs: "", customModels: []}}
  | .providerInstances.codex.config.setupMode = "existing"
  | .defaultModelSelection //= {instanceId: "claudeAgent", model: "claude-opus-5-5", options: [{id: "effort", value: "high"}]}'
if $dry; then
  printf '  + jq (Codex setupMode "existing", default model Claude Opus) on %s\n' "$settings"
else
  mkdir -p "$(dirname "$settings")"
  [ -s "$settings" ] || echo '{}' > "$settings"
  jq "$settings_jq" "$settings" > "$settings.tmp" && mv "$settings.tmp" "$settings"
fi
# bootout finishes in the background; bootstrap fails until it has.
if $dry; then
  run launchctl bootstrap "$domain" "$PLIST"
else
  for try in 1 2 3 4 5 6 7 8 9 10; do
    launchctl bootstrap "$domain" "$PLIST" 2> /dev/null && break
    [ "$try" -lt 10 ] || die "launchctl couldn't start $LABEL; see $LOG"
    sleep 1
  done
fi
run launchctl enable "$domain/$LABEL"

# A MacBook sleeps when its lid closes, whatever caffeinate says.
# lid-awake-mac.sh keeps it running with the lid closed while it's on power;
# off power it's a normal laptop. Skipped when the installed copy is current,
# so a Standard account can re-run this script. CZ_HOST_LID_AWAKE=0 skips it.
if [ "${CZ_HOST_LID_AWAKE:-1}" = 1 ] && { $dry || pmset -g batt | grep -q InternalBattery; }; then
  step "Lid closed on power (MacBook)"
  if already cmp -s "$CHECKOUT/ccez/hosts/lid-awake-mac.sh" /usr/local/sbin/cz-lid-awake; then
    echo "Already installed."
  else
    need_admin "Keeping a closed MacBook running on power"
    run sudo bash "$CHECKOUT/ccez/hosts/lid-awake-mac.sh" install
  fi
fi

step "Coding agents"
npm_global() { already have "$1" || run npm install -g "$2"; }
npm_global claude @anthropic-ai/claude-code
npm_global codex @openai/codex
# OpenCode 2 is the npm package; opencode.ai/install still gives 1.x.
opencode_2() { opencode --version 2> /dev/null | grep -q '^v\?2\.'; }
already opencode_2 || run npm install -g @opencode/cli

step "Sign in: Claude"
if already claude auth status; then
  echo "Already signed in."
else
  # Finish in this Mac's browser: Claude shows a code to paste back here.
  run claude auth login
fi

step "Sign in: Codex (optional)"
if already codex login status; then
  echo "Already signed in."
else
  # Threads default to Claude Opus; Codex stays signed in for when a newer model is better.
  ask "Sign in to Codex on this Mac? [Y/n]" y
  case "$REPLY" in
    "" | [yY]*)
      echo "Open the link on any device and enter the code. If OpenAI says device codes"
      echo "are off, turn on \"Enable device code sign-in for Codex\" in ChatGPT's settings."
      run codex login --device-auth
      ;;
    *) echo "Skipped. Run \`codex login --device-auth\` later if you want Codex here." ;;
  esac
fi

step "Sign in: OpenCode"
if already test -s "$HOME/.local/share/opencode/auth.json"; then
  echo "Already signed in."
else
  echo "No OpenCode login here yet. Usually your own Mac copies its login (your"
  echo "Muse key) over Tailscale after this script finishes, so you can answer N."
  ask "Sign in to OpenCode by hand instead? [y/N]" n
  case "$REPLY" in [yY]*) run opencode auth login ;; *) ;; esac
fi
# czcode offers the reasoning variants OpenCode's config defines; Muse Spark's
# "max" exists only through this.
if ! already test -e "$HOME/.config/opencode/opencode.jsonc" && ! already test -e "$HOME/.config/opencode/opencode.json"; then
  write_file "$HOME/.config/opencode/opencode.jsonc" << 'EOF'
// Global OpenCode config for this agent host (from ccez/hosts/mac.sh).
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "meta": {
      "models": {
        "muse-spark-1.3-contributor": { "variants": { "max": { "reasoningEffort": "max" } } }
      }
    },
    "opencode": {
      "models": {
        "muse-spark-1.3-contributor-free": { "variants": { "max": { "reasoningEffort": "max" } } }
      }
    }
  }
}
EOF
fi

step "GitHub (so agents here can push)"
already git config --global user.name || run git config --global user.name "Chris Straka"
already git config --global user.email || run git config --global user.email "c@z.local"
# Keep the token in gh's own file (mode 600), not the login keychain: the
# keychain stays locked when this account was only reached over SSH after a
# restart, so agents would lose GitHub.
if ! $dry && gh auth status 2> /dev/null | grep -q '(keyring)'; then
  gh auth token | gh auth login --hostname github.com --with-token --insecure-storage
fi
already gh auth status || run gh auth login --hostname github.com --git-protocol https --web --insecure-storage
run gh auth setup-git

step "Pair your phone and desktop"
if $dry; then
  run launchctl print "$domain/$LABEL"
  run cz pair --tailscale
  echo
  echo "Dry run done."
  exit 0
fi
launchctl print "$domain/$LABEL" | grep -E '^\s*(state|pid) =' || true
cz pair --tailscale || echo "Pairing failed; check the log: tail -50 $LOG"
cat << DONE

Done. This host is $tailscale_name.
Hardware: $(sysctl -n hw.ncpu) cores, $(($(sysctl -n hw.memsize) / 1073741824)) GB memory, $(df -h "$HOME" | awk 'NR == 2 {print $4}') free disk.
GPU: $(system_profiler SPDisplaysDataType 2> /dev/null | awk -F': ' '/Chipset Model/ {print $2; exit}')
- Open the pairing link above on each device that should use this host.
- cz runs while this account is logged in. After the Mac restarts, log in to
  this account once; switching back to another account (fast user switching)
  keeps cz running.
- The Mac stays awake while cz runs on power; the display still sleeps.
- Copy ~/SWE/AGENTS.md from your Mac to the same path here, and clone your
  projects under ~/SWE with the same git origins.
- To update cz later, run this script again.
DONE
