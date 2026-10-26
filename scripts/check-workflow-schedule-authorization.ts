import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { scheduleDefinitionFingerprint } from "../shared/workflows/scheduleAuthorization";

// Every record is synthetic. These exercise actual registered Convex handlers,
// their auth wrappers and transactional writes; no external provider is called.
const modules = {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./authorization.js": () => import("../convex/authorization"),
  "./workflows.js": () => import("../convex/workflows"),
};
const issuer = betterAuthIssuer();
const expiresAtISO = () => new Date(Date.now() + 30 * 86_400_000).toISOString();
const day = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function fixture() {
  const test = convexTest(schema, modules);
  const ids = await test.run(async ctx => {
    const societyId = await ctx.db.insert("societies", { name: "Synthetic schedule workspace", isCharity: false, isMemberFunded: false, updatedAt: 0 });
    const foreignId = await ctx.db.insert("societies", { name: "Synthetic foreign workspace", isCharity: false, isMemberFunded: false, updatedAt: 0 });
    const identityId = await ctx.db.insert("externalIdentities", { issuer, subject: "owner", status: "Active", createdAtISO: new Date().toISOString() });
    const users: Record<string, any> = {};
    for (const role of ["Owner", "Admin", "Director", "Member", "Viewer"]) users[role] = await ctx.db.insert("users", {
      societyId, role, displayName: `Synthetic ${role}`, status: "Active",
      email: `${role.toLowerCase()}@schedule.invalid`, authIssuer: issuer,
      authSubject: role.toLowerCase(), ...(role === "Owner" ? { externalIdentityId: identityId } : {}),
      createdAtISO: new Date().toISOString(),
    });
    const foreignUser = await ctx.db.insert("users", {
      societyId: foreignId, role: "Owner", displayName: "Synthetic foreign owner", status: "Active",
      authIssuer: issuer, authSubject: "foreign", email: "foreign@schedule.invalid", createdAtISO: new Date().toISOString(),
    });
    return { societyId, foreignId, identityId, users, foreignUser };
  });
  const actor = (subject = "owner") => test.withIdentity({ issuer, subject });
  const workflow = (patch: Record<string, any> = {}) => test.run(ctx => ctx.db.insert("workflows", {
    societyId: ids.societyId, name: "Scheduled insurance review", recipe: "insurance_renewal",
    provider: "internal", status: "active", trigger: { kind: "cron", cron: "0 9 * * *" },
    createdByUserId: ids.users.Admin, ...patch,
  }));
  const authorize = async (id: any, subject = "owner") => {
    const status = await actor(subject).query(api.workflows.scheduleStatus, { id });
    assert.equal(status.supported, true, status.reason);
    return actor(subject).mutation(api.workflows.authorizeSchedule, { id, expiresAtISO: expiresAtISO(), expectedDefinitionFingerprint: status.definitionFingerprint });
  };
  const due = async (id: any, offset = -60_000) => {
    const dueAtISO = new Date(Date.now() + offset).toISOString();
    await test.run(ctx => ctx.db.patch(id, { nextRunAtISO: dueAtISO }));
    return dueAtISO;
  };
  const runs = (id: any) => test.run(ctx => ctx.db.query("workflowRuns").withIndex("by_workflow", q => q.eq("workflowId", id)).collect());
  const effects = () => test.run(async ctx => ({ tasks: await ctx.db.query("tasks").collect(), notifications: await ctx.db.query("notifications").collect() }));
  const policy = (societyId = ids.societyId, number = "SYNTHETIC-1") => test.run(ctx => ctx.db.insert("insurancePolicies", {
    societyId, kind: "Other", insurer: "Synthetic insurer", policyNumber: number,
    status: "Active", startDate: day(-120), endDate: day(20), renewalDate: day(20),
    createdAtISO: new Date().toISOString(), updatedAtISO: new Date().toISOString(),
  }));
  return { test, ids, actor, workflow, authorize, due, runs, effects, policy };
}

{
  const f = await fixture();
  const id = await f.workflow({ nextRunAtISO: new Date(Date.now() - 1000).toISOString() });
  const status = await f.actor().query(api.workflows.scheduleStatus, { id });
  assert.equal(status.state, "not_authorized");
  assert.deepEqual(status.definition, { name: "Scheduled insurance review", recipe: "insurance_renewal", cron: "0 9 * * *" });
  assert.equal((await f.test.query(internal.workflows._listDue, { dueBefore: new Date().toISOString() })).length, 0, "Legacy due rows do not acquire authority from their creator.");
  await f.test.action(internal.workflows.scan, {});
  assert.equal((await f.runs(id)).length, 0);
  const args = { id, expiresAtISO: expiresAtISO(), expectedDefinitionFingerprint: status.definitionFingerprint };
  await assert.rejects(() => f.test.mutation(api.workflows.authorizeSchedule, args), /Authentication/);
  const machineBridge = f.test.withIdentity({ issuer, subject: "owner", societyer_auth_issuer: issuer, societyer_auth_provider: "better-auth" });
  assert.equal((await machineBridge.query(api.workflows.scheduleStatus, { id })).supported, true, "The machine bridge has a valid current owner binding for ordinary scoped reads.");
  await assert.rejects(() => machineBridge.mutation(api.workflows.authorizeSchedule, args), /API identity bridges cannot authorize/);
  for (const role of ["director", "member", "viewer"]) await assert.rejects(() => f.actor(role).mutation(api.workflows.authorizeSchedule, args), /Permission tasks:write/);
  await assert.rejects(() => f.actor("foreign").mutation(api.workflows.authorizeSchedule, args), /membership/);
  await assert.rejects(() => f.actor().mutation(api.workflows.authorizeSchedule, { ...args, actingUserId: f.ids.foreignUser } as any), /extra field|actingUserId|validator/i);
  await assert.rejects(() => f.actor().mutation(api.workflows.authorizeSchedule, { ...args, expectedDefinitionFingerprint: "unreviewed" }), /changed since you reviewed/);
  for (const expires of ["not-a-date", new Date(Date.now() - 1000).toISOString(), new Date(Date.now() + 91 * 86_400_000).toISOString()]) {
    await assert.rejects(() => f.actor().mutation(api.workflows.authorizeSchedule, { ...args, expiresAtISO: expires }), /90 days/);
  }
  await assert.rejects(() => f.actor().action(api.workflows.run, { societyId: f.ids.societyId, workflowId: id, triggeredBy: "cron" }), /explicitly authorized internal schedule claim/);
  await assert.rejects(() => f.actor().mutation(internal.workflows._createRun, { societyId: f.ids.societyId, workflowId: id, recipe: "insurance_renewal", demo: false, triggeredBy: "cron" }), /explicitly authorized internal schedule claim/);
  const approved = await f.authorize(id);
  assert.equal(approved.state, "authorized");
  assert.equal(approved.authorizerUserId, f.ids.users.Owner, "The authorizer comes from the authenticated person, not the creator or a client actor field.");
  assert.ok(approved.nextRunAtISO > new Date().toISOString());
  const stored = await f.test.run(ctx => ctx.db.get(id));
  assert.equal(stored!.scheduleAuthorization!.definitionFingerprint, await scheduleDefinitionFingerprint(stored!));
  assert.equal(stored!.scheduleAuthorization!.version, 1);
  const memberRecords = await f.actor("member").query(api.workflows.list, { societyId: f.ids.societyId });
  const memberRecord = await f.actor("member").query(api.workflows.get, { id });
  assert.equal(Object.prototype.hasOwnProperty.call(memberRecord, "scheduleAuthorization"), false);
  assert.ok(memberRecords.every(record => !Object.prototype.hasOwnProperty.call(record, "scheduleAuthorization")), "Workflow readers cannot retrieve the author's raw issuer, subject or external-identity grant binding.");
  const memberStatus = await f.actor("member").query(api.workflows.scheduleStatus, { id });
  assert.equal(memberStatus.authorizerUserId, f.ids.users.Owner, "The dedicated safe status projection still identifies the authorizer.");
  assert.equal(Object.prototype.hasOwnProperty.call(memberStatus, "authSubject"), false);
}

{
  const f = await fixture();
  const id = await f.workflow();
  const policyId = await f.policy();
  await f.policy(f.ids.foreignId, "FOREIGN");
  await f.authorize(id);
  const future = await f.due(id, 60_000);
  assert.equal((await f.test.mutation(internal.workflows._runScheduled, { workflowId: id, dueAtISO: future })).state, "skipped");
  const tick = await f.due(id);
  const outcomes = await Promise.all([
    f.test.mutation(internal.workflows._runScheduled, { workflowId: id, dueAtISO: tick }),
    f.test.mutation(internal.workflows._runScheduled, { workflowId: id, dueAtISO: tick }),
  ]);
  assert.equal(outcomes.filter(row => row.state === "manual_required").length, 1, "Concurrent claims commit one run.");
  await f.test.mutation(internal.workflows._runScheduled, { workflowId: id, dueAtISO: tick });
  await f.test.mutation(internal.workflows._recordScheduledFailure, { workflowId: id, dueAtISO: tick });
  const runs = await f.runs(id);
  assert.equal(runs.length, 1, "Replays and ambiguous successful responses do not duplicate or replace runs.");
  assert.equal(runs[0].status, "manual_required");
  assert.equal(runs[0].triggeredByUserId, f.ids.users.Owner);
  assert.equal(runs[0].scheduleTickAtISO, tick);
  assert.equal(runs[0].steps[0].status, "ok");
  assert.equal(runs[0].steps.filter(step => step.status === "skip").length, 3);
  const effects = await f.effects();
  assert.equal(effects.tasks.length, 3, "Scheduled insurance performs the real dated renewal-task effect.");
  assert.deepEqual(new Set(effects.tasks.map(task => task.dueDate)), new Set([day(-40), day(-10), day(13)]));
  for (const task of effects.tasks) {
    assert.equal(task.societyId, f.ids.societyId);
    assert.equal(task.insurancePolicyId, policyId);
    assert.deepEqual(task.responsibleUserIds, [f.ids.users.Owner]);
  }
  assert.equal(effects.notifications.length, 1);
  assert.equal(effects.notifications[0].userId, f.ids.users.Owner);
  // A new scheduled day can review again without recreating existing renewal tasks.
  const tick2 = await f.due(id, -120_000);
  await f.test.mutation(internal.workflows._runScheduled, { workflowId: id, dueAtISO: tick2 });
  assert.equal((await f.effects()).tasks.length, 3);
  assert.equal((await f.runs(id)).length, 2);
}

const deniedCases: Array<[string, (f: Awaited<ReturnType<typeof fixture>>, id: any) => Promise<unknown>, string]> = [
  ["expired", async (f, id) => f.test.run(async ctx => { const wf = await ctx.db.get(id); await ctx.db.patch(id, { scheduleAuthorization: { ...wf!.scheduleAuthorization!, expiresAtISO: new Date(Date.now() - 1).toISOString() } }); }), "expired"],
  ["demoted", async f => f.test.run(ctx => ctx.db.patch(f.ids.users.Owner, { role: "Viewer" })), "blocked"],
  ["membership disabled", async f => f.test.run(ctx => ctx.db.patch(f.ids.users.Owner, { status: "Disabled" })), "blocked"],
  ["membership deleted", async f => f.test.run(ctx => ctx.db.delete(f.ids.users.Owner)), "blocked"],
  ["membership tenant moved", async f => f.test.run(ctx => ctx.db.patch(f.ids.users.Owner, { societyId: f.ids.foreignId })), "blocked"],
  ["identity disabled", async f => f.test.run(ctx => ctx.db.patch(f.ids.identityId, { status: "Disabled" })), "blocked"],
  ["identity rebound", async f => f.test.run(ctx => ctx.db.patch(f.ids.identityId, { subject: "different-account" })), "blocked"],
  ["membership subject rebound", async f => f.test.run(ctx => ctx.db.patch(f.ids.users.Owner, { authSubject: "different-account" })), "blocked"],
  ["workflow module disabled", async f => f.test.run(ctx => ctx.db.patch(f.ids.societyId, { disabledModules: ["workflows"] })), "blocked"],
  ["insurance module disabled", async f => f.test.run(ctx => ctx.db.patch(f.ids.societyId, { disabledModules: ["insurance"] })), "blocked"],
  ["workspace removed", async f => f.test.run(ctx => ctx.db.patch(f.ids.societyId, { removedAtISO: new Date().toISOString() })), "blocked"],
  ["paused after selection", async (f, id) => f.test.run(ctx => ctx.db.patch(id, { status: "paused" })), "paused"],
  ["definition changed outside handler", async (f, id) => f.test.run(ctx => ctx.db.patch(id, { config: { unexpected: true } })), "configuration_changed"],
  ["foreign authorizer binding", async (f, id) => f.test.run(async ctx => { const wf = await ctx.db.get(id); await ctx.db.patch(id, { scheduleAuthorization: { ...wf!.scheduleAuthorization!, authorizerUserId: f.ids.foreignUser } }); }), "blocked"],
];
for (const [name, invalidate, expected] of deniedCases) {
  const f = await fixture();
  const id = await f.workflow();
  await f.policy();
  await f.authorize(id);
  const tick = await f.due(id);
  await invalidate(f, id);
  const result = await f.test.mutation(internal.workflows._runScheduled, { workflowId: id, dueAtISO: tick });
  assert.equal(result.state, expected, name);
  assert.equal((await f.effects()).tasks.length, 0, `${name} cannot produce business effects`);
  assert.equal((await f.runs(id)).length, 0, `${name} cannot claim execution as successful`);
  assert.equal((await f.test.run(ctx => ctx.db.get(id)))!.scheduleEnabled, false, `${name} is removed from the due queue until reviewed`);
}

{
  const f = await fixture();
  const id = await f.workflow();
  await f.authorize(id);
  await f.actor().mutation(api.workflows.configure, { id, patch: { name: "Cosmetic rename", config: {} } });
  assert.equal((await f.actor().query(api.workflows.scheduleStatus, { id })).state, "authorized", "No-op definition saves and names do not silently renew or revoke.");
  await f.actor().mutation(api.workflows.configure, { id, patch: { trigger: { kind: "cron", cron: "0 10 * * *" } } });
  const changedSchedule = await f.actor().query(api.workflows.scheduleStatus, { id });
  assert.equal(changedSchedule.state, "configuration_changed");
  assert.equal(changedSchedule.definition.cron, "0 10 * * *", "The reviewed schedule and fingerprint come from the same server snapshot.");
  assert.equal((await f.test.run(ctx => ctx.db.get(id)))!.nextRunAtISO, undefined);
  await f.authorize(id);
  await f.actor().mutation(api.workflows.setStatus, { id, status: "paused" });
  await f.actor().mutation(api.workflows.setStatus, { id, status: "active" });
  assert.equal((await f.actor().query(api.workflows.scheduleStatus, { id })).state, "revoked", "Reactivation does not renew authorization.");
  await f.authorize(id);
  const tick = await f.due(id);
  await f.actor().mutation(api.workflows.revokeSchedule, { id });
  assert.equal((await f.test.mutation(internal.workflows._runScheduled, { workflowId: id, dueAtISO: tick })).state, "skipped");
  assert.equal((await f.runs(id)).length, 0);
  await f.authorize(id);
  await f.actor().mutation(api.workflows.addNode, { id, node: { type: "ai_agent", label: "Unreviewed AI effect" } });
  const changed = await f.actor().query(api.workflows.scheduleStatus, { id });
  assert.equal(changed.state, "configuration_changed");
  assert.equal(changed.supported, false);
  await assert.rejects(() => f.actor().mutation(api.workflows.authorizeSchedule, { id, expiresAtISO: expiresAtISO(), expectedDefinitionFingerprint: "old" }), /Custom workflow nodes/);
  const foreign = await f.workflow({ societyId: f.ids.foreignId });
  await assert.rejects(() => f.actor().query(api.workflows.scheduleStatus, { id: foreign }), /membership/);
  const source = await f.workflow();
  await f.authorize(source);
  const stolen = await f.test.run(ctx => ctx.db.get(source));
  const target = await f.workflow({ scheduleEnabled: true, scheduleAuthorization: stolen!.scheduleAuthorization });
  const stolenTick = await f.due(target);
  assert.equal((await f.test.mutation(internal.workflows._runScheduled, { workflowId: target, dueAtISO: stolenTick })).state, "configuration_changed", "A grant cannot be copied to another workflow.");
}

{
  const f = await fixture();
  for (const patch of [
    { provider: "n8n" }, { recipe: "unbc_affiliate_id_request" },
    { trigger: { kind: "date_offset", offset: { anchor: "filings.dueDate", daysBefore: 7 } } },
    { trigger: { kind: "cron", cron: "0 9 1 * *" } },
    { config: { emailTo: "unreviewed@example.invalid" } },
    { nodePreview: [{ key: "scan_policies", type: "manual_trigger", label: "Hidden effect", config: { emailTo: "unreviewed@example.invalid" } }] },
  ]) {
    const id = await f.workflow(patch);
    const status = await f.actor().query(api.workflows.scheduleStatus, { id });
    assert.equal(status.supported, false);
    assert.ok(status.reason);
    await assert.rejects(() => f.actor().mutation(api.workflows.authorizeSchedule, { id, expiresAtISO: expiresAtISO(), expectedDefinitionFingerprint: "unreviewed" }));
  }
  await f.policy();
  for (const recipe of ["agm_prep", "annual_report_filing", "insurance_renewal"]) {
    const id = await f.actor().mutation(api.workflows.create, {
      societyId: f.ids.societyId, recipe, name: "Created through the real UI endpoint",
      trigger: { kind: "cron", cron: "0 9 * * *" },
    });
    assert.equal((await f.actor().query(api.workflows.scheduleStatus, { id })).state, "not_authorized");
    await f.authorize(id);
    const tick = await f.due(id);
    await f.test.mutation(internal.workflows._runScheduled, { workflowId: id, dueAtISO: tick });
    const [run] = await f.runs(id);
    assert.equal(run.status, "manual_required");
    assert.ok(run.steps.slice(recipe === "insurance_renewal" ? 1 : 0).every(step => step.status === "skip"), "Review-only steps do not claim to file reports, send notices or confirm quorum.");
    if (recipe === "insurance_renewal") assert.equal(run.steps[0].status, "ok");
  }
  assert.equal((await f.effects()).notifications.length, 3);
  assert.equal((await f.effects()).tasks.length, 3, "The catalog's real default graph supports scheduled insurance effects.");
  const hidden = await f.test.run(async ctx => ({ pendingEmails: await ctx.db.query("pendingEmails").collect(), filings: await ctx.db.query("filings").collect() }));
  assert.deepEqual(hidden, { pendingEmails: [], filings: [] }, "No hidden email outbox or filing effect is dispatched.");
}

{
  const realNow = Date.now;
  // UTC has entered January 1, but the BC workspace is still December 31.
  Date.now = () => Date.parse("2026-01-01T00:30:00.000Z");
  try {
    const f = await fixture();
    await f.test.run(ctx => ctx.db.patch(f.ids.societyId, { jurisdictionCode: "CA-BC" }));
    const id = await f.workflow();
    await f.test.run(async ctx => {
      for (const [number, renewalDate] of [["DUE-LOCAL-TODAY", "2025-12-31"], ["SIXTY-ONE-LOCAL-DAYS", "2026-03-02"]]) {
        await ctx.db.insert("insurancePolicies", {
          societyId: f.ids.societyId, kind: "Other", insurer: "Synthetic insurer", policyNumber: number,
          status: "Active", startDate: "2025-01-01", endDate: renewalDate, renewalDate,
          createdAtISO: new Date().toISOString(), updatedAtISO: new Date().toISOString(),
        });
      }
    });
    await f.authorize(id);
    const tick = await f.due(id);
    await f.test.mutation(internal.workflows._runScheduled, { workflowId: id, dueAtISO: tick });
    const [run] = await f.runs(id);
    assert.equal(run.output.insurance.asOf, "2025-12-31");
    assert.equal(run.output.insurance.currentDue, 1, "A policy 61 local calendar days away does not enter the 60-day window at UTC midnight.");
    assert.equal(run.output.insurance.overdue, 0, "A policy due today in the organization is not incorrectly marked overdue.");
    assert.equal((await f.effects()).tasks.length, 3);
    assert.equal((await f.effects()).notifications[0].linkHref, `/app/workflows/${id}`);
  } finally { Date.now = realNow; }
}

{
  const f = await fixture();
  const failing = await f.workflow();
  await f.policy();
  await f.authorize(failing);
  const failedTick = await f.due(failing, -180_000);
  await f.test.run(async ctx => {
    for (let index = 0; index < 501; index += 1) await ctx.db.insert("tasks", {
      societyId: f.ids.societyId, title: `Synthetic existing task ${index}`, status: "Todo", priority: "Low", tags: [], responsibleUserIds: [], createdAtISO: new Date().toISOString(),
    });
  });
  const healthy = await f.workflow({ recipe: "agm_prep" });
  await f.authorize(healthy);
  await f.due(healthy, -60_000);
  const result = await f.test.action(internal.workflows.scan, {});
  assert.equal(result.find(row => row.workflowId === failing)?.state, "failed");
  assert.equal(result.find(row => row.workflowId === healthy)?.state, "manual_required", "A real bounded-read failure cannot stop another workflow.");
  assert.equal((await f.effects()).tasks.length, 501, "A failed transaction commits no partial insurance effects.");
  assert.equal((await f.runs(failing)).length, 1);
  assert.equal((await f.runs(failing))[0].status, "failed");
  await f.test.mutation(internal.workflows._recordScheduledFailure, { workflowId: failing, dueAtISO: failedTick });
  assert.equal((await f.runs(failing)).length, 1, "Failure recording is also idempotent.");
  assert.equal((await f.test.run(ctx => ctx.db.get(failing)))!.scheduleEnabled, false);
  assert.equal((await f.test.query(internal.workflows._listDue, { dueBefore: new Date().toISOString() })).length, 0, "The failed workflow cannot starve the bounded due queue.");
}

{
  const f = await fixture();
  const ids = [];
  for (let index = 0; index < 30; index += 1) {
    const id = await f.workflow({ recipe: "agm_prep" });
    await f.authorize(id);
    await f.due(id);
    ids.push(id);
  }
  assert.equal((await f.test.query(internal.workflows._listDue, { dueBefore: new Date().toISOString() })).length, 25);
  assert.equal((await f.test.action(internal.workflows.scan, {})).length, 25);
  assert.equal((await f.test.action(internal.workflows.scan, {})).length, 5);
  for (const id of ids) assert.equal((await f.runs(id)).length, 1);
}

console.log("Workflow schedule authorization: explicit approval, current authority, pinned definitions, real insurance effects, atomic replay protection, bounded isolation and honest unsupported capabilities passed.");
