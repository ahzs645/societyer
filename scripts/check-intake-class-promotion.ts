/** Gate for promoting reviewed extractions of every class beyond minutes (retest of the
 * in-app intake: a fresh workspace must end with native policies, directors, statements,
 * insurance, filings … with field provenance, not only meetings). Runs the synthetic
 * per-class fixture through the pipeline, stages it in a workspace, accepts each
 * document's fields and promotes it through `intake:promoteExtraction`. Also covers
 * class-aware readiness, the queue summary, version-cluster copies ("covered") and a
 * second promotion of a copy (stable importedSourceVersions). Synthetic data only. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";
import { PortableRuntime } from "../shared/portable/define";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import { buildImportBundle, coverageReport } from "../shared/intake/bundle";
import { extractBytes } from "../shared/intake/extract";
import { sha256Hex } from "../shared/intake/node/extractFile";
import { runIntakePipeline } from "../shared/intake/pipeline";
import { stageRunInWorkspace } from "../shared/intake/stageRun";
import { orderedVersionFiles } from "../shared/intake/promotion";
import { clusterFiles, nameDateKey } from "../shared/intake/cluster";
import { infoTypeDefinition } from "../shared/gapCatalog";
import { CLASS_PROMOTION } from "../shared/intake/promotionClasses";
import { PROVIDER_EXCLUDED_CLASSES } from "../shared/intake/classify";
import { promotionReadiness, latestDecisions, requiredFieldsFor, reviewFieldsForRecord, thresholdFor, isBulkEligible, bulkAcceptCandidates } from "../shared/intake/review";
import { REGISTRY_FILING_KIND } from "../shared/intake/bundleClasses";
import { BC_SOCIETY_PRE_FILL_KINDS } from "../shared/filingPreparation";
import { extractRegistryFiling } from "../shared/intake/extractors/filing";
import { policyEffectiveDate } from "../shared/functions/importSessionHelpers/importSessionMergeAndApply";
import { isStructuralProvenanceField, provenanceFieldLabel } from "../shared/provenanceFields";
import { writeClassFixtures, writeSyntheticFixtures } from "./lib/intake-synthetic-fixtures";

// ------------------------------------------------------------ pure model
assert.deepEqual(requiredFieldsFor("policy", { title: {} }).map((field) => field.path), ["title"]);
assert.deepEqual(requiredFieldsFor("invoice", {}).map((field) => field.label), ["Invoice date", "Amount"]);
assert.deepEqual(requiredFieldsFor("insurance", { policyNumber: {} }).map((field) => field.path), ["policyNumber"]);
assert.deepEqual(requiredFieldsFor("agenda", { body: {}, date: {} }).map((field) => field.path), ["body", "date"]);
assert.deepEqual(requiredFieldsFor("meetingMinutes", {}).map((field) => field.path), ["body", "date"]);
assert.equal(thresholdFor("policy", "title"), 0.8, "class extractors' stated values bulk-accept at 0.8");
assert.equal(thresholdFor("insurance", "termStart"), 0.85);
assert.equal(thresholdFor("unknownClass", "anything"), 0.85);
const ordered = orderedVersionFiles([{ fileKey: "b.pdf", recordStatus: "approved" }, { fileKey: "a.docx", recordStatus: "draft" }, { fileKey: "c.docx" }]).map((file) => file.fileKey);
assert.deepEqual(ordered, ["a.docx", "c.docx", "b.pdf"]);
assert.deepEqual(orderedVersionFiles([{ fileKey: "b.pdf", recordStatus: "approved" }, { fileKey: "c.docx" }, { fileKey: "a.docx", recordStatus: "draft" }]).map((file) => file.fileKey), ordered, "the same order whichever copy is promoted");

// Version families keep the date a file name carries: two monthly minutes are not versions of one meeting.
const clusterOf = (names: string[]) => clusterFiles(names.map((name) => ({ id: name, name }))).map((cluster) => cluster.members.map((member) => member.fileId).sort());
assert.deepEqual(clusterOf(["2021_06_08_Lakeside_Operations_DRAFT Minutes.docx", "2021_07_21_Lakeside_Operations_DRAFT Minutes.docx"]), [], "different dates never form a version family");
assert.deepEqual(clusterOf(["February 2021 Lakeside Board Meeting_DRAFT Minutes.docx", "February 2021 Lakeside Board Meeting Minutes.docx.pdf"]), [["February 2021 Lakeside Board Meeting Minutes.docx.pdf", "February 2021 Lakeside Board Meeting_DRAFT Minutes.docx"]], "a PDF export (.docx.pdf) and the draft of the same month are one family");
assert.equal(nameDateKey("08-10-28 - Minutes.doc"), "2008-10-28");

// Every information type the intake extractors report is in the controlled gap catalogue (else "Other" in the backlog).
{
  const sources: string[] = [];
  const walk = (dir: string) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else if (entry.name.endsWith(".ts")) sources.push(fs.readFileSync(full, "utf8")); } };
  walk(path.join(process.cwd(), "shared", "intake"));
  const keys = new Set(sources.flatMap((source) => [...source.matchAll(/infoType: "([a-z_]+\.[a-z_.]+)"/g)].map((match) => match[1])));
  const unknown = [...keys].filter((key) => infoTypeDefinition(key).area === "other");
  assert.deepEqual(unknown, [], "intake information types are catalogued");
}

// ------------------------------------------------------------ workspace
const society = "society_classes";
const db = new MemoryDb({ seed: {
  societies: [{ _id: society, name: "Lakeside Clean Air Society" }],
  users: [{ _id: "user_owner", societyId: society, role: "Owner", status: "Active", displayName: "Owner" }],
} });
const runtime = new PortableRuntime({
  db, capabilities: makeCapabilities({}),
  principalProvider: () => ({ kind: "user", runtime: "test", assurance: "trusted-workspace", subject: "user_owner", userId: "user_owner", societyId: society }),
}).registerAll(PORTABLE_FUNCTIONS);
const mutate = (name: string, args: Record<string, unknown>) => runtime.runMutation(name, args) as Promise<any>;
const query = (name: string, args: Record<string, unknown>) => runtime.runQuery(name, args) as Promise<any>;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "societyer-intake-classes-"));
await writeClassFixtures(dir);
const run = await runIntakePipeline(fs.readdirSync(dir).map((name) => ({ fileKey: `local:${name}`, name, path: name, acquisitionStatus: "local" as const, read: async () => new Uint8Array(fs.readFileSync(path.join(dir, name))) })), {
  name: "Synthetic class run", sourceKind: "upload", sourceRoot: "browser upload", extract: (file, bytes) => extractBytes(file.name, bytes), hash: sha256Hex,
});
// Privacy: with a provider configured, personal-data classes never reach it and the processing log says so per file.
{
  const prompts: string[] = [];
  const llmRun = await runIntakePipeline(fs.readdirSync(dir).map((name) => ({ fileKey: `local:${name}`, name, path: name, acquisitionStatus: "local" as const, read: async () => new Uint8Array(fs.readFileSync(path.join(dir, name))) })), {
    name: "Synthetic class run (provider)", sourceKind: "upload", sourceRoot: "browser upload", extract: (file, bytes) => extractBytes(file.name, bytes), hash: sha256Hex,
    llm: { generate: async ({ prompt }) => { prompts.push(prompt); throw new Error("fake provider"); }, provider: "openai-compatible", model: "fake", budgetTokens: 1_000_000, concurrency: 2 },
  });
  const excluded = llmRun.files.filter((file) => PROVIDER_EXCLUDED_CLASSES.has(file.classification?.docClass as any) && file.disposition === "extract");
  assert.ok(excluded.length >= 4, "the fixture has consents, rosters, invoices and correspondence");
  for (const file of excluded) {
    assert.ok(!prompts.some((prompt) => prompt.includes(file.name)), `${file.name} was never sent`);
    assert.ok(llmRun.processingLog.some((entry) => entry.fileKey === file.fileKey && entry.stage === "llm_skipped" && entry.sentToProvider === false && /never sent/.test(entry.note ?? "")), `the log records that ${file.name} was withheld`);
  }
  assert.ok(prompts.length > 0 && prompts.every((prompt) => !/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(prompt.replace(/x{2,}/gi, ""))), "prompts carry no e-mail address");
}

const staged = await stageRunInWorkspace(mutate, society, run, run.extracts, coverageReport(run, buildImportBundle(run)));
// Server-side reconciliation (hosted runs) derives package-embedded minutes again and reaches the pipeline's record gaps.
const embedded = run.extractions.filter((extraction) => extraction.parentFileKey).length;
assert.ok(embedded > 0, "the fixture has minutes embedded in a package");
const reconciledAgain = await mutate("intake:reconcileRun", { societyId: society, runId: staged.runId });
assert.equal(reconciledAgain.recordGaps, run.reconciliation.gaps.length, `reconcileRun reproduces the pipeline's record gaps (${embedded} embedded minutes)`);
assert.equal(reconciledAgain.meetings, run.reconciliation.meetings.length);
const queue = await query("intake:listExtractions", { societyId: society, runId: staged.runId }) as any[];
const classRows = queue.filter((row) => row.docClass !== "meetingMinutes");
assert.ok(classRows.length >= 15, `the fixture yields extractions of every class (${classRows.length})`);
assert.ok(classRows.every((row) => typeof row.summary === "string" && row.summary.length > 3), "queue rows describe non-minutes records");
assert.ok(classRows.find((row) => row.docClass === "insurance")?.date, "a class record's queue row carries its identifying date");

/** Accept every field that has a value (a reviewer working through the document). */
async function acceptAll(row: any) {
  const detail = await query("intake:getExtraction", { societyId: society, extractionId: row._id });
  const fields = reviewFieldsForRecord(detail.extraction.record, row.docClass).filter((field) => field.field.value !== undefined && field.field.value !== null && field.field.status !== "not_stated");
  for (let offset = 0; offset < fields.length; offset += 500) {
    await mutate("intake:reviewFields", { societyId: society, items: fields.slice(offset, offset + 500).map((field) => ({ extractionId: row._id, fieldPath: field.path, decision: "accept" })) });
  }
  const after = await query("intake:getExtraction", { societyId: society, extractionId: row._id });
  return promotionReadiness(reviewFieldsForRecord(after.extraction.record, row.docClass), latestDecisions(after.reviews), row.docClass);
}

// A class without required fields is not promoted while nothing in it was accepted ("Promote all ready" skips it).
const unreviewed = queue.find((row) => ["correspondence", "agreement", "directorConsent", "roster", "proxy"].includes(row.docClass));
assert.ok(unreviewed, "the fixture has a class without required fields");
await assert.rejects(mutate("intake:promoteExtraction", { societyId: society, extractionId: unreviewed._id }), /Accept or edit at least one field/, "a document with no accepted field is not promoted");

const results: Record<string, { tables: string[]; provenance: number }> = {};
const failures: string[] = [];
// Minutes first (so agendas of the same meeting become materials), then everything else.
for (const row of [...queue].sort((a, b) => Number(a.docClass !== "meetingMinutes") - Number(b.docClass !== "meetingMinutes"))) {
  const current = (await query("intake:listExtractions", { societyId: society, runId: staged.runId }) as any[]).find((candidate) => candidate._id === row._id);
  if (current?.status !== "pending_review" && current?.status !== "in_review") continue;
  const readiness = await acceptAll(row);
  if (!readiness.ready) { failures.push(`${row.fileKey}: not ready (${[...readiness.missing, ...readiness.problems].join(", ")})`); continue; }
  try {
    const promoted = await mutate("intake:promoteExtraction", { societyId: society, extractionId: row._id });
    const tables = [...new Set((promoted.targets ?? []).map((target: any) => target.table as string))];
    results[`${row.docClass} ${row.fileKey.replace(/^local:/, "")}`] = { tables, provenance: promoted.provenance };
    for (const target of promoted.targets ?? []) assert.ok(db.dump(target.table).some((record: any) => String(record._id) === String(target.id)), `${target.table} ${target.id} exists`);
    if (row.docClass !== "meetingMinutes" && row.docClass !== "agreement" && row.docClass !== "correspondence") assert.ok(promoted.provenance > 0, `${row.fileKey} wrote provenance`);
  } catch (error) {
    failures.push(`${row.docClass} ${row.fileKey}: ${error instanceof Error ? error.message : error}`);
  }
}
assert.deepEqual(failures, [], `every class promotes:\n${failures.join("\n")}`);

const promotedClasses = new Set(Object.keys(results).map((key) => key.split(" ")[0]));
for (const docClass of ["agenda", "policy", "bylaws", "roster", "directorConsent", "registryFiling", "financialStatement", "budget", "insurance", "grant", "invoice"]) {
  assert.ok(promotedClasses.has(docClass), `${docClass} was promoted (classes: ${[...promotedClasses].join(", ")})`);
}
const tablesFor = (docClass: string) => new Set(Object.entries(results).filter(([key]) => key.startsWith(`${docClass} `)).flatMap(([, value]) => value.tables));
assert.ok(tablesFor("policy").has("policies") || tablesFor("policy").has("committees"));
assert.ok(tablesFor("bylaws").has("policies"));
assert.ok(tablesFor("insurance").has("insurancePolicies"));
assert.ok(tablesFor("financialStatement").has("financialStatementImports"));
assert.ok(tablesFor("budget").has("budgetSnapshots"));
assert.ok(tablesFor("registryFiling").has("filings"));
assert.ok(tablesFor("roster").has("directors") || tablesFor("directorConsent").has("directors"));
assert.ok(tablesFor("invoice").has("transactionCandidates"));
assert.ok(tablesFor("agenda").has("meetings"), "an agenda creates (or links) its meeting");

// Native shapes: insurance never Active, policies Draft/Superseded, directors not duplicated.
assert.ok(db.dump("insurancePolicies").every((row: any) => row.status !== "Active"));
assert.ok(db.dump("policies").every((row: any) => ["Draft", "Superseded"].includes(row.status)));
const directorNames = db.dump("directors").map((row: any) => `${row.firstName} ${row.lastName}`.toLowerCase());
assert.equal(new Set(directorNames).size, directorNames.length, "a person listed by several documents is one director");
assert.ok(db.dump("boardRoleAssignments").length >= directorNames.length, "every observed term is a role assignment");

// X-02: "Approved by the Board: March 11, 2025" with no stated effective date → effectiveDate.
const signingPolicy = db.dump("policies").find((row: any) => /Signing Authority/i.test(row.policyName)) as any;
assert.ok(signingPolicy, "the signing authority policy was promoted");
assert.equal(signingPolicy.effectiveDate, "2025-03-11", "a stated adoption date becomes the effective date");
assert.equal(policyEffectiveDate({ effectiveDate: "2024-01-01", adoptedDate: "2023-05-05" }), "2024-01-01", "an explicit effective date wins");
assert.equal(policyEffectiveDate({ adoptedDate: "2023-05-05" }), "2023-05-05");
assert.equal(policyEffectiveDate({ adoptedAtMeeting: { meetingDate: "2022-06-14", body: "board" } }), "2022-06-14", "the adopting meeting's date");
assert.equal(policyEffectiveDate({ adoptedDate: "May 2022" }), undefined, "a month is never padded to a day");
// The labelled adoption line is bulk-acceptable (stated, verified span, at τ).
{
  const extraction = run.extractions.find((row) => /Signing Authority Policy/.test(row.fileKey))!;
  const adopted = reviewFieldsForRecord(extraction.record as any, "policy").find((field) => field.path === "adoptedDate")!;
  assert.ok(adopted && isBulkEligible(adopted, "policy"), `"Approved by the Board: <date>" is bulk-accepted (${JSON.stringify(adopted?.field)})`);
}
// INT-17: stated, span-verified correspondence decisions are bulk-accepted; promotion keeps them restricted.
{
  const extraction = run.extractions.find((row) => /Funder decision email/.test(row.fileKey))!;
  const fields = reviewFieldsForRecord(extraction.record as any, "correspondence");
  const decisionFields = fields.filter((field) => field.pattern === "decisionsOrCommitments");
  assert.ok(decisionFields.length >= 1, "the funder e-mail states a decision");
  assert.ok(decisionFields.every((field) => isBulkEligible(field, "correspondence")), "stated + verified decision fields are bulk-eligible");
  const candidates = bulkAcceptCandidates(fields, new Map(), "correspondence").map((field) => field.pattern);
  assert.ok(candidates.includes("decisionsOrCommitments"));
  const inferredDecision = { ...decisionFields[0], field: { ...decisionFields[0].field, status: "inferred" as const } };
  assert.equal(isBulkEligible(inferredDecision as any, "correspondence"), false, "an inferred decision still needs a reviewer");
  const unverified = { ...decisionFields[0], field: { ...decisionFields[0].field, verification: "unverified" as any } };
  assert.equal(isBulkEligible(unverified as any, "correspondence"), false, "an unverified decision still needs a reviewer");
  assert.ok(db.dump("sourceEvidence").filter((row: any) => row.evidenceKind === "correspondence_decision").every((row: any) => row.sensitivity === "restricted"), "promoted decisions stay restricted evidence");
}
// X-07: a statement of directors is a change-of-directors filing, not an annual report.
assert.equal(REGISTRY_FILING_KIND.statement_of_directors, "ChangeOfDirectors");
assert.equal(REGISTRY_FILING_KIND.change_of_directors, "ChangeOfDirectors");
assert.equal(REGISTRY_FILING_KIND.annual_report, "AnnualReport");
for (const kind of new Set(Object.values(REGISTRY_FILING_KIND))) assert.ok(kind === "Other" || BC_SOCIETY_PRE_FILL_KINDS.some((option) => option.id === kind), `${kind} is a BC filing kind the app knows`);
assert.equal((extractRegistryFiling({ fileName: "2025 Statement of Directors.txt", extract: await extractBytes("2025 Statement of Directors.txt", new TextEncoder().encode("STATEMENT OF DIRECTORS\nSociety Name: LAKESIDE CLEAN AIR SOCIETY\nDirectors\nQUILL, AVERY\n")) } as any).record as any).filingType?.value, "statement_of_directors");
assert.equal((extractRegistryFiling({ fileName: "notice.txt", extract: await extractBytes("notice.txt", new TextEncoder().encode("NOTICE OF CHANGE OF DIRECTORS\nSociety Name: LAKESIDE CLEAN AIR SOCIETY\n")) } as any).record as any).filingType?.value, "change_of_directors");

// Provenance on class records (View source).
const policy = db.dump("policies")[0] as any;
const policyProvenance = await query("intake:provenanceForRecords", { societyId: society, targets: [{ targetTable: "policies", targetId: policy._id }] });
assert.ok(policyProvenance.some((row: any) => row.fieldPath === "policyName" && row.locator.quote), "a promoted policy shows its source quote");
const insurance = db.dump("insurancePolicies")[0] as any;
const insuranceProvenance = await query("intake:provenanceForRecords", { societyId: society, targets: [{ targetTable: "insurancePolicies", targetId: insurance._id }] });
assert.ok(insuranceProvenance.some((row: any) => row.fieldPath === "insurer" || row.fieldPath === "startDate"));
const director = db.dump("directors")[0] as any;
assert.ok((await query("intake:provenanceForRecords", { societyId: society, targets: [{ targetTable: "directors", targetId: director._id }] })).some((row: any) => row.fieldPath === "fullName"), "a director links to the line that names them");
// X-06: the "View source" drawer hides structural paths (the extractor's `kind`, source ids,
// column keys) and shows human labels; the rows themselves stay stored.
{
  const provenanceRows = db.dump("fieldProvenance") as any[];
  assert.ok(provenanceRows.some((row) => row.targetTable === "directors" && row.fieldPath === "kind"), "the structural row is still stored");
  const visible = provenanceRows.filter((row) => !isStructuralProvenanceField(row.fieldPath));
  assert.ok(visible.length > 0 && visible.length < provenanceRows.length);
  for (const hidden of ["kind", "organizationName", "sourceExternalIds", "recordStatus", "totals[0].arithmeticCheck", "lines[3].column", "sourceLocator"]) assert.equal(isStructuralProvenanceField(hidden), true, hidden);
  for (const shown of ["fullName", "termStart", "effectiveDate", "detailedAttendance[2].name", "lines[0].amount", "policyName"]) assert.equal(isStructuralProvenanceField(shown), false, shown);
  assert.equal(provenanceFieldLabel("termStart"), "Term start");
  assert.equal(provenanceFieldLabel("fullName"), "Name");
  assert.equal(provenanceFieldLabel("detailedAttendance[2].status"), "Attendance 3 › Status");
  assert.equal(provenanceFieldLabel("feePaidCents"), "Fee paid");
  assert.equal(provenanceFieldLabel("organisationRepresented"), "Organization represented");
  assert.ok(visible.every((row) => !/[a-z][A-Z]/.test(provenanceFieldLabel(row.fieldPath))), `no camelCase label is shown: ${[...new Set(visible.map((row) => provenanceFieldLabel(row.fieldPath)).filter((label) => /[a-z][A-Z]/.test(label)))].join(", ")}`);
}
// Each promoted class document is linked to a source document of its register's category.
const promotedRows = (await query("intake:listExtractions", { societyId: society, runId: staged.runId }) as any[]).filter((row) => row.status === "promoted");
assert.ok(promotedRows.every((row) => Array.isArray(row.promotion?.targets)), "promoted rows list the records they created");
const insuranceDoc = db.dump("documents").find((row: any) => row.category === "Insurance" && (row.tags ?? []).includes("insurance"));
assert.ok(insuranceDoc, "an insurance source document is filed under Insurance");
// Restricted classes (consents, invoices, correspondence) never carry contact data or text into documents.
for (const row of db.dump("documents") as any[]) {
  if (!(row.tags ?? []).includes("intake")) continue;
  const leak = [...String(row.content ?? "").replace(/\\[tnr]/g, " ").matchAll(/[\w.+-]+@[\w-]+\.[\w.]+/g)].find((match) => !/^[x.@+_-]+$/i.test(match[0]));
  assert.ok(!leak, `no e-mail address in ${row.title}: ${leak?.[0]} … ${String(row.content ?? "").slice(Math.max(0, (leak?.index ?? 0) - 200), (leak?.index ?? 0) + 60)}`);
}
// System gaps recorded for facts without a native field (e.g. an agreement).
assert.ok(db.dump("representationGaps").some((row: any) => String(row.dedupeKey ?? "").includes(":class:") || String(row.dedupeKey ?? "").includes(":unsupported:")));
assert.ok(Object.keys(CLASS_PROMOTION).length >= 16);
fs.rmSync(dir, { recursive: true, force: true });

// ------------------------------------------------------------ version clusters: copies are covered; a copy promotes cleanly
{
  const minutesDb = new MemoryDb({ seed: { societies: [{ _id: society, name: "Lakeside Clean Air Society" }], users: [{ _id: "user_owner", societyId: society, role: "Owner", status: "Active", displayName: "Owner" }] } });
  const rt = new PortableRuntime({ db: minutesDb, capabilities: makeCapabilities({}), principalProvider: () => ({ kind: "user", runtime: "test", assurance: "trusted-workspace", subject: "user_owner", userId: "user_owner", societyId: society }) }).registerAll(PORTABLE_FUNCTIONS);
  const m = (name: string, args: Record<string, unknown>) => rt.runMutation(name, args) as Promise<any>;
  const q = (name: string, args: Record<string, unknown>) => rt.runQuery(name, args) as Promise<any>;
  const minutesDir = fs.mkdtempSync(path.join(os.tmpdir(), "societyer-intake-copies-"));
  await writeSyntheticFixtures(minutesDir);
  // A draft of the same minutes: a near-duplicate text with one changed line (copies with identical bytes are not re-extracted).
  const textFile = fs.readdirSync(minutesDir).find((name) => name.endsWith(".txt"))!;
  const text = fs.readFileSync(path.join(minutesDir, textFile), "utf8");
  fs.writeFileSync(path.join(minutesDir, textFile.replace(/\.txt$/, " DRAFT.txt")), `${text}\nDraft circulated for comment.\n`);
  const copyRun = await runIntakePipeline(fs.readdirSync(minutesDir).map((name) => ({ fileKey: `local:${name}`, name, path: name, acquisitionStatus: "local" as const, read: async () => new Uint8Array(fs.readFileSync(path.join(minutesDir, name))) })), {
    name: "Copies", sourceKind: "upload", sourceRoot: "browser upload", extract: (file, bytes) => extractBytes(file.name, bytes), hash: sha256Hex,
  });
  const copyStaged = await stageRunInWorkspace(m, society, copyRun, copyRun.extracts, coverageReport(copyRun, buildImportBundle(copyRun)));
  const files = await q("intake:listFiles", { societyId: society, runId: copyStaged.runId }) as any[];
  const clustered = files.filter((file) => file.clusterKey && file.docClass === "meetingMinutes");
  const clusterKey = clustered.map((file) => file.clusterKey).find((key, index, keys) => keys.indexOf(key) !== index);
  if (!clusterKey) console.log(files.map((file) => [file.name, file.docClass, file.clusterKey, file.disposition]));
  const copyQueue = await q("intake:listExtractions", { societyId: society, runId: copyStaged.runId }) as any[];
  const inCluster = copyQueue.filter((row) => files.find((file) => file._id === row.fileId)?.clusterKey === clusterKey);
  if (clusterKey && inCluster.length >= 2) {
    const [first, second] = inCluster;
    for (const row of [first, second]) {
      const detail = await q("intake:getExtraction", { societyId: society, extractionId: row._id });
      await m("intake:reviewFields", { societyId: society, items: reviewFieldsForRecord(detail.extraction.record).filter((field) => field.field.status === "stated").map((field) => ({ extractionId: row._id, fieldPath: field.path, decision: "accept" })) });
    }
    const promoted = await m("intake:promoteExtraction", { societyId: society, extractionId: first._id });
    assert.ok(promoted.covered >= 1, "promoting one copy covers the other copies of its cluster");
    const secondRow = (await q("intake:listExtractions", { societyId: society, runId: copyStaged.runId }) as any[]).find((row) => row._id === second._id);
    assert.equal(secondRow.status, "covered");
    assert.equal(secondRow.promotion.coveredByExtractionId, first._id);
    // Reopening a covered copy and promoting it merges into the same meeting without a history conflict.
    await m("intake:setExtractionStatus", { societyId: society, extractionId: second._id, status: "in_review" });
    const again = await m("intake:promoteExtraction", { societyId: society, extractionId: second._id });
    assert.equal(again.meetingId, promoted.meetingId, "the copy merges into the meeting its cluster already created");
  } else {
    console.warn("WARN: the synthetic copy did not cluster; covered-copy checks skipped");
    assert.fail("a byte-identical copy must cluster with its original");
  }
  fs.rmSync(minutesDir, { recursive: true, force: true });
}

// ------------------------------------------------------------ minutes embedded in a package go through review and promotion
{
  const derived = (db.dump("intakeExtractions") as any[]).filter((row) => row.parentFileKey);
  const canonicalDerived = run.extractions.filter((extraction) => extraction.parentFileKey && run.reconciliation.meetings.some((meeting) => meeting.canonicalFileId === extraction.fileKey));
  assert.equal(derived.length, canonicalDerived.length, "package-embedded minutes that are a meeting's only copy are staged as their own extraction");
  assert.ok(derived.length > 0, "the fixture has package-embedded minutes without a standalone copy");
  for (const row of derived) {
    const packageFile = (db.dump("intakeFiles") as any[]).find((file) => file._id === row.fileId);
    assert.equal(packageFile.fileKey, row.parentFileKey, "a derived extraction lives on its package's file");
    assert.ok(row.fileKey.startsWith(`${row.parentFileKey}#part-`));
    assert.equal(row.status, "promoted", "embedded minutes are promoted from the review screen");
    const provenance = (db.dump("fieldProvenance") as any[]).filter((item) => item.extractionId === row._id);
    assert.ok(provenance.length > 5, "promoted embedded minutes carry field provenance");
    const meetingId = row.promotion.targets.find((target: any) => target.table === "meetings").id;
    const minutes = (db.dump("minutes") as any[]).find((item) => item.meetingId === meetingId);
    assert.ok(minutes.sourceExternalIds.includes(row.parentFileKey), "the package is the minutes' source document");
    assert.ok(!minutes.sourceExternalIds.some((key: string) => key.includes("#part-")), "no placeholder source for the derived key");
    assert.ok(!(db.dump("documents") as any[]).some((doc) => (doc.tags ?? []).some((tag: string) => tag.includes("#part-"))), "no document is created for a derived key");
    const viewSource = await query("intake:provenanceForRecords", { societyId: society, targets: [{ targetTable: "meetings", targetId: meetingId }] });
    assert.ok(viewSource.some((item: any) => item.locator?.quote && item.value !== undefined), "View source reads the value and quote from the extraction");
  }
  // Server-side reconciliation does not derive the stored ones a second time.
  const again = await mutate("intake:reconcileRun", { societyId: society, runId: staged.runId });
  assert.equal(again.meetings, run.reconciliation.meetings.length);
}

console.log(`PASS intake class promotion: ${Object.keys(results).length} documents promoted across ${promotedClasses.size} classes into ${new Set(Object.values(results).flatMap((value) => value.tables)).size} native tables; ${db.dump("fieldProvenance").length} provenance rows; version-cluster copies covered and re-promotable`);
