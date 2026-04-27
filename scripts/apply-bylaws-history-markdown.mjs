import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { config } from "dotenv";

config({ path: path.join(process.cwd(), ".env.local"), quiet: true });
config({ quiet: true });

const api = anyApi;
const SOCIETY_NAME = "Over the Edge Newspaper Society";
const BUNDLE_PATH = path.join(process.cwd(), "imports", "bylaws-history-markdown", "bylaw-import-bundle.json");
const SESSION_NAME = "OTE bylaws history Markdown import";
const DRY_RUN = process.argv.includes("--dry-run");

const url =
  process.env.VITE_CONVEX_URL ??
  process.env.CONVEX_SELF_HOSTED_URL ??
  process.env.CONVEX_URL;

if (!url) throw new Error("Missing VITE_CONVEX_URL / CONVEX_SELF_HOSTED_URL / CONVEX_URL.");
if (!existsSync(BUNDLE_PATH)) throw new Error(`Bundle not found: ${BUNDLE_PATH}`);

const client = new ConvexHttpClient(url);
const bundle = JSON.parse(readFileSync(BUNDLE_PATH, "utf8"));

const societies = await client.query(api.society.list, {});
const society = societies.find((row) => row.name === SOCIETY_NAME);
if (!society) throw new Error(`Society not found: ${SOCIETY_NAME}`);

console.log(`${DRY_RUN ? "Dry run: " : ""}${society.name} (${society._id})`);

const existingAmendments = await client.query(api.bylawAmendments.list, { societyId: society._id });
const existingSourceIds = new Set(
  existingAmendments.flatMap((row) => Array.isArray(row.sourceExternalIds) ? row.sourceExternalIds : []),
);
const pendingAmendments = (bundle.bylawAmendments ?? []).filter((record) =>
  !(record.sourceExternalIds ?? []).some((id) => existingSourceIds.has(id)),
);

if (pendingAmendments.length === 0) {
  console.log("No new bylaw history records to apply.");
  process.exit(0);
}

const filteredBundle = {
  ...bundle,
  bylawAmendments: pendingAmendments,
  sources: (bundle.sources ?? []).filter((source) =>
    pendingAmendments.some((record) => (record.sourceExternalIds ?? []).includes(source.externalId)),
  ),
};

const sessionId = await ensureImportSession(society._id, filteredBundle);
if (sessionId) await approveAndApply(sessionId);

async function ensureImportSession(societyId, sessionBundle) {
  if (DRY_RUN) {
    console.log(`Would create import session: ${SESSION_NAME}`);
    console.log(`Would stage bylaw amendments: ${sessionBundle.bylawAmendments.length}`);
    return null;
  }
  const sessionId = await client.mutation(api.importSessions.createFromBundle, {
    societyId,
    name: SESSION_NAME,
    bundle: sessionBundle,
  });
  console.log(`Created import session: ${SESSION_NAME} (${sessionId})`);
  return sessionId;
}

async function approveAndApply(sessionId) {
  const detail = await client.query(api.importSessions.get, { sessionId });
  const records = (detail.records ?? []).filter((record) => record.recordKind === "bylawAmendment");
  if (records.length === 0) {
    console.log("Import session has no bylaw amendment records.");
    return;
  }
  const approved = await client.mutation(api.importSessions.bulkSetStatus, {
    sessionId,
    status: "Approved",
    recordIds: records.map((record) => record._id),
  });
  console.log(`Approved bylaw records: ${approved.updated}`);

  const sections = await client.mutation(api.importSessions.applyApprovedSectionRecords, { sessionId });
  console.log(`Applied section records: ${sections.total}`);
  console.log(JSON.stringify(sections.byKind ?? {}, null, 2));
}
