/**
 * Gate: the agreements register (schema finding A5).
 *
 * Kernel rules (validation, status derivation, renewal dates, obligations,
 * signing-authority tiers, continuity gaps, intake mapping), the portable
 * handlers (create / update / renew / supersede / terminate / remove with
 * their generated deadlines, links, permissions, search, summary), the
 * `agreements` import bundle key, intake staging, and the "Convert agreement
 * gaps to agreements" conversion. Synthetic data only.
 */
import assert from "node:assert/strict";
import {
  addDaysIso,
  agreementGaps,
  agreementObligations,
  agreementPayloadFromExtraction,
  currentTermEnd,
  deriveAgreementStatus,
  inferAgreementKind,
  renewalNoticeDate,
  signingAuthorityCheck,
  validateAgreementInput,
} from "../shared/agreements";
import { todayDateOnly } from "../shared/dateOnly";
import { actionPermission } from "../shared/functions/actionPolicy";
import { hasPermission } from "../shared/functions/permissions";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";
import { PortableRuntime } from "../shared/portable/define";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import { importBundlePreflightIssues } from "../shared/importBundlePreflight";
import { recordsFromBundle } from "../shared/functions/importSessionHelpers/importSessionRecordKinds";
import { classBundleRecords } from "../shared/intake/bundleClasses";

const today = todayDateOnly();
const day = (offset: number) => addDaysIso(today, offset);
const fv = (value: unknown, quote = String(value)) => ({ value, status: "stated", confidence: 0.8, locators: [{ kind: "block", blockIndex: 1, page: 1, quote }], verification: "verified_span" });

/* -------------------------------- validation -------------------------------- */

const full = { title: "Hall lease", kind: "lease", status: "active", parties: [{ name: "Example Society", role: "us" }, { name: "Example Hall Association", role: "counterparty" }], effectiveDate: "2025-01-01", endDate: "2025-12-31", valueCents: 120000 };
assert.deepEqual(validateAgreementInput(full), {}, "a complete agreement validates");
assert.match(validateAgreementInput({ ...full, title: " " }).title, /title/);
assert.match(validateAgreementInput({ ...full, endDate: "2024-12-31" }).endDate, /on or after/);
assert.match(validateAgreementInput({ ...full, valueCents: -1 }).valueCents, /negative/);
assert.match(validateAgreementInput({ ...full, parties: [{ name: "Example Society", role: "us" }] }).parties, /counterparty/);
assert.equal(validateAgreementInput({ ...full, parties: [{ name: "Example Funder", role: "funder" }] }).parties, undefined, "a funder counts as the other side");
assert.match(validateAgreementInput({ ...full, kind: "contractish" }).kind, /kind/);
assert.match(validateAgreementInput({ ...full, effectiveDate: "2025-02-30" }).effectiveDate, /date/);
assert.deepEqual(validateAgreementInput({ status: "terminated" }, { partial: true }), {}, "a status-only edit does not re-check the parties");
assert.match(validateAgreementInput({ endDate: "2024-01-01" }, { partial: true, existing: { effectiveDate: "2025-01-01" } }).endDate, /on or after/, "partial edits check against the stored dates");
assert.equal(validateAgreementInput({ ...full, parties: [] }, { requireCounterparty: false }).parties, undefined, "imports may stage a draft without parties");
assert.match(validateAgreementInput({ ...full, reportingObligations: [{ text: "Report", recurrence: "weekly" }] })["reportingObligations.0.recurrence"], /how often/);

/* ---------------------------- status and renewal ---------------------------- */

assert.equal(deriveAgreementStatus({ status: "active", endDate: "2020-01-01" }, today), "expired", "an ended term is expired");
assert.equal(deriveAgreementStatus({ status: "unknown", endDate: "2020-01-01" }, today), "expired");
assert.equal(deriveAgreementStatus({ status: "active", endDate: "2020-01-01", autoRenew: true }, today), "active", "auto-renewal keeps it running");
assert.equal(deriveAgreementStatus({ status: "draft", endDate: "2020-01-01" }, today), "draft", "a draft never becomes active or expired by date");
assert.equal(deriveAgreementStatus({ status: "draft" }, today), "draft");
assert.equal(deriveAgreementStatus({ status: "active", supersededById: "x" }, today), "superseded");
assert.equal(deriveAgreementStatus({}, today), "unknown", "no status is unknown, never active");
assert.equal(currentTermEnd({ endDate: "2024-03-31", autoRenew: true, renewalTermMonths: 12 }, "2026-01-15"), "2026-03-31", "auto-renewal rolls the term forward");
assert.equal(renewalNoticeDate({ endDate: "2026-06-30", renewalNoticeDays: 60 }, "2026-01-01"), "2026-05-01");
assert.equal(inferAgreementKind("mou", "Memorandum"), "MOU");
assert.equal(inferAgreementKind("contract", "Office lease 2020"), "lease");
assert.equal(inferAgreementKind("agreement", "Data Sharing Agreement"), "data_sharing");
assert.equal(inferAgreementKind("grant", "Contribution agreement"), "funding");
assert.equal(inferAgreementKind("contract", "General Service Agreement"), "service");

/* -------------------------------- obligations -------------------------------- */

const obligationsFor = (extra: Record<string, unknown>) => agreementObligations({ title: "Example", status: "active", effectiveDate: day(-100), endDate: day(80), renewalNoticeDays: 30, deliverables: [{ id: "d1", text: "Final report", dueDate: day(-5), status: "not_started" }, { id: "d2", text: "Done", dueDate: day(10), status: "accepted" }], reportingObligations: [{ id: "r1", text: "Quarterly report", dueDate: day(20), recurrence: "quarterly" }], ...extra }, today);
const active = obligationsFor({});
assert.deepEqual(active.map((item) => item.sourceKey).sort(), ["deliverable:d1", "renewal-notice:" + day(80), "report:r1", "term-end:" + day(80)].sort(), "active agreements generate deliverable, report, notice and end deadlines; done deliverables none");
assert.equal(active.find((item) => item.sourceKey === "report:r1")?.recurrence, "Quarterly");
assert.equal(active.find((item) => item.sourceKey.startsWith("renewal-notice"))?.dueDate, day(50));
assert.ok(!obligationsFor({ status: "draft" }).some((item) => item.sourceKey === "deliverable:d1"), "a draft only implies future dates");
assert.deepEqual(obligationsFor({ status: "terminated" }), [], "closed agreements imply nothing");
assert.ok(!obligationsFor({ renewalDecision: { decision: "renew" } }).some((item) => item.category === "Agreement renewal"), "a renewal decision clears the notice deadline");

/* ----------------------------- signing authority ----------------------------- */

const tiers = [
  { maxCents: 500000, signaturesRequired: 1 },
  { minCents: 500001, maxCents: 1000000, signaturesRequired: 2 },
  { minCents: 1000001, signaturesRequired: 2, roles: ["Board"], notes: "Board approval above $10,000" },
];
const authorities = [
  { personName: "Alex Example", roleTitle: "President", tiers, effectiveDate: "2020-01-01", status: "Active" },
  { personName: "Blair Sample", roleTitle: "Treasurer", tiers, effectiveDate: "2020-01-01", status: "Active" },
];
const two = [{ name: "Alex Example" }, { name: "Blair Sample" }];
assert.equal(signingAuthorityCheck({ valueCents: 300000, ourSignatories: [{ name: "Alex Example" }] }, authorities, today).status, "ok");
const short = signingAuthorityCheck({ valueCents: 800000, ourSignatories: [{ name: "Alex Example" }] }, authorities, today);
assert.equal(short.status, "warning");
assert.match(short.issues.join(" "), /2 signatures required/);
assert.match(signingAuthorityCheck({ valueCents: 300000, ourSignatories: [{ name: "Casey Outsider" }] }, authorities, today).issues.join(" "), /Not on the signing-authority register: Casey Outsider/);
const board = signingAuthorityCheck({ valueCents: 2000000, ourSignatories: two }, authorities, today);
assert.equal(board.boardApprovalRequired, true);
assert.match(board.issues.join(" "), /board approval/);
assert.equal(signingAuthorityCheck({ valueCents: 2000000, ourSignatories: two, approvalMotionId: "m1" }, authorities, today).status, "ok", "an authorizing motion satisfies the board tier");
assert.equal(signingAuthorityCheck({ ourSignatories: two }, authorities, today).status, "no_value");
assert.equal(signingAuthorityCheck({ valueCents: 100 }, [], today).status, "no_tiers");
assert.equal(signingAuthorityCheck({ valueCents: 300000, signedDate: "2019-06-01", ourSignatories: [{ name: "Alex Example" }] }, authorities, today).status, "no_tiers", "tiers not yet in force on the signing date do not apply");

/* ------------------------------ continuity gaps ------------------------------ */

const gaps = agreementGaps([
  { _id: "a1", title: "Expiring", status: "active", endDate: day(30) },
  { _id: "a2", title: "Decided", status: "active", endDate: day(30), renewalDecision: { decision: "let_expire" } },
  { _id: "a3", title: "Overdue report", status: "active", endDate: day(400), reportingObligations: [{ id: "r1", text: "Annual report", dueDate: day(-3) }] },
  { _id: "a4", title: "Unreviewed draft", status: "draft", endDate: day(10) },
  { _id: "a5", title: "Long expired", status: "active", endDate: day(-400) },
], today);
assert.deepEqual(gaps.map((gap) => `${gap.agreementId}:${gap.kind}`).sort(), ["a1:agreement_renewal", "a3:funder_report"]);

/* ------------------------------- intake mapping ------------------------------- */

const record = {
  kind: fv("contract"), title: fv("General Service Agreement — Air Monitoring"),
  parties: [fv("Example Clean Air Society"), fv("Brightwater Monitoring Ltd")],
  effective: fv({ iso: "2025-04-01", precision: "day" }, "April 1, 2025"), expiry: fv({ iso: "2025-12-31", precision: "day" }, "December 31, 2025"),
  amount: fv({ amountCents: 1200000, currency: "CAD", text: "$12,000" }, "$12,000"),
  deliverables: [fv("Quarterly data summaries")], signatories: [fv({ nameAsWritten: "Robin Vale", role: "Chair", affiliation: "Example Clean Air Society" })],
  reportingRequirements: [{ text: fv("Final report due April 30, 2026"), due: fv({ iso: "2026-04-30", precision: "day" }, "April 30, 2026") }],
  status: fv("signed"), agreementNumber: fv("GSA-2025-01"),
};
const payload = agreementPayloadFromExtraction(record, { fileKey: "local:gsa.pdf", fileName: "gsa.pdf", organizationName: "Example Clean Air Society", asOfISO: "2026-10-07" });
assert.equal(payload.kind, "service");
assert.equal(payload.status, "expired", "a signed agreement whose term ended is expired, not active");
assert.deepEqual(payload.parties, [{ name: "Example Clean Air Society", role: "us" }, { name: "Brightwater Monitoring Ltd", role: "counterparty" }]);
assert.deepEqual(payload.ourSignatories, [{ name: "Robin Vale", title: "Chair" }]);
assert.equal(payload.valueCents, 1200000);
assert.equal(payload.reviewStatus, "NeedsReview");
assert.equal(payload.reportingObligations[0].dueDate, "2026-04-30");
assert.equal(agreementPayloadFromExtraction({ ...record, status: { status: "not_stated", locators: [] } }, { fileKey: "x", asOfISO: "2024-01-01" }).status, "draft", "without signature evidence an agreement stays a draft");
assert.deepEqual(importBundlePreflightIssues({ agreements: [payload] }), [], "the intake payload is a lossless bundle record");
assert.equal(recordsFromBundle({ agreements: [payload] })[0].recordKind, "agreement");

const run: any = {
  runId: "run", name: "Synthetic", sourceKind: "upload", sourceRoot: "", startedAtISO: "2026-10-07T00:00:00.000Z", engine: {}, clusters: [], processingLog: [],
  files: [{ fileKey: "local:gsa.pdf", name: "gsa.pdf", path: "gsa.pdf", acquisitionStatus: "local", disposition: "extract" }, { fileKey: "local:fund.pdf", name: "fund.pdf", path: "fund.pdf", acquisitionStatus: "local", disposition: "extract" }],
  extractions: [
    { fileId: "local:gsa.pdf", fileKey: "local:gsa.pdf", docClass: "agreement", schemaVersion: "agreement/1", engine: "deterministic", record, unsupported: [], references: [] },
    { fileId: "local:fund.pdf", fileKey: "local:fund.pdf", docClass: "grant", schemaVersion: "grant/1", engine: "deterministic", record: { kind: fv("grant"), title: fv("Contribution Agreement 2025"), grantStage: fv("agreement"), funder: fv("Example Fund"), amount: fv({ amountCents: 500000, currency: "CAD", text: "$5,000" }) }, unsupported: [], references: [] },
  ],
  reconciliation: { meetings: [], links: [], gaps: [], actionChains: [] },
  organizationName: "Example Clean Air Society",
};
const staged = classBundleRecords(run, { minutesPayloads: [] });
assert.equal(staged.collections.agreements?.length, 2, "an agreement and a signed funding agreement stage as native agreements");
assert.equal(staged.collections.grants?.length, 1, "the funding agreement is also the grant's record");
assert.ok(!(staged.collections.deadlines ?? []).some((row: any) => row.category === "Agreement" || row.category === "Agreement reporting"), "agreement deadlines come from the agreement, not separate rows");
assert.ok(staged.transposed.has("local:gsa.pdf"), "agreement files count as transposed");

/* -------------------------------- permissions -------------------------------- */

assert.equal(actionPermission("agreements:list", "query"), "agreements:read");
assert.equal(actionPermission("agreements:convertGaps", "mutation"), "agreements:write");
assert.equal(actionPermission("agreements:importSection", "mutation"), "agreements:write");
assert.ok(hasPermission("Admin", "agreements:write") && hasPermission("Owner", "agreements:write"));
assert.ok(hasPermission("Director", "agreements:read") && !hasPermission("Director", "agreements:write"));
assert.ok(hasPermission("Viewer", "agreements:read") && !hasPermission("Member", "agreements:read"));

/* ----------------------------- portable handlers ----------------------------- */

const now = new Date().toISOString();
const db = new MemoryDb({
  seed: {
    societies: [{ _id: "soc", name: "Example Clean Air Society" }, { _id: "other", name: "Other Society" }],
    users: [
      { _id: "owner", societyId: "soc", role: "Owner", status: "Active", displayName: "Owner Person" },
      { _id: "viewer", societyId: "soc", role: "Viewer", status: "Active" },
      { _id: "member", societyId: "soc", role: "Member", status: "Active" },
    ],
    grants: [
      { _id: "grant1", societyId: "soc", title: "Air Quality Fund", funder: "Example Fund", status: "Active", sourceExternalIds: ["local:fund.pdf"], createdAtISO: now, updatedAtISO: now },
      { _id: "grantOther", societyId: "other", title: "Foreign grant", funder: "X", status: "Active", createdAtISO: now, updatedAtISO: now },
    ],
    committees: [{ _id: "c1", societyId: "soc", name: "Operations Committee", cadence: "Monthly", color: "blue", status: "Active", createdAtISO: now }],
    meetings: [{ _id: "mt1", societyId: "soc", type: "Board", title: "Board meeting", scheduledAt: "2025-03-11T19:00:00Z", status: "Held", electronic: false, attendeeIds: [] }],
    motions: [{ _id: "mo1", societyId: "soc", primaryMeetingId: "mt1", text: "That the society enter the hall lease.", status: "Voted", outcome: "Carried", createdAtISO: now, updatedAtISO: now }],
    signingAuthorities: authorities.map((row, index) => ({ _id: `sa${index}`, societyId: "soc", authorityType: "signing", confidence: "High", createdAtISO: now, ...row })),
    documents: [{ _id: "doc1", societyId: "soc", title: "Signed lease.pdf", category: "Agreement", createdAtISO: now, flaggedForDeletion: false, tags: ["google-drive:lease1"] }],
    representationGaps: [
      { _id: "gap1", societyId: "soc", infoType: "agreement", reason: "no_schema_field", status: "open", title: "Agreement", sourceTitle: "2014 Office Lease.pdf", sourceExternalId: "google-drive:lease2014", excerpt: "Lease between the society and Example Landlord", observedDate: "2014-05", reviewHistory: [], createdAtISO: now, updatedAtISO: now },
      { _id: "gap2", societyId: "soc", infoType: "agreement.contract", reason: "no_schema_field", status: "open", title: "GSA", sourceExternalId: "local:gsa.pdf", reviewHistory: [], createdAtISO: now, updatedAtISO: now },
      { _id: "gap3", societyId: "soc", infoType: "motion.dissent", reason: "no_schema_field", status: "open", reviewHistory: [], createdAtISO: now, updatedAtISO: now },
    ],
    intakeRuns: [{ _id: "run1", societyId: "soc", name: "Archive", sourceKind: "upload", status: "reviewing", createdAtISO: now, updatedAtISO: now }],
    intakeFiles: [
      { _id: "if1", societyId: "soc", runId: "run1", fileKey: "local:gsa.pdf", name: "gsa.pdf", path: "gsa.pdf", acquisitionStatus: "local", disposition: "extract", createdAtISO: now, updatedAtISO: now },
      { _id: "if2", societyId: "soc", runId: "run1", fileKey: "local:fund.pdf", name: "fund.pdf", path: "fund.pdf", acquisitionStatus: "local", disposition: "extract", createdAtISO: now, updatedAtISO: now },
      { _id: "if3", societyId: "soc", runId: "run1", fileKey: "local:mou.pdf", name: "mou.pdf", path: "mou.pdf", acquisitionStatus: "local", disposition: "extract", createdAtISO: now, updatedAtISO: now },
    ],
    intakeExtractions: [
      { _id: "ex1", societyId: "soc", runId: "run1", fileKey: "local:gsa.pdf", docClass: "agreement", engine: "deterministic", record, unsupported: [{ infoType: "agreement.contract", category: "no_table", description: "GSA", locators: [] }], references: [], status: "pending_review", createdAtISO: now, updatedAtISO: now },
      { _id: "ex2", societyId: "soc", runId: "run1", fileKey: "local:fund.pdf", docClass: "grant", engine: "deterministic", record: run.extractions[1].record, unsupported: [], references: [], status: "pending_review", createdAtISO: now, updatedAtISO: now },
      { _id: "ex3", societyId: "soc", runId: "run1", fileKey: "local:mou.pdf", docClass: "agreement", engine: "deterministic", record: { kind: fv("mou"), title: fv("Memorandum of Understanding"), parties: [] }, unsupported: [{ infoType: "agreement.contract", category: "no_table", description: "MOU", locators: [] }], references: [], status: "pending_review", createdAtISO: now, updatedAtISO: now },
    ],
  },
});
const principal = (userId: string) => () => ({ kind: "user" as const, runtime: "test" as const, assurance: "trusted-workspace" as const, subject: userId, userId, societyId: "soc" });
const owner = new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: principal("owner") }).registerAll(PORTABLE_FUNCTIONS);
const viewer = new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: principal("viewer") }).registerAll(PORTABLE_FUNCTIONS);
const member = new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: principal("member") }).registerAll(PORTABLE_FUNCTIONS);
const m = (name: string, args: Record<string, unknown>) => owner.runMutation(name, args) as Promise<any>;
const q = (name: string, args: Record<string, unknown>) => owner.runQuery(name, args) as Promise<any>;
const deadlinesOf = (id: string) => (db.dump("deadlines") as any[]).filter((row) => row.agreementId === id);

const leaseInput = {
  societyId: "soc", title: "Hall lease", kind: "lease", status: "active",
  parties: [{ name: "Example Clean Air Society", role: "us" }, { name: "Example Hall Association", role: "counterparty" }],
  ourSignatories: two, effectiveDate: day(-300), endDate: day(60), renewalNoticeDays: 30, valueCents: 2000000,
  deliverables: [{ text: "Move-out inspection", dueDate: day(55) }], reportingObligations: [{ text: "Annual needs presentation", dueDate: day(-10) }],
  signedDocumentId: "doc1", linkedCommitteeId: "c1",
};
await assert.rejects(viewer.runMutation("agreements:create", leaseInput), /Permission agreements:write/, "viewers cannot create");
await assert.rejects(member.runQuery("agreements:list", { societyId: "soc" }), /Permission agreements:read/, "members cannot read the register");
await assert.rejects(m("agreements:create", { ...leaseInput, parties: [{ name: "Us", role: "us" }] }), /counterparty/);
await assert.rejects(m("agreements:create", { ...leaseInput, endDate: day(-400) }), /on or after/);
await assert.rejects(m("agreements:create", { ...leaseInput, valueCents: -5 }), /negative/);
await assert.rejects(m("agreements:create", { ...leaseInput, linkedGrantId: "grantOther" }), /not found/i, "links must be in the same workspace");
const leaseId = String(await m("agreements:create", leaseInput));
let deadlines = deadlinesOf(leaseId);
assert.deepEqual(deadlines.map((row) => row.category).sort(), ["Agreement", "Agreement deliverable", "Agreement renewal", "Agreement reporting"], "create generates linked deadlines");
assert.ok(deadlines.every((row) => row.sourceKey && row.status === "open"));
const list = await viewer.runQuery("agreements:list", { societyId: "soc" }) as any[];
const projected = list.find((row) => row._id === leaseId);
assert.equal(projected.effectiveStatus, "active");
assert.equal(projected.expiringSoon, true);
assert.equal(projected.overdueObligations, 1);
assert.equal(projected.signing.status, "warning", "the board tier needs an authorizing motion");
await m("agreements:update", { id: leaseId, patch: { approvedAtMeetingId: "mt1", approvalMotionId: "mo1" } });
let detail = await q("agreements:get", { id: leaseId });
assert.equal(detail.agreement.signing.status, "ok", "linking the authorizing motion satisfies the tier");
assert.equal(detail.links.motion.label, "That the society enter the hall lease.");
assert.equal(detail.links.committee.label, "Operations Committee");
assert.equal(detail.documents[0].role, "signed");
await assert.rejects(q("agreements:get", { id: "missing" }), /Record not found/, "a missing id is rejected by the gate; DETAIL_RECORD_QUERIES maps it to the not-found page");
// Editing the end date moves the generated deadlines; marking a report submitted completes its deadline.
await m("agreements:update", { id: leaseId, patch: { endDate: day(70) } });
assert.equal(deadlinesOf(leaseId).find((row) => row.category === "Agreement")?.dueDate, day(70));
const reportId = (await q("agreements:get", { id: leaseId })).agreement.reportingObligations[0].id;
await m("agreements:setObligationStatus", { id: leaseId, list: "reportingObligations", rowKey: reportId, status: "submitted" });
assert.equal(deadlinesOf(leaseId).find((row) => row.category === "Agreement reporting")?.status, "complete", "a submitted report completes its deadline");
await assert.rejects(m("agreements:update", { id: leaseId, patch: { parties: [{ name: "Us", role: "us" }] } }), /counterparty/, "editing parties keeps a counterparty");
// Summary, continuity and search.
const summary = await q("agreements:summary", { societyId: "soc" });
assert.equal(summary.expiring.length, 1);
assert.equal(summary.expiring[0].renewalDecided, false);
const continuity = await q("continuity:gaps", { societyId: "soc" });
assert.ok(continuity.agreementGaps.some((gap: any) => gap.agreementId === leaseId && gap.kind === "agreement_renewal"), "an expiring agreement without a decision is a record gap");
const checks = await q("continuity:dashboardChecks", { societyId: "soc" });
assert.ok(checks.checks.some((check: any) => check.id === "CONTINUITY-AGREEMENT-OBLIGATIONS"));
const search = await q("firm:search", { societyId: "soc", query: "hall association" });
assert.ok((search.results ?? search).some((hit: any) => hit.kind === "agreement" && hit.to === `/app/agreements/${leaseId}`), "global search finds agreements by counterparty");
// Renewal decision removes the notice deadline; renewal creates a linked draft.
await m("agreements:setRenewalDecision", { id: leaseId, decision: "renew", notes: "Board agreed to renew" });
assert.ok(!deadlinesOf(leaseId).some((row) => row.category === "Agreement renewal" && row.status === "open"), "the renewal notice deadline goes once decided");
const renewalId = String(await m("agreements:renew", { id: leaseId, mode: "renew", endDate: day(435) }));
const renewal = (await q("agreements:get", { id: renewalId }));
assert.equal(renewal.agreement.status, "draft", "a renewal starts as a draft");
assert.equal(renewal.agreement.renewalOfId, leaseId);
assert.equal(renewal.agreement.effectiveDate, day(70), "the renewal starts when the current term ends");
assert.deepEqual(renewal.versions.map((version: any) => version.relation), ["renewed by the next", "this version"]);
assert.equal((await q("agreements:get", { id: leaseId })).versions.at(-1).relation, "renewal");
await assert.rejects(m("agreements:renew", { id: leaseId, mode: "renew" }), /already exists/);
// Supersede the renewal: it becomes superseded and its open deadlines go.
const replacementId = String(await m("agreements:renew", { id: renewalId, mode: "supersede", title: "Hall lease (amended)", effectiveDate: day(70), endDate: day(800) }));
assert.equal((await q("agreements:get", { id: renewalId })).agreement.effectiveStatus, "superseded");
assert.ok(!deadlinesOf(renewalId).some((row) => row.status === "open"), "a superseded agreement keeps no open deadlines");
// Terminate requires a date and a reason.
await assert.rejects(m("agreements:terminate", { id: replacementId, terminatedAtISO: today, reason: " " }), /reason/);
await m("agreements:terminate", { id: replacementId, terminatedAtISO: today, reason: "Ended by mutual agreement" });
assert.equal((await q("agreements:get", { id: replacementId })).agreement.effectiveStatus, "terminated");
assert.ok(!deadlinesOf(replacementId).some((row) => row.status === "open"));
// Delete clears the links of the chain.
await m("agreements:remove", { id: replacementId });
assert.equal(db.dump("agreements").some((row: any) => row._id === replacementId), false);
assert.equal((db.dump("agreements") as any[]).find((row) => row._id === renewalId).supersededById, undefined, "the predecessor becomes current again");

/* ------------------------------- import bundle ------------------------------- */

const bundle = {
  sources: [{ externalSystem: "google-drive", externalId: "google-drive:lease3", title: "Storage lease.pdf" }],
  agreements: [{
    title: "Storage unit lease", kind: "Lease", status: "signed", counterparty: "Example Storage Ltd", effectiveDate: "2025-01-01", endDate: day(200),
    valueCents: 240000, ourSignatories: ["Alex Example"], reportingObligations: ["Annual inventory statement"], grantTitle: "Air Quality Fund",
    committeeName: "Operations Committee", approvedAtMeetingDate: "2025-03-11", approvedAtMeetingBody: "board", approvalMotionText: "That the society enter the hall lease",
    renewalOfExternalId: "google-drive:none", sourceExternalIds: ["google-drive:lease3"], confidence: "High",
  }],
};
assert.deepEqual(importBundlePreflightIssues(bundle), []);
async function stageAndApply(input: any) {
  const sessionId = await m("importSessions:createFromBundle", { societyId: "soc", name: "Agreements import", bundle: input });
  const session = await q("importSessions:get", { sessionId });
  for (const row of session.records) await m("importSessions:updateRecord", { recordId: row._id, status: "Approved", reviewNotes: "Synthetic fixture reviewed." });
  await m("importSessions:applyApprovedDocuments", { sessionId });
  return m("importSessions:applyApprovedSectionRecords", { sessionId });
}
const applied = await stageAndApply(bundle);
assert.equal(applied.byKind?.agreement, 1, `agreement applied: ${JSON.stringify(applied)}`);
let imported = (db.dump("agreements") as any[]).find((row) => row.title === "Storage unit lease");
assert.equal(imported.kind, "lease");
assert.equal(imported.status, "active", "the source said signed");
assert.deepEqual(imported.parties, [{ name: "Example Storage Ltd", role: "counterparty" }]);
assert.equal(imported.linkedGrantId, "grant1");
assert.equal(imported.linkedCommitteeId, "c1");
assert.equal(imported.approvedAtMeetingId, "mt1");
assert.equal(imported.approvalMotionId, "mo1");
assert.equal(imported.reviewStatus, "NeedsReview");
assert.ok(deadlinesOf(imported._id).some((row) => row.category === "Agreement"), "imported agreements generate their deadlines");
await stageAndApply({ ...bundle, agreements: [{ ...bundle.agreements[0], title: "Storage unit lease (reviewed)" }] });
assert.equal((db.dump("agreements") as any[]).filter((row) => (row.sourceExternalIds ?? []).includes("google-drive:lease3")).length, 1, "the same source updates its agreement instead of duplicating it");
imported = (db.dump("agreements") as any[]).find((row) => (row.sourceExternalIds ?? []).includes("google-drive:lease3"));
assert.equal(imported.title, "Storage unit lease (reviewed)", "an unreviewed draft takes the re-imported values");

/* -------------------------------- conversion -------------------------------- */

const preview = await q("agreements:conversionPreview", { societyId: "soc" });
assert.deepEqual([preview.gaps, preview.extractions, preview.total], [2, 2, 4], `preview ${JSON.stringify(preview)}`);
await assert.rejects(viewer.runMutation("agreements:convertGaps", { societyId: "soc" }), /Permission agreements:write/);
const dry = await m("agreements:convertGaps", { societyId: "soc", dryRun: true });
assert.equal(dry.wouldConvert, 4);
assert.equal((db.dump("representationGaps") as any[]).filter((row) => row.status === "resolved_native").length, 0, "a dry run changes nothing");
const converted = await m("agreements:convertGaps", { societyId: "soc" });
assert.equal(converted.created, 4);
assert.equal(converted.resolvedGaps, 2);
const drafts = (db.dump("agreements") as any[]).filter((row) => /Converted/.test(String(row.importedFrom)));
assert.ok(drafts.every((row) => row.reviewStatus === "NeedsReview" && row.status !== "active"), "converted agreements are drafts for review, never active");
const fromGap = drafts.find((row) => (row.representationGapIds ?? []).includes("gap1"));
assert.equal(fromGap.title, "2014 Office Lease");
assert.equal(fromGap.kind, "lease");
assert.match(fromGap.notes, /2014-05/);
const fromExtraction = drafts.find((row) => row.intakeExtractionId === "ex1");
assert.deepEqual(fromExtraction.representationGapIds, ["gap2"], "the extraction's gap is resolved by its agreement");
assert.equal(fromExtraction.valueCents, 1200000);
assert.equal(fromExtraction.intakeRunId, "run1");
const funding = drafts.find((row) => row.intakeExtractionId === "ex2");
assert.equal(funding.linkedGrantId, "grant1", "a funding agreement links the grant built from the same source");
assert.equal(funding.kind, "funding");
const gapRows = db.dump("representationGaps") as any[];
assert.equal(gapRows.find((row) => row._id === "gap1").status, "resolved_native");
assert.equal(gapRows.find((row) => row._id === "gap1").resolvedTable, "agreements");
assert.equal(gapRows.find((row) => row._id === "gap3").status, "open", "other gaps are untouched");
const provenance = (db.dump("fieldProvenance") as any[]).filter((row) => row.targetId === String(fromExtraction._id));
assert.ok(provenance.some((row) => row.fieldPath === "valueCents" && row.locator.quote === "$12,000" && row.decision === "unreviewed"), "converted values carry View source provenance");
const viewSource = await q("intake:provenanceForRecords", { societyId: "soc", targets: [{ targetTable: "agreements", targetId: String(fromExtraction._id) }] });
assert.ok(viewSource.length > 0, "View source finds the converted agreement's provenance");
const again = await m("agreements:convertGaps", { societyId: "soc" });
assert.equal(again.created, 0, "conversion is idempotent");
// Deleting a converted agreement reopens its gap.
await m("agreements:remove", { id: fromGap._id });
assert.equal((db.dump("representationGaps") as any[]).find((row) => row._id === "gap1").status, "open");
const linked = await q("agreements:forRecord", { societyId: "soc", table: "grants", recordId: "grant1" });
assert.ok(linked.length >= 2, "grant ↔ agreement links are listed on the grant");

console.log(`PASS agreements register: validation, status derivation, renewal and obligation dates, signing tiers, continuity gaps, intake mapping and staging, permissions, portable lifecycle (create/update/renew/supersede/terminate/remove with ${db.dump("deadlines").length} generated deadlines), import bundle key, and gap conversion (${converted.created} drafts, ${converted.resolvedGaps} gaps resolved).`);
