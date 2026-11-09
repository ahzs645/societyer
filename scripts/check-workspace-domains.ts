/**
 * Workspace domains: operator upsert/audit, the anonymous resolveOrigin query,
 * and canonical-origin links for provisioning, password reset and invitations.
 */
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { mock } from "node:test";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import componentSchema from "../node_modules/@convex-dev/better-auth/src/component/schema";
import { api, internal } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";

const ddc = "https://portal.ddc.example.test";
const firstForm = "https://firstform.example.test";
const spare = "https://spare.example.test";
const savedEnv = { ...process.env };
process.env.SITE_URL = `${ddc},${firstForm},${spare}`;
mock.timers.enable({ apis: ["setTimeout"] });

const t = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./workspaceDomains.js": () => import("../convex/workspaceDomains"),
  "./workspaceDefaults.js": () => import("../convex/workspaceDefaults"),
  "./hostedAuth.js": () => import("../convex/hostedAuth"),
  "./invitations.js": () => import("../convex/invitations"),
  "./authEmails.js": () => import("../convex/authEmails"),
  "./users.js": () => import("../convex/users"),
});
// The Better Auth component, so provisioning runs against its real adapter.
const componentDir = new URL("../node_modules/@convex-dev/better-auth/src/component/", import.meta.url);
const componentModules: Record<string, () => Promise<unknown>> = {};
for (const file of readdirSync(componentDir, { recursive: true, encoding: "utf8" })) {
  if (file.endsWith(".ts") && !file.includes("test")) componentModules[`./component/${file}`] = () => import(new URL(file, componentDir).href);
}
t.registerComponent("betterAuth", componentSchema, componentModules);

const issuer = betterAuthIssuer();
const { ddcId, ffId, goneId } = await t.run(async (ctx) => {
  const add = (name: string) => ctx.db.insert("societies", { name, isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const ddcId = await add("DDC North");
  const ffId = await add("First Form");
  const goneId = await add("Deleted");
  await ctx.db.delete(goneId);
  const logo = await ctx.storage.store(new Blob(["logo"], { type: "image/png" }));
  await ctx.db.patch(ddcId, { logoStorageId: logo });
  await ctx.db.insert("users", { societyId: ffId, email: "owner@example.test", displayName: "Owner", role: "Owner", status: "Active", authIssuer: issuer, authSubject: "owner", createdAtISO: new Date().toISOString() });
  return { ddcId, ffId, goneId };
});
const upsert = (origin: string, societyId = ddcId, extra: { primary?: boolean; status?: "Active" | "Disabled" } = {}) =>
  t.mutation(internal.workspaceDomains.upsert, { origin, societyId, primary: extra.primary ?? false, status: extra.status ?? "Active" });
const resolve = (origin: string) => t.query(api.workspaceDomains.resolveOrigin, { origin });

// upsert validation.
for (const bad of ["not a url", `${ddc}/app`, `${ddc}?x=1`, "ftp://portal.ddc.example.test", "https://user:pw@portal.ddc.example.test"]) {
  await assert.rejects(upsert(bad), /exact origin/, bad);
}
await assert.rejects(upsert("https://unlisted.example.test"), /not in this deployment's SITE_URL/);
await assert.rejects(upsert(ddc, goneId), /Workspace not found/);
const ddcRow = await upsert("HTTPS://Portal.DDC.example.test/", ddcId, { primary: true });
assert.equal((await t.run((ctx) => ctx.db.get(ddcRow)))?.origin, ddc, "origins are stored normalized");
assert.equal(await upsert(ddc, ddcId, { primary: true }), ddcRow, "re-running updates the same row");
await assert.rejects(upsert(ddc, ffId), /already opens another workspace/, "one Active row per origin");
await upsert(ddc, ffId, { status: "Disabled" });
// A new primary demotes the old one.
await upsert(spare, ddcId, { primary: true });
const ddcRows = await t.run((ctx) => ctx.db.query("workspaceDomains").withIndex("by_society", (q) => q.eq("societyId", ddcId)).collect());
assert.deepEqual(ddcRows.filter((row) => row.primary).map((row) => row.origin), [spare]);
await upsert(ddc, ddcId, { primary: true });
await upsert(spare, ddcId, { status: "Disabled" });
await upsert(firstForm, ffId, { primary: true });

// resolveOrigin.
assert.equal(await resolve("https://unknown.example.test"), null);
assert.equal(await resolve("garbage"), null);
assert.equal(await resolve(spare), null, "disabled mapping");
const ddcView = await resolve(`${ddc}/`);
assert.ok(ddcView);
assert.deepEqual(Object.keys(ddcView).sort(), ["logoUrl", "origin", "signIn", "societyId", "workspaceName"]);
assert.equal(ddcView.societyId, ddcId);
assert.equal(ddcView.workspaceName, "DDC North");
assert.equal(ddcView.origin, ddc);
assert.ok(ddcView.logoUrl);
assert.deepEqual(ddcView.signIn, { requiredMethod: "any" }, "no sign-in policy row means any");
await t.run((ctx) => ctx.db.insert("workspaceSignInPolicies", { societyId: ddcId, requiredMethod: "microsoft", microsoftTenantId: "tenant", microsoftGroupIds: ["group"], allowedEmailDomains: ["ddc.example.test"], supportEmail: "it@ddc.example.test", updatedAtISO: "", reason: "fixture" }));
assert.deepEqual((await resolve(ddc))?.signIn, { requiredMethod: "microsoft", supportEmail: "it@ddc.example.test" }, "only the method and support email leave the server");
assert.deepEqual(Object.keys((await resolve(firstForm))!).sort(), ["origin", "signIn", "societyId", "workspaceName"]);
// Two Active rows for one origin (an operator writing the table directly) resolve to nothing.
await t.run((ctx) => ctx.db.insert("workspaceDomains", { origin: firstForm, hostname: "firstform.example.test", societyId: ddcId, status: "Active", primary: false, createdAtISO: "", updatedAtISO: "" }));
assert.equal(await resolve(firstForm), null, "ambiguous origin");
let audit = await t.query(internal.workspaceDomains.audit, {});
assert.ok(audit.issues.some((issue) => issue.kind === "ambiguous-origin" && issue.origin === firstForm));
assert.ok(audit.issues.some((issue) => issue.kind === "site-url-unmapped" && issue.origin === spare));
await t.run(async (ctx) => {
  const extra = (await ctx.db.query("workspaceDomains").withIndex("by_origin", (q) => q.eq("origin", firstForm)).collect()).find((row) => row.societyId === ddcId);
  await ctx.db.delete(extra!._id);
  await ctx.db.insert("workspaceDomains", { origin: "https://dropped.example.test", hostname: "dropped.example.test", societyId: ffId, status: "Active", primary: true, createdAtISO: "", updatedAtISO: "" });
});
audit = await t.query(internal.workspaceDomains.audit, {});
assert.ok(audit.issues.some((issue) => issue.kind === "mapping-not-trusted" && issue.origin === "https://dropped.example.test"));
assert.ok(audit.issues.some((issue) => issue.kind === "multiple-primaries" && issue.societyId === ffId));
assert.equal(await resolve("https://dropped.example.test"), null, "an origin removed from SITE_URL no longer resolves");
assert.equal(await t.query(internal.workspaceDomains.linkOrigin, { societyId: ffId }), ddc, "two primaries: links fall back to SITE_URL[0]");
await t.run(async (ctx) => {
  const dropped = await ctx.db.query("workspaceDomains").withIndex("by_origin", (q) => q.eq("origin", "https://dropped.example.test")).unique();
  await ctx.db.delete(dropped!._id);
});
assert.equal((await t.query(internal.workspaceDomains.list, {})).length, 4);

// Links use the canonical origin while it is trusted, else SITE_URL[0].
assert.equal(await t.query(internal.workspaceDomains.linkOrigin, { societyId: ffId }), firstForm);
assert.equal(await t.query(internal.workspaceDomains.linkOrigin, {}), ddc);
try {
  Object.assign(process.env, {
    AUTH_MODE: "convex", VITE_AUTH_MODE: "convex", CONVEX_SITE_URL: "https://domains-fixture.convex.site",
    BETTER_AUTH_SECRET: "synthetic-workspace-domain-secret-000000000000000", SOCIETYER_AUTH_MANUAL_PROVISIONING: "1",
  });
  const setup = await t.action(internal.hostedAuth.provisionAccount, { email: "new@example.test", name: "New person", societyId: ffId });
  assert.match(setup, new RegExp(`^${firstForm}/reset-password#token=`), "provisioning link opens the workspace's own domain");
  const plain = await t.action(internal.hostedAuth.provisionAccount, { email: "plain@example.test", name: "Plain person" });
  assert.match(plain, new RegExp(`^${ddc}/reset-password#token=`));
  assert.match(await t.action(internal.hostedAuth.issuePasswordResetLink, { email: "new@example.test", societyId: ffId }), new RegExp(`^${firstForm}/reset-password\\?token=`));
  assert.match(await t.action(internal.hostedAuth.issuePasswordResetLink, { email: "new@example.test" }), new RegExp(`^${ddc}/reset-password\\?token=`));
  assert.match(await t.action(internal.hostedAuth.issuePasswordResetLink, { email: "new@example.test", societyId: ffId, appUrl: "https://app.example.test/sub" }), /^https:\/\/app\.example\.test\/sub\/reset-password\?token=/);
  // A canonical origin that left SITE_URL is never used for a link.
  process.env.SITE_URL = `${ddc},${spare}`;
  assert.match(await t.action(internal.hostedAuth.issuePasswordResetLink, { email: "new@example.test", societyId: ffId }), new RegExp(`^${ddc}/reset-password`));
  process.env.SITE_URL = `${ddc},${firstForm},${spare}`;
} finally {
  for (const key of ["AUTH_MODE", "VITE_AUTH_MODE", "CONVEX_SITE_URL", "BETTER_AUTH_SECRET", "SOCIETYER_AUTH_MANUAL_PROVISIONING"]) {
    if (key in savedEnv) process.env[key] = savedEnv[key]; else delete process.env[key];
  }
}

const realFetch = globalThis.fetch;
try {
  Object.assign(process.env, { SOCIETYER_EMAIL_PROVIDER: "resend", RESEND_API_KEY: "fixture-only", RESEND_FROM_EMAIL: "sender@example.test" });
  const outbound: Array<{ text: string }> = [];
  globalThis.fetch = async (_url, init) => { outbound.push(JSON.parse(String(init?.body))); return new Response('{"id":"mail-fixture"}', { status: 200 }); };
  const owner = t.withIdentity({ issuer, subject: "owner", email: "owner@example.test", emailVerified: true });
  const invitation = await owner.mutation(api.invitations.create, { societyId: ffId, email: "invitee@example.test", role: "Member" });
  await t.action(internal.invitations.deliverEmail, { id: invitation.id, token: invitation.token });
  assert.ok(outbound.at(-1)?.text.includes(`${firstForm}/invite/${invitation.token}`), "invitation email links to the invited workspace's domain");
} finally {
  globalThis.fetch = realFetch;
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  mock.timers.reset();
}

// Workspace defaults: the First Form invoice template for one workspace, without the deployment flag.
assert.equal(process.env.SOCIETYER_INITIAL_INVOICE_TEMPLATE, undefined);
const installed = await t.mutation(internal.workspaceDefaults.installInvoiceTemplate, { societyId: ffId, template: "firstform" });
assert.equal(installed.replaced, false);
const again = await t.mutation(internal.workspaceDefaults.installInvoiceTemplate, { societyId: ffId, template: "firstform" });
assert.deepEqual(again, { templateId: installed.templateId, replaced: true }, "re-running refreshes the same template");
const invoiceState = await t.run(async (ctx) => ({
  templates: await ctx.db.query("invoiceTemplates").withIndex("by_society", (q) => q.eq("societyId", ffId)).collect(),
  settings: await ctx.db.query("invoiceSettings").withIndex("by_society", (q) => q.eq("societyId", ffId)).unique(),
  ddcTemplates: await ctx.db.query("invoiceTemplates").withIndex("by_society", (q) => q.eq("societyId", ddcId)).collect(),
}));
assert.deepEqual(invoiceState.templates.map((row) => row.config.name), ["First Form"]);
assert.equal(invoiceState.settings?.defaultTemplateId, installed.templateId);
assert.equal(invoiceState.ddcTemplates.length, 0, "other workspaces are untouched");
await assert.rejects(t.mutation(internal.workspaceDefaults.installInvoiceTemplate, { societyId: ddcId, template: "firstform" }), /no Active Owner/);

console.log("Workspace domains passed: normalized SITE_URL-only upsert, one Active row per origin, primary demotion, audit flags, resolveOrigin null for unknown/disabled/ambiguous/untrusted origins and its minimal sign-in shape, canonical-origin provisioning, reset and invitation links, and per-workspace invoice-template install.");
