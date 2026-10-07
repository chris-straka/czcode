#!/usr/bin/env bash
# Everything an agent host needs to build the factory's projects, roughly
# matching the Mac (`z`): Rust, Go, Java/Kotlin, Android SDK + NDK, C/C++,
# Python, Node/bun, .NET, Docker, Kubernetes tools, Bevy's system libraries,
# Blender, media tools, and an NVIDIA driver when the GPU is recent enough.
# linux.sh runs this for you; run it alone to add tools to an existing host:
#
#   bash ~/SWE/czcode/ccez/hosts/build-tools-linux.sh
#
# From another machine, quote the path so `~` expands on the host:
#   ssh -t b@basement 'bash ~/SWE/czcode/ccez/hosts/build-tools-linux.sh'
#
# Safe to re-run: installed pieces are skipped. Options (environment):
#   SKIP_APT=1   only the steps that need no sudo
#   APT_ONLY=1   only the sudo step
#   CZ_TOOLS_SKIP="android blender docker dotnet k8s gpu"   leave groups out
# Not covered (Mac-only): Xcode/iOS, CocoaPods, gcloud, MEGAcmd.
set -euo pipefail

BLENDER_VERSION=5.2.1                         # same as the Mac
NDK_VERSIONS="28.2.13676358 30.0.16138531"    # first one is the default (games/tools/build_android.sh)
ANDROID_PACKAGES="cmdline-tools;latest platform-tools platforms;android-36 build-tools;36.0.0 cmake;4.1.2"
JDK=21

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
have() { command -v "$1" > /dev/null 2>&1; }
want() { case " ${CZ_TOOLS_SKIP:-} " in *" $1 "*) return 1 ;; *) return 0 ;; esac; }
[ "$(id -u)" -ne 0 ] || { echo "Run as your normal user, not root." >&2; exit 1; }
have apt-get || { echo "This script expects Ubuntu or Debian." >&2; exit 1; }
arch=$(dpkg --print-architecture) # amd64 or arm64
in_wsl=false
grep -qi microsoft /proc/version && in_wsl=true
mkdir -p "$HOME/.local/bin" "$HOME/.local/opt"
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$HOME/.local/go/bin:$HOME/go/bin:$HOME/.bun/bin:$PATH"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}" # agents share this host

if [ "${SKIP_APT:-0}" != 1 ]; then
  step "System packages (asks for your password once)"
  pkgs=(
    # Build basics, C/C++, linkers, debuggers
    build-essential pkg-config git curl wget ca-certificates gnupg clang lld
    mold llvm lldb gdb valgrind libclang-dev cmake ninja-build ccache nasm
    sccache mingw-w64 libssl-dev libsqlite3-dev libpq-dev zlib1g-dev
    protobuf-compiler protobuf-compiler-grpc libgrpc++-dev qtbase5-dev
    # Bevy and headless rendering (Vulkan on the CPU via lavapipe)
    libasound2-dev libudev-dev libwayland-dev libxkbcommon-dev libx11-dev
    libxcursor-dev libxrandr-dev libxi-dev libvulkan-dev mesa-vulkan-drivers
    vulkan-tools xvfb libgl1 libegl1 libxkbcommon-x11-0 libsm6 libxext6
    libxrender1
    # Java and Maven (Gradle comes from each project's wrapper; Kotlin below)
    "openjdk-$JDK-jdk-headless" maven
    # Python
    python3 python3-pip python3-venv python3-dev pipx
    # Media, images, documents, speech
    ffmpeg imagemagick pngquant ghostscript poppler-utils espeak-ng gnuplot
    chafa f3d
    # Data clients (servers run in Docker)
    sqlite3 postgresql-client redis-tools kcat
    # Everyday command-line tools
    ripgrep fd-find jq tree tmux htop btop neovim aria2 rsync unzip zip
    p7zip-full xz-utils zstd git-lfs git-filter-repo shellcheck cifs-utils
    nfs-common ethtool
    # Disk health (SMART) and hardware virtualization (Android emulator, VMs)
    smartmontools nvme-cli cpu-checker qemu-system-x86
  )
  want docker && pkgs+=(docker.io docker-compose-v2 docker-buildx)
  want dotnet && pkgs+=(dotnet-sdk-10.0)
  sudo apt-get update -q
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -yq "${pkgs[@]}"
  if want docker; then
    # Agents run Docker without sudo (takes effect at the next login).
    id -nG "$USER" | grep -qw docker || sudo usermod -aG docker "$USER"
    $in_wsl || sudo systemctl enable --now docker > /dev/null 2>&1 || true
  fi
  # /dev/kvm for the Android emulator and VMs (takes effect at the next login).
  if [ -e /dev/kvm ] && ! id -nG "$USER" | grep -qw kvm; then sudo usermod -aG kvm "$USER"; fi
  if want gpu && ! $in_wsl && lspci 2> /dev/null | grep -qi 'vga.*nvidia\|3d.*nvidia'; then
    # Only drivers that still get CUDA updates; older cards (GTX 7xx) stay on nouveau.
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -yq ubuntu-drivers-common > /dev/null
    driver=$(ubuntu-drivers devices 2> /dev/null | awk '/recommended/ && /nvidia-driver-[0-9]+/ {for (i = 1; i <= NF; i++) if ($i ~ /^nvidia-driver-[0-9]+/) print $i}' | head -1)
    if [ -n "$driver" ] && [ "${driver//[!0-9]/}" -ge 535 ]; then
      have nvidia-smi || { sudo DEBIAN_FRONTEND=noninteractive apt-get install -yq "$driver" nvidia-cuda-toolkit &&
        echo "Installed $driver; restart this PC to load it."; }
    else
      echo "NVIDIA GPU without a current driver (${driver:-none recommended}); skipped."
    fi
  fi
fi
[ "${APT_ONLY:-0}" != 1 ] || { echo "APT_ONLY: done."; exit 0; }
# Ubuntu names fd "fdfind".
have fd || ! have fdfind || ln -sf "$(command -v fdfind)" "$HOME/.local/bin/fd"
! have git-lfs || git lfs install --skip-repo > /dev/null

step "Rust"
have rustup || curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path
rustup toolchain install stable --profile default > /dev/null
rustup component add clippy rustfmt rust-analyzer
rustup target add wasm32-unknown-unknown wasm32-wasip2 x86_64-pc-windows-gnu \
  aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
have cargo-binstall || curl -L --proto '=https' --tlsv1.2 -sSf \
  https://raw.githubusercontent.com/cargo-bins/cargo-binstall/main/install-from-binstall-release.sh | bash
# crate:binary pairs; prebuilt binaries where they exist.
for pair in cargo-ndk:cargo-ndk cargo-watch:cargo-watch cargo-edit:cargo-upgrade \
  cargo-nextest:cargo-nextest worker-build:worker-build typst-cli:typst; do
  have "${pair#*:}" || cargo binstall -y --locked "${pair%%:*}"
done
cfg="$HOME/.cargo/config.toml"
touch "$cfg"
# Only point cargo at tools that exist, or every build on this host fails.
! have sccache || grep -q 'rustc-wrapper' "$cfg" || printf '[build]\nrustc-wrapper = "sccache"\n' >> "$cfg"
! { have mold && have clang; } || grep -q 'x86_64-unknown-linux-gnu' "$cfg" ||
  printf '\n[target.x86_64-unknown-linux-gnu]\nlinker = "clang"\nrustflags = ["-C", "link-arg=-fuse-ld=mold"]\n' >> "$cfg"

step "Go"
if [ ! -x "$HOME/.local/go/bin/go" ]; then
  go_version=$(curl -fsSL 'https://go.dev/VERSION?m=text' | head -1)
  curl -fsSL "https://go.dev/dl/$go_version.linux-$arch.tar.gz" | tar -xz -C "$HOME/.local"
fi
"$HOME/.local/go/bin/go" version

step "Python tools (uv)"
have uv || curl -LsSf https://astral.sh/uv/install.sh | env UV_NO_MODIFY_PATH=1 sh
for tool in yt-dlp conan pre-commit; do have "$tool" || uv tool install "$tool"; done

step "Node tools (prefix ~/.local, no sudo)"
[ "$(npm config get prefix)" = "$HOME/.local" ] || npm config set prefix "$HOME/.local"
have bun || curl -fsSL https://bun.sh/install | bash > /dev/null
for pair in pnpm:pnpm wrangler:wrangler @gltf-transform/cli:gltf-transform gltfpack:gltfpack; do
  have "${pair#*:}" || npm install -g "${pair%%:*}"
done

if want k8s; then
  step "Kubernetes tools (kubectl, kind, tilt)"
  if ! have kubectl; then
    k8s=$(curl -fsSL https://dl.k8s.io/release/stable.txt)
    curl -fsSLo "$HOME/.local/bin/kubectl" "https://dl.k8s.io/release/$k8s/bin/linux/$arch/kubectl"
    chmod +x "$HOME/.local/bin/kubectl"
  fi
  if ! have kind; then
    curl -fsSLo "$HOME/.local/bin/kind" "https://github.com/kubernetes-sigs/kind/releases/latest/download/kind-linux-$arch"
    chmod +x "$HOME/.local/bin/kind"
  fi
  if ! have tilt; then
    tilt_tag=$(curl -fsSL https://api.github.com/repos/tilt-dev/tilt/releases/latest | jq -r .tag_name)
    tilt_arch=$([ "$arch" = amd64 ] && echo x86_64 || echo arm64)
    curl -fsSL "https://github.com/tilt-dev/tilt/releases/download/$tilt_tag/tilt.${tilt_tag#v}.linux.$tilt_arch.tar.gz" |
      tar -xz -C "$HOME/.local/bin" tilt
  fi
fi

step "Twitch CLI"
# Twitch API calls for launchkit/scrapers; `twitch configure` needs the app's keys.
if ! have twitch; then
  twitch_tag=$(curl -fsSL https://api.github.com/repos/twitchdev/twitch-cli/releases/latest | jq -r .tag_name)
  twitch_dir="twitch-cli_${twitch_tag#v}_Linux_$([ "$arch" = amd64 ] && echo x86_64 || echo arm64)"
  curl -fsSL "https://github.com/twitchdev/twitch-cli/releases/download/$twitch_tag/$twitch_dir.tar.gz" |
    tar -xz -C "$HOME/.local/bin" --strip-components=1 "$twitch_dir/twitch"
fi

step "Kotlin compiler"
if ! have kotlinc; then
  kotlin_tag=$(curl -fsSL https://api.github.com/repos/JetBrains/kotlin/releases/latest | jq -r .tag_name)
  tmp=$(mktemp -d)
  curl -fsSLo "$tmp/k.zip" "https://github.com/JetBrains/kotlin/releases/download/$kotlin_tag/kotlin-compiler-${kotlin_tag#v}.zip"
  rm -rf "$HOME/.local/opt/kotlinc"
  unzip -q "$tmp/k.zip" -d "$HOME/.local/opt"
  rm -rf "$tmp"
  for b in kotlin kotlinc; do ln -sf "$HOME/.local/opt/kotlinc/bin/$b" "$HOME/.local/bin/$b"; done
fi

if want blender && [ "$arch" = amd64 ]; then
  step "Blender $BLENDER_VERSION"
  bdir="$HOME/.local/opt/blender-$BLENDER_VERSION-linux-x64"
  [ -x "$bdir/blender" ] || curl -fL "https://download.blender.org/release/Blender${BLENDER_VERSION%.*}/blender-$BLENDER_VERSION-linux-x64.tar.xz" |
    tar -xJ -C "$HOME/.local/opt"
  ln -sf "$bdir/blender" "$HOME/.local/bin/blender"
fi

ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
default_ndk="${NDK_VERSIONS%% *}"
if want android && [ "$arch" = amd64 ]; then
  step "Android SDK, NDK $NDK_VERSIONS"
  sdkm="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
  if [ ! -x "$sdkm" ]; then
    zip=$(curl -fsSL https://dl.google.com/android/repository/repository2-3.xml |
      grep -o 'commandlinetools-linux-[0-9]*_latest.zip' | sort -u -t- -k3,3n | tail -1)
    tmp=$(mktemp -d)
    curl -fsSLo "$tmp/tools.zip" "https://dl.google.com/android/repository/$zip"
    unzip -q "$tmp/tools.zip" -d "$tmp"
    mkdir -p "$ANDROID_HOME/cmdline-tools"
    rm -rf "$ANDROID_HOME/cmdline-tools/latest"
    mv "$tmp/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
    rm -rf "$tmp"
  fi
  export JAVA_HOME="${JAVA_HOME:-$(dirname "$(dirname "$(readlink -f "$(command -v javac)")")")}"
  yes | "$sdkm" --licenses > /dev/null 2>&1 || true
  ndk_pkgs=()
  for v in $NDK_VERSIONS; do ndk_pkgs+=("ndk;$v"); done
  # shellcheck disable=SC2086 # package list splits on spaces on purpose
  "$sdkm" --install $ANDROID_PACKAGES "${ndk_pkgs[@]}" > /dev/null
  # Google's Android CLI: `android init` installs its skill for Claude, Codex and OpenCode.
  android_cli="$ANDROID_HOME/cmdline-tools/latest/bin/android"
  [ ! -x "$android_cli" ] || "$android_cli" init > /dev/null
fi

step "Environment for shells and the cz service"
java_home=$(dirname "$(dirname "$(readlink -f "$(command -v javac 2> /dev/null || echo /usr/bin/javac)")")")
mkdir -p "$HOME/.config/cz-host"
tool_path="$HOME/.local/bin:$HOME/.cargo/bin:$HOME/.local/go/bin:$HOME/go/bin:$HOME/.bun/bin:$java_home/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin"
cat > "$HOME/.config/cz-host/env.sh" << ENV
# Written by ccez/hosts/build-tools-linux.sh; sourced by ~/.bashrc and ~/.profile.
export JAVA_HOME="\${JAVA_HOME:-$java_home}"
export ANDROID_HOME="\${ANDROID_HOME:-$ANDROID_HOME}"
export ANDROID_NDK_HOME="\${ANDROID_NDK_HOME:-$ANDROID_HOME/ndk/$default_ndk}"
export BUN_INSTALL="\${BUN_INSTALL:-$HOME/.bun}"
[ -n "\${CZ_HOST_ENV:-}" ] || { export CZ_HOST_ENV=1; export PATH="$tool_path:\$PATH"; }
ENV
# systemd reads this one (no variable expansion there), via linux.sh's unit.
cat > "$HOME/.config/cz-host/environment" << ENV
JAVA_HOME=$java_home
ANDROID_HOME=$ANDROID_HOME
ANDROID_NDK_HOME=$ANDROID_HOME/ndk/$default_ndk
BUN_INSTALL=$HOME/.bun
CARGO_BUILD_JOBS=2
PATH=$tool_path:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ENV
# shellcheck disable=SC2016 # written literally, for the shell to expand
for rc in "$HOME/.bashrc" "$HOME/.profile"; do
  grep -q 'cz-host/env.sh' "$rc" 2> /dev/null || echo '[ -f "$HOME/.config/cz-host/env.sh" ] && . "$HOME/.config/cz-host/env.sh"' >> "$rc"
done
# shellcheck disable=SC1091
. "$HOME/.config/cz-host/env.sh"

step "Factory CLIs from this machine's checkouts"
if [ -d "$HOME/SWE/games/tools/gk" ] && ! have gk; then
  cargo install --locked --path "$HOME/SWE/games/tools/gk" || echo "gk did not build; re-run later."
fi

step "Check"
for t in cargo go java kotlinc mvn python3 uv node bun pnpm dotnet docker kubectl kind tilt \
  clang mold sccache cmake ffmpeg magick blender sdkmanager adb cargo-ndk wrangler gltfpack typst twitch rg fd jq; do
  if have "$t"; then printf '  ok  %s\n' "$t"; else printf '  --  %s\n' "$t"; fi
done
for v in $NDK_VERSIONS; do
  if [ -d "$ANDROID_HOME/ndk/$v" ]; then printf '  ok  ndk %s\n' "$v"; else printf '  --  ndk %s\n' "$v"; fi
done
for p in alsa libudev wayland-client xkbcommon vulkan; do
  if pkg-config --exists "$p"; then printf '  ok  %s (dev)\n' "$p"; else printf '  --  %s (dev)\n' "$p"; fi
done
# A freshly installed driver only answers after a restart; that's not an error.
! have nvidia-smi || nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader 2> /dev/null ||
  echo "NVIDIA driver installed; restart this PC to load it."
echo "Done. Open a new shell (or log out and in, for Docker) to pick up the new PATH."
