# Security

808Soles has no accounts, no server and no telemetry. It talks to YouTube Music, YouTube's media servers and LRCLIB, and keeps your library on your device. This file describes how the apps are protected and what they deliberately don't protect against.

## Reporting a problem

Please open a GitHub issue that says only that you found a security problem, without the details, and ask how to reach the maintainer privately. Don't publish details until a fix is out.

## How the apps are protected

### Both apps

- **Only three services are reachable.** The native bridge that makes network requests for the interface (`electron/main.cjs`, `CadencePlugin.java`) accepts only `https://` URLs on `youtube.com`, `youtubei.googleapis.com`, `*.googlevideo.com` and `lrclib.net`, on the default port, without credentials. Redirects to other hosts are refused. This stops a compromised page from reaching local files, your home network or other servers. Cookies, `Authorization` and hop-by-hop headers can't be set, and responses are size-capped.
- **YouTube's player code is isolated.** To unlock stream URLs, the app must run a few lines of YouTube's player script. That code runs in a separate worker (`src/yt/decipher-worker.ts`), which can't reach the page, storage or the native bridge, and which is stopped if it runs for more than 8 seconds. On Windows the worker is also served with a policy that blocks all network access.
- **Untrusted data is never treated as code.** YouTube and LRCLIB data is rendered as text by React (there is no raw-HTML rendering), and only `https:` images are displayed.
- **Downloads are confined.** Files are written only to the app's private downloads folder. Names must match `<video id>.<ext>`, the source must be a googlevideo URL, files are capped at 400 MB, and deletion is limited to that folder.

### Windows (Electron)

- The interface is served from a private `app://` scheme, not `file://`, with a strict Content-Security-Policy: no inline or injected scripts, no `eval`, no plug-ins or frames, and no network access from the page.
- The renderer runs with `sandbox`, `contextIsolation` and no Node.js. The only native API it sees is the small bridge in `electron/preload.cjs`, and every bridge call checks that it comes from the app's own page.
- Navigation away from the app, new windows and `<webview>` are refused. `https` links open in your browser instead.
- All permission requests (camera, microphone, location, notifications, USB, …) are denied.
- Electron fuses are set at build time: `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect` are disabled, cookies are encrypted, code loads only from the app's `asar` archive, and `file://` gets no extra privileges.

### Android

- Release builds disable WebView debugging and mixed content, and don't allow navigation to other sites.
- HTTPS only, and only system certificate authorities are trusted, not user-installed ones (`network_security_config.xml`).
- The player only plays googlevideo streams or files from the app's own downloads folder. Lock-screen artwork must be `https`.
- App data is excluded from cloud backups and device-to-device transfer, and `adb backup` is off.
- The FileProvider is limited to a cache subfolder.

### Build and release

- Release workflow jobs get read-only repository access. Only the publishing job can write releases.
- Every third-party GitHub Action is pinned to a commit SHA, and checkouts don't keep the token.
- The Android signing key exists only as repository secrets and is never in the repository. Workflows run on pushes to `main` and on tags, never for pull requests from forks, so outside contributors can't reach the secrets.
- `npm ci` installs exactly the versions in `package-lock.json`. `npm audit` reports 0 known vulnerabilities, with an override for a dev-only `uuid` advisory.

## Known limits

- **Windows installer isn't code-signed.** SmartScreen warns on first run. Only download it from this repository's Releases page. Code signing needs a paid certificate.
- **Android APK is sideloaded.** Only install APKs from this repository's Releases page. Android refuses updates signed with a different key, which protects against tampered updates once the app is installed.
- **YouTube's terms.** Streaming this way is against YouTube's terms of service. YouTube can change or block it at any time.
- **No auto-update.** Install new versions from Releases to get fixes.
- **Media controls are open to other apps.** Any app on the phone can see what's playing and press play/pause/next, as with every Android music app.
