/** Local broker proof: no external tenant or credentials are contacted. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createLocalJWKSet, jwtVerify } from "jose";
import { getMigrations } from "better-auth/db/migration";

const dir = mkdtempSync(path.join(tmpdir(), "societyer-auth-test-"));
process.env.AUTH_MODE = "better-auth";
process.env.VITE_AUTH_MODE = "better-auth";
process.env.BETTER_AUTH_BASE_URL = "https://broker.example.test";
process.env.VITE_AUTH_BASE_URL = process.env.BETTER_AUTH_BASE_URL;
process.env.AUTH_DB_PATH = path.join(dir, "auth.sqlite");
process.env.BETTER_AUTH_SECRET = "local-test-secret-with-sufficient-entropy-do-not-deploy";
try {
  const { auth, authIssuer } = await import("../server/auth-config");
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
  assert.equal(auth.options.account?.accountLinking?.disableImplicitLinking, true);
  assert.deepEqual(auth.options.account?.accountLinking?.trustedProviders, []);
  assert.equal(auth.options.session?.expiresIn, 28800);
  assert.equal(auth.options.session?.disableSessionRefresh, true);
  const signed = await auth.api.signJWT({ body: { payload: { sub: "test-subject" } } });
  const jwksResponse = await auth.handler(new Request(`${authIssuer}/api/auth/jwks`));
  assert.equal(jwksResponse.status, 200);
  const keys = createLocalJWKSet(await jwksResponse.json());
  const expected = { issuer: authIssuer, audience: authIssuer, algorithms: ["ES256"] };
  const { payload } = await jwtVerify(signed.token, keys, expected);
  assert.equal(payload.sub, "test-subject");
  assert.ok(payload.exp && payload.exp - Math.floor(Date.now() / 1000) <= 300);
  await assert.rejects(() => jwtVerify(signed.token, keys, { ...expected, issuer: "https://foreign.test" }));
  await assert.rejects(() => jwtVerify(signed.token, keys, { ...expected, audience: "wrong-audience" }));
  await assert.rejects(() => jwtVerify(signed.token, keys, { ...expected, currentDate: new Date(Date.now() + 600000) }));
  const pieces = signed.token.split(".");
  pieces[2] = `${pieces[2][0] === "A" ? "B" : "A"}${pieces[2].slice(1)}`;
  await assert.rejects(() => jwtVerify(pieces.join("."), keys, expected));
  const originDenied = await auth.handler(new Request(`${authIssuer}/api/auth/sign-in/email`, {
    method: "POST", headers: { "content-type": "application/json", origin: "https://foreign.test" },
    body: JSON.stringify({ email: "fixture@example.test", password: "fixturepassword" }),
  }));
  assert.equal(originDenied.status, 403);
  const tokenDenied = await auth.handler(new Request(`${authIssuer}/api/auth/token`));
  assert.equal(tokenDenied.status, 401);
  console.log("Pinned Better Auth broker checks passed: ES256, issuer, audience, expiry, signature, denied origin, no-session token, explicit-linking configuration.");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
