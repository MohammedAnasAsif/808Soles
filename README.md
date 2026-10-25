# Cadence

An open-source YouTube Music player for **Android** and **Windows**, with an Apple Music–style interface.

- Home feed, New releases, moods & genres, search with suggestions
- Album, artist and playlist pages
- Full-screen Now Playing with blurred-artwork background
- Synced, tap-to-seek lyrics (LRCLIB, with YouTube Music's own lyrics as a fallback)
- Crossfade (0–12 s), Sound Check (loudness levelling), shuffle, repeat, autoplay radio
- Queue: play next, play last, reorder by removing, clear
- Library on the device: loved songs, saved albums & playlists, followed artists, your own playlists, recently played
- Android: native ExoPlayer in a foreground service — plays with the screen off, notification and lock-screen controls, Bluetooth buttons
- Windows: installer, media keys and the Windows media overlay, keyboard shortcuts (Space, Ctrl+←/→, Ctrl+↑/↓)

No account and no server: the app talks to YouTube Music directly. It is not affiliated with YouTube or Google, and streaming this way is against YouTube's terms of service. Use it at your own risk.

## Download

Every push to `main` builds both apps on GitHub Actions and publishes them on the **Latest build** release (Releases → Latest build):

- **Android:** open `Cadence.apk` on your phone and allow installing from your browser when asked.
- **Windows:** run `Cadence-Setup.exe`. It isn't code-signed, so SmartScreen may warn: *More info → Run anyway*.

Tag a commit `v1.0.0` (`git tag v1.0.0 && git push --tags`) for a versioned release.

### Android updates need a fixed signing key

Android only installs an update over an existing app if both are signed with the same key. Add these two repository secrets (Settings → Secrets and variables → Actions) once:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | your keystore file, base64-encoded |
| `ANDROID_KEYSTORE_PASSWORD` | its password (used for the store and the key) |

Create a keystore with (key alias must be `cadence`):

```bash
keytool -genkeypair -v -keystore cadence.jks -alias cadence -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 cadence.jks   # paste the output into ANDROID_KEYSTORE_BASE64
```

Without the secrets the APK still builds, but each build gets a new throwaway key, so you'd have to uninstall before installing a newer one.

## Develop

Node 22+.

```bash
npm install
npm run dev            # the app in your browser at http://localhost:5173 (live YouTube through the dev server)
npm run typecheck
npm test
```

- **Windows app locally:** `npm run build && npx electron .`, or `npm run dist:win` for the installer.
- **Android locally:** `npm run android:sync`, then open `android/` in Android Studio (JDK 21).

`npm run dev:fixtures` serves captured YouTube responses instead of the live site (set `FIXTURES_DIR`), for working on the interface offline.

## How it works

| Part | Where |
| --- | --- |
| Interface (React, Tailwind) | `src/pages`, `src/components` |
| YouTube Music data, via [YouTube.js](https://github.com/LuanRT/YouTube.js) | `src/yt` |
| Queue and playback logic | `src/store/player.ts` |
| Audio engines: two decks with crossfade | `src/audio` (desktop), `android/.../PlaybackService.java` (Android) |
| Native bridge (HTTP + playback) | `android/.../CadencePlugin.java`, `electron/main.cjs` |
| Builds | `.github/workflows/build.yml` |

Streams come from YouTube's VISIONOS client first (direct audio URLs, no PO token), falling back to ANDROID_VR, IOS and TV. Age-restricted tracks need a signed-in account, which Cadence doesn't support yet.

## License

GPL-3.0-or-later.
