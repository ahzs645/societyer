/**
 * Deployment-operator tools for linked logins and duplicate memberships:
 * accountLinks:operatorInspect / operatorUnlink and users:operatorRetireMembership.
 */
import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { toPortableQueryCtx } from "../convex/lib/portable";
import { membershipsForIdentities } from "../shared/functions/identity";
import { membershipStatusLabel } from "../shared/membershipStatusLabel";

const issuer = "https://operator-identity-tools.convex.site";
Object.assign(process.env, {
  AUTH_MODE: "convex", VITE_AUTH_MODE: "convex", CONVEX_SITE_URL: issuer,
  SITE_URL: "https://app.operator-identity-tools.example", BETTER_AUTH_SECRET: "operator-identity-tools-test-secret-0000000000000",
});
for (const key of ["SOCIETYER_ENTRA_LOGIN", "SOCIETYER_ENTRA_SSO_REQUIRED", "SOCIETYER_AUTH_ALLOWED_EMAIL_DOMAINS"]) delete process.env[key];

const t = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api"),
  "./_generated/server.js": () => import("../convex/_generated/server"),
  "./http.js": () => import("../convex/http"),
  "./society.js": () => import("../convex/society"),
  "./users.js": () => import("../convex/users"),
  "./invitations.js": () => import("../convex/invitations"),
  "./accountLinks.js": () => import("../convex/accountLinks"),
});

const as = (subject: string) => t.withIdentity({
  issuer, subject, tokenIdentifier: `${issuer}|${subject}`, email: `${subject}@example.test`, emailVerified: true,
  "societyer_session.id": `session-${subject}`, "societyer_session.createdAt": Date.now() - 60_000,
});
type Client = ReturnType<typeof as>;

const f = await t.run(async (ctx) => {
  const workspace = (name: string) => ctx.db.insert("societies", { name, isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const [shared, other, solo, ranks, qa, qb, qc] = await Promise.all(["Shared", "Other", "Solo", "Ranks", "QA", "QB", "QC"].map(workspace));
  const member = async (societyId: typeof shared, subject: string, role: string, status = "Active") => {
    const existing = await ctx.db.query("externalIdentities").withIndex("by_issuer_subject", (q) => q.eq("issuer", issuer).eq("subject", subject)).unique();
    const externalIdentityId = existing?._id ?? await ctx.db.insert("externalIdentities", { issuer, subject, status: "Active", createdAtISO: new Date(0).toISOString() });
    return ctx.db.insert("users", {
      societyId, email: `${subject}@example.test`, displayName: subject.toUpperCase(), role, status, authIssuer: issuer, authSubject: subject,
      authProvider: "convex", externalIdentityId, createdAtISO: new Date(0).toISOString(),
    });
  };
  const owner = await member(shared, "owner", "Owner");
  const pwShared = await member(shared, "pw", "Admin"); // the password login, with history
  const msShared = await member(shared, "ms", "Viewer"); // the provisioned Microsoft login
  const pwOther = await member(other, "pw", "Owner");
  const disabledShared = await member(shared, "gone", "Member", "Disabled");
  const soloOwner = await member(solo, "so", "Owner");
  const soloViewer = await member(solo, "sv", "Viewer");
  const hiOwner = await member(ranks, "hi", "Owner");
  await member(ranks, "boss", "Owner");
  const loMember = await member(ranks, "lo", "Member");
  await member(qa, "q1", "Owner");
  await member(qb, "q2", "Owner");
  await member(qc, "q3", "Owner");
  // A history row written by the Microsoft membership before the merge.
  const history = await ctx.db.insert("activity", { societyId: shared, actor: "MS", entityType: "user", entityId: msShared, subjectId: msShared,
    action: "updated", summary: "Earlier work", createdAtISO: new Date(0).toISOString() });
  return { shared, other, solo, ranks, qa, qc, owner, pwShared, msShared, pwOther, disabledShared, soloOwner, soloViewer, hiOwner, loMember, history };
});

const reachable = async (client: Client, id: string) => {
  try { return (await client.query(api.society.getById, { id: id as typeof f.shared }))._id === id; } catch { return false; }
};
const begin = async (subject: string) => {
  const started = await as(subject).mutation(api.accountLinks.begin, {});
  assert.equal(started.status, "started");
  return started.code as string;
};
const confirmLink = async (initiator: string, target: string) => as(target).mutation(api.accountLinks.confirm, { code: await begin(initiator) });
const inspect = (subject: string) => t.query(internal.accountLinks.operatorInspect, { issuer, subject });
const retire = (retireUserId: string, keepUserId: string, reason = "Duplicate after Microsoft provisioning") =>
  t.mutation(internal.users.operatorRetireMembership, { retireUserId, keepUserId, reason });
const rejects = async (promise: Promise<unknown>, pattern: RegExp, message: string) => assert.rejects(promise, pattern, message);

// ---------- operatorInspect: an identity that isn't linked ----------
const lone = await inspect("pw");
assert.equal(lone.state, "none");
assert.equal(lone.person, null);
assert.deepEqual(lone.identities.map((identity: { subject: string; externalIdentity: string }) => [identity.subject, identity.externalIdentity]), [["pw", "active"]]);
assert.deepEqual(lone.identities[0].memberships.map((m: { userId: string; workspaceName: string; role: string; status: string }) => [m.userId, m.workspaceName, m.role, m.status]),
  [[f.pwShared, "Shared", "Admin", "Active"], [f.pwOther, "Other", "Owner", "Active"]]);
assert.deepEqual((await inspect("nobody")).identities[0], { issuer, subject: "nobody", externalIdentity: "missing", memberships: [] });

// ---------- The conflict the user-facing link refuses ----------
assert.deepEqual(await confirmLink("pw", "ms"), { status: "conflict", conflicts: [{ workspaceName: "Shared" }] });

// ---------- operatorRetireMembership refusals ----------
await rejects(retire(f.msShared, f.pwShared, "  "), /reason/, "A reason is required");
await rejects(retire(f.msShared, f.msShared), /two different/, "Not the same row");
await rejects(retire(f.msShared, f.pwOther), /same workspace/, "Cross-society refused");
await rejects(retire(f.msShared, f.disabledShared), /must be Active/, "An inactive keep is refused");
await rejects(retire(f.soloOwner, f.soloViewer), /last Active Owner/, "The last Active Owner can't be retired into a non-Owner");
const refusedRows = await t.run(async (ctx) => Promise.all([f.msShared, f.soloOwner].map((id) => ctx.db.get(id))));
assert.deepEqual(refusedRows.map((row) => [row?.status, row?.authSubject, row?.mergedIntoUserId]), [["Active", "ms", undefined], ["Active", "so", undefined]], "Refusals change nothing");

// ---------- Retire the Microsoft login's duplicate, keep the password login's membership ----------
const retired = await retire(f.msShared, f.pwShared);
assert.deepEqual(retired, {
  status: "retired", societyId: f.shared, retiredUserId: f.msShared, keptUserId: f.pwShared, keptRole: "Admin", retiredRole: "Viewer",
  retiredIdentity: { issuer, subject: "ms" },
});
await rejects(retire(f.msShared, f.pwShared), /already merged/, "Retiring twice is refused");
await rejects(retire(f.owner, f.msShared), /must be Active/, "A retired row can't be kept");
const [retiredRow, keptRow, historyRow] = await t.run(async (ctx) => Promise.all([ctx.db.get(f.msShared), ctx.db.get(f.pwShared), ctx.db.get(f.history)]));
assert.equal(retiredRow?.status, "Disabled");
assert.equal(retiredRow?.mergedIntoUserId, f.pwShared);
assert.ok(retiredRow?.mergedAtISO);
assert.deepEqual([retiredRow?.authSubject, retiredRow?.authIssuer, retiredRow?.authProvider, retiredRow?.externalIdentityId], [undefined, undefined, undefined, undefined]);
assert.deepEqual([keptRow?.role, keptRow?.status, keptRow?.authSubject], ["Admin", "Active", "pw"], "The kept row is untouched");
assert.equal(historyRow?.entityId, f.msShared, "History keeps the retired id");
assert.equal((await t.run((ctx) => ctx.db.get(historyRow!.entityId as typeof f.msShared)))?.displayName, "MS", "…and it still resolves to a row");
const mergeActivity = await t.run((ctx) => ctx.db.query("activity").collect()).then((rows) => rows.filter((row) => row.action === "membership-merged"));
assert.equal(mergeActivity.length, 1);
assert.equal(mergeActivity[0].actor, "Deployment operator");
assert.match(mergeActivity[0].summary, /MS \(Viewer, Active\) into PW \(Admin\)\. Reason: Duplicate after Microsoft provisioning/);

// ---------- The link the conflict check refused now succeeds and resolves exactly one membership ----------
assert.deepEqual(await confirmLink("pw", "ms"), { status: "linked" });
for (const subject of ["pw", "ms"]) {
  assert.equal(await reachable(as(subject), f.shared), true, `${subject} reaches Shared`);
  const lookup = await as(subject).query(api.http.currentPrincipalMemberships, {});
  const sharedRows = lookup.memberships.filter((item: { society: { _id: string } }) => item.society._id === f.shared);
  assert.deepEqual(sharedRows.map((item: { userId: string; role: string }) => [item.userId, item.role]), [[f.pwShared, "Admin"]], `${subject}: exactly the kept membership`);
  assert.deepEqual(await as(subject).mutation(api.users.ensureCurrentMembership, { societyId: f.shared }), { status: "bound", societyId: f.shared, userId: f.pwShared });
}

// ---------- No identity can reach the retired row ----------
await t.run(async (ctx) => {
  const db = (await toPortableQueryCtx({ ...ctx, auth: { getUserIdentity: async () => null } })).db;
  const subjects = ["owner", "pw", "ms", "gone", "so", "sv", "hi", "boss", "lo"];
  const rows = await membershipsForIdentities(db, subjects.map((subject) => ({ issuer, subject })));
  assert.ok(!rows.some((row) => row._id === f.msShared), "Not bound to any identity");
  assert.equal((await ctx.db.query("users").withIndex("by_auth_subject", (q) => q.eq("authSubject", "ms")).collect()).length, 0);
});
const roster = await as("pw").query(api.users.list, { societyId: f.shared });
const listed = roster.find((row: { _id: string }) => row._id === f.msShared);
assert.equal(listed.mergedIntoDisplayName, "PW");
assert.equal(membershipStatusLabel(listed, true), "Merged into PW");
assert.equal(membershipStatusLabel({ status: "Active" }, true), "Not joined");
assert.equal(membershipStatusLabel({ status: "Active", authSubject: "x" }, true), "Active");
await rejects(as("pw").mutation(api.users.upsert, { id: f.msShared, societyId: f.shared, email: "ms@example.test", displayName: "MS", role: "Viewer", status: "Active" }),
  /merged into another/, "A retired row can't be reactivated");
await as("owner").mutation(api.users.upsert, { id: f.pwShared, societyId: f.shared, email: "ms@example.test", displayName: "PW", role: "Admin", status: "Active" });
assert.equal((await t.run((ctx) => ctx.db.get(f.pwShared)))?.email, "ms@example.test", "A retired row doesn't hold its email address");
await rejects(as("pw").mutation(api.invitations.create, { societyId: f.shared, email: "ms@example.test", role: "Viewer", targetUserId: f.msShared }),
  /Restore the user record/, "A retired row can't be invited to join");

// ---------- A higher role on the retired row is reported, never carried over ----------
const ranked = await retire(f.hiOwner, f.loMember, "Same person, two logins");
assert.equal(ranked.roleNotCarried, "Owner");
assert.equal((await t.run((ctx) => ctx.db.get(f.loMember)))?.role, "Member", "No escalation");
const rankActivity = (await t.run((ctx) => ctx.db.query("activity").collect())).find((row) => row.entityId === f.hiOwner && row.action === "membership-merged");
assert.match(rankActivity!.summary, /The retired membership was Owner; LO stays Member until an Owner decides\./);

// ---------- operatorInspect: who is linked to what ----------
const linked = await inspect("ms");
assert.equal(linked.state, "linked");
assert.equal(linked.person.status, "Active");
assert.deepEqual(linked.people, [{ personAccountId: linked.person.personAccountId, status: "Active" }]);
assert.deepEqual(linked.identities.map((identity: { subject: string; email: string; linkedAtISO?: string }) => [identity.subject, identity.email, Boolean(identity.linkedAtISO)]),
  [["ms", "ms@example.test", true], ["pw", "pw@example.test", true]]);
assert.deepEqual(linked.identities[0].memberships, [], "The retired row isn't the Microsoft login's any more");
assert.deepEqual(linked.identities[1].memberships.map((m: { workspaceName: string; role: string }) => [m.workspaceName, m.role]), [["Shared", "Admin"], ["Other", "Owner"]]);
assert.deepEqual(linked.events.map((event: { action: string; reason?: string }) => [event.action, event.reason ?? ""]), [["linked", ""], ["refused", "conflict"]]);

// ---------- operatorUnlink ----------
await rejects(t.mutation(internal.accountLinks.operatorUnlink, { issuer, subject: "ms", reason: "" }), /reason/, "A reason is required");
assert.deepEqual(await t.mutation(internal.accountLinks.operatorUnlink, { issuer, subject: "ms", reason: "Ticket 42: lost access to the password login" }),
  { status: "unlinked", people: [{ personAccountId: linked.person.personAccountId, personRemoved: true }] });
assert.equal(await reachable(as("ms"), f.shared), false, "The Microsoft login loses the linked membership");
assert.equal(await reachable(as("ms"), f.other), false);
assert.equal(await reachable(as("pw"), f.shared), true, "The password login keeps its own");
const unlinkEvent = (await t.run((ctx) => ctx.db.query("accountLinkEvents").collect())).at(-1)!;
assert.deepEqual([unlinkEvent.action, unlinkEvent.actorIssuer, unlinkEvent.actorSubject, unlinkEvent.reason],
  ["unlinked", "operator", "deployment-operator", "person-removed; Ticket 42: lost access to the password login"]);
assert.deepEqual(unlinkEvent.identities.map((identity) => identity.subject).sort(), ["ms", "pw"]);
assert.equal((await inspect("ms")).state, "none");
assert.deepEqual(await t.mutation(internal.accountLinks.operatorUnlink, { issuer, subject: "ms", reason: "again" }), { status: "not-linked" });

// Three logins: the person stays with the other two; a Disabled person (dashboard) is still unlinkable.
assert.deepEqual(await confirmLink("q1", "q2"), { status: "linked" });
assert.deepEqual(await confirmLink("q1", "q3"), { status: "linked" });
assert.equal(await reachable(as("q3"), f.qa), true);
const trio = await inspect("q3");
const unlinkQ3 = await t.mutation(internal.accountLinks.operatorUnlink, { issuer, subject: "q3", reason: "Shared device" });
assert.deepEqual(unlinkQ3, { status: "unlinked", people: [{ personAccountId: trio.person.personAccountId, personRemoved: false }] });
assert.equal(await reachable(as("q3"), f.qa), false);
assert.equal(await reachable(as("q2"), f.qa), true, "The others stay linked");
await t.run((ctx) => ctx.db.patch(trio.person.personAccountId, { status: "Disabled" }));
assert.equal((await inspect("q2")).state, "blocked");
assert.deepEqual((await inspect("q2")).people, [{ personAccountId: trio.person.personAccountId, status: "Disabled" }]);
assert.equal((await as("q2").mutation(api.accountLinks.begin, {})).status, "identity-disabled");
assert.equal((await t.mutation(internal.accountLinks.operatorUnlink, { issuer, subject: "q2", reason: "Clear disabled person" })).status, "unlinked");
assert.equal((await inspect("q1")).state, "none", "The last other link went with it");
assert.deepEqual(await confirmLink("q2", "q1"), { status: "linked" }, "Both can link again");

console.log("Operator identity tools passed: inspect, unlink (incl. disabled person, kept person), retire refusals (reason, same row, cross-society, inactive keep, last Owner, twice), no role escalation, retired row unreachable/unbindable with history intact, previously refused link now resolves one membership.");
