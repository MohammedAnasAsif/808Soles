#!/bin/bash
# Builds an unsigned 808Soles.ipa on macOS (used by CI). Sideloading tools
# (xtool, Sideloadly, AltStore) sign it with your Apple ID when installing.
#
#   npm run build && npm run ios:web && ios/build-ipa.sh [output.ipa]
set -euo pipefail
cd "$(dirname "$0")"

OUT_IPA="$(cd .. && pwd)/${1:-out/808Soles.ipa}"
VERSION="${VERSION_NAME:-0.1.0}"
BUILD="${VERSION_CODE:-1}"
WORK="build"
APP="$WORK/Payload/808Soles.app"
SDK="$(xcrun --sdk iphoneos --show-sdk-path)"
SDK_VERSION="$(xcrun --sdk iphoneos --show-sdk-version)"
MIN_IOS="17.0"

[ -f Sources/Soles808/Web/index.html ] || { echo "::error::Web app missing: run npm run build && npm run ios:web"; exit 1; }

rm -rf "$WORK"
mkdir -p "$APP" "$(dirname "$OUT_IPA")"

echo "Compiling Swift"
xcrun --sdk iphoneos swiftc \
  -target "arm64-apple-ios$MIN_IOS" -sdk "$SDK" \
  -O -whole-module-optimization -swift-version 5 -parse-as-library \
  -module-name Soles808 \
  Sources/Soles808/*.swift \
  -o "$APP/808Soles"

echo "Copying the web app"
cp -R Sources/Soles808/Web "$APP/Web"

echo "Compiling the icon"
ASSETS="$WORK/Assets.xcassets"
mkdir -p "$ASSETS/AppIcon.appiconset"
cp Resources/AppIcon.png "$ASSETS/AppIcon.appiconset/AppIcon.png"
cat > "$ASSETS/Contents.json" <<'JSON'
{ "info": { "author": "xcode", "version": 1 } }
JSON
cat > "$ASSETS/AppIcon.appiconset/Contents.json" <<'JSON'
{
  "images": [{ "filename": "AppIcon.png", "idiom": "universal", "platform": "ios", "size": "1024x1024" }],
  "info": { "author": "xcode", "version": 1 }
}
JSON
xcrun actool "$ASSETS" --compile "$APP" --platform iphoneos \
  --minimum-deployment-target "$MIN_IOS" --app-icon AppIcon \
  --target-device iphone --target-device ipad \
  --output-partial-info-plist "$WORK/icon.plist" --output-format human-readable-text > /dev/null

echo "Writing Info.plist"
PLIST="$APP/Info.plist"
cp Info.plist "$PLIST"
pb() { /usr/libexec/PlistBuddy -c "$1" "$PLIST"; }
set_key() { pb "Delete :$1" 2>/dev/null || true; pb "Add :$1 $2 $3"; }
set_key CFBundleExecutable string 808Soles
set_key CFBundleIdentifier string app.soles808.player
set_key CFBundleName string 808Soles
set_key CFBundlePackageType string APPL
set_key CFBundleInfoDictionaryVersion string 6.0
set_key CFBundleDevelopmentRegion string en
set_key CFBundleShortVersionString string "$VERSION"
set_key CFBundleVersion string "$BUILD"
set_key MinimumOSVersion string "$MIN_IOS"
set_key LSRequiresIPhoneOS bool true
set_key DTPlatformName string iphoneos
set_key DTPlatformVersion string "$SDK_VERSION"
set_key DTSDKName string "iphoneos$SDK_VERSION"
pb "Delete :CFBundleSupportedPlatforms" 2>/dev/null || true
pb "Add :CFBundleSupportedPlatforms array"
pb "Add :CFBundleSupportedPlatforms:0 string iPhoneOS"
pb "Delete :UIRequiredDeviceCapabilities" 2>/dev/null || true
pb "Add :UIRequiredDeviceCapabilities array"
pb "Add :UIRequiredDeviceCapabilities:0 string arm64"
pb "Merge $WORK/icon.plist"
plutil -lint "$PLIST"
plutil -convert binary1 "$PLIST"
printf 'APPL????' > "$APP/PkgInfo"

echo "Packaging"
rm -f "$OUT_IPA"
(cd "$WORK" && zip -qry "$OUT_IPA" Payload)
echo "Built $OUT_IPA ($(du -h "$OUT_IPA" | cut -f1))"
