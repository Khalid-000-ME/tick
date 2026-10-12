# Tick for Android

An installable Android app (APK). It is a Trusted Web Activity: a thin native shell that opens the hosted
Tick site in Chrome, full screen. It is not a WebView, because Google blocks sign-in inside one, and
Chrome keeps Google sign-in, passkeys and wallets working.

The shell cannot contain the app. Tick needs its server (prices, login, the chain, the indexer), so the
APK opens whatever address you build it with.

## Build

```bash
.tools/fetch.sh                              # once: a JDK 17 and the Android SDK (about 1 GB)
./build-apk.sh https://your-site.example     # about two minutes; writes dist/tick.apk
```

The address must be `https://`. Rebuild when it changes; it is baked into the app.

## Before it works for other people

1. **Deploy the site** at that address. The APK is only a door to it.
2. **Allow the address in Privy** (dashboard, your app, allowed origins/domains). Without it login fails.
3. **Ship `app/public/.well-known/assetlinks.json` with the site.** `build-apk.sh` writes it, from the
   signing key's fingerprint. With it Android hides the browser bar; without it the app still works but
   shows one.

## Install

Copy `dist/tick.apk` to a phone and open it (allow installs from that source), or with a phone on USB:
`adb install dist/tick.apk`.

## The signing key

The first build makes `tick-release.jks` and `keystore.properties` here, both ignored by git. Back them up:
an app signed with a different key is a different app to Android and cannot update the old one.

## No APK needed

The site is also installable on its own: Android Chrome offers **Install app** (manifest and icons are in
`app/`), which gives the same icon and full-screen app with nothing to build.
