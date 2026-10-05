#!/bin/sh
# Builds the release Android APK (arm64, JS bundled) and signs it with the
# czcode release key: ~/.config/czcode/android-release.jks, password in the
# macOS Keychain item "czcode-android-release". Back the key up: losing it
# means installed copies can't be updated in place.
#
# The versionCode is the commit count on HEAD, so every build from a later
# commit installs over the last one.
#
#   ccez/release/android.sh [--install] [--publish]
#     writes release/czcode-<version>-<versionCode>.apk
#     --install   adb-installs it on the connected phone
#     --publish   offers it to paired phones from this machine's cz server
#                 (copies it to $CZ_HOME/releases/android, default ~/.cz;
#                 Settings → App → Install update on the phone)
set -eu
install=false
publish=false
for arg in "$@"; do
  case "$arg" in
    --install) install=true ;;
    --publish) publish=true ;;
    *) echo "unknown flag: $arg" >&2; exit 64 ;;
  esac
done

repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
export JAVA_HOME="${JAVA_HOME:-$(/usr/libexec/java_home -v 17)}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
keystore="${CZ_ANDROID_KEYSTORE:-$HOME/.config/czcode/android-release.jks}"
build_tools=$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)
CZ_ANDROID_VERSION_CODE=$(git -C "$repo" rev-list --count HEAD)
export CZ_ANDROID_VERSION_CODE

cd "$repo/apps/mobile"
version=$(APP_VARIANT=production npx expo config --json 2>/dev/null | node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => console.log(JSON.parse(s).version))')
APP_VARIANT=production EXPO_NO_GIT_STATUS=1 npx expo prebuild --clean --platform android --no-install
(cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain)

mkdir -p "$repo/release"
name="czcode-$version-$CZ_ANDROID_VERSION_CODE.apk"
out="$repo/release/$name"
CZ_KS_PASS=$(security find-generic-password -s czcode-android-release -a czcode -w)
export CZ_KS_PASS
"$build_tools/apksigner" sign --ks "$keystore" --ks-key-alias czcode \
  --ks-pass env:CZ_KS_PASS --key-pass env:CZ_KS_PASS \
  --out "$out" android/app/build/outputs/apk/release/app-release.apk
unset CZ_KS_PASS
"$build_tools/apksigner" verify --print-certs "$out" | head -3
echo "android: $out"
if $install; then adb install -r "$out"; fi
if $publish; then
  releases="${CZ_HOME:-$HOME/.cz}/releases/android"
  mkdir -p "$releases"
  cp "$out" "$releases/$name.partial" && mv "$releases/$name.partial" "$releases/$name"
  # Keep only this build; the server offers the highest versionCode anyway.
  find "$releases" -name 'czcode-*.apk' ! -name "$name" -delete
  echo "published: $releases/$name"
fi
