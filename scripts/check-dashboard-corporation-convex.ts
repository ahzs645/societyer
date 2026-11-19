import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";

const issuer = betterAuthIssuer();
const test = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./dashboard.js": () => import("../convex/dashboard"),
} as any);
const { societyId, roleHolderId, rosterId } = await test.run(async ctx => {
  const societyId = await ctx.db.insert("societies", { name: "Synthetic dashboard corporation", entityType: "corporation", jurisdictionCode: "CA-BC", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  await ctx.db.insert("users", { societyId, role: "Owner", status: "Active", displayName: "Dashboard owner", email: "dashboard@example.invalid", authSubject: "dashboard-owner", authIssuer: issuer, authProvider: "better-auth", createdAtISO: "2026-01-01" });
  const roleHolderId = await ctx.db.insert("roleHolders", { societyId, roleType: "director", status: "current", fullName: "Undated Corporate Director", citizenshipCountries: [], taxResidenceCountries: [], relatedShareholderIds: [], controllingIndividualIds: [], sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: "2026-01-01", updatedAtISO: "2026-01-01" });
  const rosterId = await ctx.db.insert("directors", { societyId, firstName: "Roster", lastName: "Director", position: "Director", status: "Active", termStart: "2026-01-01", isBCResident: true, consentOnFile: true });
  return { societyId, roleHolderId, rosterId };
});
const owner = test.withIdentity({ subject: "dashboard-owner", issuer });
const dashboard = await owner.query(api.dashboard.summary, { societyId });
assert.equal(dashboard.counts.directors, 2);
assert.ok(dashboard.board.some((row: any) => row._id === roleHolderId), "a corporation director keeps its actual roleHolders ID through return validation");
assert.equal(dashboard.board.find((row: any) => row._id === roleHolderId)?.termStart, undefined, "a missing source date remains unknown");
assert.equal(dashboard.board.find((row: any) => row._id === rosterId)?.termStart, "2026-01-01");

// Exercise the hosted return validator, not just the portable handler: a
// neutral preparation flag must be accepted for every pre-incorporation state.
for (const state of [
  { label: "preparing", formationStatus: "preparing", organizationStatus: undefined },
  { label: "submitted", formationStatus: "submitted", organizationStatus: undefined },
  { label: "legacy pre-incorporation", formationStatus: undefined, organizationStatus: "pre_incorporation" },
] as const) {
  await test.run(async ctx => ctx.db.patch(societyId, { formationStatus: state.formationStatus, organizationStatus: state.organizationStatus }));
  const preparing = await owner.query(api.dashboard.summary, { societyId });
  const note = preparing.complianceFlags.find((flag: any) => flag.ruleId === "DASHBOARD-COMPLIANCE-PREPARING");
  assert.equal(note?.level, "info", `${state.label} returns its neutral preparation note through Convex validation`);
  assert.ok(!preparing.complianceFlags.some((flag: any) => flag.ruleId.startsWith("LEGAL-")), `${state.label} does not run incorporated legal checks`);
  await assert.rejects(() => test.query(api.dashboard.summary, { societyId }), /membership|Authentication/i);
}

// A recorded incorporation takes precedence over a stale legacy status and
// restores the same legal checks as the existing incorporated/default path.
await test.run(async ctx => ctx.db.patch(societyId, { formationStatus: "incorporated", organizationStatus: "pre_incorporation" }));
const incorporated = await owner.query(api.dashboard.summary, { societyId });
assert.deepEqual(incorporated.complianceFlags, dashboard.complianceFlags, "incorporation restores the existing compliance flags");
assert.ok(!incorporated.complianceFlags.some((flag: any) => flag.ruleId === "DASHBOARD-COMPLIANCE-PREPARING"));
await assert.rejects(() => test.query(api.dashboard.summary, { societyId }), /membership|Authentication/i);
console.log("Corporation Convex dashboard passed: mixed director/role-holder IDs, unknown appointment dates and all preparation states validate; incorporation restores legal checks and anonymous access stays denied.");
