/** Synthetic fixtures only. No credentials, network, deployment or data mutations. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { auditMeetingIntegrity, MEETING_AUDIT_TABLES } from "./lib/meetingIntegrityAudit";
import { integrityScopeTemplate, loadIntegrityInput, type RecordRow } from "./lib/meetingIntegrityInput";

type Tables = Record<string, RecordRow[]>;
const privateText = "SYNTHETIC_PRIVATE_MEETING_CONTENT_7f3e";
const bytes = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const clone = <T>(value: T): T => structuredClone(value);
const repo = fileURLToPath(new URL("../", import.meta.url));
const root = await mkdtemp(path.join(os.tmpdir(), "societyer-integrity-synthetic-"));
let passed = 0;
async function check(label: string, run: () => Promise<void>) { await run(); passed++; process.stdout.write(`PASS ${label}\n`); }
class FixtureZipWriter {
  private zip = new JSZip();
  async add(name: string, data: Uint8Array, options: { compress?: boolean } = {}) {
    this.zip.file(name, data, { compression: options.compress === false ? "STORE" : "DEFLATE", createFolders: false });
  }
  async finish() { return new Blob([await this.zip.generateAsync({ type: "uint8array" }) as BlobPart]); }
}

function base(): Tables {
  const tables: Tables = Object.fromEntries([...MEETING_AUDIT_TABLES, "societies", "users", "documents", "documentVersions", "tasks", "signatures", "sourceEvidence", "peopleDirectory", "meetingTranscriptionConnections", "_storage"].map(table => [table, []]));
  const row = (_id: string, values: RecordRow) => ({ _id, _creationTime: 1, societyId: "s1", ...values });
  tables.societies = [{ _id: "s1", _creationTime: 1, name: privateText }];
  tables.users = [row("u1", { email: `${privateText}@example.invalid`, displayName: privateText, role: "Owner", status: "Active", createdAtISO: "2020-01-01" })];
  tables.meetings = [row("meet1", { title: privateText, type: "Board", scheduledAt: "2020-01-10T12:00:00.000Z", scheduledAtPrecision: "date", electronic: false, status: "Held", attendeeIds: [privateText], minutesId: "min1", remotePasscode: privateText })];
  tables.minutes = [row("min1", { meetingId: "meet1", heldAt: "2020-01-10", attendees: [privateText], absent: [], quorumMet: false, quorumStatus: "not_recorded", discussion: privateText, decisions: [], actionItems: [], motionIds: ["motion1"], sections: [{ title: privateText, agendaItemId: "item1", motionId: "motion1", linkedTaskIds: ["task1"] }] })];
  tables.agendas = [row("agenda1", { meetingId: "meet1", title: privateText, status: "Draft", createdAtISO: "2020-01-01", updatedAtISO: "2020-01-01" })];
  tables.agendaItems = [row("item1", { agendaId: "agenda1", order: 0, type: "motion", title: privateText, motionId: "motion1", createdAtISO: "2020-01-01" })];
  tables.motions = [row("motion1", { text: privateText, status: "Voted", outcome: "Carried", primaryMeetingId: "meet1", minutesId: "min1", agendaId: "agenda1", agendaItemId: "item1", createdAtISO: "2020-01-01", updatedAtISO: "2020-01-01" })];
  tables.documents = [row("doc1", { title: privateText, meetingId: "meet1", agendaItemId: "item1", storageId: "blob1" })];
  tables.documentVersions = [row("version1", { documentId: "doc1", createdByUserId: "u1", filename: privateText })];
  tables.tasks = [row("task1", { title: privateText, meetingId: "meet1", agendaItemId: "item1", documentId: "doc1" })];
  tables.meetingMaterials = [row("material1", { meetingId: "meet1", agendaItemId: "item1", documentId: "doc1", accessGrants: [{ subjectType: "user", subjectId: "u1" }] })];
  tables.meetingSources = [row("source1", { meetingId: "meet1", actorId: "u1", driveId: privateText, itemId: privateText })];
  tables.meetingSourceText = [{ _id: "sourceText1", _creationTime: 1, sourceId: "source1", content: privateText }];
  tables.meetingTranscriptionConnections = [row("connection1", { activeJobId: "job1", createdBy: "u1", keyHash: privateText })];
  tables.meetingTranscriptionJobs = [row("job1", { meetingId: "meet1", sourceId: "source1", actorId: "u1", connectionId: "connection1", lease: privateText })];
  tables.meetingTranscriptPages = [row("page1", { jobId: "job1", meetingId: "meet1", segments: [{ text: privateText, speaker: privateText }] })];
  tables.transcripts = [row("transcript1", { meetingId: "meet1", pagedJobId: "job1", text: privateText })];
  tables.transcriptionJobs = [row("legacyJob1", { meetingId: "meet1", transcriptId: "transcript1" })];
  tables.meetingAttendanceRecords = [row("attendance1", { meetingId: "meet1", minutesId: "min1", name: privateText })];
  tables.signatures = [row("signature1", { entityType: "minutes", entityId: "min1", subjectId: "min1", signerName: privateText })];
  tables.sourceEvidence = [row("evidence1", { targetTable: "minutes", targetId: "min1", documentId: "doc1", text: privateText })];
  tables.minuteBookItems = [row("book1", { meetingId: "meet1", minutesId: "min1", documentIds: ["doc1"], signatureIds: ["signature1"] })];
  tables._storage = [{ _id: "blob1", _creationTime: 1 }];
  return tables;
}

async function native(name: string, tables: Tables, options: { zip?: boolean; prefix?: string; extra?: Record<string, string> } = {}) {
  const file = path.join(root, name);
  const records = Object.fromEntries(Object.entries(tables).map(([table, rows]) => [`${options.prefix ? options.prefix + "/" : ""}${table}/documents.jsonl`, rows.map(row => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "")]));
  Object.assign(records, options.extra);
  if (options.zip) {
    const writer = new FixtureZipWriter();
    for (const [name, text] of Object.entries(records)) await writer.add(name, bytes(text));
    await writeFile(file, new Uint8Array(await (await writer.finish()).arrayBuffer()));
  } else {
    await mkdir(file);
    for (const [name, text] of Object.entries(records)) { await mkdir(path.dirname(path.join(file, name)), { recursive: true }); await writeFile(path.join(file, name), text); }
  }
  return file;
}

async function workspace(name: string, tables: Tables, extra: RecordRow = {}) {
  const file = path.join(root, name);
  await writeFile(file, JSON.stringify({ kind: "societyer.workspaceExport", version: 2, manifest: { societyId: "s1", tables: Object.entries(tables).map(([name, rows]) => ({ name, rowCount: rows.length })) }, tables, ...extra }));
  return file;
}

const code = (report: ReturnType<typeof auditMeetingIntegrity>, name: string) => report.findings.filter(finding => finding.code === name);
const runCLI = (args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "scripts/audit-meeting-integrity.ts", ...args], { cwd: repo, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });

try {
  await check("complete native directory and deflated ZIP reconcile all graph links; no personal content leaks", async () => {
    const tables = base();
    for (const zipped of [false, true]) {
      const file = await native(zipped ? "full.zip" : "full", tables, { zip: zipped });
      const input = await loadIntegrityInput(file, { completeSnapshot: true });
      const report = auditMeetingIntegrity(input);
      assert.equal(report.outcome, "no-issues-found-within-declared-scope", JSON.stringify(report.findings));
      assert.equal(report.totals.findings, 0);
      assert.ok(report.totals.references.resolved > 40);
      assert.ok(!JSON.stringify(report).includes(privateText));
      assert.equal(report.input.binaryVerification, "not-checked");
      assert.ok(await input.verifyUnchanged());
    }
  });
  await check("absence is unresolved without declaration; a complete table makes a missing target explicit", async () => {
    const tables = base(); tables.documents = [];
    const file = await native("missing-document", tables);
    const conservative = auditMeetingIntegrity(await loadIntegrityInput(file));
    assert.equal(code(conservative, "dangling_reference_in_snapshot").length, 0);
    assert.ok(code(conservative, "reference_not_resolved_in_export").some(finding => finding.targetId === "doc1"));
    const complete = auditMeetingIntegrity(await loadIntegrityInput(file, { completeSnapshot: true }));
    assert.ok(code(complete, "dangling_reference_in_snapshot").some(finding => finding.targetId === "doc1"));
    assert.equal(complete.outcome, "issues-found-in-export");
  });
  await check("missing table never becomes complete empty even with --complete-snapshot", async () => {
    const tables = base(); delete tables.documents;
    const report = auditMeetingIntegrity(await loadIntegrityInput(await native("absent-table", tables), { completeSnapshot: true }));
    assert.equal(code(report, "dangling_reference_in_snapshot").length, 0);
    assert.equal(report.scope.tableCoverage.find(entry => entry.table === "documents")?.state, "missing");
    assert.equal(report.outcome, "inconclusive-coverage");
  });
  await check("workspace export matching counts is still filtered/non-atomic; metadata-only is rejected", async () => {
    const tables = base(); tables.documents = [];
    const file = await workspace("workspace.json", tables);
    const input = await loadIntegrityInput(file);
    assert.equal(input.consistency, "non-atomic");
    assert.equal(code(auditMeetingIntegrity(input), "dangling_reference_in_snapshot").length, 0);
    await assert.rejects(loadIntegrityInput(file, { completeSnapshot: true }), /only valid/);
    await assert.rejects(loadIntegrityInput(await workspace("metadata-only.json", {})), /metadata-only/);
    await assert.rejects(loadIntegrityInput(file, { component: "foreign" }), /only to a Convex snapshot/);
    const redactedFile = await workspace("redacted-workspace.json", tables, { manifest: { societyId: "s1", redactedFields: ["storageId"] } });
    const redacted = await loadIntegrityInput(redactedFile);
    assert.equal(redacted.coverage.get("documents")?.fields, "redacted");
    const scope = integrityScopeTemplate(redacted); scope.tables.documents.fields = "full";
    const scopeFile = path.join(root, "redacted-scope.json"); await writeFile(scopeFile, JSON.stringify(scope));
    await assert.rejects(loadIntegrityInput(redactedFile, { scopeManifest: scopeFile }), /unredacted/);
  });
  await check("hash-bound manifests respect partial/redacted/non-atomic scopes and validate row counts", async () => {
    const tables = base(); tables.documents = [];
    const file = await workspace("scoped-workspace.json", tables);
    const input = await loadIntegrityInput(file);
    const manifest = integrityScopeTemplate(input);
    assert.ok(Object.values(manifest.tables).every(table => !table.complete));
    const scopeFile = path.join(root, "scope.json");
    manifest.consistency = "point-in-time";
    for (const table of Object.values(manifest.tables)) { table.complete = true; table.fields = "full"; }
    await writeFile(scopeFile, JSON.stringify(manifest));
    assert.ok(code(auditMeetingIntegrity(await loadIntegrityInput(file, { scopeManifest: scopeFile })), "dangling_reference_in_snapshot").length);
    manifest.tables.documents.fields = "redacted";
    await writeFile(scopeFile, JSON.stringify(manifest));
    assert.equal(code(auditMeetingIntegrity(await loadIntegrityInput(file, { scopeManifest: scopeFile })), "dangling_reference_in_snapshot").length, 0);
    manifest.tables.documents.fields = "full"; manifest.consistency = "non-atomic";
    await writeFile(scopeFile, JSON.stringify(manifest));
    assert.equal(code(auditMeetingIntegrity(await loadIntegrityInput(file, { scopeManifest: scopeFile })), "dangling_reference_in_snapshot").length, 0);
    manifest.tables.documents.rows = 1;
    await writeFile(scopeFile, JSON.stringify(manifest));
    await assert.rejects(loadIntegrityInput(file, { scopeManifest: scopeFile }), /row count differs/);
    manifest.tables.documents.rows = 0; manifest.inputSha256 = "0".repeat(64);
    await writeFile(scopeFile, JSON.stringify(manifest));
    await assert.rejects(loadIntegrityInput(file, { scopeManifest: scopeFile }), /input hash/);
  });
  await check("duplicate export IDs are distinct from duplicate minutes and meeting candidates", async () => {
    const tables = base(); tables.minutes.push(clone(tables.minutes[0]));
    let report = auditMeetingIntegrity(await loadIntegrityInput(await native("overlap", tables), { completeSnapshot: true }));
    assert.equal(code(report, "duplicate_record_id").length, 1);
    assert.equal(code(report, "multiple_minutes_for_meeting").length, 0);
    tables.minutes[1]._id = "min2";
    tables.meetings.push({ ...clone(tables.meetings[0]), _id: "meet2", minutesId: undefined });
    report = auditMeetingIntegrity(await loadIntegrityInput(await native("duplicates", tables), { completeSnapshot: true }));
    assert.equal(code(report, "multiple_minutes_for_meeting").length, 1);
    assert.equal(code(report, "possible_duplicate_meetings").length, 1);
    assert.equal(code(report, "possible_duplicate_meetings")[0].certainty, "candidate");
  });
  await check("observed foreign-workspace links are detected while same titles across workspaces are not duplicates", async () => {
    const tables = base(); tables.societies.push({ _id: "s2" });
    tables.documents[0].societyId = "s2";
    tables.meetings.push({ ...clone(tables.meetings[0]), _id: "foreignMeet", societyId: "s2", minutesId: undefined });
    const report = auditMeetingIntegrity(await loadIntegrityInput(await native("foreign", tables), { completeSnapshot: true }), { societyId: "s1" });
    assert.ok(code(report, "cross_workspace_reference").some(finding => finding.targetId === "doc1"));
    assert.equal(code(report, "possible_duplicate_meetings").length, 0);
    assert.ok(!report.findings.some(finding => finding.rowIds.includes("foreignMeet")));
  });
  await check("motion identities, canonical back-links and material/job parents are reconciled", async () => {
    const tables = base(); tables.minutes[0].motionIds.push("motion1");
    tables.meetings.push({ ...clone(tables.meetings[0]), _id: "meet2", minutesId: "min1", title: "Other synthetic meeting" });
    tables.meetingMaterials[0].meetingId = "meet2";
    tables.meetingTranscriptionJobs[0].meetingId = "meet2";
    tables.documents[0].storageId = "u1";
    const report = auditMeetingIntegrity(await loadIntegrityInput(await native("mismatches", tables), { completeSnapshot: true }));
    assert.equal(code(report, "duplicate_motion_ids").length, 1);
    assert.ok(code(report, "meeting_minutes_backlink_mismatch").length);
    assert.ok(code(report, "related_record_meeting_mismatch").length >= 2);
    assert.ok(code(report, "transcript_job_meeting_mismatch").length);
    assert.ok(code(report, "reference_wrong_table").some(finding => finding.targetTable === "_storage"));
  });
  await check("approved historical IDs and attendance/quorum are reviewed without invented legal conclusions", async () => {
    const tables = base();
    Object.assign(tables.minutes[0], { approvedAt: "2020-02-01", approvedInMeetingId: "meet1", quorumMet: true, quorumStatus: undefined, adoptedSnapshot: { meetingId: "removedHistoricalMeeting", discussion: privateText }, motionSnapshots: [{ motionId: "removedHistoricalMotion", text: privateText, outcome: "Carried" }], detailedAttendance: [{ name: privateText, status: "regrets", quorumCounted: true }], importedSourceVersions: [{ versionId: "v1", contentJson: JSON.stringify({ meetingId: "deletedImportedSource", discussion: privateText }) }] });
    tables.meetings[0].status = "Scheduled";
    tables.motions[0].history = [{ meetingId: "removedHistoricalMeeting", minutesId: "removedHistoricalMinutes", status: "Draft", at: "2019-01-01" }];
    const file = await native("historical", tables);
    const input = await loadIntegrityInput(file, { completeSnapshot: true });
    const report = auditMeetingIntegrity(input);
    assert.equal(report.totals.bySeverity.error, 0, JSON.stringify(report.findings));
    assert.ok(code(report, "historical_reference_not_resolved").length >= 4);
    assert.equal(code(report, "legacy_quorum_requires_evidence_review")[0].certainty, "candidate");
    assert.ok(code(report, "attendance_quorum_count_review").length);
    assert.ok(code(report, "attendance_on_unheld_meeting_review").length);
    assert.ok(!JSON.stringify(report).includes(privateText));
    assert.ok(!JSON.stringify(report).includes("deletedImportedSource"));
    assert.ok(await input.verifyUnchanged());
  });
  await check("components are isolated and orphan source text is reported when workspace scope excludes it", async () => {
    const tables = base(); delete tables.meetingSources;
    const file = await native("components.zip", tables, { zip: true, extra: { "_components/example/meetings/documents.jsonl": JSON.stringify({ _id: "meet1", societyId: "s2", title: privateText }) } });
    const input = await loadIntegrityInput(file, { completeSnapshot: true });
    assert.deepEqual(input.otherComponents, ["_components/example"]);
    assert.equal(input.tables.get("meetings")?.[0].societyId, "s1");
    const report = auditMeetingIntegrity(input, { societyId: "s1" });
    assert.equal(code(report, "rows_with_unknown_workspace_excluded")[0].count, 1);
    const child = await loadIntegrityInput(file, { component: "_components/example" });
    assert.equal(child.tables.size, 1); assert.equal(child.tables.get("meetings")?.[0].societyId, "s2");
  });
  await check("Societyer archive v1/v2 chunks, bundled checksums and attachment links are supported", async () => {
    const tables = base();
    const database = { kind: "societyer.workspaceExport", version: 2, manifest: { societyId: "s1" }, tables };
    for (const version of [1, 2]) {
      const writer = new FixtureZipWriter();
      const descriptor = (path: string, payload: Uint8Array, extras: RecordRow = {}) => ({ path, bytes: payload.length, sha256: sha(payload), ...extras });
      let db: RecordRow;
      if (version === 1) {
        const payload = bytes(database); await writer.add("workspace.json", payload, { compress: false }); db = descriptor("workspace.json", payload);
      } else {
        const meta = bytes({ ...database, tables: undefined, tableNames: Object.keys(tables) });
        await writer.add("database/meta.json", meta);
        const chunks: RecordRow[] = [];
        for (const [table, rows] of Object.entries(tables)) {
          const payload = bytes(rows); const name = `database/${table}/0000.json`; await writer.add(name, payload);
          chunks.push(descriptor(name, payload, { table, rows: rows.length }));
        }
        db = { format: "chunked", meta: descriptor("database/meta.json", meta), chunks };
      }
      const body = bytes(privateText); await writer.add("files/private.pdf", body);
      const files = [{ status: "included", documentId: "doc1", versionId: "version1", archivePath: "files/private.pdf", bytes: body.length, sha256: sha(body) }];
      await writer.add("manifest.json", bytes({ kind: "societyer.workspaceArchive", version, database: db, tableCount: Object.keys(tables).length, rowCount: Object.values(tables).reduce((sum, rows) => sum + rows.length, 0), files }));
      const file = path.join(root, `workspace-v${version}.zip`); await writeFile(file, new Uint8Array(await (await writer.finish()).arrayBuffer()));
      const input = await loadIntegrityInput(file, { verifyFiles: true });
      assert.equal(input.tables.get("minutes")?.length, 1);
      assert.equal(input.binaryVerification, "checksummed");
      assert.equal(input.binaryFiles.checksummedEntries, 1);
      assert.equal(input.consistency, "non-atomic");
      assert.equal(input.issues.length, 0);
      assert.ok(await input.verifyUnchanged());
      assert.ok(!JSON.stringify(auditMeetingIntegrity(input)).includes(privateText));
    }
  });
  await check("local snapshots and legacy attachment manifests retain coverage and file failures", async () => {
    const directory = path.join(root, "legacy-archive"); await mkdir(directory);
    const tables = base();
    await writeFile(path.join(directory, "workspace-export.json"), JSON.stringify({ kind: "societyer.localWorkspaceSnapshot", tables, attachments: [{ documentId: "doc1", versionId: "version1" }] }));
    await writeFile(path.join(directory, "attachment-manifest.json"), JSON.stringify({ files: [{ source: "documentVersions", id: "version1", documentId: "doc1", ok: true, archivePath: "file.pdf", downloadedSha256: "bad" }] }));
    await writeFile(path.join(directory, "file.pdf"), privateText);
    const input = await loadIntegrityInput(directory, { verifyFiles: true });
    assert.equal(input.format, "local-workspace");
    assert.deepEqual(input.scope.societyIds, ["s1"]);
    assert.ok(code(auditMeetingIntegrity(input), "archive_file_checksum_mismatch").length);
    assert.ok(await input.verifyUnchanged());
  });
  await check("malformed/private input, traversal, symlinks and expansion limits fail safely", async () => {
    const file = path.join(root, "malformed.json"); await writeFile(file, `{"tables":${privateText}`);
    await assert.rejects(loadIntegrityInput(file), error => error instanceof Error && !error.message.includes(privateText) && error.message.includes("content omitted"));
    const nullFile = path.join(root, "null.json"); await writeFile(nullFile, "null");
    await assert.rejects(loadIntegrityInput(nullFile), /must be an object/);
    const writer = new FixtureZipWriter(); await writer.add("../meetings/documents.jsonl", bytes("{}"));
    const unsafe = path.join(root, "unsafe.zip"); await writeFile(unsafe, new Uint8Array(await (await writer.finish()).arrayBuffer()));
    await assert.rejects(loadIntegrityInput(unsafe), /unsafe path/);
    const link = path.join(root, "input-link"); await symlink(file, link);
    await assert.rejects(loadIntegrityInput(link), /symbolic link/);
    const valid = await native("limits", base());
    await assert.rejects(loadIntegrityInput(valid, { maxRecordBytes: 10 }), /byte limit/);
    await assert.rejects(loadIntegrityInput(valid, { maxRows: 1 }), /record-count limit/);
    await assert.rejects(loadIntegrityInput(valid, { maxFiles: 1 }), /file-count limit/);
  });
  await check("input hashes detect modification and truncated reports preserve full counts", async () => {
    const tables = base(); tables.documents = [];
    const file = await native("hash-change", tables);
    const input = await loadIntegrityInput(file, { completeSnapshot: true });
    const all = auditMeetingIntegrity(input); const limited = auditMeetingIntegrity(input, { maxFindings: 1 });
    assert.equal(limited.findings.length, 1); assert.equal(limited.findingsTruncated, true);
    assert.deepEqual(limited.totals, all.totals);
    await writeFile(path.join(file, "documents/documents.jsonl"), "{}\n");
    assert.equal(await input.verifyUnchanged(), false);
  });
  await check("CLI exits honestly, preserves bytes, writes new reports only and refuses input overwrites", async () => {
    const file = await native("cli.zip", base(), { zip: true });
    const before = sha(await readFile(file));
    const output = path.join(root, "cli-report.json");
    const good = runCLI(["--input", file, "--complete-snapshot", "--output", output]);
    assert.equal(good.status, 0, good.stderr);
    const report = JSON.parse(await readFile(output, "utf8")); assert.equal(report.inputUnchanged, true);
    assert.equal(report.input.sha256, before);
    assert.equal(sha(await readFile(file)), before);
    assert.equal(runCLI(["--input", file, "--output", output]).status, 2);
    assert.equal(runCLI(["--input", file, "--output", file]).status, 2);
    assert.equal(runCLI(["--input", file]).status, 3);
    const inside = path.join(root, "full", "report.json");
    assert.equal(runCLI(["--input", path.join(root, "full"), "--output", inside]).status, 2);
    const badTables = base(); badTables.minutes[0].motionIds.push("motion1");
    const bad = await native("cli-issues.zip", badTables, { zip: true });
    assert.equal(runCLI(["--input", bad, "--complete-snapshot"]).status, 1);
    assert.equal(runCLI(["--input", file, "--max-rows", "NaN"]).status, 2);
    assert.equal(runCLI(["--input", file, "--repair"]).status, 2);
    assert.equal(sha(await readFile(file)), before);
  });
  process.stdout.write(`Meeting integrity audit: ${passed} synthetic checks passed; no live data was accessed.\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
