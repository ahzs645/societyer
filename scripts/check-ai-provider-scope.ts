import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";

const test = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./authorization.js": () => import("../convex/authorization"),
  "./aiSettingsActions.js": () => import("../convex/aiSettingsActions"),
});
const issuer = "https://ai-scope.test";
const fixture = await test.run(async (ctx) => {
  const societyId = await ctx.db.insert("societies", { name: "Provider scope", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const foreignSocietyId = await ctx.db.insert("societies", { name: "Foreign", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  for (const role of ["Owner", "Admin", "Director", "Member", "Viewer"]) {
    await ctx.db.insert("users", { societyId, email: `${role}@ai-scope.test`, displayName: role, role, status: "Active", authIssuer: issuer, authSubject: role, createdAtISO: new Date().toISOString() });
  }
  await ctx.db.insert("users", { societyId: foreignSocietyId, email: "foreign@ai-scope.test", displayName: "Foreign", role: "Owner", status: "Active", authIssuer: issuer, authSubject: "foreign", createdAtISO: new Date().toISOString() });
  return { societyId, foreignSocietyId };
});
const keys = ["AUTH_MODE", "VITE_AUTH_MODE", "BETTER_AUTH_BASE_URL", "CLERK_JWT_ISSUER_DOMAIN"];
const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
let providerCalls = 0;
globalThis.fetch = async () => {
  providerCalls++;
  return new Response(JSON.stringify({ error: { message: "Fixture provider rejected synthetic key" } }), { status: 401, headers: { "Content-Type": "application/json" } });
};
try {
  for (const broker of ["clerk", "better-auth"]) {
    process.env.AUTH_MODE = broker; process.env.VITE_AUTH_MODE = broker;
    process.env.BETTER_AUTH_BASE_URL = broker === "better-auth" ? issuer : "https://other.test";
    process.env.CLERK_JWT_ISSUER_DOMAIN = issuer;
    const args = { societyId: fixture.societyId, provider: "openai", apiKey: "synthetic-test-key" };
    const actor = (subject: string) => test.withIdentity({ issuer, subject });
    for (const role of ["Owner", "Admin"]) {
      const result = await actor(role).action(api.aiSettingsActions.validateProviderKey, args);
      assert.equal(result.ok, false); assert.equal(result.status, 401);
      assert.equal(result.message, "Fixture provider rejected synthetic key");
    }
    const allowedCalls = providerCalls;
    for (const subject of ["Director", "Member", "Viewer", "foreign"]) {
      await assert.rejects(() => actor(subject).action(api.aiSettingsActions.validateProviderKey, args), /permission|membership/i);
    }
    await assert.rejects(() => actor("Owner").action(api.aiSettingsActions.validateProviderKey, { ...args, societyId: fixture.foreignSocietyId }), /membership/i);
    await assert.rejects(() => test.action(api.aiSettingsActions.validateProviderKey, args), /authentication/i);
    await assert.rejects(() => actor("Owner").action(api.aiSettingsActions.validateProviderKey, { provider: "openai", apiKey: "synthetic-test-key" } as any), /societyId|validator|workspace/i);
    assert.equal(providerCalls, allowedCalls, "Denied/scopeless identities never contact the provider");
    console.log(`PASS ${broker}: scoped Owner/Admin reach fixture provider; lower/foreign/anonymous/scopeless callers denied before provider access`);
  }
} finally {
  globalThis.fetch = originalFetch;
  for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
}
