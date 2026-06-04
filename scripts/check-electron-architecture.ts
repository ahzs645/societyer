import assert from "node:assert/strict";

import {
  createIdleUpdateState,
  updateCheckFailed,
  updateCheckStarted,
  updateCheckSucceeded,
  updateDownloadFailed,
  updateDownloadProgress,
  updateDownloadStarted,
  updateDownloadSucceeded,
} from "../electron/updateMachine";
import { DESKTOP_CSP_HEADER, desktopSecurityHeadersForContentType } from "../electron/csp";
import {
  contentTypeFor,
  normalizeDesktopProtocolPathname,
  protocolPathFromUrl,
} from "../electron/protocolUtils";

const idle = createIdleUpdateState({
  channel: "stable",
  currentVersion: "1.0.0",
  feedPath: "/tmp/app-update.yml",
  reason: "Update feed configured with github.",
});

const checking = updateCheckStarted(idle);
assert.equal(checking.status, "checking");
assert.equal(checking.error, undefined);

const available = updateCheckSucceeded(checking, "1.1.0");
assert.equal(available.status, "available");
assert.equal(available.availableVersion, "1.1.0");

const downloading = updateDownloadStarted(available);
assert.equal(downloading.status, "downloading");
assert.equal(downloading.downloadPercent, 0);

const progressed = updateDownloadProgress(downloading, 44.6);
assert.equal(progressed.downloadPercent, 45);

const downloaded = updateDownloadSucceeded(progressed);
assert.equal(downloaded.status, "downloaded");
assert.equal(downloaded.downloadedVersion, "1.1.0");
assert.equal(downloaded.downloadPercent, 100);

const failedCheck = updateCheckFailed(idle, "network unavailable");
assert.equal(failedCheck.status, "error");
assert.equal(failedCheck.error, "network unavailable");

const failedDownload = updateDownloadFailed(available, "download failed");
assert.equal(failedDownload.status, "available");
assert.equal(failedDownload.downloadPercent, undefined);

assert.equal(normalizeDesktopProtocolPathname("/assets/index.js"), "assets/index.js");
assert.equal(normalizeDesktopProtocolPathname("/app/settings"), "app/settings");
assert.equal(normalizeDesktopProtocolPathname("/assets/../secrets"), null);
assert.equal(normalizeDesktopProtocolPathname("/assets/%2e%2e/secrets"), "assets/%2e%2e/secrets");

assert.equal(protocolPathFromUrl(new URL("societyer-app://index.html")), "/index.html");
assert.equal(protocolPathFromUrl(new URL("societyer-app://assets/app.js")), "/assets/app.js");
assert.equal(protocolPathFromUrl(new URL("societyer-app:///assets/app.js")), "/assets/app.js");

assert.equal(contentTypeFor("/dist/index.html"), "text/html");
assert.equal(contentTypeFor("/dist/assets/app.mjs"), "text/javascript");
assert.equal(contentTypeFor("/dist/assets/app.css"), "text/css");
assert.equal(contentTypeFor("/dist/assets/icon.webp"), "image/webp");
assert.equal(contentTypeFor("/dist/assets/data.json"), "application/json");

assert.match(DESKTOP_CSP_HEADER, /default-src 'self'/);
assert.match(DESKTOP_CSP_HEADER, /object-src 'none'/);
assert.match(DESKTOP_CSP_HEADER, /frame-ancestors 'none'/);
assert.deepEqual(desktopSecurityHeadersForContentType("text/css"), [
  ["content-type", "text/css"],
  ["x-content-type-options", "nosniff"],
]);
assert.equal(
  desktopSecurityHeadersForContentType("text/html").some(
    ([header]) => header === "content-security-policy",
  ),
  true,
);

console.log("Electron architecture checks passed.");
