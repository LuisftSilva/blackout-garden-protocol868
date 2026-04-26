# Build APK instructions

## Option A — Android Studio

1. Open Android Studio.
2. Choose **Open**.
3. Select:

```text
blackout_garden_protocol_868/android-wrapper
```

4. Wait for Gradle sync.
5. Go to:

```text
Build > Build Bundle(s) / APK(s) > Build APK(s)
```

6. The APK should appear at:

```text
android-wrapper/app/build/outputs/apk/debug/app-debug.apk
```

7. Copy the APK to the Android phone and install it.

## Option B — ADB install

```bash
adb install -r android-wrapper/app/build/outputs/apk/debug/app-debug.apk
```

## Notes

The app is a native Android wrapper around an offline HTML5 game stored inside `android_asset/game`. It does not need internet, accounts, ads, server calls or analytics.
