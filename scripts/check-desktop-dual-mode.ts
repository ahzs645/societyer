import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IpcMainInvokeEvent, WebContents } from "electron";
import {
  isAllowedHostedNavigation,
  isTrustedLocalRendererUrl,
  normalizeHostedConfiguration,
  normalizeHostedOrigin,
} from "../electron/desktopModePolicy";
import { assertLocalRendererAuthority, registerLocalRendererAuthority } from "../electron/ipcAuthority";

const hosted = normalizeHostedConfiguration({ origin: "https://app.example/app", authenticationOrigins: [
  "https://login.microsoftonline.com", "https://clerk.example", "https://clerk.example/", "https://app.example",
] });
assert.deepEqual(hosted, { origin: "https://app.example", authenticationOrigins: ["https://login.microsoftonline.com", "https://clerk.example"] });
for (const invalid of ["http://app.example", "societyer-app://index.html", "javascript:alert(1)",
  "https://user:password@app.example", "https://*.example", "https://app.example/?token=private", "https://app.example/#session", "https://app.example/custom"]) {
  assert.throws(() => normalizeHostedOrigin(invalid));
}
assert.throws(() => normalizeHostedConfiguration({ origin: "https://app.example", authenticationOrigins: Array(6).fill("https://auth.example") }));
assert.equal(isAllowedHostedNavigation("https://app.example/api/auth/callback?code=example", hosted), true);
assert.equal(isAllowedHostedNavigation("https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize", hosted), true);
for (const url of ["https://app.example.evil.test", "https://other.example", "http://app.example", "file:///tmp/private", "societyer-app://index.html", "https://password@app.example"]) {
  assert.equal(isAllowedHostedNavigation(url, hosted), false);
}
assert.equal(isTrustedLocalRendererUrl("societyer-app://index.html/#/app"), true);
assert.equal(isTrustedLocalRendererUrl("societyer-app://other-host/#/app"), false);
assert.equal(isTrustedLocalRendererUrl("https://app.example"), false);
assert.equal(isTrustedLocalRendererUrl("http://127.0.0.1:55173/#/app", "http://127.0.0.1:55173"), true);
assert.equal(isTrustedLocalRendererUrl("http://127.0.0.1:55174", "http://127.0.0.1:55173"), false);

function renderer(id: number, initialUrl: string) {
  let url = initialUrl;
  const contents = Object.assign(new EventEmitter(), {
    id, mainFrame: { url: initialUrl }, getURL: () => url,
  });
  return { contents, navigate: (next: string) => { url = next; contents.mainFrame.url = next; } };
}
const local = renderer(1, "societyer-app://index.html/#/app");
registerLocalRendererAuthority(local.contents as unknown as WebContents);
const localEvent = () => ({ sender: local.contents, senderFrame: local.contents.mainFrame }) as unknown as IpcMainInvokeEvent;
assert.doesNotThrow(() => assertLocalRendererAuthority(localEvent()));
assert.throws(() => assertLocalRendererAuthority({ ...localEvent(), senderFrame: { url: "societyer-app://index.html" } } as unknown as IpcMainInvokeEvent));
assert.throws(() => assertLocalRendererAuthority({ ...localEvent(), senderFrame: null } as unknown as IpcMainInvokeEvent));
const remote = renderer(2, "https://app.example");
assert.throws(() => assertLocalRendererAuthority({ sender: remote.contents, senderFrame: remote.contents.mainFrame } as unknown as IpcMainInvokeEvent));
local.navigate("https://app.example");
assert.throws(() => assertLocalRendererAuthority(localEvent()));
local.navigate("societyer-app://index.html");
local.contents.emit("destroyed");
assert.throws(() => assertLocalRendererAuthority(localEvent()));
const dev = renderer(3, "http://127.0.0.1:55173");
registerLocalRendererAuthority(dev.contents as unknown as WebContents, "http://127.0.0.1:55173");
const devEvent = () => ({ sender: dev.contents, senderFrame: dev.contents.mainFrame }) as unknown as IpcMainInvokeEvent;
assert.doesNotThrow(() => assertLocalRendererAuthority(devEvent()));
dev.navigate("http://127.0.0.1:55174");
assert.throws(() => assertLocalRendererAuthority(devEvent()));
console.log("Desktop dual-mode HTTPS, SSO navigation, local-origin and native IPC authority checks passed.");
