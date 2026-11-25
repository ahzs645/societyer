import assert from "node:assert/strict";
import { MemoryDb, LocalStoreDb, MemoryRowStore, PortableRuntime, definePortableMutation, definePortableQuery, makeCapabilities } from "../shared/portable/index";
import { createPortable, createRenewalPortable, listPortable, updatePortable, removePortable } from "../shared/functions/insurance";
import { policyHistory, policyCostChange, estimatePayrollAssessment, policyCoverageChanges } from "../shared/insuranceHistory";
import { normalizeSectionPayload, dedupeInsurancePolicies } from "../shared/functions/importSessionHelpers/importSessionNormalize";
import { portableTestPrincipal, portableTestSeed, PORTABLE_TEST_AUTH_SUBJECT } from "./portable-test-fixture";

const societyId = "soc_insurance_history";
const exclusion = { label: "Liquor liability", endorsementNumber: "C70120.3", summary: "Confirm source wording", sourceExternalIds: ["google-drive:endorsement"], citationId: "source:1" };
const assessmentRates = [{ classificationCode: "762018", assessmentYear: "2015", netRatePer100PayrollCents: 10, baseRatePer100PayrollCents: 13, experienceDiscountPercent: 21.5, sourceExternalIds: ["google-drive:worksafe-notice"] }];
const seed = { ...portableTestSeed(societyId), insurancePolicies: [{
  _id: "policy_original", societyId, kind: "GeneralLiability", insurer: "Insurer", broker: "Broker", policyNumber: "OLD-1",
  startDate: "2024-05-06", endDate: "2025-05-06", renewalDate: "2025-05-06", status: "Lapsed", premiumCents: 188500,
  coverageCents: 500000000, sourceExternalIds: ["old-evidence"], policyExclusions: [exclusion], claimIncidents: [{ notes: "Old term incident" }],
}], documents: [{ _id: "foreign_document", societyId: "soc_other" }] };
const outcomes: any[] = [];
for (const db of [new MemoryDb({ seed, mintId: () => "policy_new" }), new LocalStoreDb(new MemoryRowStore(seed), { mintId: () => "policy_new" })]) {
  const runtime = new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: portableTestPrincipal }).registerAll([
    definePortableMutation({ name: "insurance:createRenewal", applicationPolicy: true, handler: createRenewalPortable }),
    definePortableMutation({ name: "insurance:create", applicationPolicy: true, handler: createPortable }),
    definePortableMutation({ name: "insurance:update", applicationPolicy: true, handler: updatePortable }),
    definePortableMutation({ name: "insurance:remove", applicationPolicy: true, handler: removePortable }),
    definePortableQuery({ name: "insurance:list", applicationPolicy: true, handler: listPortable }),
  ]);
  await assert.rejects(() => runtime.runMutation("insurance:createRenewal", { id: "policy_original", policyNumber: "NEW", startDate: "2025-02-30", endDate: "2026-05-06" }), /valid policy term/);
  await assert.rejects(() => runtime.runMutation("insurance:createRenewal", { id: "policy_original", policyNumber: "NEW", startDate: "2025-05-06", endDate: "2025-05-05" }), /must follow/);
  await assert.rejects(() => runtime.runMutation("insurance:createRenewal", { id: "policy_original", policyNumber: "NEW", startDate: "2025-05-06", endDate: "2026-05-06", premiumCents: -1 }), /nonnegative/);
  assert.equal((await runtime.runQuery("insurance:list", { societyId }) as any[]).length, 1, "Invalid renewal must leave prior term intact");
  await assert.rejects(() => runtime.runMutation("insurance:create", { societyId, sourceDocumentIds: ["foreign_document"] }), /not found|scope|workspace/i);
  await runtime.runMutation("insurance:update", { id: "policy_original", patch: { assessmentRates } });
  await runtime.runMutation("insurance:createRenewal", { id: "policy_original", policyNumber: "NEW-1", startDate: "2025-05-06", endDate: "2026-05-06", premiumCents: 188500, policyFeeCents: 9500, totalCostCents: 198000 });
  const rows = await runtime.runQuery("insurance:list", { societyId }) as any[];
  const original = rows.find(row => row._id === "policy_original")!;
  const renewal = rows.find(row => row._id === "policy_new")!;
  assert.equal(original.policyNumber, "OLD-1");
  assert.deepEqual(original.policyExclusions, [exclusion]);
  assert.deepEqual(original.assessmentRates, assessmentRates);
  assert.equal(renewal.policySeriesKey, original.policySeriesKey);
  assert.equal(renewal.status, "NeedsReview");
  assert.equal(renewal.totalCostCents, 198000);
  for (const field of ["sourceExternalIds", "policyExclusions", "coverageCents", "claimIncidents", "assessmentRates"]) assert.equal(renewal[field], undefined, `Renewal must not copy ${field}`);
  assert.equal(policyHistory(renewal, rows).length, 2);
  await runtime.runMutation("insurance:update", { id: original._id, patch: { grossReceiptsCents: 0, currency:"CAD" } });
  await runtime.runMutation("insurance:update", { id: original._id, patch:{}, clearFields:["grossReceiptsCents"] });
  await assert.rejects(() => runtime.runMutation("insurance:update", { id: original._id, patch:{}, clearFields:["societyId"] }), /Invalid optional/);
  await runtime.runMutation("insurance:remove", { id:original._id });
  const archivedTerms = await runtime.runQuery("insurance:list", {societyId}) as any[];
  const archived = archivedTerms.find(row => row._id === original._id);
  assert.ok(archived.archivedBy && archived.archivedAtISO);
  assert.equal(archived.grossReceiptsCents,undefined);
  assert.equal(archived.currency,"CAD");
  assert.equal(policyHistory(renewal,archivedTerms).length,2);
  outcomes.push(rows.map(({ createdAtISO, updatedAtISO, _creationTime, entityId, ...row }) => row));
}
assert.deepEqual(outcomes[0], outcomes[1], "Hosted-compatible handler differs across local stores");
assert.equal(policyCostChange(undefined, 100), undefined);
assert.deepEqual(policyCostChange(74800, 69500), { cents: 5300, percent: 5300 / 69500 * 100 });
assert.deepEqual(policyCostChange(10, 0), { cents: 10, percent: undefined });
assert.equal(policyHistory({ _id: "a", societyId, policySeriesKey: "same" }, [{ _id: "a", societyId, policySeriesKey: "same" }, { _id: "b", societyId: "foreign", policySeriesKey: "same" }]).length, 1);
assert.equal(estimatePayrollAssessment(undefined, 10), undefined);
assert.equal(estimatePayrollAssessment(1000000, undefined), undefined);
assert.equal(estimatePayrollAssessment(1000000, 10), 1000, "$10 estimated on $10,000 payroll at $0.10 per $100");
assert.equal(estimatePayrollAssessment(0, 10), 0, "Explicit zero payroll remains known");
assert.equal(estimatePayrollAssessment(-1, 10), undefined);
assert.equal(estimatePayrollAssessment(100, -1), undefined);
assert.deepEqual(normalizeSectionPayload({ assessmentRates }).assessmentRates, assessmentRates);
const normalized = normalizeSectionPayload({ insurer: "Insurer", policyNumber: "X", policyExclusions: [exclusion], policyFeeCents: 9500, totalCostCents: 198000 });
assert.deepEqual(normalized.policyExclusions, [exclusion]);
assert.equal(normalized.policyFeeCents, 9500);
assert.equal(dedupeInsurancePolicies([normalized, normalized]).length, 1);
const memberSeed = { ...portableTestSeed(societyId) };
memberSeed.users[0] = { ...memberSeed.users[0], role: "Member", authSubject: PORTABLE_TEST_AUTH_SUBJECT };
const member = new PortableRuntime({ db: new MemoryDb({ seed: { ...memberSeed, insurancePolicies: seed.insurancePolicies } }), capabilities: makeCapabilities({}), principalProvider: portableTestPrincipal }).register(definePortableMutation({ name: "insurance:createRenewal", applicationPolicy: true, handler: createRenewalPortable }));
await assert.rejects(() => member.runMutation("insurance:createRenewal", { id: "policy_original", policyNumber: "NEW", startDate: "2025-05-06", endDate: "2026-05-06" }), /Permission financials:write/);
console.log("Insurance history passed: renewal persistence/parity, prior term preservation, permissions, invalid inputs, cost comparisons and exclusion import normalization.");

assert.deepEqual(policyCoverageChanges([{ label: "Cyber extortion threats", limitCents: 5000000 }, { label: "CGL", limitCents: 500000000 }], [{ label: "Cyber extortion threats", limitCents: 2500000 }, { label: "CGL", limitCents: 500000000 }]), [{ label: "Cyber extortion threats", status: "changed", previousCents: 5000000, currentCents: 2500000 }]);
assert.equal(policyCoverageChanges(undefined, [{ label: "CGL", limitCents: 500000000 }])[0].status, "unknown");
assert.equal(policyCoverageChanges([{ label: "CGL" }], [{ label: "CGL", limitCents: 500000000 }])[0].status, "unknown");
assert.deepEqual(policyCoverageChanges([{ label: "A", limitCents: 0 }], [{ label: "B", limitCents: 10 }]).map(item => item.status), ["removed", "added"]);
assert.equal(policyCoverageChanges([{ label: "A", limitCents: 0 }], [{ label: "A", limitCents: 0 }]).length, 0);
assert.equal(policyCoverageChanges([{ label: "A", limitCents: 10 }, { label: "A", limitCents: 20 }], [{ label: "A", limitCents: 30 }])[0].status, "unknown");
console.log("Coverage history passed: explicit cyber extortion $50k to $25k, additions/removals and unknown/duplicate limits.");

assert.equal(dedupeInsurancePolicies([{ insurer: "WorkSafeBC", policyNumber: "Account 811671", assessmentRates, sourceExternalIds: ["google-drive:worksafe-notice"] }]).length, 1, "Assessment rate notice needs no invented premium or term dates");
assert.equal(dedupeInsurancePolicies([{ insurer: "Known insurer", policyNumber: "Known policy", sourceExternalIds: ["google-drive:actual-source"] }]).length, 1, "Drive evidence qualifies for review-only insurance import");

// A package premium belongs to the term. Line amounts and conditions survive edits independently.
const { addressCoverageLines } = await import("../shared/insuranceRegister");
const { validateInsurancePolicyInput } = await import("../shared/recordValidation");
const { invoiceFields, linkRenewalSources, declarationFields } = await import("../shared/intake/insuranceRenewal");
const lines = (values: string[]) => values.map((text,blockIndex) => ({text,page:1,kind:"paragraph" as const,blockIndex}));
const fields = declarationFields(lines([
  "Coverage\tForm\tDeductible\tLimit of", "Liability\tAB12-3", "Coverage A - Premises - Any\t1,000\t500,000", "One Premises",
]), "local:declaration", {policyNumber:{value:"TEST-1"}});
assert.equal(fields.coverageItems[0].limitBasis,"Any one premises");
assert.equal(fields.coverageItems[0].deductibleCents,100000);
assert.equal(fields.coverageItems[0].limitCents,50000000);
const schedule = addressCoverageLines([{lineId:"line-2",label:"A"}, {label:"B"}, {label:"C"}]);
assert.deepEqual(schedule.map(row => row.lineId), ["line-2","line-1","line-3"]);
const stored = normalizeSectionPayload({coverageItems:[{...fields.coverageItems[0],currency:"CAD",lineId:"term-line",effectiveDate:"2026-10-01"}]});
assert.equal(stored.coverageItems[0].lineId,"term-line");
assert.equal(stored.coverageItems[0].currency,"CAD");
assert.ok(validateInsurancePolicyInput({minimumRetainedPremiumPercent:125},{partial:true}).minimumRetainedPremiumPercent);
assert.ok(validateInsurancePolicyInput({coverageItems:[{label:"CGL",effectiveDate:"2026-02-31"}]},{partial:true}).coverageItems);
const observation = invoiceFields(lines(["Invoice Number","1234","Account Number\tDate","TEST-1\tMarch 3, 2026","Balance due on\tAmount Due","April 1, 2026\t$12.34","Total Invoice Balance:\t$12.34"]), "local:invoice");
assert.equal(observation?.amountCents,1234);
assert.equal(observation?.dueDate,"2026-04-01");
assert.equal(observation?.observedDate,"2026-03-03");
assert.equal(observation?.reviewStatus,"pending");
const docs:any[] = [
  {id:"a",name:"first",pages:["a"],lines:[],role:"Declaration",policy:{policyNumber:"TEST-1"}},
  {id:"b",name:"second",pages:["b"],lines:[],role:"Declaration",policy:{policyNumber:"TEST-10"}},
  {id:"s",name:"schedule",pages:["s"],lines:lines(["Policy Number: TEST-1 & TEST-10"]),role:"Other"},
  {id:"i",name:"invoice",pages:["i"],lines:lines(["Policy Number: TEST-10"]),role:"Invoice"},
  {id:"all",name:"combined",pages:["a","s","b","i"],lines:[],role:"Other"},
  {id:"extra",name:"partial compilation",pages:["s","unique"],lines:[],role:"Other"},
];
linkRenewalSources(docs);
assert.deepEqual(docs[2].links,["a","b"]);
assert.deepEqual(docs[3].links,["b"]);
assert.equal(docs[4].role,"Combined copy");
assert.equal(docs[5].role,"Other");
console.log("Renewal package checks passed for typed limits, shared sources, compilations and invoice dates.");
