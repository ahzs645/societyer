import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { StaticConvexClient } from "../src/lib/staticConvex";
import {
  NAICS_CANADA_SECTORS, NAICS_CANADA_VERSION, searchNaicsSectors, sectorForNaicsCode,
  validateNaicsSectorSelection,
} from "../shared/naicsCanada2022";

assert.equal(NAICS_CANADA_SECTORS.length, 20);
assert.equal(new Set(NAICS_CANADA_SECTORS.map((sector) => sector.code)).size, 20);
for (const [code, expected] of [["311811", "31-33"], ["445110", "44-45"], ["454110", "44-45"], ["492110", "48-49"], ["541514", "54"]]) {
  assert.equal(sectorForNaicsCode(code)?.code, expected);
  assert.equal(searchNaicsSectors(code)[0]?.code, expected);
}
assert.equal(sectorForNaicsCode("unknown"), undefined);
assert.equal(sectorForNaicsCode("999999"), undefined);
assert.ok(searchNaicsSectors("online shop").some((sector) => sector.code === "44-45"));
assert.ok(searchNaicsSectors("café").some((sector) => sector.code === "72"));
assert.ok(searchNaicsSectors("childcare").some((sector) => sector.code === "62"));
assert.ok(searchNaicsSectors("software").some((sector) => sector.code === "51"));
assert.ok(searchNaicsSectors("software").some((sector) => sector.code === "54"));
assert.equal(searchNaicsSectors("non-profit charity online").length, 20, "Legal form and online delivery alone must not imply a sector");
assert.equal(searchNaicsSectors("zzzzunknown").length, 0);
assert.ok(searchNaicsSectors("", "care").every((sector) => ["61", "62"].includes(sector.code)));
validateNaicsSectorSelection(undefined);
validateNaicsSectorSelection(null);
assert.throws(() => validateNaicsSectorSelection({ code: "99", version: NAICS_CANADA_VERSION }));
assert.throws(() => validateNaicsSectorSelection({ code: "54", version: "2017" }));

const selection = { code: "54" as const, version: NAICS_CANADA_VERSION };
const local = new StaticConvexClient({ databaseName: `naics-sector-${Date.now()}`, seed: { societies: [] } });
try {
  const { societyId } = await local.mutation("society:createWorkspace", { name: "Sector fixture" });
  await local.mutation("society:upsert", { id: societyId, naicsCode: "541514", naicsSector: selection });
  const saved = await local.query("society:getById", { id: societyId });
  assert.deepEqual(saved.naicsSector, selection);
  assert.equal(saved.naicsCode, "541514");
  const backup = local.exportLocalWorkspaceSnapshot();
  assert.deepEqual(backup.tables.societies.find((row: any) => row._id === societyId)?.naicsSector, selection);
  await local.mutation("society:upsert", { id: societyId, naicsSector: null });
  const cleared = await local.query("society:getById", { id: societyId });
  assert.equal(cleared.naicsSector, null);
  assert.equal(cleared.naicsCode, "541514", "Clearing the sector must preserve a detailed code");
  await assert.rejects(() => local.mutation("society:upsert", { id: societyId, naicsSector: { code: "99", version: NAICS_CANADA_VERSION } }));
} finally { local.close(); }

// Exercise the real hosted mutation and validators without deploying to an account.
const native = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./society.js": () => import("../convex/society"),
});
const issuer = betterAuthIssuer();
const societyId = await native.run(async (ctx) => {
  const id = await ctx.db.insert("societies", { name: "Hosted sector fixture", isCharity: false, isMemberFunded: false, updatedAt: 0, naicsCode: "541514" });
  await ctx.db.insert("users", { societyId: id, role: "Owner", status: "Active", displayName: "Sector owner", email: "sector@example.test", authSubject: "sector-owner", authIssuer: issuer, createdAtISO: "2026-01-01" });
  return id;
});
const owner = native.withIdentity({ issuer, subject: "sector-owner" });
const base = { id: societyId, name: "Hosted sector fixture", isCharity: false, isMemberFunded: false };
await owner.mutation(api.society.upsert, { ...base, naicsSector: selection });
assert.deepEqual((await native.run((ctx) => ctx.db.get(societyId)))?.naicsSector, selection);
await assert.rejects(() => owner.mutation(api.society.upsert, { ...base, naicsSector: { code: "99", version: NAICS_CANADA_VERSION } }));
await assert.rejects(() => owner.mutation(api.society.upsert, { ...base, naicsSector: { code: "54", version: "2017" } }));
await owner.mutation(api.society.upsert, { ...base, naicsSector: null });
const cleared = await native.run((ctx) => ctx.db.get(societyId));
assert.equal(cleared?.naicsSector, null);
assert.equal(cleared?.naicsCode, "541514");
console.log("NAICS checks passed: sector search, code ranges, hosted/local saves, backup, clearing and invalid selections.");
