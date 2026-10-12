import assert from "node:assert/strict";
import {
  CANDIDATE_REVIEW_REMINDERS,
  TRANSPARENCY_NOTICE_DAYS,
  TRANSPARENCY_UPDATE_DAYS,
  candidateFactsFromRegister,
  candidateSignificantIndividuals,
  deriveTransparencyDeadlines,
  displayDateOfBirth,
  openTransparencyReview,
  transparencyDisposalWindow,
  transparencyEventDeadlines,
  transparencyParticularNotes,
  transparencyParticularProblems,
} from "../shared/significantIndividuals";
import { computeVotingPower } from "../shared/votingPower";
import { looksLikeOrganization } from "../shared/nlg";
import { deriveComplianceDeadlines, type ComplianceSettings } from "../shared/corporationSettings";
import { CORPORATE_LEGAL_SOURCES } from "../shared/corporateLegalSources";
import * as stepFns from "../shared/functions/significantIndividualSteps";
import { MemoryDb, PortableRuntime, definePortableMutation, definePortableQuery, makeCapabilities } from "../shared/portable/index";
import { portableTestPrincipal, portableTestSeed } from "./portable-test-fixture";

/**
 * BC transparency register (Business Corporations Act Part 4.1, ss. 119.1 to
 * 119.91, verified against the consolidation current to October 6, 2026):
 * candidate significant individuals from the share register, structured
 * particulars, restricted date-of-birth display, and the review / update /
 * notice / disposal deadlines (BC companies only). Synthetic fixtures only.
 */

// --- verified periods ----------------------------------------------------------
assert.equal(TRANSPARENCY_UPDATE_DAYS, 30, "s. 119.31 (1): 30 days after becoming aware (not 15; 15 days is the CBCA ISC rule)");
assert.equal(TRANSPARENCY_NOTICE_DAYS, 10, "s. 119.41: 10 days after the register entry");
const transparencySource = CORPORATE_LEGAL_SOURCES.find((row) => row.id === "BC-BCA-TRANSPARENCY")!;
assert.match(transparencySource.summary, /30 days/);
assert.match(transparencySource.summary, /ten days/);
assert.match(transparencySource.summary, /recognition anniversary/);
assert.match(CORPORATE_LEGAL_SOURCES.find((row) => row.id === "CBCA-ISC")!.summary, /15 days/, "the federal ISC 15-day rule is separate");

// --- candidates: 25% of ALL issued shares (incl. non-voting) or 25% of votes ---
// Class A voting (1 vote/share), classes B and C non-voting.
const classes = [
  { rightsClassId: "A", votesPerShare: 1 },
  { rightsClassId: "B", votesPerShare: 0 },
  { rightsClassId: "C", votesPerShare: 0 },
];
const holdings = [
  { holderKey: "roleHolder:pat", holderName: "Pat Doe", rightsClassId: "A", quantity: 50 },
  { holderKey: "roleHolder:sam", holderName: "Sam Doe", rightsClassId: "A", quantity: 50 },
  { holderKey: "name:Kid Doe", holderName: "Kid Doe", rightsClassId: "B", quantity: 100 },
  { holderKey: "name:Maple Family Trust Inc.", holderName: "Maple Family Trust Inc.", rightsClassId: "C", quantity: 150 },
  { holderKey: "name:Lee Small", holderName: "Lee Small", rightsClassId: "C", quantity: 50 },
];
const voting = computeVotingPower(holdings, classes);
const roleHolders = [
  { _id: "pat", roleType: "shareholder", fullName: "Pat Doe" },
  { _id: "sam", roleType: "shareholder", fullName: "Sam Doe", nonNaturalPerson: false },
  { _id: "ctl", roleType: "controller", fullName: "Pat Doe", status: "current" },
];
const facts = candidateFactsFromRegister(voting.holders, roleHolders, looksLikeOrganization);
const candidates = candidateSignificantIndividuals(voting.holders, facts);
const byName = Object.fromEntries(candidates.map((c) => [c.holderName, c]));
// Issued: 400 shares. Votes: 100.
assert.ok(!byName["Pat Doe"].bases.includes("issued_shares_25"), "50 of 400 shares is 12.5%");
assert.deepEqual(byName["Pat Doe"].bases, ["votes_25"], "50% of the votes");
assert.equal(byName["Pat Doe"].recorded, true, "already on the register as a controller");
assert.deepEqual(byName["Kid Doe"].bases, ["issued_shares_25"], "a non-voting holder with exactly 25% of issued shares is a candidate");
assert.equal(byName["Kid Doe"].action, "review");
assert.equal(byName["Maple Family Trust Inc."].action, "look_through", "a corporate holder is a look-through prompt");
assert.match(byName["Maple Family Trust Inc."].prompt, /identify the individuals who own or control it/);
assert.equal(byName["Lee Small"], undefined, "12.5% of shares and no votes is not a candidate");
for (const candidate of candidates) {
  assert.match(candidate.prompt, /Review whether|identify the individuals|Confirm the recorded/, "each candidate is a prompt to review");
  assert.ok(!/\b(is|are) (a )?significant individuals?\./.test(candidate.prompt), "candidates never state a determination");
}
assert.match(CANDIDATE_REVIEW_REMINDERS[0], /not a finding/);
assert.ok(CANDIDATE_REVIEW_REMINDERS.some((line) => /majority of the directors/.test(line)), "director-control test is a reminder");
// Exactly at the threshold with awkward totals: 1 of 4 is 25%.
assert.equal(candidateSignificantIndividuals([{ holderKey: "x", holderName: "X", totalShares: 1, totalVotes: 0 }, { holderKey: "y", holderName: "Y", totalShares: 3, totalVotes: 0 }]).length, 2);
assert.equal(candidateSignificantIndividuals([]).length, 0);

// --- structured particulars and restricted date of birth ---------------------------
assert.deepEqual(transparencyParticularProblems({ canadianStatus: "citizen", significanceBases: ["shares_registered", "directors_right"] }), []);
assert.equal(transparencyParticularProblems({ canadianStatus: "dual" }).length, 1);
assert.equal(transparencyParticularProblems({ significanceBases: ["vibes"] }).length, 1);
assert.match(transparencyParticularNotes({ canadianStatus: "neither", citizenshipCountries: [] })[0], /every country/);
assert.deepEqual(transparencyParticularNotes({ canadianStatus: "neither", citizenshipCountries: ["Ireland"] }), []);
assert.equal(displayDateOfBirth("1980-02-03", false), "Restricted");
assert.equal(displayDateOfBirth("1980-02-03", true), "1980-02-03");
assert.equal(displayDateOfBirth(undefined, true), "");

// --- deadlines: annual review window (s. 119.3) ----------------------------------------
const review = openTransparencyReview("2016-05-10", [], "2026-10-12")!;
assert.equal(review.opensOn, "2027-05-10", "the 2026 window (May 10 to July 10) has passed; the next one is open");
assert.equal(review.dueDate, "2027-07-10");
assert.equal(review.status, "upcoming");
const inWindow = openTransparencyReview("2016-05-10", [], "2026-06-01")!;
assert.equal(inWindow.dueDate, "2026-07-10");
assert.equal(openTransparencyReview("2016-05-10", ["2026-05-20"], "2026-06-01")!.cycleYear, 2027, "a review inside the window satisfies that cycle");
assert.equal(openTransparencyReview("2016-05-10", ["2026-04-20"], "2026-06-01")!.cycleYear, 2026, "a review before the window does not count");
assert.equal(openTransparencyReview("2016-05-10", [], "2026-07-14")!.status, "overdue", "just after the window the open cycle is overdue");
assert.equal(openTransparencyReview("2026-03-01", [], "2026-10-12")!.opensOn, "2027-03-01", "the first review follows the first anniversary");
assert.equal(openTransparencyReview("2024-02-29", [], "2025-01-15")!.opensOn, "2025-02-28", "a Feb 29 recognition date uses Feb 28 in common years");
assert.equal(openTransparencyReview(undefined, [], "2026-10-12"), null);

// --- deadlines from recorded changes ----------------------------------------------------------
const events = [
  { id: "e1", individualName: "Pat Doe", stepKind: "change", awareOn: "2026-10-01" },
  { id: "e2", individualName: "Kid Doe", stepKind: "became_significant", awareOn: "2026-09-01", recordedOn: "2026-09-20" },
  { id: "e3", individualName: "Sam Doe", stepKind: "ceased_significant", awareOn: "2021-01-01", recordedOn: "2021-01-05", notifiedOn: "2021-01-10" },
  { id: "e4", individualName: "Done Doe", stepKind: "became_significant", awareOn: "2026-09-01", recordedOn: "2026-09-02", notifiedOn: "2026-09-05" },
];
const eventDeadlines = transparencyEventDeadlines(events, "2026-10-12");
const keyed = Object.fromEntries(eventDeadlines.map((d) => [d.key, d]));
assert.equal(keyed["transparency-update:e1"].dueDate, "2026-10-31", "30 days after awareness (s. 119.31 (1))");
assert.equal(keyed["transparency-update:e1"].status, "upcoming");
assert.equal(keyed["transparency-notice:e2"].dueDate, "2026-09-30", "10 days after the entry (s. 119.41)");
assert.equal(keyed["transparency-notice:e2"].status, "overdue");
assert.equal(keyed["transparency-disposal:e3"], undefined, "the disposal window opens only on the sixth anniversary (2027-01-05)");
const disposal = transparencyEventDeadlines(events, "2027-02-01").find((d) => d.key === "transparency-disposal:e3")!;
assert.equal(disposal.opensOn, "2027-01-05");
assert.equal(disposal.dueDate, "2028-01-05", "within one year after the sixth anniversary (s. 119.4)");
assert.equal(disposal.status, "upcoming");
assert.deepEqual(transparencyDisposalWindow("2019-01-05"), { opensOn: "2025-01-05", dueBy: "2026-01-05" });
assert.ok(!eventDeadlines.some((d) => d.key.endsWith(":e4")), "a fully recorded and notified entry has no open deadline");
assert.equal(deriveTransparencyDeadlines({ recognitionDate: "2016-05-10", events }, "2026-10-12")[0].key, "transparency-review");

// --- BC companies only in deriveComplianceDeadlines -----------------------------------------
const bc: ComplianceSettings = { entityType: "corporation__business_", jurisdictionCode: "CA-BC", incorporationDate: "2016-05-10", transparencyEvents: events };
const keys = (s: ComplianceSettings) => deriveComplianceDeadlines(s, "2026-10-12").map((d) => d.key).filter((key) => key.startsWith("transparency"));
assert.deepEqual(keys(bc).sort(), ["transparency-notice:e2", "transparency-review", "transparency-update:e1"]);
const bcReview = deriveComplianceDeadlines(bc, "2026-10-12").find((d) => d.key === "transparency-review")!;
assert.deepEqual(bcReview.sourceIds, ["BC-BCA-TRANSPARENCY"]);
assert.equal(bcReview.category, "transparency");
assert.deepEqual(keys({ ...bc, jurisdictionCode: "CA-FED-CBCA" }), [], "no BC Part 4.1 deadlines for a federal corporation");
assert.deepEqual(keys({ ...bc, jurisdictionCode: "CA-ON-OBCA" }), [], "none for an Ontario corporation");
assert.deepEqual(keys({ ...bc, entityType: "society" }), [], "none for a BC society");
assert.equal(deriveComplianceDeadlines({ ...bc, recognitionDate: "2018-01-15" }, "2026-10-12").find((d) => d.key === "transparency-review")!.dueDate, "2027-03-15", "a continuation/amalgamation recognition date anchors the review");

// --- portable steps: clock fields, date updates, BC-only deadline query ------------------------
const societyId = "transparency-fixture";
const membership = portableTestSeed(societyId);
function rt(society: Record<string, unknown>) {
  const db = new MemoryDb({ seed: { ...membership, societies: [{ ...membership.societies[0], ...society }] } });
  return {
    db,
    runtime: new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: portableTestPrincipal })
      .register(definePortableMutation({ name: "steps:create", handler: stepFns.createPortable }))
      .register(definePortableMutation({ name: "steps:updateDates", handler: stepFns.updateDatesPortable }))
      .register(definePortableQuery({ name: "steps:deadlines", handler: stepFns.transparencyDeadlinesPortable })),
  };
}
const { runtime, db } = rt({ entityType: "corporation__business_", jurisdictionCode: "CA-BC", actFormedUnder: "business_corporations_act", incorporationDate: "2016-05-10" });
const stepId = await runtime.runMutation("steps:create", { societyId, individualName: "Kid Doe", stepKind: "became_significant", stepsNarrative: "Share register reviewed; holder confirmed by letter.", stepDate: "2026-09-20", awareOn: "2026-09-01", recordedOn: "2026-09-20", nowISO: "2026-09-20T00:00:00Z" }) as string;
await assert.rejects(runtime.runMutation("steps:create", { societyId, individualName: "X", stepKind: "change", stepsNarrative: "n", stepDate: "2026-09-20", awareOn: "2026-09-10", recordedOn: "2026-09-01", nowISO: "x" }), /cannot be before/);
await assert.rejects(runtime.runMutation("steps:create", { societyId, individualName: "X", stepKind: "change", stepsNarrative: "n", stepDate: "2026-09-20", notifiedOn: "2026-09-21", nowISO: "x" }), /notice date applies only/);
let deadlines = await runtime.runQuery("steps:deadlines", { societyId, asOf: "2026-10-12" }) as any[];
assert.ok(deadlines.some((d) => d.key === `transparency-notice:${stepId}`));
await runtime.runMutation("steps:updateDates", { id: stepId, notifiedOn: "2026-09-25" });
assert.equal((await db.get(stepId) as any).notifiedOn, "2026-09-25");
deadlines = await runtime.runQuery("steps:deadlines", { societyId, asOf: "2026-10-12" }) as any[];
assert.ok(!deadlines.some((d) => d.key === `transparency-notice:${stepId}`), "recording the notice closes the deadline");
const federal = rt({ entityType: "corporation__business_", jurisdictionCode: "CA-FED-CBCA", incorporationDate: "2016-05-10" });
assert.deepEqual(await federal.runtime.runQuery("steps:deadlines", { societyId, asOf: "2026-10-12" }), [], "the BC deadlines query returns nothing for a federal corporation");

console.log("OK transparency-register");
