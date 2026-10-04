import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";

const issuer = betterAuthIssuer();
const test = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./minutes.js": () => import("../convex/minutes"),
} as any);
const ids = await test.run(async ctx => {
  const societyId = await ctx.db.insert("societies", { name: "Approval qualification", isCharity: false, isMemberFunded: false, updatedAt: Date.now() });
  for (const role of ["Owner", "Admin", "Director"]) await ctx.db.insert("users", { societyId, role, status: "Active", email: `${role}@example.test`, displayName: role, authSubject: role, authIssuer: issuer, authProvider: "better-auth", createdAtISO: new Date().toISOString() });
  const meetingId = await ctx.db.insert("meetings", { societyId, title: "Source", type: "Board", scheduledAt: "2026-10-04T10:00:00Z", electronic: false, status: "Complete", attendeeIds: [] });
  const targetMeetingId = await ctx.db.insert("meetings", { societyId, title: "Target", type: "Board", scheduledAt: "2026-09-04T10:00:00Z", electronic: false, status: "Complete", attendeeIds: [] });
  const values = { societyId, heldAt: "2026-10-04", attendees: [], absent: [], quorumMet: false, discussion: "Draft", motions: [], decisions: [], actionItems: [] };
  return { societyId, meetingId, targetMeetingId, source: await ctx.db.insert("minutes", { ...values, meetingId }), target: await ctx.db.insert("minutes", { ...values, meetingId: targetMeetingId }) };
});
const owner = test.withIdentity({ subject: "Owner", issuer });
const admin = test.withIdentity({ subject: "Admin", issuer });
const director = test.withIdentity({ subject: "Director", issuer });
const update = (actor: typeof director, id: any, patch: any) => actor.mutation(api.minutes.update, { id, patch });
await update(director, ids.source, { discussion: "Director draft edit" });
assert.equal((await test.run(ctx => ctx.db.get(ids.source)))?.discussion, "Director draft edit");
for (const patch of [{ approvedAt: "2026-10-04" }, { approvedInMeetingId: ids.meetingId }, { clearApproval: true }, { clearApprovedInMeeting: true }]) {
  await assert.rejects(() => update(director, ids.source, patch), /Permission minutes:approve/);
  assert.equal((await test.run(ctx => ctx.db.get(ids.source)))?.approvedAt, undefined);
}
const carried = { text: "Adopt prior minutes", outcome: "Carried", adoptsMinutesId: ids.target };
await assert.rejects(() => update(director, ids.source, { discussion: "Forbidden atomic draft", motions: [carried] }), /Permission minutes:approve/);
assert.equal((await test.run(ctx => ctx.db.get(ids.source)))?.discussion, "Director draft edit", "Denied approval must not partially save the drafter's record");
assert.equal((await test.run(ctx => ctx.db.get(ids.target)))?.approvedAt, undefined);
await update(admin, ids.source, { approvedAt: "2026-10-04", approvedInMeetingId: ids.meetingId });
assert.deepEqual((await test.run(ctx => ctx.db.get(ids.source)))?.motionSnapshots, []);
await assert.rejects(() => update(director, ids.source, { clearApproval: true }), /Permission minutes:approve/);
await update(admin, ids.source, { clearApproval: true });
assert.equal((await test.run(ctx => ctx.db.get(ids.source)))?.motionSnapshots, undefined);
await update(owner, ids.source, { motions: [carried] });
assert.equal((await test.run(ctx => ctx.db.get(ids.target)))?.approvedInMeetingId, ids.meetingId);
// An already-authorized carried adoption is not a new approval. A Director can
// continue editing the source draft without gaining permission to clear targets.
await update(director, ids.source, { discussion: "Continued drafting", motions: [carried] });
assert.equal((await test.run(ctx => ctx.db.get(ids.source)))?.discussion, "Continued drafting");
assert.ok((await test.run(ctx => ctx.db.get(ids.target)))?.approvedAt);
console.log("Minutes approval authority passed: Director drafting, all explicit approval/clear gates, denied atomic adoption, Admin approval/clear, Owner adoption, and unchanged adoption drafting.");
