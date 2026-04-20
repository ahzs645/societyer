// One-shot applicator for /Users/ahmadjalil/Downloads/OTE society.
// It stages the generated registry bundle into Import sessions, approves the
// source-backed records, applies them to section tables, and upserts the
// latest legal director snapshot for Over the Edge.
//
// Run: node scripts/build-ote-society-registry-bundle.mjs
//      node scripts/apply-ote-society-registry-snapshot.mjs

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { config } from "dotenv";

config({ path: path.join(process.cwd(), ".env.local"), quiet: true });

const api = anyApi;
const SOCIETY_NAME = "Over the Edge Newspaper Society";
const BUNDLE_PATH = path.join(process.cwd(), "imports/ote-society-registry/ote-society-import-bundle.json");
const SESSION_NAME = "OTE BC Registry society import";
const STAGE_ONLY = process.argv.includes("--stage-only");
const DRY_RUN = process.argv.includes("--dry-run");

const url =
  process.env.VITE_CONVEX_URL ??
  process.env.CONVEX_SELF_HOSTED_URL ??
  process.env.CONVEX_URL;

if (!url) throw new Error("Missing VITE_CONVEX_URL / CONVEX_SELF_HOSTED_URL / CONVEX_URL.");
if (!existsSync(BUNDLE_PATH)) throw new Error(`Bundle not found: ${BUNDLE_PATH}`);

const client = new ConvexHttpClient(url);
const bundle = JSON.parse(readFileSync(BUNDLE_PATH, "utf8"));

const CURRENT_DIRECTORS = [
  {
    firstName: "Behrouz",
    lastName: "Danesh",
    aliases: ["Bruce", "Bruce Danesh", "Behrouze Danesh", "Behrouz (Bruce) Danesh"],
    termStart: "2024-03-31",
  },
  {
    firstName: "Ahmad",
    lastName: "Jalil",
    aliases: ["Ahmad"],
    termStart: "2024-03-31",
  },
  {
    firstName: "Anhelina",
    lastName: "Maksymova",
    aliases: ["Lina", "Lina Maksymova"],
    termStart: "2024-04-09",
  },
  {
    firstName: "Parniya",
    lastName: "Peykamiya",
    aliases: ["Parniya", "Parniya Peykamiyan"],
    termStart: "2025-03-31",
  },
  {
    firstName: "Nahida",
    lastName: "Yari",
    aliases: ["Nahid", "Nahid Yari"],
    termStart: "2024-07-05",
  },
];

const societies = await client.query(api.society.list, {});
const society = societies.find((row) => row.name === SOCIETY_NAME);
if (!society) throw new Error(`Society not found: ${SOCIETY_NAME}`);

console.log(`${DRY_RUN ? "Dry run: " : ""}${society.name} (${society._id})`);
await upsertCurrentDirectors(society._id);
const sessionId = await ensureImportSession(society._id);

if (!STAGE_ONLY && sessionId) {
  await approveAndApply(sessionId);
}

async function upsertCurrentDirectors(societyId) {
  const existing = await client.query(api.directors.list, { societyId });
  for (const director of CURRENT_DIRECTORS) {
    const match = existing.find((row) => intersects(personKeys(row), personKeys(director)));
    const patch = {
      firstName: director.firstName,
      lastName: director.lastName,
      aliases: director.aliases,
      position: "Director",
      isBCResident: true,
      termStart: director.termStart,
      consentOnFile: false,
      status: "Active",
      notes: mergeNotes(
        match?.notes,
        "Current legal director per 2025 BC Statement of Directors and Registered Office filed April 1, 2025. Officer title was not assigned from registry filings. BC resident flag is inferred from the BC delivery address in the filing and should be verified with consent/residency records.",
      ),
    };
    if (DRY_RUN) {
      console.log(`${match ? "Would update" : "Would create"} director: ${director.firstName} ${director.lastName}`);
    } else if (match) {
      await client.mutation(api.directors.update, { id: match._id, patch });
      console.log(`Updated director: ${director.firstName} ${director.lastName}`);
    } else {
      await client.mutation(api.directors.create, { societyId, ...patch });
      console.log(`Created director: ${director.firstName} ${director.lastName}`);
    }
  }
}

async function ensureImportSession(societyId) {
  const sessions = await client.query(api.importSessions.list, { societyId });
  const existing = sessions.find((session) => {
    const metadata = session.bundleMetadata ?? {};
    return (
      session.name === SESSION_NAME ||
      (metadata.createdFrom === bundle.metadata?.createdFrom &&
        metadata.sourceRoot === bundle.metadata?.sourceRoot)
    );
  });
  if (existing) {
    console.log(`Using existing import session: ${existing.name} (${existing._id})`);
    return existing._id;
  }
  if (DRY_RUN) {
    console.log(`Would create import session: ${SESSION_NAME}`);
    return null;
  }
  const sessionId = await client.mutation(api.importSessions.createFromBundle, {
    societyId,
    name: SESSION_NAME,
    bundle,
  });
  console.log(`Created import session: ${SESSION_NAME} (${sessionId})`);
  return sessionId;
}

async function approveAndApply(sessionId) {
  const detail = await client.query(api.importSessions.get, { sessionId });
  const records = detail.records ?? [];
  if (records.length === 0) {
    console.log("Import session has no records to apply.");
    return;
  }
  if (DRY_RUN) {
    console.log(`Would approve and apply ${records.length} import records.`);
    return;
  }
  const approved = await client.mutation(api.importSessions.bulkSetStatus, {
    sessionId,
    status: "Approved",
    recordIds: records.map((record) => record._id),
  });
  console.log(`Approved records: ${approved.updated}`);

  const org = await client.mutation(api.importSessions.applyApprovedToOrgHistory, { sessionId });
  console.log(`Applied org history: ${org.sources} sources, ${org.items} items`);

  const documents = await client.mutation(api.importSessions.applyApprovedDocuments, { sessionId });
  console.log(`Applied document candidates: ${documents.documents}`);

  const sections = await client.mutation(api.importSessions.applyApprovedSectionRecords, { sessionId });
  console.log(`Applied section records: ${sections.total}`);
  console.log(JSON.stringify(sections.byKind ?? {}, null, 2));
}

function personKeys(row) {
  return [
    `${row.firstName ?? ""} ${row.lastName ?? ""}`,
    ...(Array.isArray(row.aliases) ? row.aliases : []),
  ]
    .map(normalizeName)
    .filter(Boolean);
}

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function intersects(left, right) {
  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value));
}

function mergeNotes(existing, note) {
  const parts = String(existing ?? "")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.includes(note)) parts.push(note);
  return parts.join("\n\n");
}
