import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { cleanWorkspaceBrand, MAX_WORKSPACE_BRAND_BYTES } from "../shared/workspaceBrandValidation";
import { importInvoiceBrand, type InvoiceBrand } from "../shared/invoiceBranding";
import { setWorkspaceBrandPortable } from "../shared/functions/society";
import { actionPermission } from "../shared/functions/actionPolicy";
import {
  MemoryDb, PortableRuntime, definePortableMutation, makeCapabilities, type PortablePrincipal,
} from "../shared/portable/index";
import { StaticConvexClient } from "../src/lib/staticConvexClient";

const profileIds = ["ddcnorth", "firstform", "overtheedge", "sparklab", "northwind", "bc-province-1977", "bc-hydro-1983"];
const brands = await Promise.all(profileIds.map(async (id) => {
  const profile = JSON.parse(await readFile(new URL(`./fixtures/brandkit/${id}.json`, import.meta.url), "utf8"));
  const brand = importInvoiceBrand(profile);
  const cleaned = cleanWorkspaceBrand(brand);
  assert.equal(cleaned.id, id);
  assert.deepEqual(cleaned, JSON.parse(JSON.stringify(brand)), `${id}: all exported variants and provenance survive workspace validation`);
  return cleaned;
}));
const brand = brands[0];
const legacy: InvoiceBrand = {
  id: "synthetic", name: "Synthetic brand", version: "1", primary: "#112233", ink: "#000000",
  paper: "#FFFFFF", muted: "#445566", light: "#EEEEEE", font: "inter", logoWidth: 10, logoHeight: 10,
  logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#112233"/></svg>',
};
assert.match(cleanWorkspaceBrand(legacy).logoSvg, /<path /, "legacy imports also use the strict vector parser");
const malformed = { ...legacy, logoSvg: legacy.logoSvg.replace("</svg>", "") };
const active = { ...legacy, logoSvg: legacy.logoSvg.replace("<circle", '<circle onload="alert(1)"') };
const oversize = { ...brand, descriptor: "x".repeat(MAX_WORKSPACE_BRAND_BYTES) };
assert.throws(() => cleanWorkspaceBrand(malformed), /vector/);
assert.throws(() => cleanWorkspaceBrand(active), /vector/);
assert.throws(() => cleanWorkspaceBrand(oversize), /250 KB/);
assert.throws(() => cleanWorkspaceBrand(undefined as any), /valid Brandkit/);
assert.equal(actionPermission("society:setWorkspaceBrand", "mutation"), "society:write");

const issuer = betterAuthIssuer();
const roles = ["Owner", "Admin", "Director", "Member", "Viewer"];
const seed = {
  societies: [
    { _id: "company", name: "Synthetic legal name", isCharity: false, isMemberFunded: false, updatedAt: 1,
      incorporationNumber: "SYNTHETIC-001", officialEmail: "office@example.test", logoStorageId: "existing-light",
      logoDarkStorageId: "existing-dark", logoInvertInDarkMode: true, letterheadStorageId: "existing-letterhead" },
    { _id: "other", name: "Synthetic other workspace", isCharity: false, isMemberFunded: false, updatedAt: 1 },
  ],
  users: [
    ...roles.map((role) => ({ _id: role, societyId: "company", role, status: "Active", authSubject: role, authIssuer: issuer, authProvider: "better-auth" })),
    { _id: "disabled", societyId: "company", role: "Admin", status: "Disabled", authSubject: "disabled", authIssuer: issuer },
  ],
  invoiceTemplates: [{ _id: "template", societyId: "company", isDefault: true, active: true, config: { brand: brands[1] } }],
  invoices: [{ _id: "issued", societyId: "company", status: "sent", documentTemplate: { brand: brands[1] } }],
};
const identity = (subject: string): PortablePrincipal => ({
  kind: "user", runtime: "test", assurance: "verified-jwt", subject, issuer, authProvider: "better-auth",
});
let principal = identity("Owner");
const db = new MemoryDb({ seed });
// Intentionally omit the application-policy wrapper here: the portable core
// itself must reject unauthorized writers, even when called from another handler.
const runtime = new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: () => principal })
  .register(definePortableMutation({ name: "society:setWorkspaceBrand", handler: setWorkspaceBrandPortable }));
const apply = (value: InvoiceBrand | null, useAccent = true, societyId = "company") =>
  runtime.runMutation("society:setWorkspaceBrand", { societyId, brand: value, useAccent });
const before = structuredClone(await db.get("company"));
const templateBefore = structuredClone(await db.get("template"));
const invoiceBefore = structuredClone(await db.get("issued"));
const otherBefore = structuredClone(await db.get("other"));
for (const role of ["Director", "Member", "Viewer"]) {
  principal = identity(role);
  await assert.rejects(() => apply(brand), /Permission society:write required/);
  assert.deepEqual(await db.get("company"), before);
}
principal = identity("disabled");
await assert.rejects(() => apply(brand), /disabled/i);
principal = { kind: "anonymous", runtime: "test", assurance: "none" };
await assert.rejects(() => apply(brand), /authenticated|denied|not found/i);
for (const role of ["Owner", "Admin"]) {
  principal = identity(role);
  const mutable = structuredClone(brand);
  assert.equal(await apply(mutable), "company");
  mutable.name = "Changed caller object";
  assert.deepEqual((await db.get("company"))?.workspaceBrand, brand, "stored snapshot is independent of the caller's object");
  assert.equal((await db.get("company"))?.workspaceBrandUseAccent, true);
}
const applied = structuredClone(await db.get("company"));
await assert.rejects(() => apply(brand, true, "other"), /not found/i);
for (const invalid of [malformed, active, oversize]) {
  await assert.rejects(() => apply(invalid), /vector|250 KB/);
  assert.deepEqual(await db.get("company"), applied, "a failed import cannot replace the saved workspace brand");
}
await assert.rejects(() => apply(brand, "true" as any), /accent/);
await apply(brands[3], false);
assert.deepEqual((await db.get("company"))?.workspaceBrand, brands[3]);
assert.equal((await db.get("company"))?.workspaceBrandUseAccent, false);
await apply(null);
const cleared = await db.get("company");
assert.equal(cleared?.workspaceBrand, undefined);
assert.equal(cleared?.workspaceBrandUseAccent, undefined);
const { updatedAt: _beforeTime, ...organizationBefore } = before!;
const { updatedAt: _afterTime, workspaceBrand: _brand, workspaceBrandUseAccent: _accent, ...organizationAfter } = cleared!;
assert.deepEqual(organizationAfter, organizationBefore, "brand changes preserve legal facts and uploaded logos/letterhead");
assert.deepEqual(await db.get("template"), templateBefore, "workspace branding does not update document defaults");
assert.deepEqual(await db.get("issued"), invoiceBefore, "issued document snapshots remain unchanged");
assert.deepEqual(await db.get("other"), otherBefore, "another workspace cannot be changed");

// The real hosted endpoint exercises its v.object validator, shared permission
// wrapper and persistence adapter, not only the portable test implementation.
const native = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./society.js": () => import("../convex/society"),
} as any);
const nativeSeed = await native.run(async (ctx) => {
  const societyId = await ctx.db.insert("societies", { name: "Synthetic legal organization", isCharity: false, isMemberFunded: false, updatedAt: 1 });
  const otherSocietyId = await ctx.db.insert("societies", { name: "Synthetic isolated organization", isCharity: false, isMemberFunded: false, updatedAt: 1 });
  for (const role of roles) {
    await ctx.db.insert("users", {
      societyId, email: `${role.toLowerCase()}@example.test`, displayName: role, role,
      status: "Active", authSubject: role, authIssuer: issuer, authProvider: "better-auth", createdAtISO: "2026-01-01",
    });
  }
  return { societyId, otherSocietyId };
});
for (const role of roles) {
  const actor = native.withIdentity({ subject: role, issuer });
  const args = { societyId: nativeSeed.societyId, brand, useAccent: true };
  if (role === "Owner" || role === "Admin") {
    await actor.mutation(api.society.setWorkspaceBrand, args);
    assert.deepEqual((await native.run((ctx) => ctx.db.get(nativeSeed.societyId)))?.workspaceBrand, brand);
  } else {
    await assert.rejects(() => actor.mutation(api.society.setWorkspaceBrand, args), /Permission society:write required/);
  }
  await assert.rejects(() => actor.mutation(api.society.setWorkspaceBrand, { ...args, societyId: nativeSeed.otherSocietyId }), /not found/i);
}
await assert.rejects(() => native.mutation(api.society.setWorkspaceBrand, { societyId: nativeSeed.societyId, brand, useAccent: true }), /not found|authenticat/i);
const nativeOwner = native.withIdentity({ subject: "Owner", issuer });
await assert.rejects(() => nativeOwner.mutation(api.society.setWorkspaceBrand, { societyId: nativeSeed.societyId, brand: malformed, useAccent: true }), /vector/);
await nativeOwner.mutation(api.society.setWorkspaceBrand, { societyId: nativeSeed.societyId, brand: null, useAccent: false });
const nativeCleared = await native.run((ctx) => ctx.db.get(nativeSeed.societyId));
assert.equal(nativeCleared?.workspaceBrand, undefined);
assert.equal(nativeCleared?.workspaceBrandUseAccent, undefined);
assert.equal(nativeCleared?.name, "Synthetic legal organization");

// Exercise the public local client and its snapshot boundary. A missing
// registry entry would route this new `set...` action to the wrong dispatcher.
const client = new StaticConvexClient({
  seed: { ...seed, societies: [seed.societies[0]] },
  principalProvider: () => identity("Owner"),
});
try {
  await client.mutation(api.society.setWorkspaceBrand, { societyId: "company", brand, useAccent: true });
  const view = await client.query(api.society.getById, { id: "company" });
  assert.deepEqual(view.workspaceBrand, brand);
  assert.equal(view.workspaceBrandUseAccent, true);
  const snapshot = await client.exportLocalWorkspaceSnapshotAsync();
  assert.deepEqual(snapshot.tables.societies.find((row) => row._id === "company")?.workspaceBrand, brand);
  assert.deepEqual(snapshot.tables.invoiceTemplates, seed.invoiceTemplates);
  assert.deepEqual(snapshot.tables.invoices, seed.invoices);
  await assert.rejects(() => client.mutation(api.society.setWorkspaceBrand, { societyId: "company", brand: malformed, useAccent: true }), /vector/);
  assert.deepEqual((await client.query(api.society.getById, { id: "company" })).workspaceBrand, brand);
  await client.mutation(api.society.setWorkspaceBrand, { societyId: "company", brand: null, useAccent: true });
  assert.equal((await client.query(api.society.getById, { id: "company" })).workspaceBrand, undefined);
} finally {
  await client.close();
}

console.log("Workspace branding backend: seven profiles, passive SVG validation, size limits, role/tenant isolation, hosted and local writes, clearing, and document snapshot preservation passed.");
