import { mutation, query } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  overviewPortable,
  upsertAddressPortable,
  removeAddressPortable,
  upsertRegistrationPortable,
  removeRegistrationPortable,
  upsertIdentifierPortable,
  removeIdentifierPortable,
} from "../shared/functions/organizationDetails";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

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

export const overview = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => overviewPortable(toPortableQueryCtx(ctx), args),
});

export const seedFromSocietyAddresses = mutation({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
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
  },
});

export const backfillFromExistingRecords = mutation({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
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
  },
});

export const upsertAddress = mutation({
  args: {
    id: v.optional(v.id("organizationAddresses")),
    societyId: v.id("societies"),
    type: v.string(),
    status: v.string(),
    effectiveFrom: v.optional(v.string()),
    effectiveTo: v.optional(v.string()),
    street: v.string(),
    unit: v.optional(v.string()),
    city: v.string(),
    provinceState: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    country: v.string(),
    notes: v.optional(v.string()),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
  },
  returns: v.any(),
  handler: (ctx, args) => upsertAddressPortable(toPortableMutationCtx(ctx), args),
});

export const removeAddress = mutation({
  args: { id: v.id("organizationAddresses") },
  returns: v.any(),
  handler: (ctx, args) => removeAddressPortable(toPortableMutationCtx(ctx), args),
});

export const upsertRegistration = mutation({
  args: {
    id: v.optional(v.id("organizationRegistrations")),
    societyId: v.id("societies"),
    registrationType: v.optional(v.string()),
    jurisdiction: v.string(),
    homeJurisdiction: v.optional(v.string()),
    assumedName: v.optional(v.string()),
    registrationNumber: v.optional(v.string()),
    registrationDate: v.optional(v.string()),
    activityCommencementDate: v.optional(v.string()),
    deRegistrationDate: v.optional(v.string()),
    nuansNumber: v.optional(v.string()),
    officialEmail: v.optional(v.string()),
    annualReturnDueDate: v.optional(v.string()),
    lastAnnualReturnFiledDate: v.optional(v.string()),
    registryProfileReportDate: v.optional(v.string()),
    registryPortalKey: v.optional(v.string()),
    profileReportDocumentId: v.optional(v.id("documents")),
    companyKeyVaultItemId: v.optional(v.id("secretVaultItems")),
    agentForServiceName: v.optional(v.string()),
    agentForServiceAddress: v.optional(v.string()),
    principalOfficeAddress: v.optional(v.string()),
    representativeIds: v.optional(v.array(v.string())),
    status: v.optional(v.string()),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => upsertRegistrationPortable(toPortableMutationCtx(ctx), args),
});

export const removeRegistration = mutation({
  args: { id: v.id("organizationRegistrations") },
  returns: v.any(),
  handler: (ctx, args) => removeRegistrationPortable(toPortableMutationCtx(ctx), args),
});

export const upsertIdentifier = mutation({
  args: {
    id: v.optional(v.id("organizationIdentifiers")),
    societyId: v.id("societies"),
    kind: v.string(),
    number: v.string(),
    jurisdiction: v.optional(v.string()),
    foreignJurisdiction: v.optional(v.string()),
    registeredAt: v.optional(v.string()),
    status: v.optional(v.string()),
    accessLevel: v.optional(v.string()),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => upsertIdentifierPortable(toPortableMutationCtx(ctx), args),
});

export const removeIdentifier = mutation({
  args: { id: v.id("organizationIdentifiers") },
  returns: v.any(),
  handler: (ctx, args) => removeIdentifierPortable(toPortableMutationCtx(ctx), args),
});

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

function cleanText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
