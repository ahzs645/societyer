# Desktop release checklist

This checklist is for the GitHub feed configured in `electron-builder.json` (`ahzs645/societyer`). Run each platform build on that platform. All platform jobs for one release must use the same committed `package.json` version.

## 1. Choose the version and channel

1. Set `package.json` to a new SemVer version; the version must be greater than the installed app version.
2. Use the version form that matches the intended channel:
   - stable: `X.Y.Z` (electron-builder expands `${channel}` to `latest`)
   - beta: `X.Y.Z-beta.N` (expands to `beta`)
   - nightly: `X.Y.Z-nightly.N` (expands to `nightly`)
3. Do not use `stable` as an electron-updater metadata name. The app's user-facing `stable` setting maps to electron-updater's `latest` channel.
4. Confirm the release commit and version are identical on the macOS, Windows, and Linux builders.

## 2. Provide publishing credentials

Export a GitHub token with permission to create releases and upload assets to `ahzs645/societyer`:

```sh
export GH_TOKEN="<GitHub token with repository Contents: read/write>"
```

`GITHUB_TOKEN` also works, but `GH_TOKEN` is the electron-builder convention used here. Never put the token in `electron-builder.json` or commit it.

## 3. Sign and notarize macOS

Use a real **Developer ID Application** certificate. Provide either a certificate already installed in the build keychain:

```sh
export CSC_NAME="Developer ID Application: <legal name> (<team id>)"
```

or an exported certificate and its password:

```sh
export CSC_LINK="/secure/path/developer-id-application.p12"
export CSC_KEY_PASSWORD="<certificate password>"
```

For notarization, the recommended credential set for the installed electron-builder is an App Store Connect API key:

```sh
export APPLE_API_KEY="/secure/path/AuthKey_<key id>.p8"
export APPLE_API_KEY_ID="<key id>"
export APPLE_API_ISSUER="<issuer UUID>"
```

Supported alternatives are all three of `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`, or a notarytool profile through `APPLE_KEYCHAIN_PROFILE` with optional `APPLE_KEYCHAIN`.

`electron-builder.json` enables hardened runtime and the installed electron-builder's notarization integration. Its built-in Electron entitlements include JIT, unsigned executable memory, and library-validation allowances; no custom `afterSign` hook is needed. A release is not ready if signing or notarization is skipped.

Code signing is **not** forced in the base config, so `npm run desktop:package` can still produce an unsigned local build for testing. The release path turns it on: `npm run desktop:release` passes `-c.mac.forceCodeSigning=true -c.win.forceCodeSigning=true`, so a release build fails loudly rather than shipping an unsigned app that can never auto-update.

Build and upload the macOS DMG, ZIP, and channel metadata:

```sh
npm run desktop:build
./node_modules/.bin/electron-builder --mac --config electron-builder.json -c.mac.forceCodeSigning=true --publish always
```

Before publishing the draft, verify the produced app (replace the app path with `release/mac-arm64/Societyer.app`, `release/mac/Societyer.app`, or the actual output):

```sh
codesign --verify --deep --strict --verbose=2 release/mac-arm64/Societyer.app
spctl --assess --type execute --verbose=2 release/mac-arm64/Societyer.app
xcrun stapler validate release/mac-arm64/Societyer.app
```

## 4. Sign Windows NSIS

Use a trusted Windows code-signing certificate. The simplest repo-compatible setup is:

```powershell
$env:WIN_CSC_LINK = "C:\secure\societyer-code-signing.pfx"
$env:WIN_CSC_KEY_PASSWORD = "<certificate password>"
$env:GH_TOKEN = "<GitHub token with repository Contents: read/write>"
```

`CSC_LINK` and `CSC_KEY_PASSWORD` are fallback names, but the Windows-specific names avoid accidentally selecting the wrong certificate. Building through `npm run desktop:release` (or passing `-c.win.forceCodeSigning=true`) makes the build fail if the app/NSIS installer is not signed. electron-builder writes the certificate publisher into packaged `app-update.yml`; electron-updater uses that publisher to reject an update signed by a different owner.

Build and upload the NSIS installer, blockmap, and channel metadata:

```powershell
npm run desktop:build
./node_modules/.bin/electron-builder --win --config electron-builder.json --publish always
```

On a Windows SDK host, verify the installer before publishing:

```powershell
signtool verify /pa /all /v release/Societyer-<version>-win-<arch>.exe
```

## 5. Build Linux AppImage

Linux AppImage updates work without a platform code-signing certificate. electron-updater still verifies the artifact checksum from the channel YAML, and the GitHub provider downloads over HTTPS. Build on Linux so the AppImage and metadata match the intended architecture:

```sh
export GH_TOKEN="<GitHub token with repository Contents: read/write>"
npm run desktop:build
./node_modules/.bin/electron-builder --linux --config electron-builder.json --publish always
```

The installed app must be running as an AppImage (`APPIMAGE` is set); electron-updater disables AppImage installation otherwise.

## 6. Verify packaged feed configuration and release assets

1. Before publishing, open the packaged resources and confirm `app-update.yml` exists and contains `provider: github`, `owner: ahzs645`, and `repo: societyer`. Typical unpacked locations are:
   - macOS: `Societyer.app/Contents/Resources/app-update.yml`
   - Windows: `win-unpacked/resources/app-update.yml`
   - Linux: `linux-unpacked/resources/app-update.yml`
2. Confirm the generated metadata filename matches the app request:

   | User channel | Version form | Windows | macOS | Linux x64 |
   | --- | --- | --- | --- | --- |
   | stable | `X.Y.Z` | `latest.yml` | `latest-mac.yml` | `latest-linux.yml` |
   | beta | `X.Y.Z-beta.N` | `beta.yml` | `beta-mac.yml` | `beta-linux.yml` |
   | nightly | `X.Y.Z-nightly.N` | `nightly.yml` | `nightly-mac.yml` | `nightly-linux.yml` |

   Non-x64 Linux files add the architecture, for example `latest-linux-arm64.yml`.
3. Open each YAML file and confirm its `version`, artifact URL/name, size, and SHA-512 correspond to files attached to the same GitHub release tag (electron-builder uses `v<package version>` by default).
4. Confirm the macOS metadata points to the ZIP. The configured `dmg` and `zip` targets are both required; the updater installs from the ZIP.
5. Download each attached metadata URL before announcing the release. For example, stable macOS must return HTTP 200:

   ```sh
   curl --fail --location "https://github.com/ahzs645/societyer/releases/download/v<version>/latest-mac.yml"
   ```

   Substitute `beta-mac.yml` or `nightly-mac.yml` for prerelease channels and repeat for Windows/Linux metadata.

## 7. Publish and test the draft

1. The configured `releaseType: draft` intentionally uploads an invisible draft. In GitHub, review that all installers, blockmaps, and channel YAML files are attached to the same draft.
2. Publish stable as a normal release. Publish beta/nightly with **Set as a pre-release** enabled. Drafts are not visible to electron-updater and will produce a feed-resolution error until published.
3. Install the previous signed release on a clean machine, select the intended channel, and exercise **Check updates → Download update → Install and restart**.
4. Confirm the diagnostics panel names the expected metadata file, reports the new version, restarts successfully, and shows the new current version afterward.
5. Repeat on macOS, Windows, and an AppImage launch on Linux. Do not announce the release until all shipped platforms pass.
