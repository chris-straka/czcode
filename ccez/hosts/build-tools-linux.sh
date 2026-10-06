#!/usr/bin/env bash
# Build tooling for a Linux agent host, roughly matching the Mac (`z`):
# Bevy/Rust game builds, Android APKs, Blender, media tools, web tooling.
# Run after linux.sh, as your normal user (sudo is asked for once):
#
#   bash ~/SWE/czcode/ccez/hosts/build-tools-linux.sh
#
# From another machine, quote the path so `~` expands on the host:
#   ssh -t b@basement 'bash ~/SWE/czcode/ccez/hosts/build-tools-linux.sh'
# SKIP_APT=1 runs only the steps that need no sudo; APT_ONLY=1 only the sudo one.
#
# Safe to re-run: installed pieces are skipped. Not covered (Mac-only or not
# needed on agent hosts): Xcode/iOS, gcloud, MEGAcmd, resend, notify-me,
# llama.cpp, databases (use Docker).
set -euo pipefail

BLENDER_VERSION=5.2.1                # same as the Mac
NDK_VERSION=28.2.13676358            # games/tools/build_android.sh default
ANDROID_PLATFORM=android-36
ANDROID_BUILD_TOOLS=36.0.0

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
have() { command -v "$1" > /dev/null 2>&1; }
[ "$(id -u)" -ne 0 ] || { echo "Run as your normal user, not root." >&2; exit 1; }
mkdir -p "$HOME/.local/bin" "$HOME/.local/opt"
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}"   # agents share this host

if [ "${SKIP_APT:-0}" != 1 ]; then
step "System packages (asks for your password once)"
sudo apt-get update -q
sudo DEBIAN_FRONTEND=noninteractive apt-get install -yq \
  build-essential pkg-config clang lld mold cmake ninja-build libssl-dev \
  protobuf-compiler mingw-w64 \
  libasound2-dev libudev-dev libwayland-dev libxkbcommon-dev libx11-dev \
  libxcursor-dev libxrandr-dev libxi-dev libvulkan-dev mesa-vulkan-drivers \
  vulkan-tools xvfb libgl1 libxkbcommon-x11-0 libsm6 libxext6 libxrender1 \
  ffmpeg imagemagick pngquant ghostscript poppler-utils espeak-ng gnuplot \
  chafa f3d \
  ripgrep fd-find jq tree tmux neovim aria2 wget curl rsync unzip zip \
  xz-utils sqlite3 git-lfs git-filter-repo shellcheck cifs-utils \
  python3-venv
fi
[ "${APT_ONLY:-0}" != 1 ] || { echo "APT_ONLY: done."; exit 0; }
# Ubuntu names fd "fdfind".
have fd || ! have fdfind || ln -sf "$(command -v fdfind)" "$HOME/.local/bin/fd"
! have git-lfs || git lfs install --skip-repo > /dev/null

step "Rust targets and components"
rustup target add wasm32-unknown-unknown wasm32-wasip2 x86_64-pc-windows-gnu \
  aarch64-linux-android armv7-linux-androideabi i686-linux-android \
  x86_64-linux-android
rustup component add clippy rustfmt rust-analyzer

step "Cargo tools (prebuilt binaries where available)"
have cargo-binstall || curl -L --proto '=https' --tlsv1.2 -sSf \
  https://raw.githubusercontent.com/cargo-bins/cargo-binstall/main/install-from-binstall-release.sh | bash
for crate in sccache cargo-ndk cargo-watch cargo-edit worker-build typst-cli; do
  bin="$crate"
  case "$crate" in cargo-edit) bin=cargo-upgrade ;; typst-cli) bin=typst ;; esac
  have "$bin" || cargo binstall -y --locked "$crate"
done

step "Faster Rust builds: sccache + mold"
cfg="$HOME/.cargo/config.toml"
touch "$cfg"
# Only point cargo at tools that exist, or every build on this host fails.
! have sccache || grep -q 'rustc-wrapper' "$cfg" || printf '[build]\nrustc-wrapper = "sccache"\n' >> "$cfg"
! { have mold && have clang; } || grep -q 'x86_64-unknown-linux-gnu' "$cfg" || printf '\n[target.x86_64-unknown-linux-gnu]\nlinker = "clang"\nrustflags = ["-C", "link-arg=-fuse-ld=mold"]\n' >> "$cfg"

step "Python tools (uv, yt-dlp)"
have uv || curl -LsSf https://astral.sh/uv/install.sh | sh
have yt-dlp || uv tool install yt-dlp

step "Node tools (prefix ~/.local, no sudo)"
[ "$(npm config get prefix)" = "$HOME/.local" ] || npm config set prefix "$HOME/.local"
have bun || curl -fsSL https://bun.sh/install | bash
have wrangler || npm install -g wrangler
have gltf-transform || npm install -g @gltf-transform/cli
have gltfpack || npm install -g gltfpack

step "Blender $BLENDER_VERSION"
bdir="$HOME/.local/opt/blender-$BLENDER_VERSION-linux-x64"
if [ ! -x "$bdir/blender" ]; then
  series="${BLENDER_VERSION%.*}"
  curl -fL "https://download.blender.org/release/Blender$series/blender-$BLENDER_VERSION-linux-x64.tar.xz" \
    | tar -xJ -C "$HOME/.local/opt"
fi
ln -sf "$bdir/blender" "$HOME/.local/bin/blender"

step "Android NDK $NDK_VERSION, $ANDROID_PLATFORM, build-tools $ANDROID_BUILD_TOOLS"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
sdkm="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
if [ -x "$sdkm" ]; then
  yes | "$sdkm" --licenses > /dev/null || true
  "$sdkm" --install "ndk;$NDK_VERSION" "platforms;$ANDROID_PLATFORM" \
    "build-tools;$ANDROID_BUILD_TOOLS" "platform-tools" > /dev/null
else
  echo "No Android SDK at $ANDROID_HOME (cmdline-tools missing); skipped."
fi

step "Factory CLIs from this machine's checkouts"
if [ -d "$HOME/SWE/games/tools/gk" ] && ! have gk; then
  cargo install --locked --path "$HOME/SWE/games/tools/gk" || echo "gk did not build (system packages missing?); re-run after them."
fi

step "Check"
for t in cargo sccache mold clang ffmpeg magick blender cargo-ndk uv yt-dlp bun wrangler gltf-transform gltfpack rg fd jq shellcheck typst; do
  if have "$t"; then printf '  ok  %s\n' "$t"; else printf '  --  %s (missing)\n' "$t"; fi
done
for p in alsa libudev wayland-client xkbcommon vulkan; do
  if pkg-config --exists "$p"; then printf '  ok  %s (dev)\n' "$p"; else printf '  --  %s (dev, missing)\n' "$p"; fi
done
blender --version 2> /dev/null | head -1
echo "Done."
