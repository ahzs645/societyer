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
import { bodyFromText, extractMeetingMinutes, parseMotion } from "../shared/intake/minutes/extractMinutes";
import { bodyKeyFor } from "../shared/intake/entities";
import { extractForClass } from "../shared/intake/extractors";
import { agendaEvidencedMeetings } from "../shared/intake/classStages";
import { classBundleRecords } from "../shared/intake/bundleClasses";
import { extractionEvidenceVerified, markEvidenceVerified } from "../shared/intake/evidenceRule";
import { extractPdf } from "../shared/intake/extract/pdf";
import { buildDocx, buildPdf } from "./lib/intake-synthetic-fixtures";
import { extractDocx } from "../shared/intake/extract/docx";
import { takeBulkBatch } from "../shared/functions/intakeReview";
import { verifyRecord } from "../shared/intake/verify";
import { clusterFiles, nameDateSignature } from "../shared/intake/cluster";
import { guardFutureMinutesDate } from "../shared/intake/pipeline";
import { agmGaps } from "../shared/intake/reconcile";
import { findDates } from "../shared/intake/parse";
import { classRecordGaps } from "../shared/intake/classStages";
import { runPeopleNames } from "../src/features/intake/runPeople";
import { directoryPersonId, loadDirectoryIndex } from "../shared/functions/importSessionHelpers/importMeetingApply";

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
assert.equal(bodyFromText("LCAS ABCD Committee Meeting")?.label, "ABCD Committee", "an organization acronym before a committee acronym is dropped");
assert.equal(bodyKeyFor("LCAS ABCD Committee Meeting"), bodyKeyFor("ABCD Committee meeting"));
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
assert.match(String(marked.meetingMinutes[0].notes), /^Evidence-verified:/m, "meetings staged from agendas or packages follow the same rule (marked in notes, which their normalization keeps)");
assert.equal(marked.meetingMinutes[0].confidence, "High");

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

// ------------------------------------------------------------ impossible dates and AGM years
const typo = { record: { date: { value: { iso: "2032-01-11", precision: "day", text: "January 11, 2032" }, status: "stated", confidence: 0.9, locators: [{ kind: "block", quote: "January 11, 2032" }] } } } as any;
guardFutureMinutesDate(typo, "2023_01_11 Operations Minutes.docx", "2026-10-01");
assert.equal(typo.record.date.value.iso, "2023-01-11", "the file-name date replaces a future minutes date");
assert.equal(typo.record.date.status, "conflicting", "and a person must confirm it");
const past = { record: { date: { value: { iso: "2025-05-13", precision: "day" }, status: "stated", confidence: 0.9, locators: [] } } } as any;
guardFutureMinutesDate(past, "2025_05_13 Board Minutes.docx", "2026-10-01");
assert.equal(past.record.date.status, "stated");
const agm = (date: string) => ({ meetingKey: `agm@${date}`, bodyKey: "agm", date, files: [], canonicalFileId: "x", status: "recorded" as const });
assert.deepEqual(agmGaps([agm("2022-06-01"), agm("2024-06-01")], 2022, 2025).map((gap) => (gap as any).year), [2023, 2025]);

// ------------------------------------------------------------ item numbers and non-minutes citations
assert.equal(findDates("4.2 July 2022 Operations Committee Meeting Minutes").length, 0, "an item number is not a day");
assert.equal(findDates("Minutes of 28 November 2018")[0]?.iso, "2018-11-28");
const citing = (text: string, date: string) => ({ fileKey: `local:${text}`, docClass: "correspondence", record: {}, references: [{ kind: "prior_minutes", text, date }], unsupported: [] }) as any;
const unresolved = classRecordGaps({ extractions: [citing("Your presentation is limited to 10 minutes", "2023-06-28"), citing("Notes:", "2014-07-31"), citing("Minutes of the June 4 board meeting", "2024-06-04")], meetings: [], evidenced: [], policyLinks: [], fiscalChanges: [] }).filter((gap) => gap.kind === "unresolved_reference");
assert.deepEqual(unresolved.map((gap) => gap.date), ["2024-06-04"], "durations and headings are not missing minutes");

// ------------------------------------------------------------ run people → directory
assert.deepEqual(runPeopleNames([{ fullName: "Avery Quill", aliases: ["Avery Quil", "Vice President"] }, { fullName: "Casey", aliases: [] }, { fullName: "City of Example", aliases: [] }, { fullName: "avery quill", aliases: [] }]), ["Avery Quil", "Avery Quill"], "one person per distinct full name as written; role words, organizations and single names are not added");
const directoryRows = [
  { _id: "pd_owned", societyId: "s1", fullName: "Avery Quill" },
  { _id: "pd_local", fullName: "Casey Lark" },
  { _id: "pd_other", societyId: "s2", fullName: "Drew Moss" },
  { _id: "pd_tomb", societyId: "s1", fullName: "Avery Quil", mergedIntoId: "pd_owned" },
];
const fakeCtx = (trusted: boolean) => ({
  principal: trusted ? { kind: "user", assurance: "trusted-workspace", runtime: "local" } : { kind: "user", assurance: "authenticated", runtime: "convex-hosted" },
  db: { query: () => ({ collect: async () => directoryRows, withIndex: (_: string, by: any) => { let society: string | undefined; by({ eq: (_f: string, value: string) => { society = value; return {}; } }); return { collect: async () => directoryRows.filter((row) => row.societyId === society) }; } }) },
});
const localIndex = await loadDirectoryIndex(fakeCtx(true), "s1");
assert.equal(directoryPersonId(localIndex, "Casey Lark"), "pd_local", "a trusted local workspace links its unowned directory people");
assert.equal(directoryPersonId(localIndex, "Drew Moss"), undefined, "never another workspace's person");
assert.equal(directoryPersonId(localIndex, "Avery Quil"), undefined, "merged tombstones are not link targets");
const hostedIndex = await loadDirectoryIndex(fakeCtx(false), "s1");
assert.equal(directoryPersonId(hostedIndex, "Casey Lark"), undefined, "hosted workspaces link only owned people");
assert.equal(directoryPersonId(hostedIndex, "Avery Quill"), "pd_owned");

// ------------------------------------------------------------ decisions: stated lines, never a repeated motion
const minutesText = textExtract([
  "Board Meeting Minutes",
  "Date: May 13, 2025",
  "Present: Avery Quill, Casey Lark, Drew Moss",
  "1. Budget",
  "MOTION: to approve the 2025 operating budget. Moved by Avery Quill, seconded by Casey Lark. Carried.",
  "Approve the 2025 operating budget.",
  "DECISION: The newsletter moves to a quarterly schedule. ACTION: Drew Moss to update the calendar.",
  "Agenda approved.",
].join("\n"));
const decided = extractMeetingMinutes({ fileId: "local:m", fileName: "2025-05-13 Board Minutes.docx", extract: minutesText } as any).record as any;
const decisionTexts = (decided.decisions ?? []).map((decision: any) => decision.value);
assert.ok(decisionTexts.includes("The newsletter moves to a quarterly schedule."), "a DECISION: line is a stated decision, cut before its ACTION:");
assert.equal(decided.decisions.find((decision: any) => decision.value === "The newsletter moves to a quarterly schedule.").status, "stated");
assert.ok(!decisionTexts.some((text: string) => /operating budget/i.test(text)), "a decision that repeats a motion is dropped");
assert.ok(decisionTexts.includes("Agenda approved."));
assert.ok((decided.actionItems ?? []).some((action: any) => /update the calendar/.test(action.text.value)), "the ACTION: on the same line is still an action item");

// ------------------------------------------------------------ two-column PDF minutes
const twoColumn = await extractPdf(await buildPdf([
  "Board Meeting Minutes",
  "Date: May 13, 2025",
  "Members Present:",
  "Avery Quill\tMinistry of Environment and Climate Change Strategy and Planning Branch",
  "Casey Lark\tRegional District",
  "",
  "Agenda Item\tGroup Action",
  "1. Welcome\tMembers welcomed.",
  "2. Budget update\tThe treasurer presented the budget",
  "\tvariance report.",
  "\f",
  "\tACTION: Treasurer to circulate the report.",
  "3. Adjournment\tAdjourned at 7 pm.",
]));
const tables = twoColumn.blocks.filter((block) => block.kind === "table");
assert.ok(tables.length >= 2, "an 'Agenda Item | Group Action' header starts a table, which continues on the next page");
const cells = tables.flatMap((block) => (block.rows ?? []).flatMap((row) => row.cells.map((cell) => cell.text)));
assert.ok(cells.some((text) => /presented the budget\s+variance report/.test(text)), "a wrapped cell stays in its column");
assert.ok(cells.some((text) => /ACTION: Treasurer to circulate/.test(text)), "the continued table keeps the action column");
assert.ok(!/Branch Casey Lark/.test(twoColumn.text), "a tabbed list row reaching the margin does not swallow the next row");

// ------------------------------------------------------------ Action | WHO | FOR columns
const whoTable = await extractDocx(await buildDocx([
  { p: "Operations Committee Minutes" },
  { p: "Date: June 3, 2025" },
  { table: [
    ["Agenda Item", "Discussion", "Action", "WHO", "FOR"],
    ["1. Newsletter", "The draft was reviewed.", "Send the newsletter to members", "Drew Moss", "June 30, 2025"],
  ] },
] as any));
const whoMinutes = extractMeetingMinutes({ fileId: "local:w", fileName: "2025-06-03 Operations Minutes.docx", extract: whoTable } as any).record as any;
assert.equal(whoMinutes.actionItems.length, 1, "the WHO column names who acts; it is not a second action");
assert.equal(whoMinutes.actionItems[0].text.value, "Send the newsletter to members");
assert.equal(whoMinutes.actionItems[0].assigneeAsWritten?.value, "Drew Moss", "the WHO cell is the action's assignee");
assert.equal(whoMinutes.actionItems[0].due?.value.iso, "2025-06-30", "the FOR cell is the action's due date");
assert.ok(!(whoMinutes.decisions ?? []).length, "no decision is invented from the action row");

console.log("PASS intake re-transposition: motion grammar, bodies, agenda dates, evidenced meetings, insurance cleanup, evidence rule, policy copies, dated version families, future minutes dates, citations, run people, local directory links, decisions, two-column PDFs, Action/WHO/FOR columns and bulk-accept batches");
