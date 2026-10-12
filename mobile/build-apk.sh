#!/bin/bash
# Builds the installable Android app (APK) that opens your hosted Tick site.
#
#   ./build-apk.sh https://your-site.example
#
# What it does, in order:
#   1. makes a signing key the first time (tick-release.jks, kept out of git; losing it means a new
#      app identity, so back it up) and signs the release build with it,
#   2. builds the APK against the address you gave and copies it to dist/tick.apk,
#   3. writes app/public/.well-known/assetlinks.json with that key's fingerprint. Deploy the site with
#      that file in it and Android hides the browser bar. Without it the app still works, with a bar.
#
# Needs the toolchain in .tools (run .tools/fetch.sh once: a JDK 17 and the Android SDK).
set -euo pipefail
cd "$(dirname "$0")"

URL="${1:-}"
if [ -z "$URL" ]; then echo "Usage: ./build-apk.sh https://your-site.example"; exit 1; fi
case "$URL" in https://*) ;; *) echo "The address must start with https:// (Android will not open a plain http app)."; exit 1 ;; esac
URL="${URL%/}"

export JAVA_HOME="$PWD/.tools/jdk17/Contents/Home"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$JAVA_HOME/bin:$PATH"
[ -d "$ANDROID_HOME/platforms/android-35" ] || { echo "Android SDK missing: run .tools/fetch.sh first."; exit 1; }
echo "sdk.dir=$ANDROID_HOME" > local.properties

if [ ! -f tick-release.jks ]; then
  PW=$(openssl rand -hex 16)
  keytool -genkeypair -keystore tick-release.jks -alias tick -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$PW" -keypass "$PW" -dname "CN=Tick, O=Tick, C=IN" >/dev/null 2>&1
  printf 'storeFile=tick-release.jks\nstorePassword=%s\nkeyAlias=tick\nkeyPassword=%s\n' "$PW" "$PW" > keystore.properties
  echo "Made a signing key: tick-release.jks (back it up, and never commit it)."
fi

[ -f gradlew ] || gradle wrapper --gradle-version 8.10.2 -q
./gradlew -q assembleRelease -PtickUrl="$URL"
mkdir -p dist && cp app/build/outputs/apk/release/app-release.apk dist/tick.apk

PW=$(grep '^storePassword=' keystore.properties | cut -d= -f2)
FP=$(keytool -list -v -keystore tick-release.jks -alias tick -storepass "$PW" 2>/dev/null | grep 'SHA256:' | head -1 | awk '{print $2}')
mkdir -p ../app/public/.well-known
cat > ../app/public/.well-known/assetlinks.json <<EOF
[{"relation":["delegate_permission/common.handle_all_urls"],"target":{"namespace":"android_app","package_name":"app.tick.mobile","sha256_cert_fingerprints":["$FP"]}}]
EOF

echo
echo "APK:            $PWD/dist/tick.apk ($(du -h dist/tick.apk | cut -f1))"
echo "Opens:          $URL/feed"
echo "Certificate:    $FP"
echo "assetlinks:     app/public/.well-known/assetlinks.json  (deploy it with the site)"
