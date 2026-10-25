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
await assert.rejects(() => test.query(api.dashboard.summary, { societyId }), /membership|Authentication/i);
console.log("Corporation Convex dashboard passed: mixed director/role-holder IDs and unknown appointment dates validate; anonymous access stays denied.");
