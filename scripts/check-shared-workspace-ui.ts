/** Pure frontend rules for shared workspaces: startup choice, handoff URLs, switcher routing, link code storage. */
import assert from "node:assert/strict";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
Object.assign(globalThis, { sessionStorage: new MemoryStorage() });

const { chooseStartupWorkspace, rememberStartupWorkspace, takeStartupWorkspace } = await import("../src/auth/startupWorkspace");
const { sanitizeHandoffNext, parseHandoffFragment, buildHandoffUrl, createHandoffRedeemer, handoffOutcome } = await import("../src/lib/sessionHandoff");
const { workspaceOpenRoute, parseDomainWorkspace } = await import("../src/lib/workspaceDomain");
const { saveLinkCode, readLinkCode, clearLinkCode } = await import("../src/pages/account/accountLinkCode");

// ---------- chooseStartupWorkspace ----------
const ddc = { societyId: "ddc", workspaceName: "DDC North", origin: "https://portal.ddcnorth.com", signIn: { requiredMethod: "microsoft" as const } };
const lockedDdc = { id: "ddc", name: "DDC North", reason: "microsoft" as const };
const lockedForm = { id: "form", name: "First Form", reason: "email-domain" as const };
const both = [{ societyId: "form" }, { societyId: "ddc" }];
const choose = (input: Partial<Parameters<typeof chooseStartupWorkspace>[0]>) => chooseStartupWorkspace({
  memberships: [], lockedWorkspaces: [], domainWorkspace: null, ...input,
});

// Rule 1: an explicit choice wins, open or locked, but only for the person's own workspaces.
assert.deepEqual(choose({ memberships: both, domainWorkspace: ddc, explicitSocietyId: "form" }), { kind: "open", societyId: "form" });
assert.deepEqual(choose({ memberships: [{ societyId: "form" }], lockedWorkspaces: [lockedDdc], explicitSocietyId: "ddc" }), { kind: "locked", workspace: lockedDdc });
assert.deepEqual(choose({ memberships: both, domainWorkspace: ddc, explicitSocietyId: "foreign" }), { kind: "open", societyId: "ddc" }, "An unknown explicit ID falls through");
// Rule 2: the mapped workspace opens, ahead of the remembered one.
assert.deepEqual(choose({ memberships: both, domainWorkspace: ddc, rememberedSocietyId: "form" }), { kind: "open", societyId: "ddc" });
// Rule 3: a locked mapped workspace shows its lock screen, never another org.
assert.deepEqual(choose({ memberships: [{ societyId: "form" }], lockedWorkspaces: [lockedDdc], domainWorkspace: ddc, rememberedSocietyId: "form" }), { kind: "locked", workspace: lockedDdc });
// Rule 4: no membership there means "no access here", even with other workspaces.
assert.deepEqual(choose({ memberships: [{ societyId: "form" }], domainWorkspace: ddc, rememberedSocietyId: "form" }), { kind: "no-access-here", domainWorkspace: ddc });
assert.deepEqual(choose({ lockedWorkspaces: [lockedForm], domainWorkspace: ddc }), { kind: "no-access-here", domainWorkspace: ddc });
assert.deepEqual(choose({ domainWorkspace: ddc }), { kind: "none" }, "Nothing at all: the invitation/onboarding path");
// Unmapped origin: remembered, else first; locked only when nothing opens.
assert.deepEqual(choose({ memberships: both, rememberedSocietyId: "ddc" }), { kind: "open", societyId: "ddc" });
assert.deepEqual(choose({ memberships: both, rememberedSocietyId: "foreign" }), { kind: "open", societyId: "form" });
assert.deepEqual(choose({ lockedWorkspaces: [lockedForm, lockedDdc], rememberedSocietyId: "ddc" }), { kind: "locked", workspace: lockedDdc });
assert.deepEqual(choose({ lockedWorkspaces: [lockedForm, lockedDdc] }), { kind: "locked", workspace: lockedForm });
assert.deepEqual(choose({}), { kind: "none" });

// Pending explicit choice survives one load, once, and expires.
rememberStartupWorkspace("ddc", 1_000);
assert.equal(takeStartupWorkspace(2_000), "ddc");
assert.equal(takeStartupWorkspace(2_000), null, "Consumed once");
rememberStartupWorkspace("ddc", 1_000);
assert.equal(takeStartupWorkspace(1_000 + 11 * 60_000), null, "Expires after 10 minutes");

// ---------- handoff next / fragment ----------
assert.equal(sanitizeHandoffNext("/app/meetings?tab=past#top"), "/app/meetings?tab=past#top");
assert.equal(sanitizeHandoffNext("/app"), "/app");
for (const unsafe of [null, "", "/application", "/login", "//evil.example/app", "https://evil.example/app", "/\\evil", "/app\u0000x", "javascript:alert(1)", "/app/../login"]) {
  const safe = sanitizeHandoffNext(unsafe);
  assert.ok(safe === "/app" || safe.startsWith("/app/"), `${String(unsafe)} -> ${safe}`);
}
assert.equal(sanitizeHandoffNext("/app/../login"), "/app", "Normalised paths are rechecked");

const url = buildHandoffUrl({ targetOrigin: "https://portal.ddcnorth.com/ignored", code: "c0de+/=", societyId: "k57abc", next: "/app/meetings" });
assert.equal(url.split("#")[0], "https://portal.ddcnorth.com/handoff");
assert.deepEqual(parseHandoffFragment(new URL(url).hash), { code: "c0de+/=", workspace: "k57abc", next: "/app/meetings" });
assert.deepEqual(parseHandoffFragment("#code=x&workspace=bad%20id&next=https://evil.example"), { code: "x", workspace: null, next: "/app" });
assert.equal(parseHandoffFragment("#workspace=k57abc"), null, "A fragment without a code is rejected");
assert.equal(parseHandoffFragment(`#code=${"x".repeat(2000)}`), null);

// ---------- handoff redemption ----------
type Fetch = Parameters<typeof createHandoffRedeemer>[0]["fetch"];
function redeemer(href: string, result: Awaited<ReturnType<Fetch>> | Error, basePath = "") {
  const calls: Array<{ path: string; code: string }> = [];
  const remembered: string[] = [];
  const replaced: string[] = [];
  let refreshed = 0;
  const run = createHandoffRedeemer({
    fetch: async (path, options) => {
      calls.push({ path, code: options.body.code });
      // The fragment is gone before the network request is made.
      assert.ok(replaced.length === 1 && !replaced[0].includes("#"), "Fragment stripped before redeeming");
      if (result instanceof Error) throw result;
      return result;
    },
    refreshSession: () => { refreshed += 1; },
    rememberWorkspace: (id) => remembered.push(id),
  }, { href: () => href, replace: (next) => replaced.push(next.href), basePath });
  return { run, calls, remembered, replaced, refreshed: () => refreshed };
}
const ok = redeemer("https://first.example/handoff#code=abc&workspace=k57form&next=%2Fapp%2Fbills", { data: { status: true } });
await ok.run();
assert.deepEqual(ok.calls, [{ path: "/societyer-handoff/redeem", code: "abc" }]);
assert.deepEqual(ok.replaced, ["https://first.example/handoff"]);
assert.deepEqual(ok.remembered, ["k57form"]);
assert.equal(ok.refreshed(), 1);
assert.deepEqual(handoffOutcome(), { status: "redeemed", workspace: "k57form", next: "/app/bills" });

const failed = redeemer("https://first.example/handoff#code=used&workspace=k57form", { error: { status: 400, message: "Invalid code" } });
await failed.run();
assert.deepEqual(failed.remembered, [], "A failed redeem selects nothing");
assert.deepEqual(handoffOutcome(), { status: "failed", next: "/app" });
const thrown = redeemer("https://first.example/handoff#code=abc", new TypeError("Failed to fetch"));
await thrown.run();
assert.equal(handoffOutcome()?.status, "failed");

const elsewhere = redeemer("https://first.example/app#code=abc", { data: {} });
await elsewhere.run();
assert.deepEqual(elsewhere.calls, [], "Only /handoff redeems");
assert.deepEqual(elsewhere.replaced, [], "Other pages keep their fragment");
const based = redeemer("https://first.example/base/handoff#code=abc", { data: {} }, "/base");
await based.run();
assert.equal(based.calls.length, 1, "Honours the build's base path");

// ---------- switcher: same origin vs handoff ----------
const here = { kind: "here" };
assert.deepEqual(workspaceOpenRoute({ currentOrigin: "https://portal.ddcnorth.com", currentOriginMapped: true, canonicalOrigin: "https://societyer-firstform.pages.dev" }), { kind: "handoff", targetOrigin: "https://societyer-firstform.pages.dev" });
assert.deepEqual(workspaceOpenRoute({ currentOrigin: "https://portal.ddcnorth.com", currentOriginMapped: true, canonicalOrigin: "https://portal.ddcnorth.com" }), here);
assert.deepEqual(workspaceOpenRoute({ currentOrigin: "https://portal.ddcnorth.com", currentOriginMapped: true }), here, "No canonical origin: switch in place");
assert.deepEqual(workspaceOpenRoute({ currentOrigin: "http://localhost:5173", currentOriginMapped: false, canonicalOrigin: "https://portal.ddcnorth.com" }), here, "Unmapped origins keep switching in place");
assert.deepEqual(workspaceOpenRoute({ currentOrigin: "https://portal.ddcnorth.com", currentOriginMapped: true, canonicalOrigin: "javascript:alert(1)" }), here);
assert.deepEqual(workspaceOpenRoute({ currentOrigin: "https://portal.ddcnorth.com", currentOriginMapped: true, canonicalOrigin: "not a url" }), here);

// ---------- resolveOrigin result ----------
assert.equal(parseDomainWorkspace(null), null);
assert.equal(parseDomainWorkspace({ workspaceName: "x" }), null);
assert.deepEqual(parseDomainWorkspace({ societyId: "s", workspaceName: "DDC", origin: "https://d.example", logoUrl: "", signIn: { requiredMethod: "microsoft", supportEmail: "help@d.example" } }),
  { societyId: "s", workspaceName: "DDC", origin: "https://d.example", logoUrl: undefined, logoDarkUrl: undefined, signIn: { requiredMethod: "microsoft", supportEmail: "help@d.example" } });
assert.equal(parseDomainWorkspace({ societyId: "s", workspaceName: "F", origin: "https://f.example" })?.signIn.requiredMethod, "any");

// ---------- link code ----------
const now = Date.parse("2026-11-08T12:00:00Z");
saveLinkCode({ code: "link-code", expiresAtISO: "2026-11-08T12:10:00Z" });
assert.deepEqual(readLinkCode(now), { code: "link-code", expiresAtISO: "2026-11-08T12:10:00Z" });
assert.equal(readLinkCode(now + 11 * 60_000), null, "Expired codes are dropped");
assert.equal(sessionStorage.getItem("societyer.accountLink.code"), null);
saveLinkCode({ code: "link-code", expiresAtISO: "2026-11-08T12:10:00Z" });
clearLinkCode();
assert.equal(readLinkCode(now), null);

console.log("Shared workspace UI passed: startup rules 1-4 and unmapped fallback; pending choice once with expiry; handoff next sanitizing, fragment parsing and redemption; switcher same-origin vs handoff; domain result parsing; link code storage.");
