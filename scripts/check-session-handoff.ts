/**
 * Cross-domain session handoff on the real Better Auth engine, with the
 * production createAuth options (trusted origins, throttle hooks and the
 * handoff + cross-domain plugins). Only persistence is swapped for SQLite.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { getCookie, getSetCookie } from "@convex-dev/better-auth/client/plugins";
import { SESSION_HANDOFF_REDEEM, SESSION_HANDOFF_TTL_MS, sessionHandoffIdentifier } from "../shared/sessionHandoff";

const authOrigin = "https://handoff-fixture.convex.site";
const ddc = "https://portal.ddc.example.test";
const firstForm = "https://firstform.example.test";
const evil = "https://evil.example.test";
const savedEnv = { ...process.env };
Object.assign(process.env, {
  AUTH_MODE: "convex", VITE_AUTH_MODE: "convex", CONVEX_SITE_URL: authOrigin, SITE_URL: `${ddc},${firstForm}`,
  BETTER_AUTH_SECRET: "synthetic-session-handoff-secret-0000000000000000",
});
for (const key of ["SOCIETYER_AUTH_ALLOWED_EMAIL_DOMAINS", "SOCIETYER_AUTH_MANUAL_PROVISIONING", "SOCIETYER_ENTRA_LOGIN", "SOCIETYER_ENTRA_SSO_REQUIRED", "RESEND_API_KEY", "SOCIETYER_EMAIL_PROVIDER", "SOCIETYER_AUTH_DEVELOPMENT_MAIL"]) delete process.env[key];

const database = new DatabaseSync(":memory:");
try {
  const throttled: string[] = [];
  let throttleOpen = true;
  const convexCtx = {
    meta: { getRequestMetadata: async () => ({ ip: "203.0.113.7" }) },
    runMutation: async (_ref: unknown, args: { buckets?: Array<{ key: string }> }) => {
      if (!args.buckets) return null;
      throttled.push(...args.buckets.map((bucket) => bucket.key));
      return throttleOpen ? { ok: true, retryAfterMs: 0 } : { ok: false, retryAfterMs: 120_000 };
    },
  };
  const { createAuth } = await import("../convex/hostedAuth");
  const configured = createAuth(convexCtx as never);
  const plugins = (configured.options.plugins ?? []).filter((plugin) => ["societyer-session-handoff", "cross-domain"].includes(plugin.id));
  assert.deepEqual(plugins.map((plugin) => plugin.id), ["societyer-session-handoff", "cross-domain"], "createAuth registers the handoff plugin with the cross-domain transport");
  const auth = betterAuth({ ...configured.options, database, plugins, logger: { disabled: true } });
  await (await getMigrations(auth.options)).runMigrations();
  const context = await auth.$context;

  // Each origin keeps its own cross-domain cookie store, as the browser client does in localStorage.
  const stores: Record<string, string> = { [ddc]: "{}", [firstForm]: "{}", [evil]: "{}" };
  async function call(origin: string | null, path: string, body: unknown, { cookie = true }: { cookie?: boolean } = {}) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (origin) headers.Origin = origin;
    if (cookie) headers["Better-Auth-Cookie"] = getCookie(stores[origin ?? ddc] ?? "{}");
    const response = await auth.handler(new Request(`${authOrigin}/api/auth${path}`, { method: "POST", headers, body: JSON.stringify(body) }));
    const delivered = response.headers.get("set-better-auth-cookie");
    if (delivered && origin && origin in stores) stores[origin] = getSetCookie(delivered, stores[origin]);
    return response;
  }
  // The target tab's verifier and the challenge (its SHA-256) the source binds the code to.
  const newVerifier = () => randomBytes(32).toString("base64url");
  const challengeOf = (verifier: string) => createHash("sha256").update(verifier).digest("hex");
  const anyChallenge = challengeOf(newVerifier());
  const create = (origin: string | null, targetOrigin: string, options?: { cookie?: boolean; challenge?: string | null }) => call(origin, "/societyer-handoff/create",
    options?.challenge === null ? { targetOrigin } : { targetOrigin, challenge: options?.challenge ?? anyChallenge }, options);
  const redeem = (origin: string | null, code: string, verifier: string | null, options?: { cookie?: boolean }) => call(origin, SESSION_HANDOFF_REDEEM,
    verifier === null ? { code } : { code, verifier }, options);
  const sessionTokenIn = (store: string) => /session_token=([^.;]+)/.exec(getCookie(store))?.[1];

  // Unauthenticated callers can't start a handoff.
  assert.equal((await create(ddc, firstForm)).status, 401, "create requires a session");

  const signUp = await call(ddc, "/sign-up/email", { name: "Handoff person", email: "handoff@example.test", password: "synthetic-handoff-password", callbackURL: `${ddc}/app` });
  assert.equal(signUp.status, 200, await signUp.clone().text());
  const sourceToken = sessionTokenIn(stores[ddc]);
  assert.ok(sourceToken, "sign-in delivered the DDC session through the cross-domain header");
  const user = (await context.internalAdapter.findUserByEmail("handoff@example.test"))!.user;
  const sourceSession = (await context.internalAdapter.findSession(sourceToken!))!.session;

  // Destination checks.
  assert.equal((await create(ddc, evil)).status, 403, "untrusted destination");
  assert.equal((await create(ddc, authOrigin)).status, 403, "Better Auth trusts its own origin, but it is not an app origin");
  assert.equal((await create(ddc, `${firstForm}/app`)).status, 403, "destination must be an exact origin");
  assert.equal((await create(ddc, ddc)).status, 400, "destination must differ from the source");
  assert.equal((await create(null, firstForm)).status, 403, "no Origin header: not a browser on a trusted origin");
  stores[evil] = stores[ddc];
  assert.equal((await create(evil, firstForm)).status, 403, "a stolen cookie replayed from an untrusted origin can't start a handoff");

  // The challenge is required and must be a lowercase SHA-256 hex digest.
  assert.equal((await create(ddc, firstForm, { challenge: null })).status, 400, "missing challenge");
  for (const malformed of ["", anyChallenge.toUpperCase(), anyChallenge.slice(1), `${anyChallenge}0`, `${anyChallenge.slice(1)}g`, newVerifier()]) {
    assert.equal((await create(ddc, firstForm, { challenge: malformed })).status, 400, `malformed challenge ${malformed}`);
  }

  async function issue() {
    const verifier = newVerifier();
    const response = await create(ddc, firstForm, { challenge: challengeOf(verifier) });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get("set-better-auth-cookie"), null, "create never re-delivers the session");
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json() as { code: string; expiresAt: string };
    assert.deepEqual(Object.keys(body).sort(), ["code", "expiresAt"], "create returns only the code and its expiry");
    assert.ok(!JSON.stringify(body).includes(sourceToken!), "no session token in the create response");
    assert.ok(new Date(body.expiresAt).getTime() - Date.now() <= SESSION_HANDOFF_TTL_MS);
    return { code: body.code, verifier };
  }

  // Only the hash is stored, and nothing stored contains the code or exposes it in a URL.
  const { code, verifier } = await issue();
  assert.match(code, /^[A-Za-z0-9_-]{43}$/);
  const verificationRows = database.prepare("select identifier, value, expiresAt from verification").all() as Array<{ identifier: string; value: string; expiresAt: string | number }>;
  const identifier = await sessionHandoffIdentifier(code);
  const stored = verificationRows.find((row) => row.identifier === identifier);
  assert.ok(stored, "the verification row is keyed by SHA-256 of the code");
  assert.match(stored.identifier, /^societyer-handoff:[a-f0-9]{64}$/);
  assert.ok(verificationRows.every((row) => !row.identifier.includes(code) && !row.value.includes(code)), "the code itself is never stored");
  assert.ok(verificationRows.every((row) => !row.value.includes(verifier)), "the verifier is never stored, only its hash");
  assert.deepEqual(JSON.parse(stored.value), { sessionId: sourceSession.id, userId: user.id, targetOrigin: firstForm, challenge: challengeOf(verifier) });

  // Untrusted or missing Origin: refused before the code is looked up.
  assert.equal((await redeem(evil, code, verifier)).status, 403);
  assert.equal((await redeem(null, code, verifier)).status, 403);
  // A trusted origin that isn't the destination: refused, and the code is
  // burned, so a misdirected link can't be retried by anyone.
  assert.equal((await redeem(ddc, code, verifier)).status, 403);
  assert.equal((await redeem(firstForm, code, verifier)).status, 400, "a code tried from the wrong origin is consumed");

  // The redeem request must go through the cross-domain client.
  const noTransport = await issue();
  assert.equal((await redeem(firstForm, noTransport.code, noTransport.verifier, { cookie: false })).status, 400);

  // Login CSRF: a code minted on another session and sent as a link reaches a
  // tab that never asked for it, so it has no verifier, or the wrong one.
  // Either is refused and the code is burned, so it can't be retried with the right one.
  stores[firstForm] = "{}";
  for (const attempt of [null, "", "short", newVerifier(), `${newVerifier().slice(1)}!`]) {
    const planted = await issue();
    assert.equal((await redeem(firstForm, planted.code, attempt)).status, 403, `verifier ${String(attempt)} refused`);
    assert.equal((await redeem(firstForm, planted.code, planted.verifier)).status, 400, "the code was burned by the failed attempt");
  }
  assert.equal(stores[firstForm], "{}", "a refused redeem delivers no session");

  // Success: the same session, delivered only through Set-Better-Auth-Cookie.
  const good = await issue();
  const redeemed = await redeem(firstForm, good.code, good.verifier);
  assert.equal(redeemed.status, 200, await redeemed.clone().text());
  assert.equal(redeemed.headers.get("set-cookie"), null, "no first-party cookie on the auth origin");
  assert.equal(redeemed.headers.get("location"), null);
  assert.equal(redeemed.headers.get("cache-control"), "no-store");
  const redeemedBody = await redeemed.json();
  assert.deepEqual(redeemedBody, { redeemed: true }, "the body carries no session, token or user data");
  assert.equal(sessionTokenIn(stores[firstForm]), sourceToken, "the target now holds the very same session");
  const shared = await auth.api.getSession({ headers: new Headers({ cookie: getCookie(stores[firstForm]) }) });
  assert.equal(shared?.session.id, sourceSession.id);
  assert.equal((await context.internalAdapter.listSessions(user.id)).length, 1, "handoff never mints a new session");
  assert.equal((await redeem(firstForm, good.code, good.verifier)).status, 400, "replay is refused");

  // A redeemed handoff can't start from an origin that is not its own destination.
  assert.equal((await create(firstForm, firstForm)).status, 400);
  assert.equal((await create(firstForm, ddc)).status, 200, "the shared session can hand back to DDC");

  // Expired code.
  const expiring = await issue();
  await context.adapter.update({ model: "verification", where: [{ field: "identifier", value: await sessionHandoffIdentifier(expiring.code) }], update: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await redeem(firstForm, expiring.code, expiring.verifier)).status, 400, "expired code");

  // A code naming another user's session is refused even if the row were tampered with.
  const tampered = await issue();
  await context.adapter.update({ model: "verification", where: [{ field: "identifier", value: await sessionHandoffIdentifier(tampered.code) }], update: { value: JSON.stringify({ sessionId: sourceSession.id, userId: "someone-else", targetOrigin: firstForm, challenge: challengeOf(tampered.verifier) }) } });
  assert.equal((await redeem(firstForm, tampered.code, tampered.verifier)).status, 401);

  // The source session expires or is revoked after the code was issued.
  const beforeExpiry = await issue();
  await context.internalAdapter.updateSession(sourceToken!, { expiresAt: new Date(Date.now() - 1000) });
  assert.equal((await redeem(firstForm, beforeExpiry.code, beforeExpiry.verifier)).status, 401, "expired source session");
  await context.internalAdapter.updateSession(sourceToken!, { expiresAt: new Date(Date.now() + 3600_000) });
  const beforeRevoke = await issue();
  await context.internalAdapter.deleteSession(sourceToken!);
  assert.equal((await redeem(firstForm, beforeRevoke.code, beforeRevoke.verifier)).status, 401, "revoked source session");
  assert.equal((await create(ddc, firstForm)).status, 401, "signed out everywhere: the shared session is gone");

  // Throttling: create and redeem are limited per client IP through the production hooks.
  assert.ok(throttled.includes(`${SESSION_HANDOFF_REDEEM}:ip:203.0.113.7`), "redeem uses the per-IP throttle");
  assert.ok(throttled.includes("/societyer-handoff/create:ip:203.0.113.7"), "create uses the per-IP throttle");
  throttleOpen = false;
  assert.equal((await redeem(firstForm, "anything", newVerifier())).status, 429);
  throttleOpen = true;

  console.log("Session handoff passed: session required, exact trusted destination, required challenge, hash-only single-use 60 s codes, origin-bound redemption that burns misdirected codes, verifier-bound redemption that refuses and burns codes the tab didn't ask for, same-session delivery only via Set-Better-Auth-Cookie, expiry/revocation/tamper refusal, and per-IP throttles.");
} finally {
  database.close();
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
}
