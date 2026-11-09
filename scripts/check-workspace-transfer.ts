/**
 * Workspace transfer end to end on convex-test: a source deployment with two
 * workspaces is serialized into the Convex export ZIP layout, then one
 * workspace is planned, applied (with an interruption and resume), verified,
 * finalized and bound into a destination that already holds DDC North, whose
 * rows must stay byte-for-byte untouched. A second run is aborted.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { api } from "../convex/_generated/api";
import type { Id, TableNames } from "../convex/_generated/dataModel";
import schema from "../convex/schema";
import { StreamingZipWriter } from "../src/lib/zipStream";
import { ZipArchive } from "./lib/convexExportZip";
import {
  abortTransfer, applyTransfer, bindMemberships, finalizeTransfer, parseBindCsv, planTransfer, transferStatus, verifyTransfer,
  type PlanState, type TransferDestination,
} from "./lib/workspaceTransfer";
import { tableValidators } from "../shared/workspaceTransfer/validators";

const issuer = "https://transfer-destination.convex.site";
Object.assign(process.env, {
  AUTH_MODE: "convex", VITE_AUTH_MODE: "convex", CONVEX_SITE_URL: issuer, SITE_URL: "https://app.transfer.example",
  BETTER_AUTH_SECRET: "workspace-transfer-test-secret-000000000000000",
});
delete process.env.SOCIETYER_ENTRA_SSO_REQUIRED;

const modules = {
  "./_generated/api.js": () => import("../convex/_generated/api"),
  "./_generated/server.js": () => import("../convex/_generated/server"),
  "./workspaceTransfer.js": () => import("../convex/workspaceTransfer"),
  "./society.js": () => import("../convex/society"),
  "./users.js": () => import("../convex/users"),
  "./http.js": () => import("../convex/http"),
  "./notifications.js": () => import("../convex/notifications"),
  "./entraProvisioning.js": () => import("../convex/entraProvisioning"),
};
const validators = tableValidators(schema);
const tables = [...validators.keys()] as TableNames[];
const dir = mkdtempSync(join(tmpdir(), "workspace-transfer-"));
const now = "2026-11-01T00:00:00.000Z";
const encode = (text: string) => new TextEncoder().encode(text);
type Backend = ReturnType<typeof convexTest>;

// ---------------------------------------------------------------- ZIP64 reader
{
  // One stored entry whose sizes and offset live only in ZIP64 extra fields.
  const name = Buffer.from("t/documents.jsonl");
  const data = Buffer.from('{"_id":"a"}\n{"_id":"b"}\n');
  const { crc32 } = await import("node:zlib");
  const crc = crc32(data);
  const u64 = (n: number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
  const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
  const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
  const local = Buffer.concat([u32(0x04034b50), u16(45), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(0xffffffff), u32(0xffffffff),
    u16(name.length), u16(20), name, u16(1), u16(16), u64(data.length), u64(data.length), data]);
  const central = Buffer.concat([u32(0x02014b50), u16(45), u16(45), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(0xffffffff), u32(0xffffffff),
    u16(name.length), u16(28), u16(0), u16(0), u16(0), u32(0), u32(0xffffffff), name, u16(1), u16(24), u64(data.length), u64(data.length), u64(0)]);
  const zip64End = Buffer.concat([u32(0x06064b50), u64(44), u16(45), u16(45), u32(0), u32(0), u64(1), u64(1), u64(central.length), u64(local.length)]);
  const locator = Buffer.concat([u32(0x07064b50), u32(0), u64(local.length + central.length), u32(1)]);
  const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(0xffff), u16(0xffff), u32(0xffffffff), u32(0xffffffff), u16(0)]);
  const path = join(dir, "zip64.zip");
  writeFileSync(path, Buffer.concat([local, central, zip64End, locator, end]));
  const archive = await ZipArchive.open(path);
  const lines: string[] = [];
  for await (const line of archive.lines(archive.entries.get("t/documents.jsonl")!)) lines.push(line);
  assert.deepEqual(lines, ['{"_id":"a"}', '{"_id":"b"}'], "ZIP64 central directory and extra fields are read");
  await archive.close();
}

// ---------------------------------------------------------------- source deployment
const src = convexTest(schema, modules);
const source = await src.run(async (ctx) => {
  const firstForm = await ctx.db.insert("societies", { name: "First Form", isCharity: false, isMemberFunded: false, updatedAt: 1,
    publicSlug: "first-form", calendarFeedToken: "feed-bearer-secret" });
  const other = await ctx.db.insert("societies", { name: "Other Org", isCharity: true, isMemberFunded: false, updatedAt: 1 });
  const identity = await ctx.db.insert("externalIdentities", { issuer: "https://source.convex.site", subject: "src-owner", status: "Active", createdAtISO: now });
  // A legacy directory row without a workspace, used only by First Form: adopted.
  const person = await ctx.db.insert("peopleDirectory", { fullName: "Ada Owner", searchName: "ada owner", createdAtISO: now, updatedAtISO: now });
  const member = await ctx.db.insert("members", { societyId: firstForm, firstName: "Ada", lastName: "Owner", membershipClass: "Voting", status: "Active",
    joinedAt: "2020-01-01", votingRights: true, directoryPersonId: person });
  const director = await ctx.db.insert("directors", { societyId: firstForm, firstName: "Ada", lastName: "Owner", position: "Chair", isBCResident: true,
    termStart: "2024-01-01", consentOnFile: true, status: "Active", directoryPersonId: person, memberId: member });
  const owner = await ctx.db.insert("users", { societyId: firstForm, email: "ada@firstform.test", displayName: "Ada", role: "Owner", status: "Active",
    authIssuer: "https://source.convex.site", authSubject: "src-owner", authProvider: "convex", externalIdentityId: identity,
    memberId: member, directorId: director, createdAtISO: now, lastLoginAtISO: now, emailVerifiedAtISO: now });
  const viewer = await ctx.db.insert("users", { societyId: firstForm, email: "bo@firstform.test", displayName: "Bo", role: "Viewer", status: "Active", createdAtISO: now });
  const disabled = await ctx.db.insert("users", { societyId: firstForm, email: "cy@firstform.test", displayName: "Cy", role: "Director", status: "Disabled", createdAtISO: now });
  const otherUser = await ctx.db.insert("users", { societyId: other, email: "x@other.test", displayName: "X", role: "Owner", status: "Active", createdAtISO: now });
  const otherCommittee = await ctx.db.insert("committees", { societyId: other, name: "Other board", cadence: "Monthly", color: "blue", status: "Active", createdAtISO: now });
  // Cross-workspace reference: must block the plan.
  const meeting = await ctx.db.insert("meetings", { societyId: firstForm, type: "Board", title: "Board meeting", scheduledAt: "2026-10-01T18:00:00Z",
    electronic: true, status: "Held", attendeeIds: [member], committeeId: otherCommittee });
  const minutes = await ctx.db.insert("minutes", { societyId: firstForm, meetingId: meeting, heldAt: "2026-10-01T18:00:00Z", attendees: ["Ada"], absent: [],
    quorumMet: true, discussion: "Adopted the budget.", decisions: [], actionItems: [] });
  await ctx.db.patch(meeting, { minutesId: minutes });
  const agenda = await ctx.db.insert("agendas", { societyId: firstForm, meetingId: meeting, title: "Agenda", status: "Final", updatedAtISO: now, createdAtISO: now });
  await ctx.db.insert("agendaItems", { societyId: firstForm, agendaId: agenda, order: 0, type: "motion", title: "Adopt budget", createdAtISO: now });
  const file = await ctx.storage.store(new Blob(["%PDF minutes bytes"], { type: "application/pdf" }));
  const looseFile = await ctx.storage.store(new Blob(["second version bytes"]));
  const otherFile = await ctx.storage.store(new Blob(["other org file"]));
  await ctx.db.insert("storageOwnership", { storageId: file, societyId: firstForm, createdAtISO: now });
  await ctx.db.insert("storageOwnership", { storageId: otherFile, societyId: other, createdAtISO: now });
  const document = await ctx.db.insert("documents", { societyId: firstForm, title: "Minutes", category: "Minutes", createdAtISO: now,
    flaggedForDeletion: false, tags: ["board"], storageId: file, meetingId: meeting });
  await ctx.db.insert("documentVersions", { societyId: firstForm, documentId: document, version: 1, storageProvider: "convex", storageKey: file,
    fileName: "minutes.pdf", uploadedAtISO: now, isCurrent: false });
  // A file referenced only by a string field.
  await ctx.db.insert("documentVersions", { societyId: firstForm, documentId: document, version: 2, storageProvider: "convex", storageKey: looseFile,
    fileName: "minutes-v2.pdf", uploadedAtISO: now, isCurrent: true });
  await ctx.db.insert("documents", { societyId: other, title: "Other", category: "Other", createdAtISO: now, flaggedForDeletion: false, tags: [], storageId: otherFile });
  const recording = await ctx.db.insert("meetingSources", { societyId: firstForm, meetingId: meeting, actorId: owner, fileName: "rec.m4a", size: 10, kind: "audio",
    fingerprint: "fp", status: "complete", offset: 10, createdAt: 1, remoteName: "rec.m4a", hashes: [], verifiedOffset: 10,
    uploadUrl: "https://upload.example/session-secret", lease: "lease-1", leaseUntil: 5 });
  await ctx.db.insert("meetingSourceText", { sourceId: recording, index: 0, text: "Call to order." });
  await ctx.db.insert("notificationPrefs", { userId: owner, channel: "email", kind: "digest", enabled: true });
  const connection = await ctx.db.insert("financialConnections", { societyId: firstForm, provider: "demo", status: "connected", connectedAtISO: now, demo: true });
  const bank = await ctx.db.insert("financialAccounts", { societyId: firstForm, connectionId: connection, externalId: "bank", name: "Bank", currency: "CAD",
    accountType: "Asset", balanceCents: 0, isRestricted: false });
  const revenue = await ctx.db.insert("financialAccounts", { societyId: firstForm, connectionId: connection, externalId: "rev", name: "Revenue", currency: "CAD",
    accountType: "Income", balanceCents: 0, isRestricted: false, parentAccountId: bank });
  const entry = await ctx.db.insert("journalEntries", { societyId: firstForm, date: "2026-10-02", memo: "Grant", source: "manual", status: "posted", createdAtISO: now, updatedAtISO: now });
  await ctx.db.insert("journalLines", { societyId: firstForm, journalEntryId: entry, accountId: bank, lineOrder: 0, amountCents: 12345, side: "debit", createdAtISO: now, updatedAtISO: now });
  await ctx.db.insert("journalLines", { societyId: firstForm, journalEntryId: entry, accountId: revenue, lineOrder: 1, amountCents: 12345, side: "credit", createdAtISO: now, updatedAtISO: now });
  await ctx.db.insert("spendBudgets", { societyId: firstForm, name: "Board", limitCents: 5000, currency: "CAD", cycle: "monthly", startDate: "2026-01-01",
    memberUserIds: [owner, viewer], createdAtISO: now, updatedAtISO: now });
  await ctx.db.insert("workflows", { societyId: firstForm, recipe: "insurance_renewal", name: "Renewal", status: "active", trigger: { kind: "cron", cron: "0 8 * * *" },
    scheduleEnabled: true, nextRunAtISO: now, createdByUserId: owner,
    scheduleAuthorization: { version: 1, authorizerUserId: owner, authIssuer: "https://source.convex.site", authSubject: "src-owner",
      externalIdentityId: identity, authorizedAtISO: now, expiresAtISO: now, definitionFingerprint: "fp" } });
  const client = await ctx.db.insert("apiClients", { societyId: firstForm, name: "Zapier", kind: "integration", status: "active", createdAtISO: now, updatedAtISO: now });
  const token = await ctx.db.insert("apiTokens", { societyId: firstForm, clientId: client, name: "t", tokenHash: "hash", tokenStart: "soc_", scopes: [], status: "active", createdAtISO: now });
  await ctx.db.insert("agentGrants", { societyId: firstForm, userId: owner, name: "Claude", scopes: [], createdAtISO: now, expiresAtISO: now, tokenHash: "grant-hash" });
  await ctx.db.insert("invitations", { societyId: firstForm, email: "new@firstform.test", role: "Member", createdAtISO: now, tokenHash: "invite-hash" });
  await ctx.db.insert("secretVaultItems", { societyId: firstForm, name: "CRA login", service: "CRA", credentialType: "password", storageMode: "stored_encrypted",
    status: "Active", sensitivity: "restricted", accessLevel: "restricted", createdAtISO: now, updatedAtISO: now, secretEncrypted: "v1:cipher", secretPreview: "••12" });
  await ctx.db.insert("activity", { societyId: firstForm, actor: "Ada", entityType: "meeting", entityId: meeting, subjectId: meeting, action: "approved",
    summary: `Approved ${JSON.stringify({ documentId: document, by: owner })}`, createdAtISO: now });
  await ctx.db.insert("activity", { societyId: firstForm, actor: "Ada", entityType: "apiToken", entityId: token, action: "created", summary: "Created a token", createdAtISO: now });
  // Enough rows that inserts, verification, export pages and abort all span several pages.
  for (let index = 0; index < 230; index++) {
    await ctx.db.insert("activity", { societyId: firstForm, actor: "Ada", entityType: "meeting", entityId: meeting, action: "viewed", summary: `View ${index}`, createdAtISO: now });
    await ctx.db.insert("activity", { societyId: other, actor: "X", entityType: "user", entityId: otherUser, action: "viewed", summary: `View ${index}`, createdAtISO: now });
  }
  const procurementRun = await ctx.db.insert("procurementSyncRuns", { societyId: firstForm, baseHash: "a", targetHash: "b", planHash: "c", operations: 1,
    counts: {}, applied: 0, nextBatch: 0, completed: false, changedAt: 1 });
  return { firstForm, other, owner, viewer, disabled, otherUser, meeting, document, file, looseFile, otherFile, procurementRun, token };
});

async function writeExport(t: Backend, path: string) {
  const zip = new StreamingZipWriter();
  await zip.add("README.md", encode("# Welcome to your Convex snapshot export!\n"));
  for (const table of tables) {
    const rows = await t.run((ctx) => ctx.db.query(table).collect());
    if (!rows.length) continue;
    await zip.add(`${table}/documents.jsonl`, encode(rows.map((row) => JSON.stringify(row)).join("\n") + "\n"));
    await zip.add(`${table}/generated_schema.jsonl`, encode(`${JSON.stringify("inferred shape")}\n`));
  }
  const files = await t.run((ctx) => ctx.db.system.query("_storage").collect());
  await zip.add("_storage/documents.jsonl", encode(files.map((file) => JSON.stringify({ ...file, ...(file.contentType ? {} : { contentType: "application/pdf" }) })).join("\n") + "\n"));
  for (const file of files) {
    const bytes = await t.run(async (ctx) => (await ctx.storage.get(file._id))?.arrayBuffer() ?? null);
    assert.ok(bytes, "stored blob is readable");
    await zip.add(`_storage/${file._id}${file === files[0] ? ".pdf" : ""}`, new Uint8Array(bytes));
  }
  await zip.add("_components/betterAuth/user/documents.jsonl", encode('{"_id":"ba1","email":"ada@firstform.test"}\n'));
  writeFileSync(path, Buffer.from(await zip.finish().arrayBuffer()));
}

// ---------------------------------------------------------------- plan
const blockedZip = join(dir, "blocked.zip");
await writeExport(src, blockedZip);
const blocked = await planTransfer(blockedZip, source.firstForm, validators);
const codes = (state: PlanState, severity: string) => state.report.findings.filter((f) => f.severity === severity).map((f) => `${f.code}:${f.table ?? ""}`);
assert.equal(blocked.report.ok, false);
assert.ok(codes(blocked, "blocking").includes("CROSS_WORKSPACE_REF:meetings"), "a reference into another workspace blocks the plan");
assert.ok(codes(blocked, "blocking").includes("IN_FLIGHT:procurementSyncRuns"), "an unfinished sync run blocks the plan");
await blocked.archive.close();
const tsx = "./node_modules/.bin/tsx";
const cliBlocked = spawnSync(tsx, ["scripts/workspace-transfer.ts", "plan", "--export", blockedZip, "--society", source.firstForm], { encoding: "utf8" });
assert.equal(cliBlocked.status, 1, "CLI plan exits 1 when blocked");
assert.match(cliBlocked.stdout, /CROSS_WORKSPACE_REF/);

await src.run(async (ctx) => {
  await ctx.db.patch(source.meeting, { committeeId: undefined });
  await ctx.db.patch(source.procurementRun, { completed: true });
});
const exportZip = join(dir, "firstform.zip");
await writeExport(src, exportZip);
const planOut = join(dir, "plan.json");
const cliPlan = spawnSync(tsx, ["scripts/workspace-transfer.ts", "plan", "--export", exportZip, "--society", source.firstForm, "--out", planOut], { encoding: "utf8" });
assert.equal(cliPlan.status, 0, cliPlan.stdout + cliPlan.stderr);
assert.match(cliPlan.stdout, /Plan OK/);
const cliKey = spawnSync(tsx, ["scripts/workspace-transfer.ts", "status", "--url", "https://x.convex.cloud", "--admin-key-env", "prod|abc", "--run", "r"], { encoding: "utf8" });
assert.equal(cliKey.status, 1);
assert.match(cliKey.stderr, /variable NAME/, "a key pasted as --admin-key-env is refused, not used");

const plan = await planTransfer(exportZip, source.firstForm, validators);
const report = plan.report;
assert.equal(report.ok, true, JSON.stringify(report.findings.filter((f) => f.severity === "blocking")));
assert.equal(report.sourceSocietyName, "First Form");
assert.equal(report.files.count, 2, "the typed file and the string-held file move; the other workspace's file doesn't");
assert.equal(report.tables.users.copied, 3);
assert.equal(report.tables.peopleDirectory.adopted, 1, "the legacy directory row is adopted into the workspace");
assert.equal(report.tables.meetingSourceText.copied, 1, "child rows without societyId follow their parent");
assert.equal(report.tables.notificationPrefs.copied, 1);
for (const table of ["apiTokens", "apiClients", "agentGrants", "invitations", "storageOwnership"]) assert.ok(report.tables[table].excluded >= 1 && report.tables[table].copied === 0, `${table} is excluded`);
assert.equal(report.tables.workflows.policy, "copy-disabled");
assert.ok(codes(plan, "warning").includes("UNMAPPED_ID_STRING:activity"), "a string holding an excluded token id is reported");
assert.ok(codes(plan, "info").includes("COMPONENT_NOT_COPIED:betterAuth"));
assert.ok((report.stringRewrites["activity.entityId"] ?? 0) >= 1 && (report.stringRewrites["documentVersions.storageKey"] ?? 0) === 2);
assert.deepEqual(report.totals.journalLines, { debit: { amountCents: 12345, rows: 1 }, credit: { amountCents: 12345, rows: 1 } });
assert.ok(![...plan.rows.values()].some((row) => row.doc.societyId === source.other || row.id === source.otherUser), "nothing of the other workspace is selected");

// ---------------------------------------------------------------- destination with DDC North
const dst = convexTest(schema, modules);
const ddc = await dst.run(async (ctx) => {
  const society = await ctx.db.insert("societies", { name: "DDC North", isCharity: true, isMemberFunded: false, updatedAt: 1, publicSlug: "ddc-north" });
  const identity = await ctx.db.insert("externalIdentities", { issuer, subject: "ddc-owner", status: "Active", createdAtISO: now });
  const owner = await ctx.db.insert("users", { societyId: society, email: "dee@ddc.test", displayName: "Dee", role: "Owner", status: "Active",
    authIssuer: issuer, authSubject: "ddc-owner", authProvider: "convex", externalIdentityId: identity, createdAtISO: now });
  const meeting = await ctx.db.insert("meetings", { societyId: society, type: "Board", title: "DDC board", scheduledAt: now, electronic: false, status: "Held", attendeeIds: [] });
  const file = await ctx.storage.store(new Blob(["ddc file"]));
  await ctx.db.insert("storageOwnership", { storageId: file, societyId: society, createdAtISO: now });
  await ctx.db.insert("documents", { societyId: society, title: "DDC bylaws", category: "Bylaws", createdAtISO: now, flaggedForDeletion: false, tags: [], storageId: file });
  await ctx.db.insert("activity", { societyId: society, actor: "Dee", entityType: "meeting", entityId: meeting, action: "created", summary: "DDC", createdAtISO: now });
  return { society, owner, meeting };
});

async function snapshot(t: Backend): Promise<Map<string, string>> {
  const rows = new Map<string, string>();
  for (const table of tables) for (const row of await t.run((ctx) => ctx.db.query(table).collect())) rows.set(row._id, JSON.stringify(row));
  for (const file of await t.run((ctx) => ctx.db.system.query("_storage").collect())) rows.set(file._id, JSON.stringify(file));
  return rows;
}
const assertUntouched = async (before: Map<string, string>, label: string) => {
  const after = await snapshot(dst);
  for (const [id, json] of before) assert.equal(after.get(id), json, `${label}: existing row ${id} is unchanged`);
};
const ddcBefore = await snapshot(dst);

const dest: TransferDestination = {
  query: (name, args) => dst.query(makeFunctionReference<"query">(name), args),
  mutation: (name, args) => dst.mutation(makeFunctionReference<"mutation">(name), args),
  uploadFile: (_runId, bytes, contentType) => dst.run((ctx) => ctx.storage.store(new Blob([bytes as BlobPart], { type: contentType ?? "" }))),
};
const fn = <T>(name: string, args: Record<string, unknown>) => dst.mutation(makeFunctionReference<"mutation">(name), args) as Promise<T>;

// ---------------------------------------------------------------- apply, interrupted and resumed
await assert.rejects(applyTransfer(plan, dest, { label: "ff-1", sourceDeployment: "elated-bee-460", failAfterWrites: 4 }), /Simulated interruption/);
const partial = await transferStatus(dest, "ff-1");
assert.equal(partial.status, "applying");
assert.ok(partial.insertedRows > 0 && partial.insertedRows < report.rows, "the interruption left a partial run");
const runId = partial._id;
const societyItem = { table: "societies", sourceId: source.firstForm, doc: {} };
const replay = await fn<Array<{ inserted: boolean }>>("workspaceTransfer:insertBatch", { runId, items: [societyItem] });
assert.equal(replay[0].inserted, false, "an already-mapped row is never inserted twice");
await assert.rejects(fn("workspaceTransfer:insertBatch", { runId, items: [{ table: "apiTokens", sourceId: "x", doc: {} }] }), /not copied/);
await assert.rejects(fn("workspaceTransfer:insertBatch", { runId, items: [{ table: "users", sourceId: "y",
  doc: { societyId: ddc.society, email: "e", displayName: "E", role: "Owner", status: "Active", createdAtISO: now } }] }), /not the transferred workspace/);
await assert.rejects(applyTransfer(plan, dest, { label: "ff-other", sourceDeployment: "x" }), /already transfers this workspace/);

const applied = await applyTransfer(plan, dest, { label: "ff-1", sourceDeployment: "elated-bee-460" });
assert.equal(applied.runId, runId);
const run = await transferStatus(dest, "ff-1");
assert.equal(run.status, "applied");
assert.equal(run.insertedRows, report.rows);
assert.equal(run.uploadedFiles, 2);
const destSociety = run.destSocietyId as Id<"societies">;
await assertUntouched(ddcBefore, "after apply");

const inWorkspace = await dst.run(async (ctx) => ({
  society: await ctx.db.get(destSociety),
  users: await ctx.db.query("users").withIndex("by_society", (q) => q.eq("societyId", destSociety)).collect(),
  members: await ctx.db.query("members").withIndex("by_society", (q) => q.eq("societyId", destSociety)).collect(),
  meetings: await ctx.db.query("meetings").withIndex("by_society", (q) => q.eq("societyId", destSociety)).collect(),
  minutes: await ctx.db.query("minutes").collect(),
  documents: await ctx.db.query("documents").withIndex("by_society", (q) => q.eq("societyId", destSociety)).collect(),
  versions: await ctx.db.query("documentVersions").collect(),
  workflows: await ctx.db.query("workflows").collect(),
  vault: await ctx.db.query("secretVaultItems").collect(),
  sources: await ctx.db.query("meetingSources").collect(),
  sourceText: await ctx.db.query("meetingSourceText").collect(),
  prefs: await ctx.db.query("notificationPrefs").collect(),
  people: await ctx.db.query("peopleDirectory").collect(),
  activity: await ctx.db.query("activity").withIndex("by_society", (q) => q.eq("societyId", destSociety)).collect(),
  tokens: await ctx.db.query("apiTokens").collect(),
  grants: await ctx.db.query("agentGrants").collect(),
  invitations: await ctx.db.query("invitations").collect(),
  claims: await ctx.db.query("storageOwnership").collect(),
  budgets: await ctx.db.query("spendBudgets").collect(),
}));
const { society, users } = inWorkspace;
assert.ok(society?.transferQuarantinedAtISO, "the workspace is quarantined until finalize");
assert.equal(society?.publicSlug, undefined, "the public slug is held back");
assert.equal(society?.calendarFeedToken, undefined, "the calendar feed bearer token is not copied");
assert.equal(users.length, 3, "no duplicate memberships after resume");
for (const user of users) for (const field of ["authSubject", "authIssuer", "authProvider", "externalIdentityId", "lastLoginAtISO", "emailVerifiedAtISO"]) {
  assert.equal((user as Record<string, unknown>)[field], undefined, `imported membership has no ${field}`);
}
const ownerRow = users.find((user) => user.email === "ada@firstform.test")!;
assert.equal(ownerRow.role, "Owner");
assert.equal(users.find((user) => user.email === "cy@firstform.test")?.status, "Disabled", "status is kept");
const [meetingRow] = inWorkspace.meetings;
const minutesRow = inWorkspace.minutes.find((row) => row.meetingId === meetingRow._id);
assert.ok(minutesRow && meetingRow.minutesId === minutesRow._id, "the optional meeting→minutes cycle is rewritten in pass 2");
assert.deepEqual(meetingRow.attendeeIds, inWorkspace.members.map((row) => row._id), "string-held member ids are rewritten");
const docRow = inWorkspace.documents[0];
assert.equal(docRow.meetingId, meetingRow._id);
const storageClaims = inWorkspace.claims.filter((claim) => claim.societyId === destSociety);
assert.equal(storageClaims.length, 2, "both copied files are claimed for the workspace");
assert.ok(storageClaims.some((claim) => claim.storageId === docRow.storageId));
const versions = inWorkspace.versions.filter((row) => row.societyId === destSociety);
assert.ok(versions.every((row) => storageClaims.some((claim) => claim.storageId === row.storageKey)), "string-held storage ids are rewritten");
const copiedBytes = await dst.run(async (ctx) => (await ctx.storage.get(docRow.storageId!))?.text());
assert.equal(copiedBytes, "%PDF minutes bytes");
const workflow = inWorkspace.workflows[0];
assert.equal(workflow.scheduleEnabled, false);
assert.equal(workflow.scheduleAuthorization, undefined);
assert.equal(workflow.nextRunAtISO, undefined);
assert.equal(workflow.createdByUserId, ownerRow._id);
const vault = inWorkspace.vault[0];
assert.equal(vault.secretEncrypted, undefined);
assert.equal(vault.status, "NeedsReview");
assert.equal(inWorkspace.sources[0].uploadUrl, undefined);
assert.equal(inWorkspace.sources[0].lease, undefined);
assert.equal(inWorkspace.sourceText[0].sourceId, inWorkspace.sources[0]._id, "child row follows its parent");
assert.equal(inWorkspace.prefs[0].userId, ownerRow._id);
assert.equal(inWorkspace.people[0].societyId, destSociety, "adopted directory row belongs to the workspace");
assert.deepEqual(inWorkspace.budgets[0].memberUserIds.slice().sort(), users.filter((u) => u.role !== "Director").map((u) => u._id).sort());
const approved = inWorkspace.activity.find((row) => row.action === "approved")!;
assert.equal(approved.entityId, meetingRow._id, "string-held entityId is rewritten");
assert.ok(approved.summary.includes(docRow._id) && approved.summary.includes(ownerRow._id) && !approved.summary.includes(source.document), "ids inside JSON text are rewritten");
assert.equal(inWorkspace.activity.find((row) => row.entityType === "apiToken")?.entityId, source.token, "an excluded row's id is left (and was reported)");
assert.equal(inWorkspace.tokens.length + inWorkspace.grants.length + inWorkspace.invitations.length, 0, "credentials are not copied");
const scheduled = await dst.query(makeFunctionReference<"query">("notifications:societyIds"), {}) as string[];
assert.ok(scheduled.includes(ddc.society) && !scheduled.includes(destSociety), "digest and alert crons skip the quarantined workspace");

// ---------------------------------------------------------------- verify, corrupt, verify
const verified = await verifyTransfer(plan, dest, "ff-1");
assert.equal(verified.ok, true, JSON.stringify({ server: verified.serverIssues, problems: verified.problems }));
assert.deepEqual(verified.totals.destination, verified.totals.source);
assert.equal(verified.files.verified, 2);
await dst.run((ctx) => ctx.db.patch(docRow._id, { meetingId: ddc.meeting }));
const corrupted = await verifyTransfer(plan, dest, "ff-1");
assert.equal(corrupted.ok, false);
assert.ok(corrupted.serverIssues.some((issue) => /documents\.meetingId references a meetings row this transfer did not write/.test(issue)), corrupted.serverIssues.join("\n"));
assert.ok(corrupted.problems.some((problem) => problem.includes("meetingId")));
await assert.rejects(finalizeTransfer(dest, "ff-1", false), /passing verify/);
await dst.run((ctx) => ctx.db.patch(docRow._id, { meetingId: meetingRow._id }));
const strayId = await dst.run((ctx) => ctx.db.insert("activity", { societyId: destSociety, actor: "?", entityType: "x", action: "x", summary: "stray", createdAtISO: now }));
const stray = await verifyTransfer(plan, dest, "ff-1");
assert.ok(stray.problems.some((problem) => problem.startsWith("activity:")), "a row the run didn't write fails verification");
await dst.run((ctx) => ctx.db.delete(strayId));
assert.equal((await verifyTransfer(plan, dest, "ff-1")).ok, true);

// ---------------------------------------------------------------- finalize and bind
const csv = (lines: string[]) => parseBindCsv(["sourceUserId,authIssuer,authSubject,reason", ...lines].join("\n"));
assert.match((await bindMemberships(dest, "ff-1", csv([`${source.owner},${issuer},ba-ada,checked`]), undefined))[0].message, /Finalize/);
const directory = (args: Record<string, unknown>) => fn<{ membershipId: string; role: string }>("entraProvisioning:ensureDirectoryMembership",
  { societyId: destSociety, name: "Bo", ...args });
const viewerRow = users.find((user) => user.email === "bo@firstform.test")!;
await assert.rejects(directory({ authUserId: "ba-bo-ms", email: "bo@firstform.test" }), /still being transferred/, "Entra provisioning can't add a Viewer to a quarantined workspace");
const finalized = await finalizeTransfer(dest, "ff-1", false);
await assert.rejects(directory({ authUserId: "ba-bo-ms", email: "someone@firstform.test", transferredMembership: { runId, userId: viewerRow._id, reason: "r" } }),
  /not this directory user/);
const provisioned = await directory({ authUserId: "ba-bo-ms", email: "BO@firstform.test", transferredMembership: { runId, userId: viewerRow._id, reason: "Entra roster" } });
assert.deepEqual(provisioned, { membershipId: viewerRow._id, role: "Viewer" }, "Entra provisioning binds the imported membership instead of adding one");
assert.equal(finalized.publicSlug, "first-form");
assert.equal((await dst.run((ctx) => ctx.db.get(destSociety)))?.transferQuarantinedAtISO, undefined);
const results = await bindMemberships(dest, "ff-1", csv([
  `${source.owner},${issuer},ba-ada,Ada confirmed by phone`,
  `bo@firstform.test,${issuer},ba-bo`,
  `${source.owner},${issuer},ba-ada-2,again`,
  `${source.disabled},${issuer},ba-ada,same identity`,
  `${source.disabled},https://elsewhere.example,ba-cy,wrong issuer`,
  `nobody@firstform.test,${issuer},ba-z,missing`,
  `${source.otherUser},${issuer},ba-x,other workspace`,
  `${source.disabled},${issuer},ddc-owner`,
]), "operator confirmed in person");
const outcome = results.map((result) => `${result.ok ? "ok" : "no"}:${result.message}`);
assert.match(outcome[0], /^ok:bound Owner/);
assert.match(outcome[1], /^no:.*already bound/, "bound through Entra provisioning above");
assert.match(outcome[2], /^no:.*already bound/);
assert.match(outcome[3], /^no:.*already has a membership in this workspace/);
assert.match(outcome[4], /^no:.*CONVEX_SITE_URL/);
assert.match(outcome[5], /^no:No imported membership/);
assert.match(outcome[6], /^no:No imported membership/, "a row outside the run can't be bound");
assert.match(outcome[7], /^ok:bound Director \(Disabled\)/, "a DDC login can hold a second workspace's membership; Disabled stays Disabled; the --reason fallback applies");
const claims = (subject: string) => ({ issuer, subject, tokenIdentifier: `${issuer}|${subject}`, email: `${subject}@example.test`, emailVerified: true,
  "societyer_session.id": `session-${subject}`, "societyer_session.createdAt": Date.now() - 60_000 });
const reachable = async (subject: string, id: Id<"societies">) => {
  try { return (await dst.withIdentity(claims(subject)).query(api.society.getById, { id }))._id === id; } catch { return false; }
};
assert.equal(await reachable("ba-ada", destSociety), true, "the bound owner opens the transferred workspace");
assert.equal(await reachable("ba-ada", ddc.society), false, "and not DDC");
assert.equal(await reachable("ddc-owner", ddc.society), true, "DDC keeps working");
assert.equal(await reachable("src-owner", destSociety), false, "the source login binding was not carried over");
await assertUntouched(ddcBefore, "after finalize and bind");
await assert.rejects(abortTransfer(dest, "ff-1"), /only for unfinalized runs/);

// ---------------------------------------------------------------- a second run, aborted
const beforeSecond = await snapshot(dst);
const otherPlan = await planTransfer(exportZip, source.other, validators);
assert.equal(otherPlan.report.ok, true, JSON.stringify(otherPlan.report.findings));
assert.equal(otherPlan.report.files.count, 1);
await applyTransfer(otherPlan, dest, { label: "other-1", sourceDeployment: "elated-bee-460" });
const second = await transferStatus(dest, "other-1");
assert.ok(second.destSocietyId && second.destSocietyId !== destSociety);
const deleted = await abortTransfer(dest, "other-1");
assert.equal(deleted, otherPlan.report.rows + otherPlan.report.files.count);
assert.equal((await transferStatus(dest, "other-1")).status, "aborted");
const afterAbort = await snapshot(dst);
for (const id of afterAbort.keys()) {
  if (!beforeSecond.has(id)) {
    const row = JSON.parse(afterAbort.get(id)!) as { label?: string; status?: string };
    assert.ok(row.label === "other-1" && row.status === "aborted", `abort left ${id} behind`);
  }
}
for (const [id, json] of beforeSecond) {
  assert.equal(afterAbort.get(id), json, `abort touched ${id}`);
}
await assertUntouched(ddcBefore, "after abort");

rmSync(dir, { recursive: true, force: true });
await plan.archive.close();
await otherPlan.archive.close();
console.log(`workspace transfer: ${report.rows} rows and ${report.files.count} files moved, resumed after an interruption, verified, finalized and bound; a second run aborted cleanly`);
