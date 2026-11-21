// Dashboard dismissals gate: only recommendations ("warn"/"info") can be
// dismissed, never requirements ("err") or continuity checks resting on a
// statutory or bylaw duty; a dismissal is per workspace, records who, when and
// why, hides the item from the summary, and stops hiding it once the item's
// level changes; restore puts the row back as it was.
import assert from "node:assert/strict";
import type { PortableDoc, PortableMutationCtx } from "../shared/portable/ctx";
import { activeDismissal, isBindingSeverity, isRecommendationLevel, normalizeDismissalReason } from "../shared/dashboardDismissals";
import type { DashboardComplianceFlag } from "../shared/dashboardComplianceRules";
import type { ContinuityCheck } from "../src/features/gaps/ContinuityChecksCard";

// ---- pure rules
{
  assert.ok(isRecommendationLevel("warn") && isRecommendationLevel("info"));
  assert.ok(!isRecommendationLevel("err") && !isRecommendationLevel("ok"), "requirements and passes are not recommendations");
  assert.ok(isBindingSeverity("statutory") && isBindingSeverity("bylaw") && !isBindingSeverity("practice") && !isBindingSeverity(undefined));
  const row = { status: "dismissed", flagLevel: "warn", dismissedAtISO: "2026-11-20T10:00:00.000Z", dismissedByName: "Mina Patel", dismissalReason: "Handled offline" };
  assert.deepEqual(activeDismissal(row, { level: "warn", dismissable: true }), { level: "warn", dismissedAtISO: row.dismissedAtISO, dismissedByName: "Mina Patel", reason: "Handled offline" });
  assert.equal(activeDismissal(row, { level: "err", dismissable: false }), undefined, "an item that escalated to err shows again");
  assert.equal(activeDismissal(row, { level: "info", dismissable: true }), undefined, "a dismissal at another level no longer applies");
  assert.equal(activeDismissal({ ...row, status: "open" }, { level: "warn", dismissable: true }), undefined, "only a dismissed row hides an item");
  assert.equal(activeDismissal(row, { level: "warn", dismissable: false }), undefined, "an item the server marks binding is never hidden");
  assert.equal(normalizeDismissalReason("   "), undefined);
  assert.equal(normalizeDismissalReason("x".repeat(900))?.length, 500);
}

// ---- portable handlers on the demo seed
const { tables, society } = await import("../src/lib/staticConvexFixtures");
const { MemoryDb } = await import("../shared/portable/memoryDb");
const { makeCapabilities } = await import("../shared/portable/capabilities");
const dashboard = await import("../shared/functions/dashboard");
const continuity = await import("../shared/functions/continuity");
const remediation = await import("../shared/functions/dashboardRemediation");

const seed: Record<string, PortableDoc[]> = {};
for (const [key, rows] of Object.entries(tables as Record<string, PortableDoc[]>)) seed[key] = JSON.parse(JSON.stringify(rows));
seed.users = seed.users.map((user) => ({ ...user, status: "Active", authIssuer: "https://issuer.test", authSubject: `sub-${user._id}` }));
seed.societies = [JSON.parse(JSON.stringify(society)), { _id: "other_society", name: "Elsewhere Ltd", entityType: "corporation" }];
const db = new MemoryDb({ seed });
const S = String(seed.users[0].societyId);
const owner = seed.users.find((user) => user.role === "Owner")!;
const ctx: PortableMutationCtx = {
  db,
  principal: { kind: "user", runtime: "test", assurance: "trusted-workspace", subject: `sub-${owner._id}`, issuer: "https://issuer.test", userId: owner._id, societyId: S },
  capabilities: makeCapabilities({}),
  runQuery: async () => { throw new Error("nested"); },
  runMutation: async () => { throw new Error("nested"); },
};
const flags = async (): Promise<DashboardComplianceFlag[]> => (await dashboard.summaryPortable(ctx, { societyId: S })).complianceFlags;
const checks = async (): Promise<ContinuityCheck[]> => (await continuity.dashboardChecksPortable(ctx, { societyId: S })).checks;

const demoFlags = await flags();
const demoChecks = await checks();
for (const flag of demoFlags) {
  assert.equal(flag.dismissable, flag.level === "warn" || flag.level === "info", `${flag.ruleId}: only recommendations are dismissable`);
  assert.equal(flag.dismissal, undefined, `${flag.ruleId}: nothing is dismissed in the seed`);
}
for (const check of demoChecks) {
  const binding = isBindingSeverity(check.requirement);
  assert.equal(check.dismissable, isRecommendationLevel(check.level) && !binding, `${check.id}: binding or err checks are not dismissable`);
}
if (process.env.DASHBOARD_DISMISSALS_VERBOSE) {
  console.log(demoFlags.map((flag) => `flag ${flag.ruleId} ${flag.level} dismissable=${flag.dismissable}`).join("\n"));
  console.log(demoChecks.map((check) => `check ${check.id} ${check.level} requirement=${check.requirement ?? "-"} dismissable=${check.dismissable}`).join("\n"));
}

// Dismiss a recommended compliance flag with a reason.
const flag = demoFlags.find((row) => row.dismissable);
assert.ok(flag, "the demo has a recommendation to dismiss");
await assert.rejects(
  remediation.dismissItemPortable(ctx, { societyId: S, ruleId: flag.ruleId, flagLevel: "err", flagText: flag.text }),
  /Only recommendations/,
  "a requirement cannot be dismissed",
);
await remediation.dismissItemPortable(ctx, { societyId: S, ruleId: flag.ruleId, flagLevel: flag.level, flagText: flag.text, reason: "  Covered by the board's own review  " });
const dismissed = (await flags()).find((row) => row.ruleId === flag.ruleId)!;
assert.equal(dismissed.dismissal?.reason, "Covered by the board's own review");
assert.equal(dismissed.dismissal?.dismissedByName, "Mina Patel", "records who dismissed it");
assert.ok(dismissed.dismissal?.dismissedAtISO, "records when");
assert.equal(dismissed.remediationStatus, "dismissed");
const stored = (await db.query("complianceRemediations").collect()).find((row) => row.ruleId === flag.ruleId)!;
assert.equal(stored.societyId, S, "the dismissal belongs to this workspace");
assert.equal(stored.dismissedByUserId, owner._id);
assert.equal(stored.flagLevel, flag.level, "keyed to the level it was dismissed at");
assert.ok((await db.query("activity").collect()).some((row) => row.action === "dashboard-item-dismissed" && row.societyId === S), "the activity log records the dismissal");

// The same row at another level (the flag escalated) no longer hides it.
await db.patch(stored._id, { flagLevel: "err" });
const escalated = (await flags()).find((row) => row.ruleId === flag.ruleId)!;
assert.equal(escalated.dismissal, undefined, "a dismissal at another level shows the item again");
assert.equal(escalated.remediationStatus, undefined, "a stale dismissal says nothing about the item");
await db.patch(stored._id, { flagLevel: flag.level });

// Restore: a row the dismissal created goes away; the activity log keeps the history.
assert.deepEqual(await remediation.restoreItemPortable(ctx, { societyId: S, ruleId: flag.ruleId }), { restored: true });
assert.equal((await flags()).find((row) => row.ruleId === flag.ruleId)!.dismissal, undefined);
assert.equal((await db.query("complianceRemediations").collect()).some((row) => row.ruleId === flag.ruleId), false);
assert.deepEqual(await remediation.restoreItemPortable(ctx, { societyId: S, ruleId: flag.ruleId }), { restored: false }, "restoring twice is a no-op");

// A row holding a review task returns to it on restore.
const task = await remediation.createComplianceReviewTaskPortable(ctx, { societyId: S, ruleId: flag.ruleId, flagLevel: flag.level, flagText: flag.text, evidenceRequired: flag.evidenceRequired });
await remediation.dismissItemPortable(ctx, { societyId: S, ruleId: flag.ruleId, flagLevel: flag.level, flagText: flag.text });
await remediation.dismissItemPortable(ctx, { societyId: S, ruleId: flag.ruleId, flagLevel: flag.level, flagText: flag.text, reason: "again" });
await remediation.restoreItemPortable(ctx, { societyId: S, ruleId: flag.ruleId });
const reopened = (await flags()).find((row) => row.ruleId === flag.ruleId)!;
assert.equal(reopened.remediationStatus, "open", "back to the open review workflow, even after dismissing twice");
assert.equal(reopened.remediationTaskId, task.taskId);

// Continuity: a recommendation check can be dismissed; a binding one never hides.
const check = demoChecks.find((row) => row.dismissable);
if (check) {
  await remediation.dismissItemPortable(ctx, { societyId: S, ruleId: check.id, flagLevel: check.level, flagText: check.title });
  assert.ok((await checks()).find((row) => row.id === check.id)!.dismissal, `${check.id} is dismissed`);
  await remediation.restoreItemPortable(ctx, { societyId: S, ruleId: check.id });
}
const binding = demoChecks.find((row) => isRecommendationLevel(row.level) && !row.dismissable);
if (binding) {
  await remediation.dismissItemPortable(ctx, { societyId: S, ruleId: binding.id, flagLevel: binding.level, flagText: binding.title });
  assert.equal((await checks()).find((row) => row.id === binding.id)!.dismissal, undefined, `${binding.id} rests on a ${binding.requirement} duty and stays`);
}

console.log(`Dashboard dismissals: ${demoFlags.filter((row) => row.dismissable).length} of ${demoFlags.length} demo flags and ${demoChecks.filter((row) => row.dismissable).length} of ${demoChecks.length} continuity checks are dismissable.`);
