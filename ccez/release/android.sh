#!/bin/sh
# Builds the release Android APK (arm64, JS bundled) and signs it with the
# czcode release key: ~/.config/czcode/android-release.jks, password in the
# macOS Keychain item "czcode-android-release". Back the key up: losing it
# means installed copies can't be updated in place.
#
#   ccez/release/android.sh [--install]   writes release/czcode-<version>.apk
set -eu
repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
export JAVA_HOME="${JAVA_HOME:-$(/usr/libexec/java_home -v 17)}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
keystore="${CZ_ANDROID_KEYSTORE:-$HOME/.config/czcode/android-release.jks}"
build_tools=$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)

cd "$repo/apps/mobile"
version=$(node -e 'console.log(require("./package.json").version)')
APP_VARIANT=production EXPO_NO_GIT_STATUS=1 npx expo prebuild --clean --platform android --no-install
(cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain)

mkdir -p "$repo/release"
out="$repo/release/czcode-$version.apk"
CZ_KS_PASS=$(security find-generic-password -s czcode-android-release -a czcode -w)
export CZ_KS_PASS
"$build_tools/apksigner" sign --ks "$keystore" --ks-key-alias czcode \
  --ks-pass env:CZ_KS_PASS --key-pass env:CZ_KS_PASS \
  --out "$out" android/app/build/outputs/apk/release/app-release.apk
unset CZ_KS_PASS
"$build_tools/apksigner" verify --print-certs "$out" | head -3
echo "android: $out"
if [ "${1:-}" = "--install" ]; then adb install -r "$out"; fi
