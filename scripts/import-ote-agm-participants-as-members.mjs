import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { config } from "dotenv";

config({ path: path.join(process.cwd(), ".env.local") });

const api = anyApi;
const url =
  process.env.CONVEX_SELF_HOSTED_URL ??
  process.env.VITE_CONVEX_URL ??
  process.env.CONVEX_URL;

if (!url) {
  throw new Error("Set CONVEX_SELF_HOSTED_URL, VITE_CONVEX_URL, or CONVEX_URL.");
}

const write = process.argv.includes("--write");
const client = new ConvexHttpClient(url);

const SOCIETY_NAME = "Over the Edge Newspaper Society";
const PARTICIPANT_DOC_TITLE = "OTE AGM Participant List — March 31, 2025";
const JOINED_AT = "2025-03-31";
const IMPORT_NOTE =
  "Imported from OTE AGM Participant List — March 31, 2025. Student identifier present in source document but not stored in member record.";

const societies = await client.query(api.society.list, {});
const society = societies.find((row) => row.name === SOCIETY_NAME);
if (!society) throw new Error(`Society not found: ${SOCIETY_NAME}`);

const documents = await client.query(api.documents.list, { societyId: society._id });
const participantDoc = documents.find((row) => row.title === PARTICIPANT_DOC_TITLE);
if (!participantDoc?.storageId) {
  throw new Error(`Stored participant document not found: ${PARTICIPANT_DOC_TITLE}`);
}

const downloadUrl = await client.query(api.files.getUrl, {
  storageId: participantDoc.storageId,
});
if (!downloadUrl) throw new Error("Participant document has no download URL.");

const response = await fetch(downloadUrl);
if (!response.ok) throw new Error(`Failed to download participant document: ${response.status}`);

const dir = mkdtempSync(path.join(tmpdir(), "societyer-ote-participants-"));
const docxPath = path.join(dir, "participant-list.docx");

try {
  writeFileSync(docxPath, Buffer.from(await response.arrayBuffer()));
  const xml = execFileSync("unzip", ["-p", docxPath, "word/document.xml"], {
    encoding: "utf8",
    maxBuffer: 5 * 1024 * 1024,
  });
  const text = decodeXmlText(xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  const participants = parseParticipants(text);
  const existingMembers = await client.query(api.members.list, { societyId: society._id });
  const existingKeys = new Set(existingMembers.map((member) => personKey(member.firstName, member.lastName)));
  const missing = participants.filter((participant) => !existingKeys.has(personKey(participant.firstName, participant.lastName)));

  console.log(`Found ${participants.length} participant(s); ${missing.length} missing from members.`);
  for (const participant of missing) {
    console.log(`- ${participant.firstName} ${participant.lastName}`);
  }

  if (!write) {
    console.log("\nDry run only. Re-run with --write to create member rows.");
    process.exit(0);
  }

  for (const participant of missing) {
    await client.mutation(api.members.create, {
      societyId: society._id,
      firstName: participant.firstName,
      lastName: participant.lastName,
      aliases: [],
      membershipClass: "Ordinary",
      status: "Active",
      joinedAt: JOINED_AT,
      votingRights: true,
      notes: IMPORT_NOTE,
    });
  }
  console.log(`Created ${missing.length} member row(s).`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

function decodeXmlText(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseParticipants(text) {
  const rows = [];
  const pattern = /([\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*)+)\s*-\s*(\d{6,})/gu;
  let match;
  while ((match = pattern.exec(text))) {
    const name = match[1].trim();
    const parts = name.split(/\s+/);
    if (parts.length < 2) continue;
    rows.push({
      firstName: parts.slice(0, -1).join(" "),
      lastName: parts.at(-1),
    });
  }
  return dedupeBy(rows, (row) => personKey(row.firstName, row.lastName));
}

function personKey(firstName, lastName) {
  return `${firstName ?? ""} ${lastName ?? ""}`.toLowerCase().replace(/[^a-z]+/g, " ").trim();
}

function dedupeBy(rows, keyFor) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = keyFor(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}
