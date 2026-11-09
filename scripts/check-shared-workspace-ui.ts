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
const {
  sanitizeHandoffNext, parseHandoffFragment, buildHandoffStartUrl, beginHandoff, issueHandoff, handoffChallenge, createHandoffVerifier,
  createHandoffRedeemer, handoffOutcome, HANDOFF_REQUEST_TTL_MS,
} = await import("../src/lib/sessionHandoff");
const { workspaceOpenRoute, parseDomainWorkspace } = await import("../src/lib/workspaceDomain");
const { saveLinkCode, readLinkCode, clearLinkCode } = await import("../src/pages/account/accountLinkCode");
const { signInOptions, isAccountLinkSignIn } = await import("../src/auth/signInOptions");

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

const source = "https://portal.ddcnorth.com";
const target = "https://first.example";
const challenge = "a".repeat(64);
const parse = (hash: string, origin = target) => parseHandoffFragment(hash, origin);

// Step 1: the switcher only names itself; no code exists yet.
const start = buildHandoffStartUrl({ targetOrigin: `${target}/ignored`, sourceOrigin: `${source}/app/x`, societyId: "k57abc", next: "/app/meetings" });
assert.equal(start.split("#")[0], `${target}/handoff`);
assert.deepEqual(parse(new URL(start).hash), { mode: "begin", from: source, workspace: "k57abc", next: "/app/meetings" });
assert.deepEqual(parse(`#from=${encodeURIComponent(source)}&workspace=bad%20id&next=https://evil.example`), { mode: "begin", from: source, workspace: null, next: "/app" });
for (const from of [target, `${source}/`, `${source}/app`, "https://*.ddcnorth.com", "javascript:alert(1)", "not a url", ""]) {
  assert.equal(parse(`#from=${encodeURIComponent(from)}`), null, `from=${from} is not another exact origin`);
}
// Step 3 request: an exact other origin and a lowercase SHA-256 hex challenge.
assert.deepEqual(parse(`#issue=1&target=${encodeURIComponent(target)}&challenge=${challenge}`, source), { mode: "issue", target, challenge });
for (const bad of [`issue=1&target=${encodeURIComponent(source)}&challenge=${challenge}`, `issue=1&target=${encodeURIComponent(`${target}/x`)}&challenge=${challenge}`,
  `issue=1&target=${encodeURIComponent(target)}&challenge=${challenge.toUpperCase()}`, `issue=1&target=${encodeURIComponent(target)}&challenge=${challenge.slice(1)}`,
  `issue=1&target=${encodeURIComponent(target)}`, `issue=0&target=${encodeURIComponent(target)}&challenge=${challenge}`]) {
  assert.equal(parse(`#${bad}`, source), null, bad);
}
// Step 4 request.
assert.deepEqual(parse("#code=abc_-9"), { mode: "redeem", code: "abc_-9" });
assert.equal(parse("#code=c0de+/="), null, "Codes are base64url");
assert.equal(parse(`#code=${"x".repeat(2000)}`), null);
assert.equal(parse("#workspace=k57abc"), null, "A fragment without a step is rejected");
assert.equal(parse(`#code=abc&from=${encodeURIComponent(source)}`), null, "Steps can't be mixed");
assert.equal(parse(`#issue=1&code=abc&target=${encodeURIComponent(target)}&challenge=${challenge}`, source), null);

// ---------- handoff steps 2 and 3 ----------
const tab = new MemoryStorage();
const begin = { mode: "begin" as const, from: source, workspace: "k57form", next: "/app/bills" };
const issueUrl = new URL(await beginHandoff(begin, { currentOrigin: target, storage: tab, now: 1_000 }));
assert.equal(`${issueUrl.origin}${issueUrl.pathname}`, `${source}/handoff`);
const issueStep = parse(issueUrl.hash, source);
assert.ok(issueStep?.mode === "issue" && issueStep.target === target);
const stored = JSON.parse(tab.getItem("societyer.handoff.request") ?? "null") as { verifier: string; from: string; expiresAt: number };
assert.match(stored.verifier, /^[A-Za-z0-9_-]{43}$/, "32 random bytes, base64url");
assert.equal(issueStep.challenge, await handoffChallenge(stored.verifier), "Only the verifier's hash leaves the tab");
assert.ok(!issueUrl.href.includes(stored.verifier));
assert.deepEqual({ from: stored.from, expiresAt: stored.expiresAt }, { from: source, expiresAt: 1_000 + HANDOFF_REQUEST_TTL_MS });
assert.notEqual(createHandoffVerifier(), createHandoffVerifier());
await assert.rejects(beginHandoff(begin, { currentOrigin: target, storage: null }), "Blocked storage stops the handoff");

const created: Array<{ path: string; body: Record<string, string> }> = [];
const codeUrl = await issueHandoff(issueStep, async (path, options) => {
  created.push({ path, body: options.body });
  return { data: { code: "minted_code", expiresAt: "x" } };
});
assert.deepEqual(created, [{ path: "/societyer-handoff/create", body: { targetOrigin: target, challenge: issueStep.challenge } }]);
assert.equal(codeUrl, `${target}/handoff#code=minted_code`, "The code goes back to the asking target only, with nothing else");
await assert.rejects(issueHandoff(issueStep, async () => ({ error: { status: 401 } })));
await assert.rejects(issueHandoff(issueStep, async () => ({ data: { code: "bad code" } })));

// ---------- handoff redemption (step 4) ----------
type Fetch = Parameters<typeof createHandoffRedeemer>[0]["fetch"];
function redeemer(href: string, result: Awaited<ReturnType<Fetch>> | Error, { basePath = "", storage = tab, now = 2_000 }: { basePath?: string; storage?: InstanceType<typeof MemoryStorage>; now?: number } = {}) {
  const calls: Array<{ path: string; body: Record<string, string> }> = [];
  const remembered: string[] = [];
  const replaced: string[] = [];
  let refreshed = 0;
  const run = createHandoffRedeemer({
    fetch: async (path, options) => {
      calls.push({ path, body: options.body });
      // The fragment and the stored request are gone before the network request is made.
      assert.ok(replaced.length === 1 && !replaced[0].includes("#"), "Fragment stripped before redeeming");
      assert.equal(storage.getItem("societyer.handoff.request"), null, "Request removed before redeeming");
      if (result instanceof Error) throw result;
      return result;
    },
    refreshSession: () => { refreshed += 1; },
    rememberWorkspace: (id) => remembered.push(id),
  }, { href: () => href, replace: (next) => replaced.push(next.href), basePath, storage: () => storage, now: () => now });
  return { run, calls, remembered, replaced, refreshed: () => refreshed };
}
const requestBefore = tab.getItem("societyer.handoff.request");
// Workspace and next come from this tab's request, never from the code link.
const ok = redeemer(`${target}/handoff#code=abc&workspace=k57evil&next=%2Fapp%2Fevil`, { data: { redeemed: true } });
await ok.run();
assert.deepEqual(ok.calls, [{ path: "/societyer-handoff/redeem", body: { code: "abc", verifier: stored.verifier } }]);
assert.deepEqual(ok.replaced, [`${target}/handoff`]);
assert.deepEqual(ok.remembered, ["k57form"]);
assert.equal(ok.refreshed(), 1);
assert.deepEqual(handoffOutcome(), { status: "redeemed", workspace: "k57form", next: "/app/bills" });

// A code this tab never asked for (login CSRF), a second use, or a stale request: refused without calling redeem.
const planted = redeemer(`${target}/handoff#code=attacker`, { data: { redeemed: true } });
await planted.run();
assert.deepEqual(planted.calls, [], "No request in this tab: never redeemed");
assert.deepEqual(planted.replaced, [`${target}/handoff`], "Still stripped");
assert.deepEqual(handoffOutcome(), { status: "failed", next: "/app" });
tab.setItem("societyer.handoff.request", requestBefore ?? "");
const stale = redeemer(`${target}/handoff#code=abc`, { data: {} }, { now: 1_000 + HANDOFF_REQUEST_TTL_MS });
await stale.run();
assert.deepEqual(stale.calls, [], "Expired request: never redeemed");
assert.equal(tab.getItem("societyer.handoff.request"), null, "An expired request is discarded");
for (const corrupt of ["{", JSON.stringify({ ...stored, verifier: "short" }), JSON.stringify({ ...stored, from: "https://x.example/app" })]) {
  tab.setItem("societyer.handoff.request", corrupt);
  const run = redeemer(`${target}/handoff#code=abc`, { data: {} });
  await run.run();
  assert.deepEqual(run.calls, [], `Corrupt request ${corrupt.slice(0, 20)} is refused`);
}

tab.setItem("societyer.handoff.request", requestBefore ?? "");
const failed = redeemer(`${target}/handoff#code=used`, { error: { status: 403, message: "Wrong verifier" } });
await failed.run();
assert.deepEqual(failed.remembered, [], "A failed redeem selects nothing");
assert.deepEqual(handoffOutcome(), { status: "failed", next: "/app/bills" });
assert.equal(tab.getItem("societyer.handoff.request"), null, "A failed redeem can't be retried");
tab.setItem("societyer.handoff.request", requestBefore ?? "");
const thrown = redeemer(`${target}/handoff#code=abc`, new TypeError("Failed to fetch"));
await thrown.run();
assert.equal(handoffOutcome()?.status, "failed");

// Steps 2 and 3 are left to the page; nothing is redeemed or stored.
const beginLoad = redeemer(`${target}/handoff#from=${encodeURIComponent(source)}&workspace=k57form`, { data: {} });
await beginLoad.run();
assert.deepEqual(beginLoad.calls, []);
assert.deepEqual(beginLoad.replaced, [`${target}/handoff`], "Step fragments are stripped too");
assert.deepEqual(handoffOutcome(), { status: "step", step: { mode: "begin", from: source, workspace: "k57form", next: "/app" } });
const selfBegin = redeemer(`${target}/handoff#from=${encodeURIComponent(target)}`, { data: {} });
await selfBegin.run();
assert.deepEqual(handoffOutcome(), { status: "failed", next: "/app" }, "A handoff from this same origin is refused");

tab.setItem("societyer.handoff.request", requestBefore ?? "");
const elsewhere = redeemer(`${target}/app#code=abc`, { data: {} });
await elsewhere.run();
assert.deepEqual(elsewhere.calls, [], "Only /handoff redeems");
assert.deepEqual(elsewhere.replaced, [], "Other pages keep their fragment");
const based = redeemer(`${target}/base/handoff#code=abc`, { data: {} }, { basePath: "/base" });
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

// ---------- which sign-in options /login shows ----------
// LINK_SIGN_IN_PATH (src/pages/account/accountPage.ts) is `/login?linkAccount=1&redirect=%2Faccount%2Flink%2Fconfirm`.
assert.equal(isAccountLinkSignIn("1", "/account/link/confirm"), true, "Second login of a link");
assert.equal(isAccountLinkSignIn(null, "/account/link"), true, "Fresh re-sign-in of the first login");
assert.equal(isAccountLinkSignIn(null, "/account/link/confirm?x=1"), true);
assert.equal(isAccountLinkSignIn(null, "/app"), false);
assert.equal(isAccountLinkSignIn("0", "/account/linked"), false);
const ddcDomain = { domainRequiresMicrosoft: true, deploymentRequiresMicrosoft: false };
const passwordAllowed = { microsoftRequired: false, password: true, passwordForLinking: false };
const microsoftOnly = { microsoftRequired: true, password: false, passwordForLinking: false };
assert.deepEqual(signInOptions({ ...ddcDomain, linking: false }), microsoftOnly, "Microsoft-only domain outside the link flow");
assert.deepEqual(signInOptions({ ...ddcDomain, linking: true }), { microsoftRequired: true, password: true, passwordForLinking: true }, "Linking a password login on portal.ddcnorth.com");
assert.deepEqual(signInOptions({ ...ddcDomain, deploymentRequiresMicrosoft: true, linking: true }), microsoftOnly, "Deployment-wide required SSO refuses /sign-in/email: no form");
assert.deepEqual(signInOptions({ ...ddcDomain, deploymentRequiresMicrosoft: undefined, linking: true }), microsoftOnly, "Not until capabilities load");
assert.deepEqual(signInOptions({ domainRequiresMicrosoft: false, deploymentRequiresMicrosoft: false, linking: false }), passwordAllowed);
assert.deepEqual(signInOptions({ domainRequiresMicrosoft: false, deploymentRequiresMicrosoft: undefined, linking: true }), passwordAllowed, "Other domains unchanged while loading");
assert.deepEqual(signInOptions({ domainRequiresMicrosoft: false, deploymentRequiresMicrosoft: true, linking: true }), microsoftOnly);

console.log("Shared workspace UI passed: startup rules 1-4 and unmapped fallback; pending choice once with expiry; handoff next sanitizing, step parsing, destination-initiated verifier/challenge, redemption only for this tab's own request; switcher same-origin vs handoff; domain result parsing; link code storage; sign-in options (password on a Microsoft-only domain only for linking, and only when the deployment allows it).");
