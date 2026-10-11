/**
 * Gate: governance form validation, legacy option normalization, delete
 * cascades and corporate-history row ids (ui-governance G-07, G-10, G-14,
 * G-16, G-18, G-19, G-20, G-27, G-29). Uses the real portable handlers on the
 * in-memory runtime where a handler is involved.
 */
import assert from "node:assert/strict";
import { MemoryDb, PortableRuntime, definePortableMutation, definePortableQuery, makeCapabilities } from "../shared/portable/index";
import { directorCreate, directorUpdate } from "../shared/functions/directors";
import { memberCreate } from "../shared/functions/members";
import { createPortable as commitmentCreate, removePortable as commitmentRemove, commitmentProblems } from "../shared/functions/commitments";
import { createReviewTaskPortable, createTransparencyDraftPortable, removePortable as policyRemove, upsertPortable as policyUpsert } from "../shared/functions/policies";
import { listPortable as nameList, upsertPortable as nameUpsert } from "../shared/functions/nameHistory";
import { createPortable as constatingCreate, listPortable as constatingList, updatePortable as constatingUpdate } from "../shared/functions/constating";
import { createPortable as siCreate } from "../shared/functions/significantIndividualSteps";
import { upsertPublicationPortable } from "../shared/functions/transparency";
import { directorProblems, directorTermLapsed, memberProblems } from "../shared/registerValidation";
import { normalizeOptionValue, officerTitleLabel, isAllowedOption } from "../shared/orgHubOptions";
import { annualFilingYear } from "../shared/annualFilings";
import { isValidFiscalYearEnd, validateEntitySetup } from "../shared/entitySetup";
import { validateElectionQuestion } from "../shared/electionValidation";
import { deriveComplianceDeadlines } from "../shared/corporationSettings";
import { officerAppointmentView } from "../shared/packetOperativeData";
import { portableTestPrincipal, portableTestSeed } from "./portable-test-fixture";

// --- G-07 register validation -------------------------------------------------
assert.deepEqual(directorProblems({ firstName: "", lastName: "" }), ["Enter the director's name."]);
assert.ok(directorProblems({ firstName: "Ada", lastName: "Lovelace", email: "not-an-email" }).some((p) => /valid email/.test(p)));
assert.ok(directorProblems({ firstName: "Ada", termStart: "2026-10-06", termEnd: "2026-10-01" }).some((p) => /before term start/.test(p)));
assert.deepEqual(directorProblems({ firstName: "Ada", lastName: "L", position: "Director", termStart: "2025-06-19", termEnd: "2027-06-19" }), []);
assert.equal(directorTermLapsed({ status: "Active", termEnd: "2026-10-01" }, "2026-10-06"), true);
assert.equal(directorTermLapsed({ status: "Resigned", termEnd: "2026-10-01" }, "2026-10-06"), false);
assert.deepEqual(memberProblems({ firstName: " ", lastName: "" }), ["Enter the member's name."]);
assert.ok(memberProblems({ firstName: "B", joinedAt: "2026-02-30" }).some((p) => /Joined date/.test(p)));
assert.ok(memberProblems({ firstName: "B", joinedAt: "2026-02-01", leftAt: "2026-01-01" }).some((p) => /Left date/.test(p)));

// --- G-10 legacy officer titles -----------------------------------------------
assert.equal(normalizeOptionValue("officerTitles", "President"), "president");
assert.equal(normalizeOptionValue("officerTitles", "Vice President"), "vice_president");
assert.equal(normalizeOptionValue("officerTitles", "Vice-President"), "vice_president");
assert.equal(normalizeOptionValue("officerTitles", "Privacy Officer"), "privacy_officer");
assert.equal(isAllowedOption("officerTitles", "privacy_officer"), true);
assert.equal(normalizeOptionValue("officerTitles", "Grand Poobah"), "Grand Poobah", "unknown labels stay as-is so validation still rejects them");
assert.equal(normalizeOptionValue("officerTitles", ""), undefined);
assert.equal(officerTitleLabel("vice_president"), "Vice-President");
assert.equal(officerTitleLabel("President"), "President");
assert.deepEqual(officerAppointmentView([{ roleType: "officer", fullName: "Jane Doe", officerTitle: "treasurer" }]).appointment.officers, [{ name: "Jane Doe", title: "Treasurer" }]);

// --- G-20 fiscal year end -----------------------------------------------------
assert.equal(isValidFiscalYearEnd("03-31"), true);
assert.equal(isValidFiscalYearEnd("02-29"), true);
assert.equal(isValidFiscalYearEnd("13-45"), false);
assert.equal(isValidFiscalYearEnd("04-31"), false);
assert.throws(() => validateEntitySetup({ fiscalYearEnd: "13-45" }), /Fiscal year end/);

// --- G-27 annual filing period years ------------------------------------------
assert.equal(annualFilingYear("2025"), "2025");
assert.equal(annualFilingYear("2025 AGM"), "2025");
assert.equal(annualFilingYear("FY2025-2026"), "2026");
assert.equal(annualFilingYear("2025-26"), "2026");
assert.equal(annualFilingYear("FY2025"), "2025");
assert.equal(annualFilingYear("2024 and 2025"), null, "ambiguous labels are not linked");
assert.equal(annualFilingYear("Annual report"), null);

// --- G-16 ballot questions ----------------------------------------------------
const option = (id: string, label: string) => ({ id, label });
assert.throws(() => validateElectionQuestion({ title: "Q", maxSelections: 1, options: [option("a", "Yes"), option("b", "yes ")] }), /listed twice/);
assert.throws(() => validateElectionQuestion({ title: "Q", maxSelections: 1, options: [option("a", "Yes")] }), /at least two/);
validateElectionQuestion({ title: "Q", maxSelections: 1, options: [option("a", "For"), option("b", "Against")] });

// --- G-18 commitment values ---------------------------------------------------
assert.ok(commitmentProblems({ title: "T", confidence: 2.5 }, true).some((p) => /Confidence/.test(p)));
assert.ok(commitmentProblems({ title: "T", noticeLeadDays: -5 }, true).some((p) => /Lead time/.test(p)));
assert.deepEqual(commitmentProblems({ title: "T", confidence: 0.8, noticeLeadDays: 14 }, true), []);

// --- Next annual report follows the next AGM -----------------------------------
const derived = deriveComplianceDeadlines({ agmMonth: 6, agmDay: 19, jurisdictionCode: "CA-BC", entityType: "society", annualMeetingDate: "2025-06-19", heldAgmYears: [2025] }, "2026-10-06");
assert.equal(derived.find((d) => d.key === "annual-report")?.dueDate, "2027-01-30", "30 days after the Dec 31, 2026 AGM deadline, not the past Jul 19, 2025");

// --- Runtime: handlers enforce the rules and cascades ---------------------------
const societyId = "soc_governance_forms";
const seed = {
  ...portableTestSeed(societyId),
  societies: [{ _id: societyId, name: "Synthetic Forms Society", entityType: "society", jurisdictionCode: "CA-BC" }],
  directors: [{ _id: "dir_1", societyId, firstName: "Ada", lastName: "Lovelace", position: "Director", isBCResident: true, termStart: "2025-06-19", consentOnFile: true, status: "Active" }],
};
let counter = 0;
const db = new MemoryDb({ seed, mintId: () => `row_${++counter}` });
const runtime = new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: portableTestPrincipal }).registerAll([
  definePortableMutation({ name: "directors:create", applicationPolicy: true, handler: directorCreate }),
  definePortableMutation({ name: "directors:update", applicationPolicy: true, handler: directorUpdate }),
  definePortableMutation({ name: "members:create", applicationPolicy: true, handler: memberCreate }),
  definePortableMutation({ name: "commitments:create", applicationPolicy: true, handler: commitmentCreate }),
  definePortableMutation({ name: "commitments:remove", applicationPolicy: true, handler: commitmentRemove }),
  definePortableMutation({ name: "policies:upsert", applicationPolicy: true, handler: policyUpsert }),
  definePortableMutation({ name: "policies:remove", applicationPolicy: true, handler: policyRemove }),
  definePortableMutation({ name: "policies:createReviewTask", applicationPolicy: true, handler: createReviewTaskPortable }),
  definePortableMutation({ name: "policies:createTransparencyDraft", applicationPolicy: true, handler: createTransparencyDraftPortable }),
  definePortableMutation({ name: "nameHistory:upsert", applicationPolicy: true, handler: nameUpsert }),
  definePortableQuery({ name: "nameHistory:list", applicationPolicy: true, handler: nameList }),
  definePortableMutation({ name: "constating:create", applicationPolicy: true, handler: constatingCreate }),
  definePortableMutation({ name: "constating:update", applicationPolicy: true, handler: constatingUpdate }),
  definePortableQuery({ name: "constating:list", applicationPolicy: true, handler: constatingList }),
  definePortableMutation({ name: "significantIndividualSteps:create", applicationPolicy: true, handler: siCreate }),
  definePortableMutation({ name: "transparency:upsertPublication", applicationPolicy: true, handler: upsertPublicationPortable }),
]);
const directorArgs = { societyId, firstName: "", lastName: "", position: "Director", isBCResident: true, termStart: "2026-10-06", consentOnFile: false, status: "Active" };
await assert.rejects(() => runtime.runMutation("directors:create", directorArgs), /Director not saved: Enter the director's name/);
await assert.rejects(() => runtime.runMutation("directors:update", { id: "dir_1", patch: { email: "not-an-email" } }), /valid email/);
await assert.rejects(() => runtime.runMutation("members:create", { societyId, firstName: "", lastName: "", membershipClass: "Regular", status: "Active", joinedAt: "2026-10-06", votingRights: true }), /Member not saved/);
assert.equal((await db.query("members").collect()).length, 0, "no blank member row was written");

await assert.rejects(() => runtime.runMutation("commitments:create", { societyId, title: "Lease report", category: "Lease", requirement: "Report", cadence: "Annual", status: "Active", confidence: 2.5 }), /Confidence/);
const commitmentId = await runtime.runMutation("commitments:create", { societyId, title: "Lease report", category: "Lease", requirement: "Report", cadence: "Annual", status: "Active", confidence: 0.9, noticeLeadDays: 14 }) as string;
await db.insert("tasks", { societyId, title: "Prepare Lease report", status: "Todo", commitmentId, eventId: `commitment:${commitmentId}`, createdAtISO: "2026-10-06T00:00:00Z" });
await db.insert("tasks", { societyId, title: "Done prep", status: "Done", commitmentId, createdAtISO: "2026-10-06T00:00:00Z" });
await runtime.runMutation("commitments:remove", { id: commitmentId });
const remainingTasks = await db.query("tasks").collect();
assert.deepEqual(remainingTasks.map((task: any) => task.title), ["Done prep"], "open preparation tasks are removed, completed ones kept");

await assert.rejects(() => runtime.runMutation("policies:upsert", { societyId, policyName: "  " }), /policy name/);
const policyId = await runtime.runMutation("policies:upsert", { societyId, policyName: "Privacy Policy", status: "Active" }) as string;
await runtime.runMutation("policies:createReviewTask", { policyId });
await runtime.runMutation("policies:createTransparencyDraft", { policyId });
await runtime.runMutation("policies:remove", { id: policyId });
assert.equal((await db.query("publications").collect()).length, 0, "the policy's unpublished transparency draft is removed");
assert.equal((await db.query("tasks").collect()).filter((task: any) => String(task.eventId ?? "").startsWith("policy:")).length, 0, "the policy's open review task is removed");

await assert.rejects(() => runtime.runMutation("transparency:upsertPublication", { societyId, title: " ", category: "Notice", status: "Draft" }), /needs a title/);

await assert.rejects(() => runtime.runMutation("nameHistory:upsert", { societyId, name: " ", startISO: "2026-10-06", nowISO: "2026-10-06T00:00:00Z" }), /corporate name/);
await runtime.runMutation("nameHistory:upsert", { societyId, name: "Synthetic Forms Society", startISO: "2017-05-12", nowISO: "2026-10-06T00:00:00Z" });
const names = await runtime.runQuery("nameHistory:list", { societyId }) as any[];
assert.ok(names[0]._id, "name history rows keep their id so Remove/Edit work (G-14)");
await assert.rejects(() => runtime.runMutation("constating:create", { societyId, action: "incorporated", jurisdiction: "", legislation: "", startISO: "2017-05-12", nowISO: "2026-10-06T00:00:00Z" }), /jurisdiction/);
const eventId = await runtime.runMutation("constating:create", { societyId, action: "incorporated", jurisdiction: "BC", legislation: "Society Act", startISO: "2017-05-12", nowISO: "2026-10-06T00:00:00Z" }) as string;
await runtime.runMutation("constating:update", { id: eventId, action: "transitioned", jurisdiction: "BC", legislation: "Societies Act", startISO: "2018-01-10" });
const events = await runtime.runQuery("constating:list", { societyId }) as any[];
assert.equal(events[0]._id, eventId);
assert.equal(events[0].legislation, "Societies Act");

await assert.rejects(() => runtime.runMutation("significantIndividualSteps:create", { societyId, individualName: "", stepsNarrative: "", stepDate: "", nowISO: "2026-10-06T00:00:00Z" }), /Step not recorded/);

console.log("governance form checks passed");
