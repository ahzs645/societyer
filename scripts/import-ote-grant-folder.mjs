// One-shot importer for /Users/ahmadjalil/Downloads/Grant.
// Uploads the local grant packet files to Convex storage, creates/reuses
// document rows, and upserts structured grant records for Over the Edge.
//
// Run: node scripts/import-ote-grant-folder.mjs

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { config } from "dotenv";

config({ path: path.join(process.cwd(), ".env.local"), quiet: true });

const api = anyApi;
const ROOT = "/Users/ahmadjalil/Downloads/Grant";
const SOCIETY_NAME = "Over the Edge Newspaper Society";
const IMPORT_TAG = "ote-grant-folder-import";
const DRY_RUN = process.argv.includes("--dry-run");

const url =
  process.env.VITE_CONVEX_URL ??
  process.env.CONVEX_SELF_HOSTED_URL ??
  process.env.CONVEX_URL;

if (!url) throw new Error("Missing VITE_CONVEX_URL / CONVEX_SELF_HOSTED_URL / CONVEX_URL.");
if (!existsSync(ROOT)) throw new Error(`Grant folder not found: ${ROOT}`);

const client = new ConvexHttpClient(url);

const MIME = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".pdf": "application/pdf",
  ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const CATEGORY_BY_BASENAME = [
  [/bylaws/i, "Bylaws"],
  [/annual general meeting|agm|minutes/i, "Minutes"],
  [/budget|financial|fin312|statement|screenshot|revenue|expenses|balance sheet/i, "FinancialStatement"],
];

const allFiles = listFiles(ROOT).sort((a, b) => a.localeCompare(b));
const today = new Date().toISOString().slice(0, 10);

const societies = await client.query(api.society.list, {});
const society = societies.find((row) => row.name === SOCIETY_NAME);
if (!society) throw new Error(`Society not found: ${SOCIETY_NAME}`);

const users = await client.query(api.users.list, { societyId: society._id });
const actor = users.find((user) => ["Owner", "Admin", "Director"].includes(user.role));
if (!actor) throw new Error(`No Director/Admin/Owner user found for ${SOCIETY_NAME}.`);

const existingDocuments = await client.query(api.documents.list, { societyId: society._id });
const documentsByTitle = new Map(existingDocuments.map((doc) => [doc.title, doc]));
const documentsByRelPath = new Map();

console.log(`${DRY_RUN ? "Dry run: " : ""}Importing ${allFiles.length} grant packet files for ${society.name}`);

for (const absPath of allFiles) {
  const relPath = path.relative(ROOT, absPath);
  const document = await ensureDocument(absPath, relPath);
  documentsByRelPath.set(relPath, document._id ?? document.id);
}

const existingGrants = await client.query(api.grants.list, { societyId: society._id });
const grantsByTitle = new Map(existingGrants.map((grant) => [grant.title, grant]));

const grantSpecs = buildGrantSpecs();
const results = [];
for (const spec of grantSpecs) {
  const existing = grantsByTitle.get(spec.title);
  const payload = {
    id: existing?._id,
    societyId: society._id,
    title: spec.title,
    funder: spec.funder,
    program: spec.program,
    status: spec.status,
    opportunityType: spec.opportunityType,
    priority: spec.priority,
    fitScore: spec.fitScore,
    nextAction: spec.nextAction,
    publicDescription: spec.publicDescription,
    allowPublicApplications: false,
    applicationInstructions: spec.applicationInstructions,
    requirements: spec.requirements,
    amountRequestedCents: spec.amountRequestedCents,
    restrictedPurpose: spec.restrictedPurpose,
    applicationDueDate: spec.applicationDueDate,
    submittedAtISO: spec.submittedAtISO,
    startDate: spec.startDate,
    endDate: spec.endDate,
    nextReportDueAtISO: spec.nextReportDueAtISO,
    notes: spec.notes,
    actingUserId: actor._id,
  };
  if (DRY_RUN) {
    results.push({ title: spec.title, action: existing ? "would update" : "would create" });
    continue;
  }
  const id = await client.mutation(api.grants.upsertGrant, payload);
  results.push({ id, title: spec.title, action: existing ? "updated" : "created" });
}

console.log(
  JSON.stringify(
    {
      ok: true,
      dryRun: DRY_RUN,
      society: society.name,
      societyId: society._id,
      actor: actor.displayName,
      filesSeen: allFiles.length,
      documentsImportedOrReused: documentsByRelPath.size,
      grants: results,
    },
    null,
    2,
  ),
);

function listFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const absPath = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(absPath));
    else if (entry.isFile()) out.push(absPath);
  }
  return out;
}

function categoryFor(relPath) {
  const basename = path.basename(relPath);
  for (const [pattern, category] of CATEGORY_BY_BASENAME) {
    if (pattern.test(basename)) return category;
  }
  return "Grant";
}

function documentTitle(relPath) {
  const cleanPath = relPath.split(path.sep).join(" — ");
  return `Grant packet — ${cleanPath}`;
}

async function ensureDocument(absPath, relPath) {
  const title = documentTitle(relPath);
  const category = categoryFor(relPath);
  const existing = documentsByTitle.get(title);
  if (existing?.storageId || DRY_RUN) {
    return existing ?? { id: `dry-doc:${relPath}`, _id: `dry-doc:${relPath}` };
  }

  const ext = path.extname(absPath).toLowerCase();
  const mimeType = MIME[ext] ?? "application/octet-stream";
  const fileName = path.basename(absPath);
  const fileSizeBytes = statSync(absPath).size;
  const bytes = readFileSync(absPath);

  let documentId = existing?._id;
  if (!documentId) {
    documentId = await client.mutation(api.documents.create, {
      societyId: society._id,
      title,
      category,
      fileName,
      mimeType,
      tags: [IMPORT_TAG, "grant-packet", relPath.split(path.sep)[0]],
    });
  }

  const uploadUrl = await client.mutation(api.files.generateUploadUrl, {});
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": mimeType },
    body: bytes,
  });
  if (!response.ok) {
    throw new Error(`Upload failed for ${relPath}: HTTP ${response.status}`);
  }
  const upload = await response.json();
  const storageId = upload.storageId ?? upload.id ?? upload;

  await client.mutation(api.files.attachUploadedFileToDocument, {
    documentId,
    storageId,
    fileName,
    mimeType,
    fileSizeBytes,
  });

  const document = { _id: documentId, title, category, storageId };
  documentsByTitle.set(title, document);
  console.log(`document ${existing ? "attached" : "created"}: ${relPath}`);
  return document;
}

function doc(relPath) {
  const id = documentsByRelPath.get(relPath);
  if (!id) throw new Error(`Missing imported document for ${relPath}`);
  return id;
}

function req({
  id,
  category,
  label,
  status = "Needed",
  relPath,
  dueDate,
  notes,
}) {
  return {
    id,
    category,
    label,
    status,
    dueDate,
    documentId: relPath ? doc(relPath) : undefined,
    notes,
  };
}

function buildGrantSpecs() {
  return [
    {
      title: "BC Community Gaming Grant 2025 — Community News Publication and Distribution",
      funder: "Province of British Columbia",
      program: "Community Gaming Grant",
      status: "Submitted",
      opportunityType: "Government",
      priority: "High",
      fitScore: 90,
      amountRequestedCents: 7_500_000,
      submittedAtISO: "2025-01-22",
      nextReportDueAtISO: "2025-07-29",
      nextAction: "Track application status and retain application confirmation, follow-up, and program financial evidence.",
      publicDescription:
        "Submitted BC Community Gaming Grant request for the Community News Publication and Distribution program.",
      applicationInstructions:
        "Imported from the local BC Gaming Grant packet. Keep the confirmation PDF, supporting attachments, and follow-up documents with this grant record.",
      restrictedPurpose:
        "Community News Publication and Distribution program costs, including production, distribution, contributor honoraria, digital access, equipment, software, and program support.",
      notes:
        `Imported from local Grant folder on ${today}. Application ID 1238069 was received on 2025-01-22. The application summary lists BC society S0048345, fiscal year end April 30, Arts and Culture sector, program delivered for 30 years, and a $75,000 request for Community News Publication and Distribution. Supporting documents in the packet include bylaws, directors/officers evidence, AGM minutes, financial statement evidence, program budget, simplified program financials, common forms, and confirmation/follow-up PDFs.`,
      requirements: [
        req({ id: "core-opportunity-fit", category: "Prospect", label: "Eligibility and fit confirmed", status: "Ready" }),
        req({ id: "core-owner", category: "Ownership", label: "Board owner and internal reviewer assigned", status: "Ready" }),
        req({ id: "core-budget", category: "Finance", label: "Requested amount and budget notes prepared", status: "Attached", relPath: "BC Gaming Grant/2024-2025.pdf" }),
        req({ id: "core-application-draft", category: "Application", label: "Application narrative drafted", status: "Attached", relPath: "BC Gaming Grant/Main Application.docx" }),
        req({ id: "core-submission-confirmation", category: "Submission", label: "Submission confirmation saved", status: "Attached", relPath: "BC Gaming Grant/showCGGApplicationSummary.pdf" }),
        req({ id: "core-reporting-calendar", category: "Post-award", label: "Reporting deadlines added", status: "Requested", dueDate: "2025-07-29", notes: "Community Gaming Grant conditions require a Gaming Account Summary Report within 90 days of fiscal year-end if funds are received." }),
        req({ id: "bc-bylaws", category: "Organization", label: "Certified constitution and bylaws attached", status: "Attached", relPath: "BC Gaming Grant/Bylaws.pdf" }),
        req({ id: "bc-board-list", category: "Governance", label: "Board list and officer details ready", status: "Attached", relPath: "BC Gaming Grant/StatementOfDirectorsAndOffice.pdf" }),
        req({ id: "bc-agm-minutes", category: "Governance", label: "AGM minutes with board election evidence attached", status: "Attached", relPath: "BC Gaming Grant/OTE ANNUAL GENERAL MEETING Feb 2024 (1).docx" }),
        req({ id: "bc-org-financials", category: "Finance", label: "Prior-year financial statements and current budget attached", status: "Attached", relPath: "BC Gaming Grant/Screenshot 2025-01-22 at 11.17.53 AM.jpeg" }),
        req({ id: "bc-gaming-account", category: "Finance", label: "Gaming account evidence reviewed", status: "Ready", relPath: "BC Gaming Grant/Followup Email/FIN312 Completed.pdf", notes: "Application summary says gaming account information was on file with GPEB with no changes." }),
        req({ id: "bc-program-description", category: "Program", label: "Program description and community benefit narrative ready", status: "Attached", relPath: "BC Gaming Grant/Program Information.docx" }),
        req({ id: "bc-program-financials", category: "Program", label: "Program actuals or simplified financials attached", status: "Attached", relPath: "BC Gaming Grant/simplified_program_financials.xlsm" }),
        req({ id: "bc-program-budget", category: "Program", label: "Program budget attached when required", status: "Attached", relPath: "BC Gaming Grant/2024-2025.pdf" }),
        req({ id: "bc-inkind", category: "Program", label: "In-kind contribution summary attached when claimed", status: "Waived", relPath: "BC Gaming Grant/simplified_program_financials.xlsm", notes: "The workbook's in-kind contribution summary contains no entered contribution amounts." }),
        req({ id: "bc-officers", category: "Submission", label: "Two officers, submitter, contact, and delivery emails confirmed", status: "Ready" }),
        req({ id: "bc-confirmation", category: "Submission", label: "Application ID and confirmation PDF saved", status: "Attached", relPath: "BC Gaming Grant/showCGGApplicationSummary.pdf" }),
        req({ id: "bc-summary-report", category: "Post-award", label: "Gaming Account Summary Report deadline tracked", status: "Requested", dueDate: "2025-07-29" }),
      ],
    },
    {
      title: "Canada Summer Jobs 2025 — Student Media Operations & Systems Coordinator",
      funder: "Employment and Social Development Canada",
      program: "Canada Summer Jobs",
      status: "Submitted",
      opportunityType: "Government",
      priority: "High",
      fitScore: 85,
      amountRequestedCents: 1_149_120,
      submittedAtISO: "2024-12-10",
      startDate: "2025-04-21",
      endDate: "2025-08-30",
      nextAction: "Track GCOS status, agreement outcome, advance payment, and hiring follow-up.",
      publicDescription:
        "Submitted Canada Summer Jobs application for one student media operations and systems coordinator role.",
      applicationInstructions:
        "Imported from the local Canada Summer Jobs packet. Keep the GCOS authority confirmation, application summary, and submission confirmation with this record.",
      restrictedPurpose:
        "Wages and mandatory employment related costs for one media coordinator placement supporting archives, digital systems, editorial workflow, and multimedia operations.",
      notes:
        `Imported from local Grant folder on ${today}. Confirmation number A001242170 was captured in the packet on 2024-12-10. The application requests one participant for 16 weeks at 35 hours/week and $18/hour, plus $1,411.20 in mandatory employment related costs; estimated requested contribution is $11,491.20. The role covers archive digitization, digital content management, editorial calendar support, multimedia production, process documentation, database/archive management, and staff training.`,
      requirements: [
        req({ id: "core-opportunity-fit", category: "Prospect", label: "Eligibility and fit confirmed", status: "Ready" }),
        req({ id: "core-owner", category: "Ownership", label: "Board owner and internal reviewer assigned", status: "Ready" }),
        req({ id: "core-budget", category: "Finance", label: "Requested amount and budget notes prepared", status: "Ready", relPath: "Canada Summer Jobs/Online Version - For Review Purposes Only – Must be Submitted Online - Canada.ca.pdf" }),
        req({ id: "core-application-draft", category: "Application", label: "Application narrative drafted", status: "Attached", relPath: "Canada Summer Jobs/Online Version - For Review Purposes Only – Must be Submitted Online - Canada.ca.pdf" }),
        req({ id: "core-submission-confirmation", category: "Submission", label: "Submission confirmation saved", status: "Attached", relPath: "Canada Summer Jobs/Confirmation - Canada.ca.pdf" }),
        req({ id: "core-reporting-calendar", category: "Post-award", label: "Reporting deadlines added", status: "Needed" }),
        req({ id: "csj-gcos-authority", category: "Access", label: "GCOS access and primary officer authority confirmed", status: "Attached", relPath: "Canada Summer Jobs/Grants and Contributions Online Services - [Confirm your Authority to Act as Primary Officer on Behalf of the Organization].pdf" }),
        req({ id: "csj-org-profile", category: "Organization", label: "Legal name, CRA/business number, mandate, and address ready", status: "Attached", relPath: "Canada Summer Jobs/2012 BC Registry Annual Report BC Society.pdf", notes: "The application summary also includes the organization profile and mandate." }),
        req({ id: "csj-project-dates", category: "Project", label: "Project title, start date, end date, and location confirmed", status: "Ready", relPath: "Canada Summer Jobs/Online Version - For Review Purposes Only – Must be Submitted Online - Canada.ca.pdf" }),
        req({ id: "csj-job-details", category: "Project", label: "Job activities, supervision, and youth employment details prepared", status: "Attached", relPath: "Canada Summer Jobs/Online Version - For Review Purposes Only – Must be Submitted Online - Canada.ca.pdf" }),
        req({ id: "csj-wage-budget", category: "Finance", label: "Wage, hours, and requested contribution calculated", status: "Ready", relPath: "Canada Summer Jobs/Online Version - For Review Purposes Only – Must be Submitted Online - Canada.ca.pdf" }),
        req({ id: "csj-contacts", category: "Contacts", label: "Primary and secondary contacts confirmed", status: "Ready" }),
        req({ id: "csj-attestation", category: "Submission", label: "Privacy, attestation, and signatory details reviewed", status: "Ready" }),
        req({ id: "csj-confirmation", category: "Submission", label: "Submission confirmation saved", status: "Attached", relPath: "Canada Summer Jobs/Confirmation - Canada.ca.pdf" }),
      ],
    },
  ];
}
