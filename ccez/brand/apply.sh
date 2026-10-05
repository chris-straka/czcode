#!/bin/sh
# Stamps one launcher mark into every icon, favicon, and splash asset.
#
#   ccez/brand/apply.sh <mark>        e.g. ccez/brand/apply.sh dot
#
# Marks live in ccez/brand/marks/<mark>.svg: a light mark on a transparent
# 1024 canvas. Each build variant gets the same mark on its own quiet tile
# colour so dev and release installs are told apart on the phone. Splash
# images are blank: the splash is the plain background colour.
# Needs rsvg-convert and ImageMagick (`brew install librsvg imagemagick`).
set -eu
mark=${1:?usage: apply.sh <mark>}
repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
svg="$repo/ccez/brand/marks/$mark.svg"
test -f "$svg" || { echo "no mark $svg" >&2; exit 1; }
cd "$repo"

PROD_BG='#141414'
DEV_BG='#1E2833'
NIGHTLY_BG='#2B2433'
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Mark alone on transparent, at <size>, scaled by <scale> around the centre.
mark_png() { # size scale out
  inner=$(awk "BEGIN{printf \"%d\", $1*$2}")
  rsvg-convert -w "$inner" -h "$inner" "$svg" -o "$tmp/m.png"
  magick -size "$1x$1" xc:none "$tmp/m.png" -gravity center -composite "$3"
}
# Mark on a tile: <margin> and <radius> are fractions of <size>.
tile_png() { # size bg margin radius out
  edge=$(awk "BEGIN{printf \"%d\", $1*(1-2*$3)}")
  r=$(awk "BEGIN{printf \"%d\", $1*$4}")
  mark_png "$edge" 1 "$tmp/t.png"
  magick -size "${edge}x${edge}" xc:none -fill "$2" -draw "roundrectangle 0,0,$((edge - 1)),$((edge - 1)),$r,$r" \
    "$tmp/t.png" -composite -background none -gravity center -extent "$1x$1" "$5"
}
ico() { # tile.png out.ico
  magick "$1" -define icon:auto-resize=256,64,48,32,16 "$2"
}
icon_set() { # bg dir prefix-for-web ios macos universal
  bg=$1 dir=$2 web=$3
  tile_png 1024 "$bg" 0 0 "$dir/$4"
  tile_png 1024 "$bg" 0.1 0.18 "$dir/$5"
  tile_png 1024 "$bg" 0.02 0.2 "$dir/$6"
  tile_png 180 "$bg" 0 0 "$dir/$web-web-apple-touch-180.png"
  tile_png 32 "$bg" 0 0.2 "$dir/$web-web-favicon-32x32.png"
  tile_png 16 "$bg" 0 0.2 "$dir/$web-web-favicon-16x16.png"
  tile_png 256 "$bg" 0 0.2 "$tmp/ico.png"
  ico "$tmp/ico.png" "$dir/$web-web-favicon.ico"
  ico "$tmp/ico.png" "$dir/$web-windows.ico"
  # Icon Composer project: the tile colour plus the mark as one layer.
  rm -rf "$dir/app-icon.icon/Assets"
  mkdir -p "$dir/app-icon.icon/Assets"
  cp "$svg" "$dir/app-icon.icon/Assets/mark.svg"
  hex=${bg#\#}
  rgb=$(for i in 1 3 5; do printf '%d\n' "0x$(printf '%s' "$hex" | cut -c$i-$((i + 1)))"; done |
    awk '{printf "%s%.5f", (NR > 1 ? "," : ""), $1 / 255}')
  cat >"$dir/app-icon.icon/icon.json" <<EOF
{
  "fill": {
    "solid": "srgb:$rgb,1.00000"
  },
  "groups": [
    {
      "layers": [
        {
          "image-name": "mark.svg",
          "name": "Mark",
          "position": {
            "scale": 1,
            "translation-in-points": [0, 0]
          }
        }
      ]
    }
  ],
  "supported-platforms": {
    "circles": ["watchOS"],
    "squares": "shared"
  }
}
EOF
}

icon_set "$PROD_BG" assets/prod cz-black black-ios-1024.png black-macos-1024.png black-universal-1024.png
icon_set "$DEV_BG" assets/dev blueprint blueprint-ios-1024.png blueprint-macos-1024.png blueprint-universal-1024.png
icon_set "$NIGHTLY_BG" assets/nightly nightly nightly-ios-1024.png nightly-macos-1024.png nightly-universal-1024.png
cp "$svg" assets/prod/logo.svg

# Web public icons are the release set (the build swaps in others per channel).
cp assets/prod/cz-black-web-favicon.ico apps/web/public/favicon.ico
cp assets/prod/cz-black-web-favicon-16x16.png apps/web/public/favicon-16x16.png
cp assets/prod/cz-black-web-favicon-32x32.png apps/web/public/favicon-32x32.png
cp assets/prod/cz-black-web-apple-touch-180.png apps/web/public/apple-touch-icon.png

# Android: adaptive foreground and monochrome are the mark alone; the
# background layer is the tile colour; splash images are blank.
m=apps/mobile/assets
mark_png 432 1 "$m/android-icon-foreground.png"
mark_png 432 1.5 "$m/android-icon-mark.png"
mark_png 96 2.2 "$m/android-notification-icon.png"
magick -size 432x432 "xc:$DEV_BG" "$m/android-icon-background-dev.png"
magick -size 432x432 "xc:$NIGHTLY_BG" "$m/android-icon-background-nightly.png"
for v in dev nightly prod; do magick -size 1152x1152 xc:none "$m/android-splash-icon-$v.png"; done
cp "$svg" "$m/widget/CzMark.svg"

echo "brand: applied mark '$mark'"
