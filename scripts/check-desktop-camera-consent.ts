import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import type { Session, WebContents } from "electron";
import { installCameraPermissions } from "../electron/mediaPermissions";

const origin = "https://app.example";
function fixture(renderer: { kind: "hosted"; origin: string } | { kind: "local"; devOrigin?: string } = { kind: "hosted", origin }) {
  const initialUrl = renderer.kind === "hosted" ? `${origin}/app` : renderer.devOrigin ?? "societyer-app://index.html/#/app";
  let url = initialUrl, dead = false;
  const contents = Object.assign(new EventEmitter(), { getURL: () => url, isDestroyed: () => dead });
  let request: Parameters<Session["setPermissionRequestHandler"]>[0];
  let check: Parameters<Session["setPermissionCheckHandler"]>[0];
  let promptCount = 0;
  let resolveConsent: ((allowed: boolean) => void) | undefined;
  const session = {
    setPermissionRequestHandler: (handler: typeof request) => { request = handler; },
    setPermissionCheckHandler: (handler: typeof check) => { check = handler; },
  };
  const revoke = installCameraPermissions(session as Session, contents as unknown as WebContents, renderer, () => {
    promptCount += 1;
    return new Promise<boolean>((resolve) => { resolveConsent = resolve; });
  });
  const details = { isMainFrame: true, requestingUrl: initialUrl, securityOrigin: renderer.kind === "hosted" ? origin : initialUrl, mediaTypes: ["video"] as Array<"video" | "audio"> };
  const ask = (overrides = {}, sender = contents, permission = "media") => {
    let callbacks = 0;
    const result = new Promise<boolean>((resolve) => request!(sender as unknown as WebContents, permission as "media", (value) => { callbacks += 1; resolve(value); }, { ...details, ...overrides }));
    return { result, callbacks: () => callbacks };
  };
  const allowed = (overrides = {}, sender = contents, permission = "media") => check!(sender as unknown as WebContents, permission as "media", details.securityOrigin, { ...details, mediaType: "video", ...overrides });
  return { contents, ask, allowed, revoke, consent: (value: boolean) => resolveConsent!(value), prompts: () => promptCount,
    navigate(next: string) { url = next; contents.emit("did-start-navigation", {}, next, false, true); },
    destroy() { dead = true; contents.emit("destroyed"); } };
}
let groups = 0;
const cases: Array<{ name: string; passed: true }> = [];
async function group(name: string, test: () => Promise<void>) { await test(); groups += 1; cases.push({ name, passed: true }); console.log(`PASS ${name}`); }
await group("Camera defaults denied; explicit main-app approval enables video only", async () => {
  const f = fixture(); assert.equal(f.allowed(), false);
  const pending = f.ask(); assert.equal(f.prompts(), 1); assert.equal(f.allowed(), false);
  f.consent(true); assert.equal(await pending.result, true); assert.equal(f.allowed(), true);
  assert.equal(f.allowed({ mediaType: "audio" }), false); assert.equal(f.allowed({ mediaType: "unknown" }), false);
  assert.equal(await f.ask({ mediaTypes: ["audio"] }).result, false);
  assert.equal(await f.ask({ mediaTypes: ["audio", "video"] }).result, false);
  assert.equal(await f.ask({ mediaTypes: [] }).result, false);
  assert.equal(await f.ask({}, f.contents, "display-capture").result, false);
  assert.equal(await f.ask({}, f.contents, "notifications").result, false);
});
await group("SSO popups, callbacks, frames and lookalike origins cannot request or reuse grant", async () => {
  const f = fixture(); const initial = f.ask(); f.consent(true); await initial.result;
  const popup = Object.assign(new EventEmitter(), { getURL: () => `${origin}/api/auth/callback`, isDestroyed: () => false });
  assert.equal(await f.ask({}, popup).result, false); assert.equal(f.allowed({}, popup), false);
  for (const override of [{ isMainFrame: false }, { requestingUrl: "https://login.microsoftonline.com" },
    { requestingUrl: "https://app.example.evil.test" }, { securityOrigin: "https://clerk.example" }, { requestingUrl: "https://user@app.example" }]) {
    assert.equal(await f.ask(override).result, false); assert.equal(f.allowed(override), false);
  }
  assert.equal(f.prompts(), 1);
});
await group("Denial and concurrent requests settle once without persisting a grant", async () => {
  const f = fixture(); const first = f.ask(), second = f.ask(); assert.equal(f.prompts(), 1);
  f.consent(false); assert.equal(await first.result, false); assert.equal(await second.result, false);
  assert.equal(first.callbacks(), 1); assert.equal(second.callbacks(), 1); assert.equal(f.allowed(), false);
});
await group("Revoke, replacement/failure and renderer destruction reject pending consent", async () => {
  for (const dispose of [(f: ReturnType<typeof fixture>) => f.revoke(), (f: ReturnType<typeof fixture>) => f.destroy()]) {
    const f = fixture(); const pending = f.ask(); dispose(f);
    assert.equal(await pending.result, false); f.consent(true); await Promise.resolve();
    assert.equal(pending.callbacks(), 1); assert.equal(f.allowed(), false);
    assert.equal(await f.ask().result, false);
  }
});
await group("Navigating to sign-in or another document invalidates old and pending grants", async () => {
  const f = fixture(); const pending = f.ask(); f.navigate("https://clerk.example/sign-in");
  assert.equal(await pending.result, false); f.consent(true); await Promise.resolve(); assert.equal(f.allowed(), false);
  f.navigate(`${origin}/app`); const next = f.ask(); f.consent(true); assert.equal(await next.result, true);
  f.navigate(`${origin}/app/assets`); assert.equal(f.allowed(), false);
});
await group("Trusted bundled and exact development renderers use consent; reset revokes without losing records", async () => {
  for (const renderer of [{ kind: "local" } as const, { kind: "local", devOrigin: "http://127.0.0.1:55173" } as const]) {
    const f = fixture(renderer); const first = f.ask(); f.consent(true); assert.equal(await first.result, true);
    f.revoke.reset(); assert.equal(f.allowed(), false);
    const next = f.ask(); f.consent(true); assert.equal(await next.result, true);
    for (const requestingUrl of ["societyer-app://other-host/#/app", "https://app.example", "http://127.0.0.1:55174"]) {
      assert.equal(await f.ask({ requestingUrl }).result, false);
    }
  }
});
await group("Only trusted main frames may copy sanitized text; clipboard reads and popup/frame writes stay denied", async () => {
  const f = fixture();
  assert.equal(f.allowed({}, f.contents, "clipboard-sanitized-write"), true);
  assert.equal(await f.ask({}, f.contents, "clipboard-sanitized-write").result, true);
  for (const permission of ["clipboard-read", "deprecated-sync-clipboard-read"]) {
    assert.equal(f.allowed({}, f.contents, permission), false);
    assert.equal(await f.ask({}, f.contents, permission).result, false);
  }
  assert.equal(f.allowed({ isMainFrame: false }, f.contents, "clipboard-sanitized-write"), false);
  assert.equal(await f.ask({ isMainFrame: false }, f.contents, "clipboard-sanitized-write").result, false);
  const popup = Object.assign(new EventEmitter(), { getURL: () => `${origin}/app`, isDestroyed: () => false });
  assert.equal(f.allowed({}, popup, "clipboard-sanitized-write"), false);
  assert.equal(await f.ask({}, popup, "clipboard-sanitized-write").result, false);
  f.revoke(); assert.equal(f.allowed({}, f.contents, "clipboard-sanitized-write"), false);
});
console.log(`Desktop camera consent policy passed (${groups}/${groups} groups).`);
await mkdir("artifacts/offline", { recursive: true });
await writeFile("artifacts/offline/desktop-camera-consent.json", `${JSON.stringify({ kind: "actual-permission-controller-with-deterministic-session-fixtures", cases,
  limits: ["Policy checks do not exercise actual OS/device permissions; see separate Electron runtime qualification"] }, null, 2)}\n`);
