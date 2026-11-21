// Dashboard dismissals gate. Whether a finding may be dismissed depends on
// what it rests on, not its level (shared/dashboardFindingPolicy.ts): only
// recommendations at warn/info can be dismissed; statutory, bylaw and
// internal-policy findings (and any unclassified rule) can be acknowledged,
// which keeps them on the dashboard and in every count. The server looks each
// item up itself, so neither mutation path dismisses a requirement whatever
// level the client sends. Dismissals and acknowledgements hold only while the
// finding's subject (rule version + affected records) is unchanged; rows
// dismissed before a rule became protected are ignored and kept as they were.
import assert from "node:assert/strict";
import type { PortableDoc, PortableMutationCtx } from "../shared/portable/ctx";
import { activeAcknowledgement, activeDismissal, isBindingSeverity, isRecommendationLevel, normalizeDismissalReason } from "../shared/dashboardDismissals";
import {
  continuityFindingPolicy,
  decisionWaivesFinding,
  findingPolicy,
  findingSubjectKey,
  isClassifiedFinding,
  isDismissableFinding,
} from "../shared/dashboardFindingPolicy";
import { bcSocietiesDashboardComplianceRulePack, type DashboardComplianceFlag } from "../shared/dashboardComplianceRules";
import { LEGAL_GOVERNANCE_PROFILES } from "../shared/legalGovernanceProfiles";
import { PRIVACY_LAWS } from "../shared/privacyRuleProfiles";
import type { ContinuityCheck } from "../src/features/gaps/ContinuityChecksCard";

// ---- policy: requirement basis, independent of level
{
  const mustBeProtected = [
    "BC-SOC-DIRECTOR-CONSENT",
    "BC-SOC-CONSTITUTION-EVIDENCE",
    "BC-SOC-BYLAWS-EVIDENCE",
    "PIPA-POLICY-DOCUMENTED",
    "PIPA-POLICY-EVIDENCE",
    "BC-SOC-DIRECTORS-MIN",
    "BC-SOC-DIRECTORS-BC-RESIDENT",
    "CONTINUITY-DIRECTOR-CONSENT",
    "CONTINUITY-AGM-THIS-YEAR",
    "CONTINUITY-ANNUAL-REPORT-FILED",
    "home:compliance-ca-bc-societies-annual-report:2026-07-31",
  ];
  for (const corporate of LEGAL_GOVERNANCE_PROFILES.filter((profile) => profile.kind === "corporation")) {
    for (const suffix of ["DIRECTORS-MIN", "DIRECTOR-CONSENT", "DIRECTORS-RESIDENCY", "CLASSIFICATION", "GOVERNING-DOCUMENTS"]) {
      mustBeProtected.push(`LEGAL-${corporate.id}-${suffix}`);
    }
  }
  for (const lawId of Object.keys(PRIVACY_LAWS)) mustBeProtected.push(`PRIVACY-${lawId}-OFFICER`, `PRIVACY-${lawId}-POLICY`);
  for (const ruleId of mustBeProtected) {
    const policy = findingPolicy(ruleId);
    assert.ok(policy.protected && policy.basis && policy.basis !== "recommendation", `${ruleId} is a requirement`);
    assert.equal(isDismissableFinding(policy, "warn"), false, `${ruleId} is not dismissable at warn`);
    assert.equal(isDismissableFinding(policy, "info"), false, `${ruleId} is not dismissable at info`);
  }
  assert.equal(findingPolicy("LEGAL-bc_company-DIRECTOR-CONSENT").subject, "directors");
  for (const ruleId of ["PRIVACY-APPLICABILITY", "BYLAW-RULE-SET-CONFIGURED", "FINANCE-CONTROL-SINGLE-APPROVAL", "CONTINUITY-MINUTES-APPROVED"]) {
    const policy = findingPolicy(ruleId);
    assert.equal(policy.basis, "recommendation", `${ruleId} is a recommendation`);
    assert.ok(isDismissableFinding(policy, "warn") && isDismissableFinding(policy, "info"));
    assert.equal(isDismissableFinding(policy, "err"), false, "a recommendation at err still stays");
  }
  assert.equal(findingPolicy("FINANCE-CONTROL-SIGNING-AUTHORITY").basis, "internal_policy");
  assert.ok(findingPolicy("FINANCE-CONTROL-SIGNING-AUTHORITY").protected, "an adopted internal policy is not dismissable");
  // Unknown ids fail closed.
  const unknown = findingPolicy("SOMETHING-NEW");
  assert.ok(unknown.protected && unknown.basis === undefined && !isClassifiedFinding("SOMETHING-NEW"));
  // Every rule in the BC pack is classified.
  for (const rule of bcSocietiesDashboardComplianceRulePack.rules) assert.ok(isClassifiedFinding(rule.id), `${rule.id} has a requirement basis`);
  // A continuity expectation marked binding makes a recommendation check a requirement.
  assert.equal(continuityFindingPolicy("CONTINUITY-MINUTES-APPROVED", "bylaw").basis, "bylaw");
  assert.ok(continuityFindingPolicy("CONTINUITY-MINUTES-APPROVED", "bylaw").protected);
  assert.ok(!continuityFindingPolicy("CONTINUITY-MINUTES-APPROVED", "practice").protected);
  assert.ok(continuityFindingPolicy("CONTINUITY-AGM-THIS-YEAR", "practice").protected, "a practice expectation never loosens a statutory check");
  // Obligation decisions: only a dismissed recommendation leaves the counts.
  const occurrence = "home:compliance-ca-bc-societies-annual-report:2025-07-31";
  assert.equal(decisionWaivesFinding(occurrence, { status: "dismissed" }), false, "a dismissed statutory occurrence still counts");
  assert.equal(decisionWaivesFinding(occurrence, { status: "acknowledged" }), false);
  assert.equal(decisionWaivesFinding("CONTINUITY-MINUTES-APPROVED", { status: "dismissed" }), true);

  // Subject keys: order-free, versioned, and different for different records.
  assert.equal(findingSubjectKey("BC-SOC-DIRECTOR-CONSENT", ["director:a", "director:b"]), findingSubjectKey("BC-SOC-DIRECTOR-CONSENT", ["director:b", "director:a"]));
  assert.notEqual(findingSubjectKey("BC-SOC-DIRECTOR-CONSENT", ["director:a"]), findingSubjectKey("BC-SOC-DIRECTOR-CONSENT", ["director:a", "director:c"]));
  assert.match(findingSubjectKey("BC-SOC-DIRECTOR-CONSENT", ["x"]), /^BC-SOC-DIRECTOR-CONSENT@v1:[0-9a-f]{8}$/);

  assert.ok(isRecommendationLevel("warn") && isRecommendationLevel("info"));
  assert.ok(!isRecommendationLevel("err") && !isRecommendationLevel("ok"));
  assert.ok(isBindingSeverity("statutory") && isBindingSeverity("bylaw") && !isBindingSeverity("practice") && !isBindingSeverity(undefined));
  const row = { status: "dismissed", flagLevel: "warn", dismissedAtISO: "2026-11-20T10:00:00.000Z", dismissedByName: "Mina Patel", dismissalReason: "Handled offline", dismissedSubjectKey: "K1" };
  assert.deepEqual(activeDismissal(row, { level: "warn", dismissable: true, subjectKey: "K1" }), { level: "warn", dismissedAtISO: row.dismissedAtISO, dismissedByName: "Mina Patel", reason: "Handled offline" });
  assert.equal(activeDismissal(row, { level: "warn", dismissable: true, subjectKey: "K2" }), undefined, "a new subject is not hidden by an old dismissal");
  assert.equal(activeDismissal({ ...row, dismissedSubjectKey: undefined }, { level: "warn", dismissable: true, subjectKey: "K1" }), undefined, "a row without a subject key hides nothing");
  assert.equal(activeDismissal(row, { level: "err", dismissable: false, subjectKey: "K1" }), undefined, "an item that escalated shows again");
  assert.equal(activeDismissal(row, { level: "info", dismissable: true, subjectKey: "K1" }), undefined, "a dismissal at another level no longer applies");
  assert.equal(activeDismissal({ ...row, status: "open" }, { level: "warn", dismissable: true, subjectKey: "K1" }), undefined);
  assert.equal(activeDismissal(row, { level: "warn", dismissable: false, subjectKey: "K1" }), undefined, "a protected item is never hidden");
  assert.deepEqual(activeAcknowledgement({ acknowledgedAtISO: "2026-11-21", acknowledgedByName: "Mina", acknowledgedSubjectKey: "K1" }, { subjectKey: "K1" }), { acknowledgedAtISO: "2026-11-21", acknowledgedByName: "Mina" });
  assert.equal(activeAcknowledgement({ acknowledgedAtISO: "2026-11-21", acknowledgedSubjectKey: "K1" }, { subjectKey: "K2" }), undefined);
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
const obligations = await import("../shared/functions/complianceObligations");

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
const flagById = async (ruleId: string) => (await flags()).find((row) => row.ruleId === ruleId);
const outstanding = (rows: DashboardComplianceFlag[]) => rows.filter((row) => !row.dismissal && row.level !== "ok" && row.level !== "info").length;
const remediationRows = async () => (await db.query("complianceRemediations").collect()) as (PortableDoc & Record<string, unknown>)[];

const demoFlags = await flags();
const demoChecks = await checks();
for (const flag of demoFlags) {
  const policy = findingPolicy(flag.ruleId);
  assert.equal(flag.requirementBasis, policy.basis, `${flag.ruleId}: basis surfaced`);
  assert.equal(flag.dismissable, isDismissableFinding(policy, flag.level), `${flag.ruleId}: only recommendations at warn/info are dismissable`);
  assert.ok(flag.subjectKey?.startsWith(`${flag.ruleId}@v`), `${flag.ruleId}: has a subject key`);
  assert.equal(flag.dismissal, undefined, `${flag.ruleId}: nothing is dismissed in the seed`);
  if (policy.protected && flag.level !== "ok" && flag.level !== "info") {
    assert.ok(flag.remediationActions.some((action) => action.intent === "createComplianceReviewTask" || action.intent === "createPrivacyReviewTask"), `${flag.ruleId}: a requirement can get a follow-up`);
  }
}
for (const check of demoChecks) {
  const policy = continuityFindingPolicy(check.id, check.requirement);
  assert.equal(check.requirementBasis, policy.basis);
  assert.equal(check.dismissable, isDismissableFinding(policy, check.level), `${check.id}: dismissable only as a recommendation`);
}
if (process.env.DASHBOARD_DISMISSALS_VERBOSE) {
  console.log(demoFlags.map((flag) => `flag ${flag.ruleId} ${flag.level} basis=${flag.requirementBasis ?? "-"} dismissable=${flag.dismissable}`).join("\n"));
  console.log(demoChecks.map((check) => `check ${check.id} ${check.level} basis=${check.requirementBasis ?? "-"} dismissable=${check.dismissable}`).join("\n"));
}

// ---- a protected warn cannot be dismissed through either mutation path
const consent = demoFlags.find((row) => row.ruleId === "BC-SOC-DIRECTOR-CONSENT");
assert.ok(consent && consent.level === "warn" && !consent.dismissable, "the demo has an amber, protected consent finding");
for (const flagLevel of ["warn", "info", undefined]) {
  await assert.rejects(
    remediation.dismissItemPortable(ctx, { societyId: S, ruleId: consent.ruleId, flagLevel, flagText: consent.text }),
    /requirement/,
    `dashboard dismiss refuses a statutory finding (client level ${flagLevel ?? "none"})`,
  );
}
await assert.rejects(
  remediation.dismissItemPortable(ctx, { societyId: S, ruleId: "CONTINUITY-DIRECTOR-CONSENT", flagLevel: "warn", flagText: "x" }),
  /requirement/,
  "the continuity twin is protected too",
);
await assert.rejects(
  obligations.dismissDecisionPortable(ctx, { societyId: S, ruleId: consent.ruleId, flagLevel: "info", flagText: consent.text, evidenceRequired: [] }),
  /requirement/,
  "the obligations path cannot dismiss a dashboard requirement either",
);
await assert.rejects(
  obligations.dismissDecisionPortable(ctx, { societyId: S, ruleId: "home:compliance-ca-bc-societies-annual-report:2025-07-31", flagLevel: "warn", flagText: "Annual report", evidenceRequired: [] }),
  /requirement/,
  "a statutory obligation occurrence cannot be dismissed",
);
assert.equal((await remediationRows()).length, 0, "refused dismissals write nothing");
assert.equal((await flagById(consent.ruleId))?.dismissal, undefined);

// ---- an old dismissal does not hide a newly protected finding; its row is kept
const legacyId = await db.insert("complianceRemediations", {
  societyId: S, ruleId: consent.ruleId, flagLevel: "warn", flagText: consent.text, evidenceRequired: [],
  status: "dismissed", dismissedAtISO: "2026-11-20T10:00:00.000Z", dismissedByName: "Mina Patel",
  dismissedSubjectKey: consent.subjectKey, createdAtISO: "2026-11-20T10:00:00.000Z", updatedAtISO: "2026-11-20T10:00:00.000Z",
});
const legacyBefore = JSON.stringify(await db.get(legacyId));
const reshown = await flagById(consent.ruleId);
assert.ok(reshown && !reshown.dismissal, "the protected finding shows despite the old dismissal row");
assert.equal(reshown.remediationStatus, undefined, "the ignored dismissal says nothing about the finding");
assert.equal(outstanding(await flags()), outstanding(demoFlags), "and it stays in the counts");
assert.equal(JSON.stringify(await db.get(legacyId)), legacyBefore, "the historical row is preserved untouched");
await db.delete(legacyId);

// ---- acknowledging a requirement records who/when and leaves it outstanding
await remediation.acknowledgeItemPortable(ctx, { societyId: S, ruleId: consent.ruleId, flagLevel: "warn", note: "  Chasing the signed form  " });
const acknowledged = (await flagById(consent.ruleId))!;
assert.equal(acknowledged.dismissal, undefined, "an acknowledgement hides nothing");
assert.equal(acknowledged.acknowledgement?.acknowledgedByName, "Mina Patel");
assert.equal(acknowledged.acknowledgement?.note, "Chasing the signed form");
assert.ok(acknowledged.acknowledgement?.acknowledgedAtISO);
assert.equal(acknowledged.remediationStatus, undefined, "a row made by an acknowledgement reports no workflow");
assert.equal(outstanding(await flags()), outstanding(demoFlags), "acknowledgement leaves the counts intact");
assert.ok((await db.query("activity").collect()).some((row) => row.action === "dashboard-item-acknowledged"));
await assert.rejects(
  remediation.acknowledgeItemPortable(ctx, { societyId: S, ruleId: consent.ruleId, flagLevel: "err" }),
  /changed/,
  "an acknowledgement of a stale level is refused",
);
// The consent continuity check stays on the dashboard too.
assert.ok((await checks()).some((row) => row.id === "CONTINUITY-DIRECTOR-CONSENT" && row.level === "warn" && !row.dismissal));

// Assign follow-up: the review task path keeps the finding outstanding and shows owner + due date.
const followUp = await remediation.createComplianceReviewTaskPortable(ctx, {
  societyId: S, ruleId: consent.ruleId, flagLevel: consent.level, flagText: consent.text, evidenceRequired: consent.evidenceRequired,
  assignee: "Jordan Lee", dueDate: "2026-12-15",
});
const owned = (await flagById(consent.ruleId))!;
assert.equal(owned.remediationStatus, "open");
assert.equal(owned.remediationTaskId, followUp.taskId);
assert.deepEqual(owned.followUp, { assignee: "Jordan Lee", dueDate: "2026-12-15" });
assert.ok(owned.acknowledgement, "the follow-up keeps the acknowledgement");
assert.equal(outstanding(await flags()), outstanding(demoFlags), "a follow-up leaves the counts intact");

// A newly affected director is a new subject: the acknowledgement no longer applies.
// Consent is derived from the register, so take a verified director's entries away.
const consentRows = await db.query("directorConsents").collect();
const otherDirector = seed.directors.find((row) =>
  row.status === "Active" && consentRows.some((entry) => String(entry.directorId) === String(row._id) && entry.reviewStatus === "Reviewed"))!;
assert.ok(otherDirector, "the demo has a director with a reviewed consent");
const removedConsents = consentRows.filter((entry) => String(entry.directorId) === String(otherDirector._id));
for (const entry of removedConsents) await db.delete(entry._id);
const widened = (await flagById(consent.ruleId))!;
assert.notEqual(widened.subjectKey, consent.subjectKey, "another affected director changes the subject");
assert.equal(widened.acknowledgement, undefined, "an acknowledgement covers only the directors it was made for");
const restoredConsentIds = new Map<string, string>();
for (const entry of removedConsents) {
  const { _id, _creationTime, ...rest } = entry as PortableDoc & { _creationTime?: number };
  void _creationTime;
  const previousId = rest.previousId ? restoredConsentIds.get(String(rest.previousId)) ?? rest.previousId : undefined;
  restoredConsentIds.set(String(_id), await db.insert("directorConsents", { ...rest, ...(previousId ? { previousId } : {}) }));
}
assert.ok((await flagById(consent.ruleId))!.acknowledgement, "back to the acknowledged subject");

// Withdrawing an acknowledgement keeps the row's review task.
assert.deepEqual(await remediation.restoreItemPortable(ctx, { societyId: S, ruleId: consent.ruleId }), { restored: true });
const withdrawn = (await flagById(consent.ruleId))!;
assert.equal(withdrawn.acknowledgement, undefined);
assert.equal(withdrawn.remediationStatus, "open");

// ---- obligations: acknowledge leaves the occurrence counted; reopen withdraws it
const occurrence = "home:compliance-ca-bc-societies-annual-report:2025-07-31";
await obligations.acknowledgeDecisionPortable(ctx, { societyId: S, ruleId: occurrence, flagLevel: "warn", flagText: "Annual report", evidenceRequired: [], notes: "Waiting on the AGM date" });
let decision = (await remediationRows()).find((row) => row.ruleId === occurrence)!;
assert.equal(decision.status, "acknowledged");
assert.equal(decision.acknowledgedByName, "Mina Patel");
assert.equal(decisionWaivesFinding(occurrence, decision), false, "an acknowledged overdue occurrence stays in the counts");
await obligations.reopenDecisionPortable(ctx, { societyId: S, ruleId: occurrence, flagLevel: "warn", flagText: "Annual report", evidenceRequired: [] });
decision = (await remediationRows()).find((row) => row.ruleId === occurrence)!;
assert.equal(decision.status, "open");
assert.equal(decision.acknowledgedAtISO, undefined, "reopening withdraws the acknowledgement");

// ---- a recommendation can still be dismissed and restored
const recommendation = demoFlags.find((row) => row.dismissable)!;
assert.ok(recommendation, "the demo has a recommendation to dismiss");
await assert.rejects(
  remediation.dismissItemPortable(ctx, { societyId: S, ruleId: recommendation.ruleId, flagLevel: "err", flagText: recommendation.text }),
  /changed/,
  "a client acting on a stale level is refused",
);
await remediation.dismissItemPortable(ctx, { societyId: S, ruleId: recommendation.ruleId, flagLevel: recommendation.level, flagText: "client text is not stored", reason: "  Covered by the board's own review  " });
const dismissed = (await flagById(recommendation.ruleId))!;
assert.equal(dismissed.dismissal?.reason, "Covered by the board's own review");
assert.equal(dismissed.dismissal?.dismissedByName, "Mina Patel", "records who dismissed it");
assert.ok(dismissed.dismissal?.dismissedAtISO, "records when");
assert.equal(dismissed.remediationStatus, "dismissed");
assert.equal(outstanding(await flags()), outstanding(demoFlags) - 1, "a dismissed recommendation leaves the counts");
const stored = (await remediationRows()).find((row) => row.ruleId === recommendation.ruleId)!;
assert.equal(stored.societyId, S, "the dismissal belongs to this workspace");
assert.equal(stored.dismissedByUserId, owner._id);
assert.equal(stored.flagLevel, recommendation.level, "keyed to the level the server computed");
assert.equal(stored.flagText, recommendation.text, "the server's text, not the client's");
assert.equal(stored.dismissedSubjectKey, recommendation.subjectKey, "and to the finding's subject");
assert.ok((await db.query("activity").collect()).some((row) => row.action === "dashboard-item-dismissed" && row.societyId === S));

// The same row at another level (the flag escalated) no longer hides it.
await db.patch(stored._id, { flagLevel: "err" });
const escalated = (await flagById(recommendation.ruleId))!;
assert.equal(escalated.dismissal, undefined, "a dismissal at another level shows the item again");
assert.equal(escalated.remediationStatus, undefined);
await db.patch(stored._id, { flagLevel: recommendation.level });

// Restore: a row the dismissal created goes away; the activity log keeps the history.
assert.deepEqual(await remediation.restoreItemPortable(ctx, { societyId: S, ruleId: recommendation.ruleId }), { restored: true });
assert.equal((await flagById(recommendation.ruleId))!.dismissal, undefined);
assert.equal((await remediationRows()).some((row) => row.ruleId === recommendation.ruleId), false);
assert.deepEqual(await remediation.restoreItemPortable(ctx, { societyId: S, ruleId: recommendation.ruleId }), { restored: false }, "restoring twice is a no-op");

// A row holding a review task returns to it on restore.
const task = await remediation.createComplianceReviewTaskPortable(ctx, { societyId: S, ruleId: recommendation.ruleId, flagLevel: recommendation.level, flagText: recommendation.text, evidenceRequired: recommendation.evidenceRequired });
await remediation.dismissItemPortable(ctx, { societyId: S, ruleId: recommendation.ruleId, flagLevel: recommendation.level });
await remediation.dismissItemPortable(ctx, { societyId: S, ruleId: recommendation.ruleId, reason: "again" });
await remediation.restoreItemPortable(ctx, { societyId: S, ruleId: recommendation.ruleId });
const reopened = (await flagById(recommendation.ruleId))!;
assert.equal(reopened.remediationStatus, "open", "back to the open review workflow, even after dismissing twice");
assert.equal(reopened.remediationTaskId, task.taskId);

// The obligations path cannot hide a recommendation behind the dashboard's back:
// its rows carry no subject key.
await obligations.dismissDecisionPortable(ctx, { societyId: S, ruleId: recommendation.ruleId, flagLevel: recommendation.level, flagText: recommendation.text, evidenceRequired: [] });
assert.equal((await flagById(recommendation.ruleId))!.dismissal, undefined, "a decision without a subject key hides nothing on the dashboard");

// ---- continuity: a recommendation check dismisses; a new subject shows it again
const check = demoChecks.find((row) => row.id === "CONTINUITY-AGREEMENT-OBLIGATIONS" && row.dismissable);
assert.ok(check, "the demo has an agreement recommendation check");
await remediation.dismissItemPortable(ctx, { societyId: S, ruleId: check.id, flagLevel: check.level });
assert.ok((await checks()).find((row) => row.id === check.id)!.dismissal, `${check.id} is dismissed`);
const agreements = await db.query("agreements").collect();
for (const agreement of agreements) {
  const { _id, _creationTime, ...rest } = agreement as PortableDoc & { _creationTime?: number };
  void _id; void _creationTime;
  await db.insert("agreements", rest);
}
const changed = (await checks()).find((row) => row.id === check.id)!;
assert.notEqual(changed.subjectKey, check.subjectKey, "another expiring agreement changes the check's subject");
assert.equal(changed.dismissal, undefined, "a new affected record is not suppressed by the old dismissal");
await remediation.restoreItemPortable(ctx, { societyId: S, ruleId: check.id });

// ---- duplicates: the consent continuity check is left out only while its flag is listed
{
  const { buildAttentionItems, continuityChecksShownAsFlags } = await import("../src/features/dashboard/NeedsAttentionCard");
  const consentFlag = (await flagById("BC-SOC-DIRECTOR-CONSENT"))!;
  const consentCheck = (await checks()).find((row) => row.id === "CONTINUITY-DIRECTOR-CONSENT")!;
  assert.deepEqual(continuityChecksShownAsFlags([consentFlag]), ["CONTINUITY-DIRECTOR-CONSENT"], "desktop: the flag stands in for the check while listed");
  const hiddenFlag = { ...consentFlag, dismissal: { level: "warn" as const, dismissedAtISO: "2026-11-20" } };
  assert.deepEqual(continuityChecksShownAsFlags([hiddenFlag]), [], "a flag that is not listed does not hide its twin");
  assert.deepEqual(continuityChecksShownAsFlags([{ ...consentFlag, ruleId: "LEGAL-bc_company-DIRECTOR-CONSENT" }]), ["CONTINUITY-DIRECTOR-CONSENT"], "corporate consent flags count too");
  const attention = (flagRows: DashboardComplianceFlag[] | undefined) => buildAttentionItems({
    flags: flagRows, checks: [consentCheck], todayISO: "2026-11-21", filingLabel: (kind) => kind, canOpen: () => true,
    flagLink: () => undefined, flagActions: () => null,
  }).map((item) => item.key);
  assert.deepEqual(attention([consentFlag]), ["flag:BC-SOC-DIRECTOR-CONSENT"], "phone: consent listed once, as the compliance item");
  assert.deepEqual(attention([hiddenFlag]), ["continuity:CONTINUITY-DIRECTOR-CONSENT"], "phone: consent never disappears from both");
  assert.deepEqual(attention(undefined), ["continuity:CONTINUITY-DIRECTOR-CONSENT"], "phone: with Compliance hidden, the continuity check shows consent");
}

console.log(`Dashboard dismissals: ${demoFlags.filter((row) => row.dismissable).length} of ${demoFlags.length} demo flags and ${demoChecks.filter((row) => row.dismissable).length} of ${demoChecks.length} continuity checks are dismissable; requirements refuse dismissal on both paths.`);
