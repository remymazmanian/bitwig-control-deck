#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
SOURCE="$ROOT/macos"
BUILD="${CONTROL_DECK_BUILD_DIR:-$ROOT/build}"
APP="$BUILD/Bitwig Control Deck.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"
ICONSET="$BUILD/AppIcon.iconset"

mkdir -p "$MACOS" "$RESOURCES" "$ICONSET"

clang -fobjc-arc -O2 -framework Cocoa "$SOURCE/generate_icon.m" -o "$BUILD/control-deck-icon-generator"
"$BUILD/control-deck-icon-generator" "$ICONSET"
node "$SOURCE/build_icns.mjs" "$ICONSET" "$RESOURCES/AppIcon.icns"

clang -fobjc-arc -O2 -Wall -Wextra \
  -framework Cocoa \
  -framework WebKit \
  "$SOURCE/main.m" \
  -o "$MACOS/Bitwig Control Deck"

cp "$SOURCE/Info.plist" "$CONTENTS/Info.plist"
xattr -cr "$APP"
codesign --force --deep --sign - "$APP"
plutil -lint "$CONTENTS/Info.plist"
codesign --verify --deep --strict "$APP"

echo "$APP"
