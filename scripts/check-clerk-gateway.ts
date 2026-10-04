import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Request } from "express";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.CLERK_JWT_KEY = publicKey.export({ type: "spki", format: "pem" }).toString();
process.env.CLERK_JWT_ISSUER_DOMAIN = "https://company.clerk.accounts.dev";
process.env.CLERK_AUTHORIZED_PARTIES = "https://app.company.test";

const { clerkVerificationConfig, verifyClerkConvexToken, machinePrincipalClaims } =
  await import("../server/clerk-auth");
const { extractApiToken } = await import("../server/api-gateway/shared");

const timestamp = Math.floor(Date.now() / 1000);
const claims = {
  iss: process.env.CLERK_JWT_ISSUER_DOMAIN,
  sub: "user_gateway_test",
  sid: "sess_gateway_test",
  aud: "convex",
  azp: "https://app.company.test",
  iat: timestamp - 5,
  nbf: timestamp - 5,
  exp: timestamp + 120,
};

function token(payload: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "gateway-test" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const input = `${header}.${body}`;
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")}`;
}

const valid = token(claims);
assert.deepEqual(await verifyClerkConvexToken(valid), { subject: claims.sub, issuer: claims.iss });
for (const invalid of [
  { ...claims, iss: "https://attacker.clerk.accounts.dev" },
  { ...claims, aud: "other-api" },
  { ...claims, aud: undefined },
  { ...claims, azp: "https://evil.company.test" },
  { ...claims, azp: undefined },
  { ...claims, exp: timestamp - 60 },
  { ...claims, nbf: timestamp + 120 },
]) {
  await assert.rejects(verifyClerkConvexToken(token(invalid)), { code: "invalid_clerk_token", statusCode: 401 });
}
await assert.rejects(verifyClerkConvexToken(`${valid.slice(0, -12)}tamperedJWT`), { code: "invalid_clerk_token" });
await assert.rejects(verifyClerkConvexToken("not-a-jwt"), { code: "invalid_clerk_token" });

const originalParties = process.env.CLERK_AUTHORIZED_PARTIES;
for (const configured of ["", "*", "https://app.company.test/path"]) {
  process.env.CLERK_AUTHORIZED_PARTIES = configured;
  assert.throws(clerkVerificationConfig, { code: "clerk_not_configured" });
}
process.env.CLERK_AUTHORIZED_PARTIES = originalParties;

function request(headers: Record<string, string>) {
  return { get: (name: string) => headers[name.toLowerCase()] } as Request;
}
assert.equal(extractApiToken(request({ authorization: `Bearer ${valid}` })), null);
assert.equal(extractApiToken(request({ authorization: "Bearer soc_bound_machine_key" })), "soc_bound_machine_key");
assert.equal(extractApiToken(request({ authorization: `Bearer ${valid}`, "x-api-key": "soc_explicit_key" })), "soc_explicit_key");
assert.deepEqual(machinePrincipalClaims({ authSubject: claims.sub, authIssuer: claims.iss, authProvider: "clerk" }), {
  sub: claims.sub, societyer_auth_issuer: claims.iss, societyer_auth_provider: "clerk",
});
assert.deepEqual(machinePrincipalClaims({ authSubject: "legacy-user" }), { sub: "legacy-user" });

const weakSecret = spawnSync(process.execPath,
  ["--import", "tsx", "--input-type=module", "-e", "await import('./server/auth-config.ts')"], {
    env: { ...process.env, NODE_ENV: "production", AUTH_MODE: "clerk", BETTER_AUTH_SECRET: "" },
    encoding: "utf8",
  });
assert.notEqual(weakSecret.status, 0);
assert.match(weakSecret.stderr, /non-development BETTER_AUTH_SECRET/);

// Start the real server with a throwaway signing database, without connecting to
// Convex or an external Clerk account, and check its public auth surface.
const testDir = await mkdtemp(path.join(tmpdir(), "societyer-clerk-gateway-"));
const child = spawn(process.execPath, ["--import", "tsx", "server/auth-server.ts"], {
  env: {
    ...process.env,
    NODE_ENV: "production",
    AUTH_MODE: "clerk",
    AUTH_SERVER_PORT: "0",
    AUTH_DB_PATH: path.join(testDir, "auth.sqlite"),
    BETTER_AUTH_SECRET: "clerk-gateway-test-secret-over-32-characters",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
try {
  const baseUrl = await new Promise<string>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Clerk gateway server startup timed out.")), 15_000);
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Clerk gateway exited before startup (${code}).`));
    });
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const match = output.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.stderr.resume();
  });
  assert.equal((await (await fetch(`${baseUrl}/healthz`)).json()).mode, "clerk");
  const jwksResponse = await fetch(`${baseUrl}/api/auth/jwks`);
  assert.equal(jwksResponse.status, 200);
  const jwks = await jwksResponse.json();
  assert.ok(Array.isArray(jwks.keys) && jwks.keys.length > 0);
  for (const endpoint of ["", "/get-session", "/token", "/sign-in/email", "/sign-up/email", "/sign-jwt"]) {
    for (const method of ["GET", "POST"]) {
      assert.equal((await fetch(`${baseUrl}/api/auth${endpoint}`, { method })).status, 404);
    }
  }
} finally {
  const stopped = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  if (child.exitCode === null) {
    child.kill();
    await stopped;
  }
  await rm(testDir, { recursive: true, force: true });
}

console.log("Clerk gateway: JWT validation, bearer dispatch, machine claims, and JWKS-only public auth routes verified.");
