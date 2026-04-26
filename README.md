# Blackout Garden: Protocol 868

Offline single-player survival/action vertical slice for Android/browser.

## What is included

- Playable HTML5/Canvas game in `web/`
- Offline save using local storage
- Mobile touch controls: joystick + EMP + scan + interact
- Desktop controls: WASD/arrows, mouse/tap EMP, E interact, Q scan, Esc pause
- Android WebView wrapper project in `android-wrapper/`
- No login, no ads, no server, no external assets

## Game loop

1. Start at Base Hub.
2. Launch a relay mission.
3. Explore the map, collect energy/water/parts/data/medicine.
4. Avoid or destroy drones/crawlers/turrets.
5. Activate all field terminals.
6. Raise the 868 MHz antenna.
7. Return to extraction.
8. Spend resources on base upgrades.
9. Continue to the next mountain relay.

## Browser version

Open:

```text
web/index.html
```

The browser version is immediately playable. For full PWA offline install behaviour, serve the `web/` folder through HTTPS or localhost.

Local server example:

```bash
cd web
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

On Android, if hosted locally/HTTPS, Chrome/Brave can use **Add to Home Screen / Install app**.

## Android APK build

This environment did not include Android SDK/Gradle, so the APK was not compiled here.

To build the APK:

1. Install Android Studio.
2. Open the folder:

```text
android-wrapper/
```

3. Let Android Studio sync Gradle.
4. Build:

```text
Build > Build Bundle(s) / APK(s) > Build APK(s)
```

5. Install the generated APK on the phone.

Expected output path:

```text
android-wrapper/app/build/outputs/apk/debug/app-debug.apk
```

## Direct install by ADB

```bash
adb install -r android-wrapper/app/build/outputs/apk/debug/app-debug.apk
```

## Design notes

This version uses a high-detail 2D Canvas rendering pipeline rather than heavy 3D, because it gives a playable offline result now and is easy to wrap for Android. Visuals include fog, rain/snow/ash weather, glow, particles, scan pulses, dynamic camera, hostile drones, terminals, antenna effects, HUD, minimap and cinematic menu/base UI.

## Version

0.1.0 vertical slice.
