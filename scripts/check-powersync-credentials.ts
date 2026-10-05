/** Exercises the production HTTP broker with real Better Auth sessions and ES256 signing.
 * Convex identity is injected here; native authorization/replication tests cover that boundary.
 */
import assert from "node:assert/strict";
import express from "express";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createLocalJWKSet, jwtVerify } from "jose";
import { getMigrations } from "better-auth/db/migration";
import { validatePowerSyncProductionEnvironment } from "./check-powersync-production-config";
import { meetingSyncConfiguration, mountMeetingSyncCredentialRoute, type MeetingSyncSession } from "../server/powersync-credentials";

const directory = mkdtempSync(path.join(tmpdir(), "societyer-sync-broker-"));
process.env.AUTH_MODE = "better-auth";
process.env.VITE_AUTH_MODE = "better-auth";
process.env.BETTER_AUTH_BASE_URL = "https://broker.example.test";
process.env.VITE_AUTH_BASE_URL = process.env.BETTER_AUTH_BASE_URL;
process.env.AUTH_DB_PATH = path.join(directory, "auth.sqlite");
process.env.BETTER_AUTH_SECRET = "disposable-broker-test-secret-never-used-for-production";
const cases: string[] = [];
const check = (name: string) => { cases.push(name); console.log(`PASS ${name}`); };
let server: ReturnType<express.Express["listen"]> | undefined;
const gatewayServers: ReturnType<express.Express["listen"]>[] = [];
try {
  const disabled = meetingSyncConfiguration({}, process.env.BETTER_AUTH_BASE_URL, "none");
  assert.equal(disabled, null);
  for (const [environment, mode] of [
    [{ SOCIETYER_POWERSYNC_ENABLED: "yes" }, "better-auth"],
    [{ SOCIETYER_POWERSYNC_ENABLED: "1", PS_PUBLIC_ORIGIN: "https://sync.example.test" }, "none"],
    ...["http://sync.example.test", "https://user:pass@sync.example.test", "https://sync.example.test/path", "https://sync.example.test?token=x", "https://localhost", "https://127.0.0.1", "https://sync.example.test#fragment"].map(origin => [{ SOCIETYER_POWERSYNC_ENABLED: "1", PS_PUBLIC_ORIGIN: origin }, "better-auth"]),
    [{ SOCIETYER_POWERSYNC_ENABLED: "1", PS_PUBLIC_ORIGIN: "https://sync.example.test", SOCIETYER_LOCAL_LIVE_PILOT: "1" }, "better-auth"],
  ] as [NodeJS.ProcessEnv, string][]) assert.throws(() => meetingSyncConfiguration(environment, process.env.BETTER_AUTH_BASE_URL!, mode));
  const validEnvironment = {
    AUTH_MODE: "better-auth", BETTER_AUTH_BASE_URL: "https://app.invalid", AUTH_DB_PATH: "/data/auth.sqlite", BETTER_AUTH_SECRET: "A".repeat(40),
    SOCIETYER_POWERSYNC_ENABLED: "1", PS_PUBLIC_ORIGIN: "https://sync.invalid", PS_JWKS_URL: "https://app.invalid/api/auth/jwks",
    PS_CONVEX_DEPLOYMENT_URL: "https://convex.invalid", PS_CONVEX_DEPLOY_KEY: "B".repeat(40),
    PS_STORAGE_URI: "postgresql://sync:strong-contract-password@database.invalid/sync", OFFLINE_MEETING_PREPARATION_ENABLED: "1", VITE_POWERSYNC_MEETING_PREPARATION: "1",
  };
  assert.equal(validatePowerSyncProductionEnvironment(validEnvironment).ok, true);
  for (const mutation of [
    { PS_JWKS_URL: "https://foreign.invalid/api/auth/jwks" }, { PS_STORAGE_URI: "postgresql://sync:pw@database.invalid/sync?sslmode=disable" },
    { PS_CONVEX_DEPLOY_KEY: "" }, { OFFLINE_MEETING_PREPARATION_ENABLED: "0" }, { VITE_POWERSYNC_MEETING_PREPARATION: "0" },
  ]) assert.equal(validatePowerSyncProductionEnvironment({ ...validEnvironment, ...mutation }).ok, false);
  check("production validator binds broker JWKS, storage TLS and all three enablement layers");
  check("disabled feature stays absent; malformed origins, auth-none and test signer fail closed");
  const configuration = meetingSyncConfiguration({ SOCIETYER_POWERSYNC_ENABLED: "1", PS_PUBLIC_ORIGIN: "https://sync.example.test/" }, process.env.BETTER_AUTH_BASE_URL, "better-auth")!;
  assert.equal(configuration.endpoint, "https://sync.example.test");
  assert.ok(meetingSyncConfiguration({ SOCIETYER_POWERSYNC_ENABLED: "1", PS_PUBLIC_ORIGIN: "https://sync.example.test" }, process.env.BETTER_AUTH_BASE_URL, "clerk"));
  const { auth } = await import("../server/auth-config");
  const { runMigrations } = await getMigrations(auth.options); await runMigrations();
  const signedUp = await auth.handler(new Request(`${configuration.trustedOrigin}/api/auth/sign-up/email`, {
    method: "POST", headers: { "content-type": "application/json", origin: configuration.trustedOrigin },
    body: JSON.stringify({ email: "broker-fixture@example.test", name: "Credential fixture", password: "FixtureStrongPass123!" }),
  }));
  assert.equal(signedUp.status, 200);
  const cookies = signedUp.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ");
  assert.ok(cookies);
  let actorOverride: MeetingSyncSession | undefined;
  let identityOverride: { actorKey: string; societyId: string; accessUntilEpochMs?: number } | undefined;
  let denyIdentity = false;
  let transientIdentity = false;
  let queryCount = 0;
  let lastNativeToken: string | undefined;
  const app = express(); app.use(express.json());
  const router = express.Router();
  mountMeetingSyncCredentialRoute(router, {
    configuration,
    resolveSession: async request => {
      if (actorOverride) return actorOverride;
      const headers = new Headers({ cookie: request.get("cookie") ?? "" });
      const session = await auth.api.getSession({ headers });
      if (!session) return null;
      const token = await auth.api.getToken({ headers });
      return { type: "better-auth", societyId: "workspace-authorized", convexAuthToken: token.token };
    },
    queryIdentity: async (token, societyId) => {
      queryCount++; lastNativeToken = token;
      if (transientIdentity) throw new Error("Temporary database outage");
      if (denyIdentity || societyId !== "workspace-authorized") throw Object.assign(new Error("membership revoked"), { status: 403 });
      return identityOverride ?? { actorKey: "native-actor-only", societyId };
    },
    signer: auth.api,
  });
  app.use("/api/v1", router);
  app.use((error: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.status ?? 503).json({ error: "unavailable" }));
  server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server!.on("listening", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/v1/offline/meeting-preparation/credentials`;
  const request = (body: unknown = { societyId: "workspace-authorized" }, headers: Record<string, string> = {}, suffix = "") => fetch(url + suffix, {
    method: "POST", headers: { "content-type": "application/json", origin: configuration.trustedOrigin, cookie: cookies, ...headers }, body: JSON.stringify(body),
  });
  const jwks = createLocalJWKSet(await auth.api.getJwks());
  const validResponse = await request(); assert.equal(validResponse.status, 200);
  assert.equal(validResponse.headers.get("cache-control"), "no-store, private");
  const credential = await validResponse.json();
  assert.equal(credential.endpoint, configuration.endpoint);
  const { payload } = await jwtVerify(credential.token, jwks, { issuer: configuration.trustedOrigin, audience: configuration.endpoint, algorithms: ["ES256"] });
  assert.equal(payload.sub, "native-actor-only"); assert.equal(payload.society_id, "workspace-authorized");
  assert.ok(payload.exp && payload.iat && payload.exp - payload.iat <= 300);
  assert.ok(lastNativeToken && lastNativeToken !== credential.token);
  const { payload: userToken } = await jwtVerify(lastNativeToken, jwks, { audience: configuration.trustedOrigin });
  assert.notEqual(userToken.sub, payload.sub);
  await assert.rejects(jwtVerify(credential.token, jwks, { audience: configuration.trustedOrigin }));
  check("real cookie session exchanges only authenticated Convex identity for 5-minute audience-bound ES256 credentials");
  let baselineQueries = queryCount;
  for (const origin of ["", "null", "https://foreign.example.test"]) assert.equal((await request(undefined, { origin })).status, 403);
  assert.equal((await request(undefined, { "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal(queryCount, baselineQueries);
  check("cross-origin and originless requests cannot query identity or issue credentials");
  for (const body of [{}, [], { societyId: "" }, { societyId: "workspace-authorized", sub: "forged-owner" }, { societyId: "workspace-authorized", endpoint: "https://foreign.test" }]) assert.equal((await request(body)).status, 400);
  assert.equal((await request(undefined, {}, "?societyId=foreign")).status, 400);
  assert.equal((await request(undefined, { "x-society-id": "foreign" })).status, 400);
  assert.equal(queryCount, baselineQueries);
  check("client identities, endpoint overrides and competing workspace channels are rejected");
  assert.equal((await request(undefined, { cookie: "" })).status, 401);
  for (const type of ["local-dev", "api-key"]) {
    actorOverride = { type, societyId: "workspace-authorized", convexAuthToken: "not-a-user-session" };
    assert.equal((await request()).status, 401);
  }
  actorOverride = undefined;
  assert.equal((await request({ societyId: "foreign" })).status, 403);
  check("anonymous, API-key, local-dev and foreign-workspace sessions receive no credential");
  denyIdentity = true; assert.equal((await request()).status, 403); denyIdentity = false;
  transientIdentity = true; const unavailable = await request(); assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { error: "sync_identity_unavailable" }); transientIdentity = false;
  check("temporary native outages return sanitized retryable 503; confirmed revocation returns 403");
  identityOverride = { actorKey: "native-actor-only", societyId: "foreign" }; assert.equal((await request()).status, 403);
  identityOverride = { actorKey: "", societyId: "workspace-authorized" }; assert.equal((await request()).status, 403);
  identityOverride = { actorKey: "native-actor-only", societyId: "workspace-authorized", accessUntilEpochMs: Date.now() - 1000 }; assert.equal((await request()).status, 403);
  check("revoked, malformed, mismatched and expired native identity never signs");
  identityOverride = { actorKey: "native-actor-only", societyId: "workspace-authorized", accessUntilEpochMs: Date.now() + 30_000 };
  const bounded = await (await request()).json();
  const limited = await jwtVerify(bounded.token, jwks, { audience: configuration.endpoint });
  assert.ok(limited.payload.exp! - limited.payload.iat! <= 30);
  identityOverride = undefined;
  check("temporary memberships cannot receive tokens beyond their remaining access period");
  let limitedResponse: Response | undefined;
  for (let attempt = 0; attempt < 22; attempt++) { const response = await request(); if (response.status === 429) { limitedResponse = response; break; } assert.equal(response.status, 200); }
  assert.equal(limitedResponse?.status, 429); assert.equal(limitedResponse?.headers.get("retry-after"), "60");
  check("credential minting has a bounded actor/workspace rate limit");
  assert.equal((await fetch(url)).status, 404);
  check("GET never mints credentials");

  // Exercise the ACTUAL gateway mount/session resolver. This catches optional
  // issuer plumbing defects that an injected resolveSession test cannot detect.
  let lookupIssuer = configuration.trustedOrigin;
  let lookupSubject: string | undefined;
  const nativePaths: string[] = [];
  const native = express(); native.use(express.json());
  native.post("/api/query", async (req, res) => {
    try {
      const nativeToken = req.get("authorization")?.replace(/^Bearer /, ""); assert.ok(nativeToken);
      const principal = await jwtVerify(nativeToken, jwks, { issuer: configuration.trustedOrigin, audience: configuration.trustedOrigin });
      nativePaths.push(req.body.path);
      if (req.body.path === "http:currentPrincipalMemberships") {
        res.json({ status: "success", value: { status: "ready", authSubject: lookupSubject ?? principal.payload.sub,
          authIssuer: lookupIssuer, memberships: [{ society: { _id: "workspace-authorized" }, userId: "native-workspace-user", role: "Owner" }] } });
      } else if (req.body.path === "offlineMeetings:syncIdentity") {
        assert.equal(req.body.args[0].societyId, "workspace-authorized");
        res.json({ status: "success", value: { actorKey: `${principal.payload.iss}|${principal.payload.sub}`, societyId: "workspace-authorized" } });
      } else { res.status(400).json({ status: "error", errorMessage: "Unexpected native query" }); }
    } catch { res.status(401).json({ status: "error", errorMessage: "Native user JWT required" }); }
  });
  const nativeServer = native.listen(0, "127.0.0.1"); gatewayServers.push(nativeServer);
  await new Promise<void>(resolve => nativeServer.on("listening", resolve));
  const nativeAddress = nativeServer.address(); assert.ok(nativeAddress && typeof nativeAddress !== "string");
  process.env.CONVEX_SELF_HOSTED_URL = `http://127.0.0.1:${nativeAddress.port}`;
  process.env.SOCIETYER_POWERSYNC_ENABLED = "1"; process.env.PS_PUBLIC_ORIGIN = configuration.endpoint;
  delete process.env.SOCIETYER_LOCAL_LIVE_PILOT;
  const { mountApiGateway } = await import("../server/api-gateway");
  const gateway = express(); mountApiGateway(gateway);
  const gatewayServer = gateway.listen(0, "127.0.0.1"); gatewayServers.push(gatewayServer);
  await new Promise<void>(resolve => gatewayServer.on("listening", resolve));
  const gatewayAddress = gatewayServer.address(); assert.ok(gatewayAddress && typeof gatewayAddress !== "string");
  const gatewayRequest = () => fetch(`http://127.0.0.1:${gatewayAddress.port}/api/v1/offline/meeting-preparation/credentials`, {
    method: "POST", headers: { origin: configuration.trustedOrigin, cookie: cookies, "content-type": "application/json" },
    body: JSON.stringify({ societyId: "workspace-authorized" }),
  });
  const nativeCredential = await gatewayRequest(); assert.equal(nativeCredential.status, 200);
  const nativeResult = await nativeCredential.json();
  const actualSigned = await jwtVerify(nativeResult.token, jwks, { audience: configuration.endpoint, issuer: configuration.trustedOrigin });
  assert.equal(actualSigned.payload.sub, `${configuration.trustedOrigin}|${userToken.sub}`);
  assert.deepEqual(nativePaths, ["http:currentPrincipalMemberships", "offlineMeetings:syncIdentity"]);
  lookupIssuer = "https://foreign.invalid"; assert.equal((await gatewayRequest()).status, 401);
  lookupIssuer = configuration.trustedOrigin; lookupSubject = "foreign-subject"; assert.equal((await gatewayRequest()).status, 401);
  assert.equal(nativePaths.filter(value => value === "offlineMeetings:syncIdentity").length, 1);
  check("actual gateway accepts matching Better Auth issuer and rejects native issuer/subject mismatches before signing");
  console.log(`Production credential broker: ${cases.length}/${cases.length} groups passed.`);
} finally {
  for (const gatewayServer of gatewayServers.reverse()) await new Promise<void>((resolve, reject) => gatewayServer.close(error => error ? reject(error) : resolve()));
  if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
  rmSync(directory, { recursive: true, force: true });
}
