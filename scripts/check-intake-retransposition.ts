/** Gate for the fixes found while re-transposing a full real archive (WP-R):
 * motion grammar ("X makes a motion …", trailing "Motion carried." sentences),
 * body detection (meeting rooms are not committees, organization prefixes on
 * committee acronyms, working groups), agenda dates confirmed by the file name,
 * agenda-evidenced meetings (press releases, rescheduled agendas, special
 * meetings), policy copies staged once, insurance broker/additional-insured
 * cleanup, the record-level evidence rule for class records and run-wide bulk
 * accept batches. Synthetic data only. */
import assert from "node:assert/strict";
import { finalizeBlocks, blocksFromPlainText, INTAKE_EXTRACT_VERSION, type IntakeExtract } from "../shared/intake/blocks";
import { bodyFromText, parseMotion } from "../shared/intake/minutes/extractMinutes";
import { bodyKeyFor } from "../shared/intake/entities";
import { extractForClass } from "../shared/intake/extractors";
import { agendaEvidencedMeetings } from "../shared/intake/classStages";
import { classBundleRecords } from "../shared/intake/bundleClasses";
import { extractionEvidenceVerified, markEvidenceVerified } from "../shared/intake/evidenceRule";
import { takeBulkBatch } from "../shared/functions/intakeReview";
import { verifyRecord } from "../shared/intake/verify";
import { clusterFiles, nameDateSignature } from "../shared/intake/cluster";

function textExtract(text: string): IntakeExtract {
  const { blocks, text: joined } = finalizeBlocks(blocksFromPlainText(text));
  return { method: "plain-text", methodVersion: INTAKE_EXTRACT_VERSION, blocks, text: joined, warnings: [] };
}

// ------------------------------------------------------------ motion grammar
const makes = parseMotion("Avery makes a motion to allocate funds for a second sponsorship day, Casey seconded.  Motion accepted.");
assert.ok(makes);
assert.equal(makes.movedBy, "Avery");
assert.equal(makes.secondedBy, "Casey");
assert.equal(makes.text, "allocate funds for a second sponsorship day");
assert.equal(makes.outcome, "carried");
const trailing = parseMotion("MOTION to authorize the treasurer to open a savings account on behalf of the society. Motion Carried Unanimously.");
assert.ok(trailing);
assert.equal(trailing.text, "authorize the treasurer to open a savings account on behalf of the society", "the outcome sentence is not motion wording");
assert.equal(trailing.outcome, "carried");
const carriedForward = parseMotion("MOTION: to approve the motion carried forward from the March meeting (Carried)");
assert.ok(carriedForward?.text.includes("carried forward from the March meeting"), "'carried forward' inside the wording stays");

// ------------------------------------------------------------ bodies
assert.equal(bodyFromText("2nd Floor Committee Meeting Room, 100 Main Street"), undefined, "a meeting room is not a committee");
assert.equal(bodyFromText("LCAS AQMP Committee Meeting")?.label, "AQMP Committee", "an organization acronym before a committee acronym is dropped");
assert.equal(bodyKeyFor("LCAS AQMP Committee Meeting"), bodyKeyFor("AQMP Committee meeting"));
assert.equal(bodyFromText("RWG_Agenda_Sept-21-2012.docx")?.body, "committee", "an acronym working group is a committee, not the board");
assert.equal(bodyFromText("Monitoring Working Group notes")?.label, "Monitoring Working Group");
assert.equal(bodyFromText("Strategic Planning Committee")?.label, "Strategic Planning Committee");
assert.equal(bodyFromText("Board meeting")?.body, "board");

// ------------------------------------------------------------ agenda date confirmed by the file name
const combined = textExtract([
  "Operations Committee Meeting",
  "Date:\tAugust 9, 2025 (12:00-1:00 PM)",
  "Subject:\tMinutes",
  "Location:\tMS TEAMS",
  "Date:\tSeptember 13, 2025 (12:00-1:00 PM)",
  "Subject:\tAgenda",
  "Location:\tMS TEAMS",
  "Agenda Items:",
  "1. Welcome",
  "2. Review and approve August minutes",
  "3. Member updates",
  "October 5, 2025",
].join("\n"));
const agenda = extractForClass("agenda", { fileId: "local:a", fileName: "2025_09_13 Operations Agenda.docx", extract: combined });
assert.ok(agenda);
assert.equal((agenda.record as any).date?.value?.iso, "2025-09-13", "the Date: line matching the file name dates the agenda");

// ------------------------------------------------------------ agenda-evidenced meetings
const meetings = [{ meetingKey: "operations@2025-04-16", bodyKey: "operations", date: "2025-04-16", files: [], canonicalFileId: "local:m" }] as any[];
const agendaExtraction = (fileKey: string, date: string, title: string) => ({ fileKey, docClass: "agenda", record: { date: { value: { iso: date, precision: "day", text: date }, status: "stated", confidence: 0.9, locators: [] }, bodyLabel: { value: "Operations Committee", status: "stated", confidence: 0.9, locators: [] }, title: { value: title, status: "stated", confidence: 0.9, locators: [] } } }) as any;
const files = [
  { fileKey: "local:draft", name: "2025_04_09 Operations Agenda DRAFT.docx" },
  { fileKey: "local:special", name: "2025_04_11 Operations Special Meeting Agenda.docx" },
  { fileKey: "local:release", name: "AGM Media Release.doc" },
  { fileKey: "local:later", name: "2025_05_14 Operations Agenda.docx" },
] as any[];
const evidenced = agendaEvidencedMeetings([
  agendaExtraction("local:draft", "2025-04-09", "Operations Committee Agenda"),
  agendaExtraction("local:special", "2025-04-11", "Operations Committee Special Meeting"),
  { ...agendaExtraction("local:release", "2025-03-01", "Annual General Meeting"), docClass: "agmMaterial" },
  agendaExtraction("local:later", "2025-05-14", "Operations Committee Agenda"),
], files, meetings);
assert.deepEqual(evidenced.map((row) => row.fileId).sort(), ["local:later", "local:special"], "a rescheduled agenda within a week belongs to the held meeting; a special meeting and a later meeting are separate; a press release is not evidence");

// ------------------------------------------------------------ insurance cleanup
const certificate = textExtract([
  "CERTIFICATE OF INSURANCE",
  "Broker",
  "Insurer: Example Mutual Insurance Company",
  "Policy Number: GL-1234",
  "Policy Period: January 1, 2025 to January 1, 2026",
  "Additional Insured",
  "It is hereby understood and agreed that this policy is extended to cover Riverside Seniors Association as an additional insured, but only in respect of liability arising out of the operations of the named insured.",
  "Additional Insured(s) and remain as stated in this certificate",
].join("\n"));
const insurance = extractForClass("insurance", { fileId: "local:i", fileName: "2025 Certificate of Insurance.pdf", extract: certificate, asOfISO: "2026-10-01" });
assert.ok(insurance);
const insured = ((insurance.record as any).additionalInsureds ?? []).map((field: any) => field.value);
assert.deepEqual(insured, ["Riverside Seniors Association"], "only the named additional insured party is kept");
assert.notEqual((insurance.record as any).broker?.value, "Broker", "a heading cell is not a broker");

// ------------------------------------------------------------ evidence rule
const stated = (value: unknown, quote: string) => ({ value, status: "stated", confidence: 0.95, locators: [{ kind: "block", blockIndex: 0, quote }], verification: "verified_span" });
const verifiedPolicy = { docClass: "policy", record: { title: stated("Signing Authority Policy", "Signing Authority Policy"), effectiveDate: stated({ iso: "2024-03-01", precision: "day", text: "March 1, 2024" }, "March 1, 2024") }, verification: { quoted: 2, verified: 2, mismatched: 0 } };
assert.equal(extractionEvidenceVerified(verifiedPolicy), true);
assert.equal(extractionEvidenceVerified({ ...verifiedPolicy, verification: { quoted: 2, mismatched: 1 } }), false, "a failed quote blocks the rule");
assert.equal(extractionEvidenceVerified({ ...verifiedPolicy, record: { ...verifiedPolicy.record, effectiveDate: { ...verifiedPolicy.record.effectiveDate, status: "conflicting" } } }), false, "a conflicting value blocks the rule");
assert.equal(extractionEvidenceVerified({ ...verifiedPolicy, record: { ...verifiedPolicy.record, title: { ...verifiedPolicy.record.title, confidence: 0.6 } } }), false, "a header value below the threshold blocks the rule");
const marked = { policies: [{ policyName: "A", sourceExternalIds: ["local:p1"] }, { policyName: "B", sourceExternalIds: ["local:p1", "local:p2"] }], meetingMinutes: [{ sourceExternalIds: ["local:p1"] }] } as Record<string, any>;
const markedDocs = { ...marked, documentMap: [{ externalId: "local:p1" }, { externalId: "local:p2" }] };
assert.equal(markEvidenceVerified(markedDocs, [{ ...verifiedPolicy, fileKey: "local:p1" }, { ...verifiedPolicy, fileKey: "local:p2", verification: { quoted: 1, mismatched: 1 } }]), 2);
assert.equal(markedDocs.documentMap[0].evidenceVerified, true, "the source document of a verified record is verified with it");
assert.equal(markedDocs.documentMap[1].evidenceVerified, undefined);
assert.equal(marked.policies[0].confidence, "High");
assert.equal(marked.policies[0].evidenceVerified, true);
assert.equal(marked.policies[1].evidenceVerified, undefined, "every source must pass");
assert.equal(marked.meetingMinutes[0].evidenceVerified, true, "meetings staged from agendas or packages follow the same header rule");

// ------------------------------------------------------------ policy copies staged once
const policyText = textExtract("Signing Authority Policy\nEffective Date: March 1, 2024\n1. Purpose\nCheques require two signatures.\n2. Scope\nAll accounts.");
const policyEnvelope = (fileKey: string) => {
  const envelope = extractForClass("policy", { fileId: fileKey, fileName: "Signing Authority Policy.docx", extract: policyText })!;
  return { ...envelope, fileKey, verification: verifyRecord(envelope.record, policyText) };
};
const run = {
  runId: "r", name: "r", sourceKind: "local_folder", sourceRoot: "/", startedAtISO: "2026-10-01T00:00:00.000Z", completedAtISO: "2026-10-01T00:00:00.000Z", engine: { minutes: "deterministic" },
  files: [{ fileKey: "local:board/Signing Authority Policy.docx", name: "Signing Authority Policy.docx", path: "board/Signing Authority Policy.docx", disposition: "extract" }, { fileKey: "local:orientation/Signing Authority Policy.docx", name: "Signing Authority Policy.docx", path: "orientation/Signing Authority Policy.docx", disposition: "extract" }],
  clusters: [], extractions: [policyEnvelope("local:board/Signing Authority Policy.docx"), policyEnvelope("local:orientation/Signing Authority Policy.docx")],
  reconciliation: { meetings: [], links: [], gaps: [], actionChains: [] }, processingLog: [],
} as any;
const staged = classBundleRecords(run, { minutesPayloads: [] });
assert.equal(staged.collections.policies?.length, 1, "two copies of one policy version stage one policy");
assert.equal((staged.collections.policies![0].sourceExternalIds as string[]).length, 2, "the staged policy cites both copies");

// ------------------------------------------------------------ bulk accept batches
const ids = [...Array(3000).fill("e1"), ...Array(2500).fill("e2"), ...Array(10).fill("e3")];
assert.deepEqual([...takeBulkBatch(ids, 5000)], ["e1"], "whole documents only, never past the limit");
assert.deepEqual([...takeBulkBatch(Array(7000).fill("big"), 5000)], ["big"], "one oversized document still forms a batch");
assert.deepEqual([...takeBulkBatch(ids.slice(3000), 5000)], ["e2", "e3"]);

// ------------------------------------------------------------ version families keep their dates
assert.equal(nameDateSignature("Board_Minutes_23-Feb-2016 DRAFT.docx"), nameDateSignature("Board_Minutes_23-Feb-2016 FINAL (2).pdf"));
assert.notEqual(nameDateSignature("2019_04_09 Ops Minutes v2.docx"), nameDateSignature("2019_05_14 Ops Minutes.docx"));
const monthly = clusterFiles([
  { id: "a", name: "2019_04_09 Operations Minutes DRAFT.docx" },
  { id: "b", name: "2019_04_09 Operations Minutes APPROVED.pdf" },
  { id: "c", name: "2019_05_14 Operations Minutes.docx" },
  { id: "d", name: "2019_06_11 Operations Minutes.docx" },
]);
assert.equal(monthly.length, 1, "only the two copies of one meeting form a version family");
assert.deepEqual(monthly[0].members.map((member) => member.fileId).sort(), ["a", "b"]);

console.log("PASS intake re-transposition: motion grammar, bodies, agenda dates, evidenced meetings, insurance cleanup, evidence rule, policy copies, dated version families and bulk-accept batches");
