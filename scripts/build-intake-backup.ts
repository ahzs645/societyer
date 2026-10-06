import type { PortableDoc } from "../shared/portable/ctx";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { StaticConvexClient } from "../src/lib/staticConvex";
import { assertImportBundlePreflight } from "../shared/importBundlePreflight";

/** Build an isolated review workspace; never approve or apply extracted records. */
export async function buildIntakeBackup(organization: Record<string, unknown>, bundles: unknown[]) {
  for (const field of ["name", "jurisdictionCode", "entityType"]) {
    if (typeof organization?.[field] !== "string" || !String(organization[field]).trim()) {
      throw new Error(`Organization must explicitly provide ${field}.`);
    }
  }
  if (!bundles.length) throw new Error("At least one import bundle is required.");
  for (const bundle of bundles) assertImportBundlePreflight(bundle);
  const societyId = `intake_society_${randomUUID()}`;
  const client = new StaticConvexClient({
    databaseName: `societyer-intake-${randomUUID()}`,
    seed: { societies: [{ ...organization, _id: societyId, _creationTime: Date.now() }] },
  });
  await client.whenLocalWorkspaceReady();
  // Await metadata explicitly: constructor seeding is asynchronous.
  await client.mutation("seedRecordTableMetadata:ensureForSociety", { societyId });
  const sessionIds: string[] = [];
  for (const bundle of bundles) {
    sessionIds.push(await client.mutation("importSessions:createFromBundle", { societyId, bundle }));
  }
  const snapshot = client.exportLocalWorkspaceSnapshot();
  snapshot.workspace.name = `${organization.name} — document intake review`;
  const restored = new StaticConvexClient({ seed: { societies: [] }, databaseName: `verify-intake-${randomUUID()}` });
  await restored.importLocalWorkspaceSnapshot(JSON.parse(JSON.stringify(snapshot)));
  const restoredDocuments = new Map((restored.exportLocalWorkspaceSnapshot().tables.documents ?? []).map((row) => [row._id, row]));
  for (const document of snapshot.tables.documents ?? []) {
    const recovered = restoredDocuments.get(document._id);
    assert.equal(recovered?.content, document.content, "Backup roundtrip changed serialized source evidence.");
  }
  let recordCount = 0;
  for (const sessionId of sessionIds) {
    const original = await client.query("importSessions:get", { sessionId });
    const session = await restored.query("importSessions:get", { sessionId });
    if (!session?.records?.length || session.records.some((record: PortableDoc) => record.status !== "Pending")) {
      throw new Error("Backup roundtrip did not preserve Pending review records.");
    }
    // Compare the complete persisted staged payload, not merely summary counts.
    const contents = (value: { records: PortableDoc[] }) => value.records.map((record: PortableDoc) => ({
      id: record._id,
      payload: record.payload,
      sourceExternalIds: record.sourceExternalIds,
      status: record.status,
      reviewNotes: record.reviewNotes,
      importedTargets: record.importedTargets,
      recordKind: record.recordKind,
      targetModule: record.targetModule,
      confidence: record.confidence,
      riskFlags: record.riskFlags,
    }));
    assert.deepEqual(contents(session), contents(original), "Backup roundtrip changed staged records.");
    recordCount += session.records.length;
  }
  return { snapshot, societyId, sessionIds, recordCount };
}

async function main() {
  const args = process.argv.slice(2);
  const bundles: string[] = [];
  let organizationPath: string | undefined;
  let outputPath: string | undefined;
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}.`);
    if (flag === "--bundle") bundles.push(value);
    else if (flag === "--organization") organizationPath = value;
    else if (flag === "--out") outputPath = value;
    else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!organizationPath || !outputPath || !bundles.length) {
    throw new Error("Usage: npx tsx scripts/build-intake-backup.ts --organization organization.json --bundle bundle.json [--bundle more.json] --out backup.json");
  }
  const organization = JSON.parse(await readFile(organizationPath, "utf8"));
  const inputs = await Promise.all(bundles.map(async (file) => JSON.parse(await readFile(file, "utf8"))));
  const result = await buildIntakeBackup(organization, inputs);
  // Never overwrite an existing backup or input file.
  await writeFile(outputPath, JSON.stringify(result.snapshot, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ output: resolve(outputPath), sessions: result.sessionIds.length, pendingRecords: result.recordCount, attachmentBytesIncluded: false }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
