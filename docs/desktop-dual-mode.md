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
- Camera scanning asks for native user consent in the trusted main local renderer and the exact configured HTTPS app's main window. The default choice keeps the camera blocked; Assets and Inventory retain manual asset-tag/code lookup. A grant stays in memory for that renderer rather than being stored with hosted cookies. Navigation, closing the renderer and switching modes reset it. Switching online stops the local scanner's video tracks while retaining local form state. Hosted sign-in popups, same-origin callback popups, embedded frames and other origins cannot request or inherit camera consent. Microphone, screen capture and browser notifications remain denied. The Notifications module uses in-app records and remains usable.
- User-initiated clipboard copy works in the same trusted main local and hosted renderers. Only sanitized clipboard writing is allowed; clipboard reading, embedded frames and sign-in popups remain blocked.
- macOS packaging includes a camera usage description and camera entitlement; the native prompt also requests macOS camera consent. A denied or restricted OS/device permission still falls back to manual entry. Linux camera qualification uses Chromium's fake video device; it does not establish physical webcam, macOS or Windows camera support.
- The actual Linux Electron renderer and native main process were tested with a disposable HTTPS/sign-in fixture. That qualification does not claim real enterprise Microsoft/Clerk SSO or signed macOS/Windows installer tests.
- Desktop windows support a minimum width of 360 pixels. The hosted regular web app retains its own mobile layouts.

## Reproduce qualification

```sh
npm run desktop:build
npm run test:desktop-dual-mode
npx tsx scripts/check-desktop-camera-consent.ts
npm run test:electron-architecture
SOCIETYER_TEST_DESKTOP_DIST=dist npm run test:desktop-dual-mode-runtime
SOCIETYER_TEST_DESKTOP_DIST=dist node scripts/check-desktop-linux-package.mjs
```

The runtime check requires Electron's installed binary, OpenSSL, FFmpeg, and a display. For headless Linux provide `SOCIETYER_TEST_XVFB=/usr/bin/Xvfb` or an existing `DISPLAY`. The test generates a disposable certificate and accepts only its exact public-key pin inside the test harness. Production code has no certificate-validation bypass. Temporary profiles, certificate keys, servers, windows and the test Xvfb process are removed in `finally`.

The runtime evidence is recorded in [desktop-dual-mode-runtime.json](../artifacts/offline/desktop-dual-mode-runtime.json). It tests the real bundled setup screen, native file APIs, secure hosted window, fixture SSO popup/callback navigation, blocked foreign origins, local-mode WebSocket termination, file/session retention, restart, origin partitioning, unavailable endpoint fallback and narrow desktop layout. Camera cases use `use-fake-device-for-media-stream` and a generated QR video, which supply a video device without automatically approving permission; each approval is an explicit fixture choice for the actual production permission handlers. The bundled scanner reads that QR code and resolves a genuinely created asset in a disposable organization made through the guided local setup flow.

The final Linux Electron runtime passed 21 cases, including camera revocation and pending consent callbacks, local and hosted clipboard copy, and scanning an initially unknown asset after it was created. Store updates invalidate inactive retained query snapshots so a previously missing asset can resolve on resubscription without rerunning inactive queries.

The Linux packaging check runs electron-builder with `--dir --publish never`, maps a separately built local renderer into the package and uses the installed Electron distribution. It writes only ignored temporary output, verifies the ASAR contents and launches the actual unsigned Linux package. It does not publish an installer or claim macOS/Windows execution, signing, notarization or AppImage installation. Production signing/notarization credentials and real Microsoft/Clerk deployments are required to qualify those remaining cases; an HTTPS callback fixture cannot establish provider tenant policy or enterprise-browser restrictions.

The final directory-package smoke passed seven cases, including native file write/read, offline bundled reload and production userData isolation in a disposable appData profile. The camera policy passed seven groups. Demo browser fallback passed eight cases across 320/390/768/1440-pixel views, covering permission denial, asset-tag lookup, unknown inventory codes and successful bin lookup. Browser denial tests use full Chromium with its camera permission explicitly denied; they retain the actual getUserMedia and scanner paths. These counts are recorded in [desktop-linux-package.json](../artifacts/offline/desktop-linux-package.json), [desktop-camera-consent.json](../artifacts/offline/desktop-camera-consent.json) and [desktop-camera-fallback.json](../artifacts/offline/desktop-camera-fallback.json).
