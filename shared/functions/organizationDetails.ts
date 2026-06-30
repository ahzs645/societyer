/**
 * PORTABLE FUNCTIONS: the organization-details domain
 * (overview / upsertAddress / removeAddress / upsertRegistration /
 *  removeRegistration / upsertIdentifier / removeIdentifier).
 *
 * Reads/writes the `organizationAddresses`, `organizationRegistrations`, and
 * `organizationIdentifiers` tables over `ctx.db`. Each handler runs unchanged on
 * hosted Convex, the local Dexie runtime, and the convex-test oracle.
 *
 * The offline backfill/seed helpers (`seedFromSocietyAddresses`,
 * `backfillFromExistingRecords`) are intentionally NOT ported; they remain as
 * static no-ops in convex/organizationDetails.ts.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { cleanText } from "./text";
import { assertAllowedOption } from "../orgHubOptions";

export async function overviewPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const [addresses, registrations, identifiers] = await Promise.all([
    ctx.db
      .query("organizationAddresses")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
    ctx.db
      .query("organizationRegistrations")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
    ctx.db
      .query("organizationIdentifiers")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
  ]);

  return {
    addresses: sortCurrentFirst(addresses, "effectiveFrom"),
    registrations: sortCurrentFirst(registrations, "registrationDate"),
    identifiers: identifiers
      .slice()
      .sort((a, b) => String(a.kind ?? "").localeCompare(String(b.kind ?? ""))),
  };
}

export async function upsertAddressPortable(
  ctx: PortableMutationCtx,
  { id, ...args }: {
    id?: string;
    societyId: string;
    type: string;
    status: string;
    effectiveFrom?: string;
    effectiveTo?: string;
    street: string;
    unit?: string;
    city: string;
    provinceState?: string;
    postalCode?: string;
    country: string;
    notes?: string;
    sourceDocumentIds?: string[];
  },
) {
  assertAllowedOption("addressTypes", args.type, "Address type", false);
  assertAllowedOption("addressStatuses", args.status, "Address status", false);
  const now = new Date().toISOString();
  const payload = {
    ...cleanObject(args),
    status: cleanText(args.status) || "current",
    type: cleanText(args.type) || "other",
    street: cleanText(args.street) || "Needs review",
    city: cleanText(args.city) || "Needs review",
    country: cleanText(args.country) || "Canada",
    updatedAtISO: now,
  };
  if (id) {
    await ctx.db.patch(id, payload);
    return id;
  }
  return await ctx.db.insert("organizationAddresses", {
    ...payload,
    createdAtISO: now,
  });
}

export async function removeAddressPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  await ctx.db.delete(id);
}

export async function upsertRegistrationPortable(
  ctx: PortableMutationCtx,
  { id, ...args }: {
    id?: string;
    societyId: string;
    registrationType?: string;
    jurisdiction: string;
    homeJurisdiction?: string;
    assumedName?: string;
    registrationNumber?: string;
    registrationDate?: string;
    activityCommencementDate?: string;
    deRegistrationDate?: string;
    nuansNumber?: string;
    officialEmail?: string;
    annualReturnDueDate?: string;
    lastAnnualReturnFiledDate?: string;
    registryProfileReportDate?: string;
    registryPortalKey?: string;
    profileReportDocumentId?: string;
    companyKeyVaultItemId?: string;
    agentForServiceName?: string;
    agentForServiceAddress?: string;
    principalOfficeAddress?: string;
    representativeIds?: string[];
    status?: string;
    sourceDocumentIds?: string[];
    notes?: string;
  },
) {
  assertAllowedOption("entityJurisdictions", args.jurisdiction, "Registration jurisdiction", false);
  assertAllowedOption("entityJurisdictions", args.homeJurisdiction, "Home jurisdiction");
  assertAllowedOption("registrationTypes", args.registrationType, "Registration type");
  assertAllowedOption("registrationStatuses", args.status, "Registration status");
  const now = new Date().toISOString();
  const payload = {
    ...cleanObject(args),
    registrationType: cleanText(args.registrationType) || "extra_provincial",
    jurisdiction: cleanText(args.jurisdiction) || "Needs review",
    representativeIds: args.representativeIds ?? [],
    status: cleanText(args.status) || "needs_review",
    updatedAtISO: now,
  };
  if (id) {
    await ctx.db.patch(id, payload);
    return id;
  }
  return await ctx.db.insert("organizationRegistrations", {
    ...payload,
    createdAtISO: now,
  });
}

export async function removeRegistrationPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  await ctx.db.delete(id);
}

export async function upsertIdentifierPortable(
  ctx: PortableMutationCtx,
  { id, ...args }: {
    id?: string;
    societyId: string;
    kind: string;
    number: string;
    jurisdiction?: string;
    foreignJurisdiction?: string;
    registeredAt?: string;
    status?: string;
    accessLevel?: string;
    sourceDocumentIds?: string[];
    notes?: string;
  },
) {
  assertAllowedOption("taxNumberTypes", args.kind, "Identifier kind", false);
  assertAllowedOption("entityJurisdictions", args.jurisdiction, "Identifier jurisdiction");
  assertAllowedOption("identifierStatuses", args.status, "Identifier status");
  assertAllowedOption("accessLevels", args.accessLevel, "Identifier access level");
  const now = new Date().toISOString();
  const payload = {
    ...cleanObject(args),
    kind: cleanText(args.kind) || "other",
    number: cleanText(args.number) || "Needs review",
    status: cleanText(args.status) || "needs_review",
    accessLevel: cleanText(args.accessLevel) || "restricted",
    updatedAtISO: now,
  };
  if (id) {
    await ctx.db.patch(id, payload);
    return id;
  }
  return await ctx.db.insert("organizationIdentifiers", {
    ...payload,
    createdAtISO: now,
  });
}

export async function removeIdentifierPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  await ctx.db.delete(id);
}

const BACKFILL_DOCUMENT_CATEGORIES = [
  "Constitution",
  "Bylaws",
  "Minutes",
  "FinancialStatement",
  "Policy",
  "Filing",
  "WorkflowGenerated",
];
const BACKFILL_DOCUMENT_SCAN_LIMIT_PER_CATEGORY = 80;
const BACKFILL_MINUTE_BOOK_SCAN_LIMIT = 500;
const BACKFILL_INSERT_LIMIT = 100;

export async function seedFromSocietyAddressesPortable(ctx: PortableMutationCtx, { societyId }: { societyId: string }) {
  const society = await ctx.db.get(societyId);
  if (!society) throw new Error("Society not found.");
  const existing = await ctx.db
    .query("organizationAddresses")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const now = new Date().toISOString();
  let created = 0;

  const insertLegacy = async (type: string, address: unknown) => {
    const text = cleanText(address);
    if (!text) return;
    if (existing.some((row) => row.type === type && row.status === "current")) return;
    await ctx.db.insert("organizationAddresses", {
      societyId,
      type,
      status: "current",
      street: text,
      city: "Needs review",
      country: "Canada",
      notes: "Created from legacy society address text. Review and split into structured fields.",
      createdAtISO: now,
      updatedAtISO: now,
    });
    created += 1;
  };

  await insertLegacy("registered_office", society.registeredOfficeAddress);
  await insertLegacy("mailing", society.mailingAddress);

  return { created };
}

export async function backfillFromExistingRecordsPortable(ctx: PortableMutationCtx, { societyId }: { societyId: string }) {
  const society = await ctx.db.get(societyId);
  if (!society) throw new Error("Society not found.");
  const now = new Date().toISOString();
  let addressesCreated = 0;
  let minuteBookItemsCreated = 0;

  const addresses = await ctx.db
    .query("organizationAddresses")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const insertLegacyAddress = async (type: string, address: unknown) => {
    const text = cleanText(address);
    if (!text) return;
    if (addresses.some((row) => row.type === type && row.status === "current")) return;
    await ctx.db.insert("organizationAddresses", {
      societyId,
      type,
      status: "current",
      street: text,
      city: "Needs review",
      country: "Canada",
      notes: "Backfilled from legacy society address text. Review and split into structured fields.",
      createdAtISO: now,
      updatedAtISO: now,
    });
    addressesCreated += 1;
  };
  await insertLegacyAddress("registered_office", society.registeredOfficeAddress);
  await insertLegacyAddress("mailing", society.mailingAddress);

  const [documentGroups, minuteBookItems] = await Promise.all([
    Promise.all(
      BACKFILL_DOCUMENT_CATEGORIES.map((category) =>
        ctx.db
          .query("documents")
          .withIndex("by_society_category", (q) => q.eq("societyId", societyId).eq("category", category))
          .take(BACKFILL_DOCUMENT_SCAN_LIMIT_PER_CATEGORY),
      ),
    ),
    ctx.db
      .query("minuteBookItems")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .take(BACKFILL_MINUTE_BOOK_SCAN_LIMIT),
  ]);
  const documents = documentGroups.flat();
  const existingDocIds = new Set(minuteBookItems.flatMap((item) => (item.documentIds ?? []).map(String)));
  for (const doc of documents) {
    if (existingDocIds.has(String(doc._id))) continue;
    const recordType = minuteBookRecordTypeForDocument(doc);
    if (!recordType) continue;
    if (minuteBookItemsCreated >= BACKFILL_INSERT_LIMIT) break;
    await ctx.db.insert("minuteBookItems", {
      societyId,
      title: doc.title,
      recordType,
      effectiveDate: doc.createdAtISO?.slice(0, 10),
      status: doc.archivedAtISO ? "Archived" : "NeedsReview",
      documentIds: [doc._id],
      signatureIds: [],
      sourceEvidenceIds: [],
      archivedAtISO: doc.archivedAtISO,
      notes: "Backfilled from existing document category/tags.",
      createdAtISO: now,
      updatedAtISO: now,
    });
    minuteBookItemsCreated += 1;
  }

  return {
    addressesCreated,
    minuteBookItemsCreated,
    scannedDocuments: documents.length,
    scannedMinuteBookItems: minuteBookItems.length,
    capped: minuteBookItemsCreated >= BACKFILL_INSERT_LIMIT,
  };
}

function minuteBookRecordTypeForDocument(doc: any) {
  const text = [doc.title, doc.category, ...(doc.tags ?? [])].join(" ").toLowerCase();
  if (doc.category === "Constitution" || text.includes("constitution")) return "constitution";
  if (doc.category === "Bylaws" || text.includes("bylaw")) return "bylaws";
  if (doc.category === "Minutes" || text.includes("minutes") || text.includes("meeting")) return "minutes";
  if (doc.category === "Policy" || text.includes("policy")) return "policy";
  if (doc.category === "Filing" || text.includes("filing") || text.includes("annual report")) return "filing";
  if (text.includes("resolution")) return "resolution";
  if (text.includes("shareholder ledger") || text.includes("member ledger")) return "ledger";
  if (text.includes("paper minute book") || text.includes("paper archive")) return "paper_minute_book_archive";
  if (doc.category === "FinancialStatement") return "financial_statement";
  if (doc.category === "WorkflowGenerated") return "workflow_package_document";
  return undefined;
}

function sortCurrentFirst(rows: any[], dateField: string) {
  return rows.slice().sort((a, b) => {
    const statusScore = (row: any) => row.status === "current" || row.status === "active" ? 0 : 1;
    const score = statusScore(a) - statusScore(b);
    if (score !== 0) return score;
    return String(b[dateField] ?? "").localeCompare(String(a[dateField] ?? ""));
  });
}

function cleanObject<T extends Record<string, any>>(source: T) {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string") {
      const cleaned = cleanText(value);
      if (cleaned !== undefined) result[key] = cleaned;
      continue;
    }
    if (value !== undefined) result[key] = value;
  }
  return result as T;
}
