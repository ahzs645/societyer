import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";

const test = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./http.js": () => import("../convex/http"),
});
const issuer = "https://generated-doc.test";
const authKeys = ["AUTH_MODE", "VITE_AUTH_MODE", "BETTER_AUTH_BASE_URL", "CLERK_JWT_ISSUER_DOMAIN"];
const previousAuth = Object.fromEntries(authKeys.map((key) => [key, process.env[key]]));
process.env.AUTH_MODE = "clerk";
process.env.VITE_AUTH_MODE = "clerk";
process.env.BETTER_AUTH_BASE_URL = "https://signer.generated-doc.test";
process.env.CLERK_JWT_ISSUER_DOMAIN = issuer;
const previousToken = process.env.SOCIETYER_API_PLATFORM_TOKEN;
process.env.SOCIETYER_API_PLATFORM_TOKEN = "test-service-token";
try {
  const seeded = await test.run(async (ctx) => {
    const societyId = await ctx.db.insert("societies", { name: "Document test", isCharity: false, isMemberFunded: false, updatedAt: 0 });
    for (const [subject, role] of [["member", "Member"], ["owner", "Owner"]]) {
      await ctx.db.insert("users", { societyId, email: `${subject}@generated.test`, displayName: subject, role, status: "Active", authSubject: subject, authIssuer: issuer, createdAtISO: new Date().toISOString() });
    }
    const restrictedId = await ctx.db.insert("documents", { societyId, title: "Restricted generated record", category: "Other", tags: [], flaggedForDeletion: false, createdAtISO: new Date().toISOString() });
    const publicId = await ctx.db.insert("documents", { societyId, title: "Member policy", category: "Policy", tags: [], flaggedForDeletion: false, createdAtISO: new Date().toISOString() });
    for (const [documentId, storageKey] of [[restrictedId, "private.pdf"], [publicId, "policy.pdf"]]) {
      await ctx.db.insert("documentVersions", { societyId, documentId, storageProvider: "local", storageKey, version: 1, fileName: storageKey, uploadedAtISO: new Date().toISOString(), isCurrent: true });
    }
    await ctx.db.insert("documentVersions", { societyId, documentId: publicId, storageProvider: "rustfs", storageKey: "provider-confusion.pdf", version: 2, fileName: "ignored.pdf", uploadedAtISO: new Date().toISOString(), isCurrent: false });
    return { societyId };
  });
  const member = test.withIdentity({ issuer, subject: "member" });
  const owner = test.withIdentity({ issuer, subject: "owner" });
  const access = (storageKey: string) => ({ societyId: seeded.societyId, storageKey, serviceToken: "test-service-token" });
  assert.equal(await member.query(api.http.gatewayGeneratedDocumentAccess, access("private.pdf")), false);
  assert.equal(await owner.query(api.http.gatewayGeneratedDocumentAccess, access("private.pdf")), true);
  assert.equal(await member.query(api.http.gatewayGeneratedDocumentAccess, access("policy.pdf")), true);
  assert.equal(await member.query(api.http.gatewayGeneratedDocumentAccess, access("provider-confusion.pdf")), false);
  assert.equal(await test.query(api.http.gatewayGeneratedDocumentAccess, access("policy.pdf")), false, "a valid service token alone cannot authorize document bytes");
  assert.equal(await test.withIdentity({ issuer: "https://foreign-issuer.test", subject: "owner" }).query(api.http.gatewayGeneratedDocumentAccess, access("private.pdf")), false);
  await test.run(async ctx => {
    const societyId = await ctx.db.insert("societies", { name: "Foreign historical key owner", isCharity: false, isMemberFunded: false, updatedAt: 0 });
    const documentId = await ctx.db.insert("documents", { societyId, title: "Foreign private bytes", category: "Other", tags: [], flaggedForDeletion: false, createdAtISO: new Date().toISOString() });
    await ctx.db.insert("documentVersions", { societyId, documentId, storageProvider: "local", storageKey: "private.pdf", version: 1, fileName: "foreign-private.pdf", uploadedAtISO: new Date().toISOString(), isCurrent: true });
    await ctx.db.insert("documentVersions", { societyId, documentId, storageProvider: "rustfs", storageKey: "policy.pdf", version: 2, fileName: "external-provider-policy.pdf", uploadedAtISO: new Date().toISOString(), isCurrent: false });
  });
  assert.equal(await owner.query(api.http.gatewayGeneratedDocumentAccess, access("private.pdf")), false, "A readable own-tenant claim cannot override a historical foreign local-file claim.");
  assert.equal(await member.query(api.http.gatewayGeneratedDocumentAccess, access("private.pdf")), false);
  assert.equal(await member.query(api.http.gatewayGeneratedDocumentAccess, access("policy.pdf")), true, "A foreign nonlocal provider key does not refer to the generated-file directory.");
  console.log("Generated document access passed: service token requires authenticated actor ACL, issuer binding and correct local provider; historical cross-tenant local-key collisions deny readable own claims, nonlocal provider collisions do not block legitimate local files.");
} finally {
  for (const key of authKeys) { if (previousAuth[key] === undefined) delete process.env[key]; else process.env[key] = previousAuth[key]; }
  if (previousToken === undefined) delete process.env.SOCIETYER_API_PLATFORM_TOKEN;
  else process.env.SOCIETYER_API_PLATFORM_TOKEN = previousToken;
}
