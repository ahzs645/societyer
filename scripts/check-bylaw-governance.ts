/**
 * Gate: bylaw amendment lifecycle and bylaw rule validation (ui-governance
 * G-01, G-05, G-06). Runs the real portable handlers on the in-memory runtime.
 */
import assert from "node:assert/strict";
import { MemoryDb, PortableRuntime, definePortableMutation, definePortableQuery, makeCapabilities } from "../shared/portable/index";
import {
  createDraftPortable,
  listPortable as listAmendments,
  markResolutionPassedPortable,
  startConsultationPortable,
} from "../shared/functions/bylawAmendments";
import { getForDatePortable, listPortable as listRules, upsertActivePortable } from "../shared/functions/bylawRules";
import {
  bylawRuleContextFor,
  bylawRuleEffectiveDateProblem,
  bylawRuleProblems,
  evaluateSpecialResolution,
  voteCountProblems,
} from "../shared/bylawGovernance";
import { DEFAULT_BYLAW_RULES } from "../shared/bylawBaselines";
import { evaluateLegalDecision } from "../shared/legalDecision";
import { portableTestPrincipal, portableTestSeed } from "./portable-test-fixture";

// --- G-05: special resolution threshold (BC Societies Act s.1(1), s.17(1)) ---
assert.equal(evaluateSpecialResolution({ votesFor: 2, votesAgainst: 1 }).passed, true, "exactly two-thirds passes");
assert.equal(evaluateSpecialResolution({ votesFor: 2, votesAgainst: 1 }, 66.67).passed, true, "66.67 is snapped to the exact two-thirds");
assert.equal(evaluateSpecialResolution({ votesFor: 199, votesAgainst: 101 }).passed, false, "66.33% fails");
assert.equal(evaluateSpecialResolution({ votesFor: 1, votesAgainst: 10 }).passed, false);
assert.equal(evaluateSpecialResolution({ votesFor: 0, votesAgainst: 0, abstentions: 9 }).passed, false, "no votes cast cannot pass");
assert.equal(evaluateSpecialResolution({ votesFor: 7, votesAgainst: 3 }, 75).passed, false, "a 3/4 bylaw majority is honoured");
assert.equal(evaluateSpecialResolution({ votesFor: 3, votesAgainst: 1 }, 75).passed, true);
assert.equal(evaluateSpecialResolution({ votesFor: 3, votesAgainst: 2 }, 50).passed, false, "a configured threshold below 2/3 cannot lower the statutory minimum");
assert.equal(evaluateSpecialResolution({ votesFor: 8, votesAgainst: 4 }).minimumFor, 8);
assert.deepEqual(voteCountProblems({ votesFor: 1, votesAgainst: 10, abstentions: -2 }), ["Abstentions cannot be negative."]);
assert.deepEqual(voteCountProblems({ votesFor: 1.5 }), ["Votes for must be a whole number."]);
assert.ok(voteCountProblems({}, { requireVotesFor: true }).length > 0);

// --- G-06: rule validation --------------------------------------------------
const bc = bylawRuleContextFor({ entityType: "society", jurisdictionCode: "CA-BC" });
assert.equal(bc.bcSociety, true);
assert.equal(bylawRuleContextFor({ entityType: "corporation__business_", jurisdictionCode: "CA-BC" }).bcSociety, false);
assert.deepEqual(bylawRuleProblems(DEFAULT_BYLAW_RULES, bc), [], "the statutory baseline is valid");
const bad = bylawRuleProblems({ ...DEFAULT_BYLAW_RULES, generalNoticeMinDays: 90, generalNoticeMaxDays: 10, quorumValue: 0 }, bc);
assert.ok(bad.some((p) => /cannot be greater than the notice maximum/.test(p)), "min > max rejected");
assert.ok(bad.some((p) => /at least 1 person/.test(p)), "quorum 0 rejected");
assert.ok(bylawRuleProblems({ ...DEFAULT_BYLAW_RULES, generalNoticeMinDays: 5 }, bc).some((p) => /at least 7 days/.test(p)));
assert.ok(bylawRuleProblems({ ...DEFAULT_BYLAW_RULES, generalNoticeMaxDays: 61 }, bc).some((p) => /60 days/.test(p)));
assert.deepEqual(bylawRuleProblems({ ...DEFAULT_BYLAW_RULES, generalNoticeMinDays: 7 }, bc), [], "bylaws may set a 7-day minimum");
assert.ok(bylawRuleProblems({ ...DEFAULT_BYLAW_RULES, quorumValue: 2 }, bc).some((p) => /s\.82/.test(p)));
assert.deepEqual(bylawRuleProblems({ ...DEFAULT_BYLAW_RULES, quorumValue: 2 }, { bcSociety: false, corporation: true }), [], "a company may have quorum 2");
assert.ok(bylawRuleProblems({ ...DEFAULT_BYLAW_RULES, specialResolutionThresholdPct: 60 }, bc).some((p) => /two-thirds/.test(p)));
assert.ok(bylawRuleProblems({ ...DEFAULT_BYLAW_RULES, resolutionTypes: [{ label: "", thresholdPct: 150 }] }, bc).length >= 2, "nameless 150% custom type rejected, not dropped");
assert.ok(bylawRuleProblems({ ...DEFAULT_BYLAW_RULES, quorumType: "percentage", quorumValue: 0 }, bc).some((p) => /percentage quorum/.test(p)));

assert.equal(bylawRuleEffectiveDateProblem("2026-10-06T00:00:00.000Z", [{ version: 1, effectiveFromISO: "2025-06-01T00:00:00.000Z", status: "Active" }]), null);
assert.match(String(bylawRuleEffectiveDateProblem("2025-06-01T00:00:00.000Z", [{ version: 1, effectiveFromISO: "2025-06-01T00:00:00.000Z", status: "Active" }])), /prospective/);
assert.equal(bylawRuleEffectiveDateProblem("2024-01-01", [{ version: 1, effectiveFromISO: "2025-06-01", status: "Active" }], { allowBackdated: true }), null);

// Empty threshold-preview inputs: one clear message, no integer-range noise.
const preview = evaluateLegalDecision({ jurisdiction: "CA-BC", entityType: "society", body: "members", mode: "meeting", resolution: "ordinary", votesFor: NaN, votesAgainst: NaN });
assert.ok(!preview.warnings.some((w) => /exact-integer/.test(w)));

// --- Runtime: amendment lifecycle + rule versions ------------------------------
const societyId = "soc_bylaw_governance";
const seed = {
  ...portableTestSeed(societyId),
  societies: [{ _id: societyId, name: "Synthetic Bylaw Society", entityType: "society", jurisdictionCode: "CA-BC" }],
  meetings: [{ _id: "agm_2026", societyId, type: "AGM", title: "2026 AGM", status: "Held", scheduledAt: "2026-06-18T18:00:00.000Z" }],
  bylawRuleSets: [{ _id: "rules_v1", ...DEFAULT_BYLAW_RULES, societyId, status: "Active", version: 1, effectiveFromISO: "2025-06-01T00:00:00.000Z", updatedAtISO: "2025-06-01T00:00:00.000Z" }],
};
let counter = 0;
const db = new MemoryDb({ seed, mintId: () => `row_${++counter}` });
const runtime = new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: portableTestPrincipal }).registerAll([
  definePortableMutation({ name: "bylawAmendments:createDraft", applicationPolicy: true, handler: createDraftPortable }),
  definePortableMutation({ name: "bylawAmendments:startConsultation", applicationPolicy: true, handler: startConsultationPortable }),
  definePortableMutation({ name: "bylawAmendments:markResolutionPassed", applicationPolicy: true, handler: markResolutionPassedPortable }),
  definePortableQuery({ name: "bylawAmendments:list", applicationPolicy: true, handler: listAmendments }),
  definePortableMutation({ name: "bylawRules:upsertActive", applicationPolicy: true, handler: upsertActivePortable }),
  definePortableQuery({ name: "bylawRules:list", applicationPolicy: true, handler: listRules }),
  definePortableQuery({ name: "bylawRules:getForDate", applicationPolicy: true, handler: getForDatePortable }),
]);

// G-01: a draft needs a title; with one it saves.
await assert.rejects(() => runtime.runMutation("bylawAmendments:createDraft", { societyId, title: "  ", baseText: "a", proposedText: "b" }), /title/);
const draftId = await runtime.runMutation("bylawAmendments:createDraft", { societyId, title: " Quorum amendment ", baseText: "Quorum is 3.", proposedText: "Quorum is 5." }) as string;
await runtime.runMutation("bylawAmendments:startConsultation", { id: draftId });

// G-05: negative counts rejected; a sub-threshold vote is recorded as failed.
await assert.rejects(() => runtime.runMutation("bylawAmendments:markResolutionPassed", { id: draftId, votesFor: 1, votesAgainst: 10, abstentions: -2 }), /cannot be negative/);
const failed = await runtime.runMutation("bylawAmendments:markResolutionPassed", { id: draftId, votesFor: 6, votesAgainst: 4, abstentions: 0 }) as any;
assert.equal(failed.passed, false);
let row = (await runtime.runQuery("bylawAmendments:list", { societyId }) as any[])[0];
assert.equal(row.title, "Quorum amendment");
assert.equal(row.status, "Consultation", "a failed special resolution never marks the amendment passed");
assert.equal(row.history.at(-1).action, "resolution_failed");
await assert.rejects(() => runtime.runMutation("bylawAmendments:markResolutionPassed", { id: draftId, votesFor: 9, votesAgainst: 1, resolutionDateISO: "2999-01-01" }), /future/);
const passed = await runtime.runMutation("bylawAmendments:markResolutionPassed", { id: draftId, votesFor: 8, votesAgainst: 4, abstentions: 1, meetingId: "agm_2026" }) as any;
assert.equal(passed.passed, true);
row = (await runtime.runQuery("bylawAmendments:list", { societyId }) as any[])[0];
assert.equal(row.status, "ResolutionPassed");
assert.equal(row.resolutionPassedAtISO, "2026-06-18T00:00:00.000Z", "the resolution date is the meeting date, not the click time");
await assert.rejects(() => runtime.runMutation("bylawAmendments:markResolutionPassed", { id: draftId, votesFor: 8, votesAgainst: 4 }), /consultation/);

// G-06: impossible rules rejected server-side; versions are prospective.
const ruleArgs = (overrides: Record<string, unknown>) => {
  const { societyId: _s, version: _v, status: _st, updatedAtISO: _u, ...values } = DEFAULT_BYLAW_RULES as Record<string, unknown>;
  return { ...values, societyId, ...overrides };
};
await assert.rejects(() => runtime.runMutation("bylawRules:upsertActive", ruleArgs({ generalNoticeMinDays: 90, generalNoticeMaxDays: 10, quorumValue: 0, effectiveFromISO: "2026-10-01T00:00:00.000Z" })), /not saved/);
await assert.rejects(() => runtime.runMutation("bylawRules:upsertActive", ruleArgs({ effectiveFromISO: "2025-06-01T00:00:00.000Z" })), /prospective/);
await runtime.runMutation("bylawRules:upsertActive", ruleArgs({ quorumValue: 5, effectiveFromISO: "2026-10-01T00:00:00.000Z" }));
const atAgm = await runtime.runQuery("bylawRules:getForDate", { societyId, dateISO: "2026-06-18T18:00:00.000Z" }) as any;
assert.equal(atAgm.version, 1, "the June 2026 AGM is still evaluated under v1");
assert.equal(atAgm.quorumValue, 3);
const later = await runtime.runQuery("bylawRules:getForDate", { societyId, dateISO: "2026-10-02T00:00:00.000Z" }) as any;
assert.equal(later.version, 2);
assert.equal(later.quorumValue, 5);
assert.equal((await runtime.runQuery("bylawRules:list", { societyId }) as any[]).some((r) => "allowBackdated" in r), false, "the backdating flag is not persisted");
await runtime.runMutation("bylawRules:upsertActive", ruleArgs({ quorumValue: 4, effectiveFromISO: "2024-01-01T00:00:00.000Z", allowBackdated: true }));
assert.equal((await runtime.runQuery("bylawRules:getForDate", { societyId, dateISO: "2024-06-01T00:00:00.000Z" }) as any).quorumValue, 4, "an explicitly backdated historical version applies to its own period only");

console.log("bylaw governance checks passed");
