import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";

const issuer = betterAuthIssuer();
const test = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./volunteers.js": () => import("../convex/volunteers"),
  "./grants.js": () => import("../convex/grants"),
  "./publicPortal.js": () => import("../convex/publicPortal"),
} as any);
const ids = await test.run(async ctx => {
  const societyId = await ctx.db.insert("societies", { name: "Published intake", isCharity: false, isMemberFunded: false, updatedAt: Date.now(), publicSlug: "published-intake", publicTransparencyEnabled: true, publicVolunteerIntakeEnabled: true, publicGrantIntakeEnabled: true });
  const privateId = await ctx.db.insert("societies", { name: "Private workspace", isCharity: false, isMemberFunded: false, updatedAt: Date.now() });
  const memberId = await ctx.db.insert("members", { societyId, firstName: "Private", lastName: "Member", status: "Active", membershipClass: "Regular", joinedAt: "2026-10-04", votingRights: true });
  const grant = { societyId, title: "Test opportunity", funder: "Test", status: "Open", createdAtISO: new Date().toISOString(), updatedAtISO: new Date().toISOString() };
  const publicGrant = await ctx.db.insert("grants", { ...grant, allowPublicApplications: true });
  const privateGrant = await ctx.db.insert("grants", { ...grant, allowPublicApplications: false });
  await ctx.db.insert("users", { societyId, role: "Admin", status: "Disabled", email: "disabled@example.test", displayName: "Disabled", authSubject: "disabled", authIssuer: issuer, authProvider: "better-auth", createdAtISO: new Date().toISOString() });
  return { societyId, privateId, memberId, publicGrant, privateGrant };
});
const volunteer = { societyId: ids.societyId, firstName: "Public", lastName: "Applicant", email: "public@example.test", interests: [] };
const grant = { societyId: ids.societyId, applicantName: "Public Applicant", email: "public@example.test", projectTitle: "Public proposal", projectSummary: "Proposal", grantId: ids.publicGrant };
assert.ok(await test.query(api.publicPortal.volunteerIntakeContext, { slug: "published-intake" }));
assert.ok(await test.query(api.publicPortal.grantIntakeContext, { slug: "published-intake" }));
const volunteerId = await test.mutation(api.volunteers.submitApplication, { ...volunteer, source: "forged-internal" });
assert.equal((await test.run(ctx => ctx.db.get(volunteerId)))?.source, "public");
assert.ok(await test.mutation(api.grants.submitApplication, grant));
assert.ok(await test.mutation(api.grants.submitApplication, { ...grant, grantId: undefined }));
await assert.rejects(() => test.mutation(api.volunteers.submitApplication, { ...volunteer, memberId: ids.memberId }), /cannot assign a workspace member/);
await assert.rejects(() => test.mutation(api.grants.submitApplication, { ...grant, memberId: ids.memberId }), /cannot assign a workspace member/);
await assert.rejects(() => test.mutation(api.grants.submitApplication, { ...grant, grantId: ids.privateGrant }), /unavailable/);
await assert.rejects(() => test.mutation(api.volunteers.submitApplication, { ...volunteer, societyId: ids.privateId }), /unavailable/);
await assert.rejects(() => test.mutation(api.grants.submitApplication, { ...grant, societyId: ids.privateId }), /unavailable/);
for (const resource of ["volunteers", "grants"] as const) await assert.rejects(() => test.query(api[resource].list, { societyId: ids.societyId }), /Authentication/);
await assert.rejects(() => test.withIdentity({ issuer, subject: "disabled" }).mutation(api.volunteers.submitApplication, volunteer), /disabled/);
await test.run(ctx => ctx.db.patch(ids.societyId, { disabledModules: ["volunteers", "grants"] }));
assert.equal(await test.query(api.publicPortal.volunteerIntakeContext, { slug: "published-intake" }), null);
await assert.rejects(() => test.mutation(api.volunteers.submitApplication, volunteer), /disabled/);
await assert.rejects(() => test.mutation(api.grants.submitApplication, grant), /disabled/);
await test.run(ctx => ctx.db.patch(ids.societyId, { disabledModules: [], publicTransparencyEnabled: false }));
await assert.rejects(() => test.mutation(api.volunteers.submitApplication, volunteer), /unavailable/);
await test.run(ctx => ctx.db.patch(ids.societyId, { publicTransparencyEnabled: true, publicVolunteerIntakeEnabled: false, publicGrantIntakeEnabled: false }));
await assert.rejects(() => test.mutation(api.volunteers.submitApplication, volunteer), /unavailable/);
await assert.rejects(() => test.mutation(api.grants.submitApplication, grant), /unavailable/);
console.log("Public intake authority passed: configured anonymous applications, fixed public attribution, private/unpublished/disabled denial, no private member/grant substitution, inactive membership denial, and protected roster reads.");
