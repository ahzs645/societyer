import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { createApiToken, hashApiToken } from "../server/api-gateway/shared";
import { betterAuthIssuer } from "../convex/lib/authIdentity";

const previous = process.env.SOCIETYER_API_PLATFORM_TOKEN;
process.env.SOCIETYER_API_PLATFORM_TOKEN = "native-key-mint-service-test";
try {
  const test = convexTest(schema, {
    "./_generated/api.js": () => import("../convex/_generated/api.js"),
    "./_generated/server.js": () => import("../convex/_generated/server.js"),
    "./authorization.js": () => import("../convex/authorization"),
    "./apiPlatform.js": () => import("../convex/apiPlatform"),
  });
  const issuer = betterAuthIssuer();
  const rows = await test.run(async ctx => {
    const societyId = await ctx.db.insert("societies", { name: "Key issuance test", isCharity: false, isMemberFunded: false, updatedAt: 0 });
    const foreignSociety = await ctx.db.insert("societies", { name: "Foreign", isCharity: false, isMemberFunded: false, updatedAt: 0 });
    const users: Record<string, any> = {};
    for (const [name, role, society, status] of [["Owner", "Owner", societyId, "Active"], ["Admin", "Admin", societyId, "Active"], ["Member", "Member", societyId, "Active"], ["Disabled", "Owner", societyId, "Disabled"], ["Foreign", "Owner", foreignSociety, "Active"]]) users[name] = await ctx.db.insert("users", { societyId: society as any, email: `${name}@key.test`, displayName: name, role: String(role), status: String(status), authIssuer: issuer, authSubject: String(name), createdAtISO: new Date().toISOString() });
    const clientId = await ctx.db.insert("apiClients", { societyId, name: "Native key client", kind: "integration", status: "active", createdAtISO: new Date().toISOString(), updatedAtISO: new Date().toISOString() });
    return { societyId, clientId, users };
  });
  const rawToken = createApiToken();
  assert.ok(rawToken.startsWith("soc_"));
  const args = { societyId: rows.societyId, clientId: rows.clientId, name: "Gateway-minted key", tokenHash: hashApiToken(rawToken), tokenStart: rawToken.slice(0, 14), scopes: ["documents:read", "settings:manage"], serviceToken: process.env.SOCIETYER_API_PLATFORM_TOKEN };
  for (const createdByUserId of [undefined, rows.users.Admin, rows.users.Member, rows.users.Disabled, rows.users.Foreign]) await assert.rejects(() => test.mutation(api.apiPlatform.createToken, { ...args, createdByUserId }), /authorized API-key creator/);
  await assert.rejects(() => test.mutation(api.apiPlatform.createToken, { ...args, createdByUserId: rows.users.Owner, serviceToken: "forged" }), /invalid/);
  const { serviceToken: _serviceCredential, ...directArgs } = args;
  await assert.rejects(() => test.withIdentity({ issuer, subject: "Admin" }).mutation(api.apiPlatform.createToken, { ...directArgs, tokenHash: "native-admin-attempt" }), /settings:manage/);
  const directId = await test.withIdentity({ issuer, subject: "Owner" }).mutation(api.apiPlatform.createToken, { ...directArgs, tokenHash: "native-owner-token" });
  assert.equal((await test.run(ctx => ctx.db.get(directId)))!.createdByUserId, rows.users.Owner);
  const id = await test.mutation(api.apiPlatform.createToken, { ...args, createdByUserId: rows.users.Owner });
  const stored = await test.run(ctx => ctx.db.get(id));
  assert.equal(stored!.createdByUserId, rows.users.Owner, "trusted actor must survive gateway mint");
  const verify = () => test.mutation(api.apiPlatform.verifyToken, { tokenHash: args.tokenHash, requiredScope: "documents:read", serviceToken: args.serviceToken });
  let result = await verify();
  assert.equal(result.valid, true);
  assert.equal(result.userId, rows.users.Owner);
  assert.deepEqual(result.scopes, ["documents:read", "settings:manage"]);
  await test.run(ctx => ctx.db.patch(rows.users.Owner, { status: "Disabled" }));
  assert.equal((await verify()).valid, false, "disabling creator revokes use immediately");
  await test.run(ctx => ctx.db.patch(rows.users.Owner, { status: "Active", role: "Member" }));
  const writeUse = await test.mutation(api.apiPlatform.verifyToken, { tokenHash: args.tokenHash, requiredScope: "settings:manage", serviceToken: args.serviceToken });
  assert.equal(writeUse.valid, false);
  await assert.rejects(() => test.mutation(api.apiPlatform.createToken, { ...args, tokenHash: "second-hash", createdByUserId: rows.users.Owner }), /authorized API-key creator/);
  await test.run(ctx => ctx.db.patch(rows.users.Owner, { role: "Owner", authSubject: undefined }));
  assert.equal((await verify()).valid, false);
  await assert.rejects(() => test.mutation(api.apiPlatform.createToken, { ...args, createdByUserId: rows.users.Owner }), /identity binding/);
  await test.run(ctx => ctx.db.patch(rows.users.Owner, { authSubject: "Owner" }));
  const hookArgs = { societyId: rows.societyId, name: "Trusted webhook", targetUrl: "https://example.org/webhooks", eventTypes: ["documents.created"], secretEncrypted: "v1:fixture-encrypted-secret", createdByUserId: rows.users.Owner, serviceToken: args.serviceToken };
  for (const createdByUserId of [undefined, rows.users.Admin, rows.users.Member, rows.users.Disabled, rows.users.Foreign]) await assert.rejects(() => test.mutation(api.apiPlatform.upsertWebhookSubscription, { ...hookArgs, createdByUserId }), /authorized webhook creator/);
  const hookId = await test.mutation(api.apiPlatform.upsertWebhookSubscription, hookArgs);
  assert.equal((await test.run(ctx => ctx.db.get(hookId)))!.createdByUserId, rows.users.Owner);
  const rotatingActor = await test.run(ctx => ctx.db.insert("users", { societyId: rows.societyId, displayName: "Rotating Owner", email: "rotate@example.test", role: "Owner", status: "Active", authIssuer: issuer, authSubject: "rotating-owner", createdAtISO: new Date().toISOString() }));
  await test.mutation(api.apiPlatform.upsertWebhookSubscription, { ...hookArgs, id: hookId, createdByUserId: rotatingActor, secretEncrypted: "v1:rotated-fixture-secret" });
  const rotated = await test.run(ctx => ctx.db.get(hookId));
  assert.equal(rotated!.createdByUserId, rows.users.Owner, "rotation preserves original creator even when a different authorized Owner rotates");
  assert.equal(rotated!.secretEncrypted, "v1:rotated-fixture-secret");
  await test.run(ctx => ctx.db.patch(rotatingActor, { status: "Disabled" }));
  await assert.rejects(() => test.mutation(api.apiPlatform.upsertWebhookSubscription, { ...hookArgs, id: hookId, createdByUserId: rotatingActor }), /authorized webhook creator/);
  assert.equal((await test.run(ctx => ctx.db.get(hookId)))!.secretEncrypted, "v1:rotated-fixture-secret", "denied rotation preserves stored state");
  console.log("API key mint passed: service-issued key retains validated creator; foreign, missing, inactive, insufficient-role and unbound creators are rejected; token use follows current authority; native Admin mint is denied and trusted webhook rotation preserves original creator.");
} finally {
  if (previous === undefined) delete process.env.SOCIETYER_API_PLATFORM_TOKEN; else process.env.SOCIETYER_API_PLATFORM_TOKEN = previous;
}
