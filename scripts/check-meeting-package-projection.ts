import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { toPortableQueryCtx } from "../convex/lib/portable";
import { packageForMeetingPortable } from "../shared/functions/meetingMaterials";
import { seedRegisterProjection } from "./fixtures/registerProjection";

const issuer = betterAuthIssuer();
const test = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./meetingMaterials.js": () => import("../convex/meetingMaterials"),
} as any);
const fixture = await test.run(async ctx => {
  const societyId = await ctx.db.insert("societies", { name: "Meeting package scoped qualification", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const users: Record<string, any> = {};
  for (const role of ["Owner", "Director", "Member", "Viewer"]) users[role] = await ctx.db.insert("users", { societyId, role, status: "Active", displayName: role, email: `${role}@example.test`, authIssuer: issuer, authSubject: role, createdAtISO: new Date().toISOString() });
  const fixture = await seedRegisterProjection(ctx, societyId, "package authority");
  await ctx.db.insert("meetingMaterials", { societyId, meetingId: fixture.meeting, documentId: fixture.publicDocument, order: 1, requiredForMeeting: true, accessLevel: "public", createdAtISO: new Date().toISOString() });
  await ctx.db.insert("minutes", { societyId, meetingId: fixture.meeting, heldAt: new Date().toISOString(), attendees: [], absent: [], quorumMet: true, discussion: "Scoped private minutes", motions: [], decisions: [], actionItems: [] });
  await ctx.db.insert("tasks", { societyId, meetingId: fixture.meeting, title: "Scoped private task", status: "Open", priority: "Normal", tags: [], createdAtISO: new Date().toISOString() });
  const agendaId = await ctx.db.insert("agendas", { societyId, meetingId: fixture.meeting, title: "Agenda", status: "Draft", createdAtISO: new Date().toISOString(), updatedAtISO: new Date().toISOString() });
  await ctx.db.insert("agendaItems", { societyId, agendaId, order: 0, type: "discussion", title: "Scoped private agenda", createdAtISO: new Date().toISOString() });
  return { societyId, users, ...fixture };
});
for (const role of ["Owner", "Director", "Member", "Viewer"]) {
  const result = await test.withIdentity({ issuer, subject: role }).query(api.meetingMaterials.packageForMeeting, { meetingId: fixture.meeting });
  assert.equal(result.minutes?.discussion, "Scoped private minutes");
  assert.equal(result.tasks.length, 1);
  assert.deepEqual(result.agenda, ["Scoped private agenda"]);
  assert.equal(result.materials.length, role === "Owner" ? 2 : 1);
  assert.deepEqual(result.restrictedResources, []);
}
await test.run(async native => {
  const portable = await toPortableQueryCtx(native);
  const scoped = (scopes: string[]) => ({ ...portable, principal: { kind: "service" as const, runtime: "test" as const, assurance: "trusted-internal" as const, subject: "meeting-package-service", societyId: String(fixture.societyId), actorUserId: String(fixture.users.Owner), scopes } });
  await assert.rejects(() => packageForMeetingPortable(scoped(["minutes:read"]), { meetingId: String(fixture.meeting) }), /Service scope meetings:read required/);
  const meetingOnly = await packageForMeetingPortable(scoped(["meetings:read"]), { meetingId: String(fixture.meeting) });
  assert.equal(meetingOnly.meeting._id, fixture.meeting);
  assert.equal(meetingOnly.minutes, null);
  for (const field of ["materials", "tasks", "agenda"] as const) assert.deepEqual(meetingOnly[field], []);
  assert.deepEqual(meetingOnly.restrictedResources, ["minutes", "agendas", "tasks", "documents"]);
  assert.ok(!JSON.stringify(meetingOnly).includes("Scoped private"));
  const minutesOnly = await packageForMeetingPortable(scoped(["meetings:read", "minutes:read"]), { meetingId: String(fixture.meeting) });
  assert.equal(minutesOnly.minutes?.discussion, "Scoped private minutes");
  assert.deepEqual(minutesOnly.tasks, []); assert.deepEqual(minutesOnly.materials, []); assert.deepEqual(minutesOnly.agenda, []);
  const documents = await packageForMeetingPortable(scoped(["meetings:read", "documents:read"]), { meetingId: String(fixture.meeting) });
  assert.equal(documents.materials.length, 2); assert.equal(documents.minutes, null);
  const broken = new Proxy(portable.db, { get(target, key) { if (key === "query") return () => { throw new Error("Unexpected meeting package failure"); }; return Reflect.get(target, key); } });
  await assert.rejects(() => packageForMeetingPortable({ ...scoped(["meetings:read"]), db: broken }, { meetingId: String(fixture.meeting) }), /Unexpected meeting package failure/);
});
await assert.rejects(() => test.query(api.meetingMaterials.packageForMeeting, { meetingId: fixture.meeting }), /principal|authentication|authorized/i);
console.log("Meeting package qualification passed: four actual role projections, restricted material ACL, narrow service read scopes, anonymous denial and unexpected failures preserved.");
