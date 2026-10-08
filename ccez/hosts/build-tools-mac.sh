#!/usr/bin/env bash
# Everything a macOS agent host needs to build the factory's projects, the
# Homebrew counterpart of build-tools-linux.sh: Rust, Go, Java/Kotlin, Android
# SDK + NDK, C/C++, Python, Node/bun, .NET, Docker (Colima), Kubernetes tools,
# Blender, and media tools. mac.sh runs this for you; run it alone to add
# tools to an existing host:
#
#   bash ~/SWE/czcode/ccez/hosts/build-tools-mac.sh
#
# No password needed: everything goes into this account's Homebrew and home
# folder (Blender in ~/Applications, .NET in ~/.dotnet), so other accounts on
# the Mac are untouched. Safe to re-run: installed pieces are skipped.
# Options (environment):
#   CZ_TOOLS_SKIP="android blender docker dotnet k8s"   leave groups out
#   CZ_HOST_DRY_RUN=1   print the steps for a fresh Mac without running them
# Not covered: Xcode/iOS and CocoaPods (need the App Store and an Apple ID),
# gcloud, MEGAcmd.
set -euo pipefail

BLENDER_VERSION=5.2.1                         # same as the Mac
NDK_VERSIONS="28.2.13676358 30.0.16138531"    # first one is the default (games/_tools/build_android.sh)
ANDROID_PACKAGES="platform-tools platforms;android-36 build-tools;36.0.0 cmake;4.1.2"
JDK=21

dry=false
if [ "${CZ_HOST_DRY_RUN:-0}" = 1 ]; then
  dry=true
  # Show the paths a Mac account would get. Nothing is written in a dry run.
  HOME="/Users/$USER"
fi

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
have() { command -v "$1" > /dev/null 2>&1; }
want() { case " ${CZ_TOOLS_SKIP:-} " in *" $1 "*) return 1 ;; *) return 0 ;; esac; }
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

[ "$(id -u)" -ne 0 ] || { echo "Run as the agent account, not root." >&2; exit 1; }
if $dry; then
  echo "Dry run: printing the steps for a fresh Apple-silicon Mac. Nothing runs."
  arch=arm64 brew_prefix=/opt/homebrew
else
  [ "$(uname -s)" = Darwin ] || { echo "This script is for macOS; Linux uses build-tools-linux.sh." >&2; exit 1; }
  have brew || { echo "No Homebrew found; run mac.sh first." >&2; exit 1; }
  arch=$(uname -m) # arm64 or x86_64
  brew_prefix=$(brew --prefix)
fi
java_home="$brew_prefix/opt/openjdk@$JDK/libexec/openjdk.jdk/Contents/Home"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
default_ndk="${NDK_VERSIONS%% *}"
run mkdir -p "$HOME/.local/bin" "$HOME/Applications"
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$HOME/go/bin:$HOME/.bun/bin:$HOME/.dotnet:$java_home/bin:$brew_prefix/bin:$PATH"

step "Homebrew packages"
formulae=(
  # Build basics, C/C++, linkers (Apple's own linker is already fast; mold is Linux-only)
  pkgconf cmake ninja ccache nasm sccache llvm lld mingw-w64 openssl@3 sqlite
  libpq protobuf grpc qt@5
  # Java, Maven, Kotlin (Gradle comes from each project's wrapper)
  "openjdk@$JDK" maven kotlin
  # Go, Python
  go python@3.13 pipx
  # Media, images, documents, speech
  ffmpeg imagemagick pngquant ghostscript poppler espeak-ng gnuplot chafa f3d
  # Data clients (servers run in Docker); libpq above has psql
  redis kcat
  # Everyday command-line tools
  ripgrep fd jq tree tmux htop btop neovim aria2 rsync p7zip xz zstd git-lfs
  git-filter-repo shellcheck
  # Disk health (SMART)
  smartmontools
  # Twitch API (market data for launchkit/scrapers); `twitch configure` needs the app's keys
  twitchdev/twitch/twitch-cli
)
# Docker runs in a Colima VM owned by this account, not Docker Desktop.
want docker && formulae+=(colima docker docker-compose docker-buildx)
want k8s && formulae+=(kubernetes-cli kind tilt)
# One at a time, so one failing formula is reported instead of stopping the rest.
failed=()
for formula in "${formulae[@]}"; do
  already brew list --formula "$formula" || run brew install -q "$formula" || failed+=("$formula")
done
already git lfs install --skip-repo || run git lfs install --skip-repo
if want docker; then
  # Lets `docker compose` and `docker buildx` find Homebrew's plugins.
  docker_cfg="$HOME/.docker/config.json"
  if ! already grep -q cliPluginsExtraDirs "$docker_cfg"; then
    if $dry || [ ! -s "$docker_cfg" ]; then
      write_file "$docker_cfg" <<< "{ \"cliPluginsExtraDirs\": [\"$brew_prefix/lib/docker/cli-plugins\"] }"
    else
      jq --arg d "$brew_prefix/lib/docker/cli-plugins" '.cliPluginsExtraDirs += [$d]' "$docker_cfg" > "$docker_cfg.tmp" &&
        mv "$docker_cfg.tmp" "$docker_cfg"
    fi
  fi
  # Starts the VM now and at each login of this account (a launchd agent).
  already colima status || run brew services start colima
fi

step "Rust"
already have rustup || run_sh "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path"
run rustup toolchain install stable --profile default
run rustup component add clippy rustfmt rust-analyzer
case "$arch" in arm64) other_mac=x86_64-apple-darwin ;; *) other_mac=aarch64-apple-darwin ;; esac
run rustup target add "$other_mac" wasm32-unknown-unknown wasm32-wasip2 x86_64-pc-windows-gnu \
  aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
already have cargo-binstall || run_sh "curl -L --proto '=https' --tlsv1.2 -sSf https://raw.githubusercontent.com/cargo-bins/cargo-binstall/main/install-from-binstall-release.sh | bash"
# crate:binary pairs; prebuilt binaries where they exist.
for pair in cargo-ndk:cargo-ndk cargo-watch:cargo-watch cargo-edit:cargo-upgrade \
  cargo-nextest:cargo-nextest worker-build:worker-build typst-cli:typst; do
  already have "${pair#*:}" || run cargo binstall -y --locked "${pair%%:*}"
done
cfg="$HOME/.cargo/config.toml"
# Only point cargo at tools that exist, or every build on this host fails.
if $dry || { have sccache && ! grep -q 'rustc-wrapper' "$cfg" 2> /dev/null; }; then
  run_sh "printf '[build]\\nrustc-wrapper = \"sccache\"\\n' >> '$cfg'"
fi

step "Python tools (uv)"
already have uv || run_sh 'curl -LsSf https://astral.sh/uv/install.sh | env UV_NO_MODIFY_PATH=1 sh'
for tool in yt-dlp conan pre-commit; do already have "$tool" || run uv tool install "$tool"; done

step "Node tools (prefix ~/.local)"
npm_prefix_is_local() { [ "$(npm config get prefix)" = "$HOME/.local" ]; }
already npm_prefix_is_local || run npm config set prefix "$HOME/.local"
already have bun || run_sh 'curl -fsSL https://bun.sh/install | bash > /dev/null'
for pair in pnpm:pnpm wrangler:wrangler @gltf-transform/cli:gltf-transform gltfpack:gltfpack; do
  already have "${pair#*:}" || run npm install -g "${pair%%:*}"
done

if want dotnet; then
  step ".NET SDK (in ~/.dotnet)"
  # Homebrew's .NET is a system-wide installer package; Microsoft's script
  # installs into this home folder instead.
  already have dotnet || run_sh "curl -fsSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 10.0 --install-dir '$HOME/.dotnet'"
fi

if want blender; then
  step "Blender $BLENDER_VERSION (in ~/Applications, this account only)"
  app="$HOME/Applications/Blender.app"
  if ! already grep -q "<string>$BLENDER_VERSION" "$app/Contents/Info.plist"; then
    case "$arch" in arm64) barch=arm64 ;; *) barch=x64 ;; esac
    dmg_url="https://download.blender.org/release/Blender${BLENDER_VERSION%.*}/blender-$BLENDER_VERSION-macos-$barch.dmg"
    if $dry; then
      run curl -fL -o /tmp/blender.dmg "$dmg_url"
      run hdiutil attach -nobrowse -readonly -mountpoint /tmp/blender-dmg /tmp/blender.dmg
      run ditto /tmp/blender-dmg/Blender.app "$app"
      run hdiutil detach /tmp/blender-dmg
    else
      tmp=$(mktemp -d)
      curl -fL -o "$tmp/blender.dmg" "$dmg_url"
      hdiutil attach -nobrowse -readonly -mountpoint "$tmp/mnt" "$tmp/blender.dmg" > /dev/null
      rm -rf "$app"
      ditto "$tmp/mnt/Blender.app" "$app"
      hdiutil detach "$tmp/mnt" > /dev/null
      rm -rf "$tmp"
    fi
  fi
  run ln -sf "$app/Contents/MacOS/Blender" "$HOME/.local/bin/blender"
fi

if want android; then
  step "Android SDK, NDK $NDK_VERSIONS"
  sdkm="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
  if ! already test -x "$sdkm"; then
    if $dry; then
      run curl -fsSLo /tmp/tools.zip "https://dl.google.com/android/repository/commandlinetools-mac-<latest>_latest.zip"
      run unzip -q /tmp/tools.zip -d /tmp
      run mv /tmp/cmdline-tools "$ANDROID_HOME/cmdline-tools/latest"
    else
      zip=$(curl -fsSL https://dl.google.com/android/repository/repository2-3.xml |
        grep -o 'commandlinetools-mac-[0-9]*_latest.zip' | sort -u -t- -k3,3n | tail -1)
      tmp=$(mktemp -d)
      curl -fsSLo "$tmp/tools.zip" "https://dl.google.com/android/repository/$zip"
      unzip -q "$tmp/tools.zip" -d "$tmp"
      mkdir -p "$ANDROID_HOME/cmdline-tools"
      rm -rf "$ANDROID_HOME/cmdline-tools/latest"
      mv "$tmp/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
      rm -rf "$tmp"
    fi
  fi
  export JAVA_HOME="${JAVA_HOME:-$java_home}"
  run_sh "yes | '$sdkm' --licenses > /dev/null 2>&1 || true"
  ndk_pkgs=()
  for v in $NDK_VERSIONS; do ndk_pkgs+=("ndk;$v"); done
  # shellcheck disable=SC2086 # package list splits on spaces on purpose
  run "$sdkm" --install $ANDROID_PACKAGES "${ndk_pkgs[@]}"
fi

step "Gradle daemons stop after 10 idle minutes"
# Agents build once and move on; Gradle's default keeps each daemon (about
# 1 GB) alive for 3 hours after the last build.
already grep -q '^org.gradle.daemon.idletimeout=' "$HOME/.gradle/gradle.properties" ||
  run_sh "mkdir -p '$HOME/.gradle' && echo org.gradle.daemon.idletimeout=600000 >> '$HOME/.gradle/gradle.properties'"

step "Environment for shells and the cz service"
# mac.sh's launchd agent sources this file before starting cz.
tool_path="$HOME/.local/bin:$HOME/.cargo/bin:$HOME/go/bin:$HOME/.bun/bin:$HOME/.dotnet:$java_home/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$brew_prefix/opt/libpq/bin"
write_file "$HOME/.config/cz-host/env.sh" << ENV
# Written by ccez/hosts/build-tools-mac.sh; sourced by ~/.zprofile and the cz launchd agent.
export JAVA_HOME="\${JAVA_HOME:-$java_home}"
export ANDROID_HOME="\${ANDROID_HOME:-$ANDROID_HOME}"
export ANDROID_NDK_HOME="\${ANDROID_NDK_HOME:-$ANDROID_HOME/ndk/$default_ndk}"
export BUN_INSTALL="\${BUN_INSTALL:-$HOME/.bun}"
export DOTNET_ROOT="\${DOTNET_ROOT:-$HOME/.dotnet}"
[ -n "\${CZ_HOST_ENV:-}" ] || { export CZ_HOST_ENV=1; export PATH="$tool_path:\$PATH"; }
ENV
# shellcheck disable=SC2016 # written literally, for the shell to expand
env_line='[ -f "$HOME/.config/cz-host/env.sh" ] && . "$HOME/.config/cz-host/env.sh"'
for rc in "$HOME/.zprofile" "$HOME/.bash_profile"; do
  if ! already grep -q 'cz-host/env.sh' "$rc"; then
    if $dry; then printf '  + append to %s: %s\n' "$rc" "$env_line"; else echo "$env_line" >> "$rc"; fi
  fi
done
if ! $dry; then
  # shellcheck disable=SC1091
  . "$HOME/.config/cz-host/env.sh"
fi

step "Factory CLIs from this account's checkouts"
if $dry || { [ -d "$HOME/SWE/games/_tools/gk" ] && ! have gk; }; then
  run cargo install --locked --path "$HOME/SWE/games/_tools/gk" || echo "gk did not build; re-run later."
fi

if $dry; then
  echo
  echo "Dry run done."
  exit 0
fi

step "Check"
for t in cargo go java kotlinc mvn python3 uv node bun pnpm dotnet docker colima kubectl kind tilt \
  clang sccache cmake ffmpeg magick blender sdkmanager adb cargo-ndk wrangler gltfpack typst rg fd jq; do
  if have "$t"; then printf '  ok  %s\n' "$t"; else printf '  --  %s\n' "$t"; fi
done
for v in $NDK_VERSIONS; do
  if [ -d "$ANDROID_HOME/ndk/$v" ]; then printf '  ok  ndk %s\n' "$v"; else printf '  --  ndk %s\n' "$v"; fi
done
[ ${#failed[@]} -eq 0 ] || printf '  --  brew install failed: %s\n' "${failed[*]}"
echo "Done. Open a new Terminal window to pick up the new PATH."
