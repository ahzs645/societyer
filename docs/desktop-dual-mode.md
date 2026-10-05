# Societyer Desktop modes

The same installed Electron application can open its bundled local workspace or your hosted HTTPS Societyer web app. The local vault and hosted workspace are separate datasets. Mode switching does not automatically upload, migrate or merge local records.

In Desktop setup, use the local workspace for core records and native document files without a Convex server or hosted sign-in. To open the online workspace, enter the origin of your deployed app, such as `https://your-societyer.example`, and select **Open online workspace**. Enter the web app origin rather than a Convex API or PowerSync endpoint.

The online window loads the existing hosted app, which retains its Clerk or Better Auth sign-in, workspace roles, module permissions and enabled PowerSync meeting preparation. It uses a persistent session isolated by the exact HTTPS app origin. Another origin or port uses a separate partition. No preload, native filesystem bridge or Node integration is exposed to the online app or its sign-in popups.

If sign-in redirects to a separate origin, add the exact HTTPS origin supplied by your administrator under **External sign-in providers**. For Microsoft this can include `https://login.microsoftonline.com`; custom Clerk sign-in domains must be entered explicitly. Wildcards, HTTP, embedded credentials and unapproved navigation are blocked. This does not change the server's tenant restrictions or authentication policy.

Use **File → Return to Local Workspace** (`Cmd/Ctrl+Shift+L`) to switch back, or **File → Open Online Workspace** (`Cmd/Ctrl+Shift+O`) to reopen online. **Save online form edits first**: returning locally closes online and sign-in windows, terminates their WebSockets, and blocks requests from their dedicated session. Saved hosted cookies, IndexedDB and PowerSync queues remain in the origin's persistent partition. Native menu actions for backups and local settings return to the local renderer rather than exposing native actions remotely.

A successful online selection becomes the startup mode. On the next launch the app tries that HTTPS origin; a failed load returns to the bundled local workspace. Reconnect and choose online again when ready. The established `societyer-app://index.html` local origin is preserved, including existing IndexedDB records and vault binding. Relative bundled assets now resolve correctly from that origin; the previous IPC-only smoke could miss a blank React screen.

## Scope and limits

- Core local records and native files work offline. Optional local connectors, remote AI, imports and other external services require their own configured connections.
- Hosted offline work remains the enabled meeting-preparation pathway. Arbitrary server modules are not replicated into the local vault, and hosted offline reload can require online authentication again.
- Online web permissions such as camera, microphone, display capture and browser notifications currently default to denied in the isolated Electron session. Assets and Inventory camera scanning display a permission error and keep manual asset-tag/code lookup available. The Notifications module uses in-app records and remains usable. There are no microphone or screen-capture callers in the current app. Use the regular web app for camera scanning until a native consent prompt and platform camera permissions are qualified.
- The actual Linux Electron renderer and native main process were tested with a disposable HTTPS/sign-in fixture. That qualification does not claim real enterprise Microsoft/Clerk SSO or signed macOS/Windows installer tests.
- Desktop windows support a minimum width of 360 pixels. The hosted regular web app retains its own mobile layouts.

## Reproduce qualification

```sh
npm run desktop:build
npm run test:desktop-dual-mode
npm run test:electron-architecture
SOCIETYER_TEST_DESKTOP_DIST=dist npm run test:desktop-dual-mode-runtime
```

The runtime check requires Electron's installed binary, OpenSSL, and a display. For headless Linux provide `SOCIETYER_TEST_XVFB=/usr/bin/Xvfb` or an existing `DISPLAY`. The test generates a disposable certificate and accepts only its exact public-key pin inside the test harness. Production code has no certificate-validation bypass. Temporary profiles, certificate keys, servers, windows and the test Xvfb process are removed in `finally`.

The runtime evidence is recorded in [desktop-dual-mode-runtime.json](../artifacts/offline/desktop-dual-mode-runtime.json). It tests the real bundled setup screen, native file APIs, secure hosted window, SSO popup/callback navigation, blocked foreign origins, local-mode WebSocket termination, file/session retention, restart, origin partitioning, unavailable endpoint fallback and narrow desktop layout.
