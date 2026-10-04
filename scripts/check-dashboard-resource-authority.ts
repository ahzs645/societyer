import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { toPortableQueryCtx } from "../convex/lib/portable";
import { navCountsPortable, summaryPortable } from "../shared/functions/dashboard";

const issuer = betterAuthIssuer();
const test = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./dashboard.js": () => import("../convex/dashboard"),
} as any);
const fixture = await test.run(async ctx => {
  const societyId = await ctx.db.insert("societies", { name: "Dashboard resource qualification", isCharity: false, isMemberFunded: false, updatedAt: Date.now() });
  const users: Record<string, any> = {};
  for (const role of ["Owner", "Viewer", "Member"]) users[role] = await ctx.db.insert("users", { societyId, role, status: "Active", displayName: `${role} dashboard actor`, email: `${role}@example.test`, authSubject: role, authIssuer: issuer, authProvider: "better-auth", createdAtISO: new Date().toISOString() });
  await ctx.db.insert("members", { societyId, firstName: "Readable", lastName: "Member", membershipClass: "Regular", status: "Active", joinedAt: "2026-01-01", votingRights: true });
  const directorId = await ctx.db.insert("directors", { societyId, firstName: "Restricted", lastName: "Director marker", position: "Director", status: "Active", termStart: "2026-01-01", isBCResident: false, consentOnFile: false });
  await ctx.db.insert("meetings", { societyId, title: "Readable meeting", type: "Board", scheduledAt: new Date(Date.now() + 86400000).toISOString(), electronic: false, status: "Scheduled", attendeeIds: [] });
  await ctx.db.insert("filings", { societyId, kind: "Restricted future filing marker", dueDate: "2030-01-01", status: "Draft" });
  const filingId = await ctx.db.insert("filings", { societyId, kind: "Restricted proof marker", dueDate: "2026-01-01", filedAt: "2026-01-02", status: "Filed", confirmationNumber: "Restricted confirmation marker", evidenceNotes: "Restricted evidence marker", submittedByUserId: users.Owner });
  await ctx.db.insert("activity", { societyId, entityType: "filing", entityId: filingId, actor: "Restricted audit marker", action: "filed", summary: "Proof recorded", createdAtISO: new Date().toISOString() });
  await ctx.db.insert("deadlines", { societyId, title: "Restricted deadline marker", dueDate: "2026-01-01", category: "Governance", done: false });
  await ctx.db.insert("conflicts", { societyId, directorId, declaredAt: "2026-01-01", contractOrMatter: "Restricted conflict marker", natureOfInterest: "Private", abstainedFromVote: true, leftRoom: true });
  await ctx.db.insert("committees", { societyId, name: "Restricted committee marker", status: "Active", cadence: "Monthly", color: "blue", createdAtISO: new Date().toISOString() });
  await ctx.db.insert("goals", { societyId, title: "Restricted goal marker", status: "OnTrack", progressPercent: 10, targetDate: "2030-01-01", category: "Governance", startDate: "2026-01-01", milestones: [], keyResults: [], createdAtISO: new Date().toISOString() });
  await ctx.db.insert("tasks", { societyId, title: "Readable task", status: "Todo", priority: "High", tags: [], createdAtISO: new Date().toISOString() });
  return { societyId, users };
});
const actors = Object.fromEntries(["Owner", "Viewer", "Member"].map(role => [role, test.withIdentity({ subject: role, issuer })]));
const owner = await actors.Owner.query(api.dashboard.summary, { societyId: fixture.societyId });
const viewer = await actors.Viewer.query(api.dashboard.summary, { societyId: fixture.societyId });
assert.deepEqual(viewer, owner, "Viewer retains declared resource read grants, not write authority");
assert.equal(owner.board.length, 1); assert.equal(owner.upcomingFilings.length, 1); assert.equal(owner.evidenceChains.length, 1); assert.equal(owner.goals.length, 1);
assert.ok(JSON.stringify(owner).includes("Restricted confirmation marker"));
const member = await actors.Member.query(api.dashboard.summary, { societyId: fixture.societyId });
assert.equal(member.upcomingMeetings.length, 1); assert.equal(member.openTasks.length, 1); assert.equal(member.counts.members, 1);
for (const field of ["board", "upcomingFilings", "overdueFilings", "goals", "evidenceChains"]) assert.deepEqual(member[field], [], field);
for (const field of ["directors", "bcResidents", "overdueFilings", "openDeadlines", "openConflicts", "committees", "openGoals"]) assert.equal(member.counts[field], 0, field);
assert.ok(!JSON.stringify(member).includes("Restricted"), "Composite cannot bypass forbidden resource endpoints");
assert.ok(!member.complianceFlags.some((flag: any) => flag.ruleId.startsWith("BC-SOC-DIRECTOR") || flag.ruleId === "DASHBOARD-COMPLIANCE-OK"), "Unreadable board must not create false failure or overall-compliance claims");
assert.ok(member.complianceFlags.some((flag: any) => flag.ruleId === "PIPA-POLICY-DOCUMENTED"), "Authorized document/society checks still run");
const badges = await actors.Member.query(api.dashboard.navCounts, { societyId: fixture.societyId });
assert.equal(badges.members, 1); assert.equal(badges.openTasks, 1); assert.equal(badges.directors, 0); assert.equal(badges.openDeadlines, 0);
await test.run(async ctx => {
  const portable = await toPortableQueryCtx(ctx);
  const scoped = { ...portable, principal: { kind: "service" as const, runtime: "test" as const, assurance: "trusted-internal" as const, subject: "dashboard-service", actorUserId: String(fixture.users.Owner), societyId: String(fixture.societyId), scopes: ["society:read", "meetings:read"] } };
  const service = await summaryPortable(scoped, { societyId: String(fixture.societyId) });
  assert.equal(service.upcomingMeetings.length, 1); assert.equal(service.counts.members, 0); assert.deepEqual(service.board, []); assert.deepEqual(service.openTasks, []); assert.deepEqual(service.complianceFlags, []); assert.deepEqual(service.evidenceChains, []);
  assert.deepEqual(service.readAccess, ["meetings:read"]);
  assert.equal((await navCountsPortable(scoped, { societyId: String(fixture.societyId) })).openTasks, 0);
  await assert.rejects(() => summaryPortable({ ...scoped, principal: { ...scoped.principal, scopes: ["meetings:read"] } }, { societyId: String(fixture.societyId) }), /Service scope society:read required/);
  let membershipReads = 0;
  const brokenDb = new Proxy(portable.db, { get(target, key) {
    const value = Reflect.get(target, key);
    if (key === "get") return (...args: any[]) => {
      if (++membershipReads > 1) throw new Error("Unexpected dashboard database failure");
      return (value as any).apply(target, args);
    };
    return typeof value === "function" ? value.bind(target) : value;
  } });
  await assert.rejects(() => summaryPortable({ ...scoped, db: brokenDb }, { societyId: String(fixture.societyId) }), /Unexpected dashboard database failure/);
});
console.log("Dashboard authority passed: Owner/Viewer full reads, Member resource projections and badges, authorized compliance checks, no false unreadable-board claims, service scopes and unexpected database errors preserved.");
