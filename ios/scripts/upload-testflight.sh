#!/bin/sh
# Archive, sign and upload a Nænsom build to TestFlight with xcodebuild alone, using the Apple ID signed
# in to Xcode. Usage, from ios/:  scripts/upload-testflight.sh <build-number>
#
# Why not a plain signed archive: automatic signing archives with a development profile, and Apple
# refuses to make one while the team has no registered devices. So the archive is built unsigned, the
# app and the extension are signed ad hoc with their entitlements (an unsigned build loses them, and
# Live Activities and the App Group need them), and the export re-signs both for the App Store,
# creating the distribution certificate and the App Store profiles itself.
set -eu
BUILD="${1:?usage: scripts/upload-testflight.sh <build-number>}"
cd "$(dirname "$0")/.."
OUT="${TMPDIR:-/tmp}/naensom-testflight-$BUILD"
rm -rf "$OUT" && mkdir -p "$OUT"

xcodegen generate
xcodebuild -project Naensom.xcodeproj -scheme Naensom -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$OUT/Naensom.xcarchive" \
  DEVELOPMENT_TEAM=B32HGH682W CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO \
  CURRENT_PROJECT_VERSION="$BUILD" archive

APP="$OUT/Naensom.xcarchive/Products/Applications/Naensom.app"
codesign --force --sign - --entitlements LiveActivity/NaensomLiveActivity.entitlements \
  "$APP/PlugIns/NaensomLiveActivity.appex"
codesign --force --sign - --entitlements App/Naensom.entitlements "$APP"

cat > "$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>app-store-connect</string>
<key>destination</key><string>upload</string>
<key>teamID</key><string>B32HGH682W</string>
<key>signingStyle</key><string>automatic</string>
<key>uploadSymbols</key><true/>
<key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PLIST

xcodebuild -exportArchive -archivePath "$OUT/Naensom.xcarchive" \
  -exportOptionsPlist "$OUT/ExportOptions.plist" -exportPath "$OUT/export" -allowProvisioningUpdates
