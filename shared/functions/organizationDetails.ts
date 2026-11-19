import { normalizeAddressText, parseAddressText } from "../structuredAddress";
import { canonicalizeJurisdictionCode } from "../organizationDomain";
import { normalizeGstRegistration, normalizeBcPstRegistration } from "../invoiceTaxRegistrations";
import { isCalendarDate } from "../invoicing";
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

import type { PortableDoc, PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireOwnedRow, requireRolePortable, requireSocietyMembership } from "./access";
import { requirePermissionPortable } from "./permissions";
import { cleanText } from "./text";
import { assertAllowedOption } from "../orgHubOptions";
import {
  TAX_STATUS_OPTIONS,
  certificateAnniversaryDate,
  organizationStatusForFormation,
  validateArticlesProvisions,
  validateEntitySetup,
  validateFormationEvidence,
} from "../entitySetup";
import { isPreparingIncorporation, validateWorkspaceLegalIdentity, validateWorkspaceLegalIdentityUpdate } from "../organizationDomain";
import { organizationToday } from "./electionElectorate";
import { isTimeZone } from "../timeZones";
import { proposedRegisteredOffice } from "../registeredOffice";

export async function overviewPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
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
  await requireSocietyMembership(ctx, args.societyId);
  if (id) await getOwned(ctx, "organizationAddresses", id, args.societyId);
  await Promise.all((args.sourceDocumentIds ?? []).map((documentId) =>
    getOwned(ctx, "documents", documentId, args.societyId)));
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
  await requireOwnedRow(ctx, "organizationAddresses", id);
  await ctx.db.delete(id);
}

export async function upsertRegistrationPortable(
  ctx: PortableMutationCtx,
  { id, ...args }: {
    id?: string;
    societyId: string;
    registrationType?: string;
    corporationClass?: string;
    licenceEvidenceDocumentId?: string;
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
    /** Which registry portal the row uses ("bc_registry_societies"). `null` removes it, e.g. a key typed here as plain text. */
    registryPortalKey?: string | null;
    profileReportDocumentId?: string;
    companyKeyVaultItemId?: string;
    agentForServiceName?: string;
    agentForServiceAddress?: string;
    principalOfficeAddress?: string;
    representativeIds?: string[];
    status?: string;
    sourceDocumentIds?: string[];
    notes?: string;
  } & RegistrationRegistryFacts,
) {
  await requireSocietyMembership(ctx, args.societyId);
  if (id) await getOwned(ctx, "organizationRegistrations", id, args.societyId);
  validateRegistrationRegistryFacts(args);
  if (args.certificateDocumentId) await getOwned(ctx, "documents", args.certificateDocumentId, args.societyId);
  if (args.corporationClass && !["federal_corporation", "foreign_epca_licensed", "other"].includes(args.corporationClass)) throw new Error("Choose a supported corporation registration class.");
  if (args.corporationClass === "foreign_epca_licensed" && (canonicalizeJurisdictionCode(args.jurisdiction) !== "CA-ON-OBCA" || !args.licenceEvidenceDocumentId)) throw new Error("Ontario foreign EPCA licence classification requires an Ontario registration and licence evidence.");
  if (args.licenceEvidenceDocumentId) await getOwned(ctx, "documents", args.licenceEvidenceDocumentId, args.societyId);

  await Promise.all([
    args.profileReportDocumentId
      ? getOwned(ctx, "documents", args.profileReportDocumentId, args.societyId)
      : Promise.resolve(),
    args.companyKeyVaultItemId
      ? getOwned(ctx, "secretVaultItems", args.companyKeyVaultItemId, args.societyId)
      : Promise.resolve(),
    ...(args.sourceDocumentIds ?? []).map((documentId) =>
      getOwned(ctx, "documents", documentId, args.societyId)),
  ]);
  assertAllowedOption("entityJurisdictions", args.jurisdiction, "Registration jurisdiction", false);
  assertAllowedOption("entityJurisdictions", args.homeJurisdiction, "Home jurisdiction");
  assertAllowedOption("registrationTypes", args.registrationType, "Registration type");
  assertAllowedOption("registrationStatuses", args.status, "Registration status");
  const now = new Date().toISOString();
  // `null` removes the stored value (the profile no longer edits it: a key typed there belongs in Access custody).
  const { registryPortalKey, ...rest } = args;
  const payload = {
    ...cleanObject({ ...rest, ...(registryPortalKey ? { registryPortalKey } : {}) }),
    ...(registryPortalKey === null && id ? { registryPortalKey: undefined } : {}),
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
  await requireOwnedRow(ctx, "organizationRegistrations", id);
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
  await requireSocietyMembership(ctx, args.societyId);
  if (id) await getOwned(ctx, "organizationIdentifiers", id, args.societyId);
  await Promise.all((args.sourceDocumentIds ?? []).map((documentId) =>
    getOwned(ctx, "documents", documentId, args.societyId)));
  assertAllowedOption("taxNumberTypes", args.kind, "Identifier kind", false);
  assertAllowedOption("entityJurisdictions", args.jurisdiction, "Identifier jurisdiction");
  assertAllowedOption("identifierStatuses", args.status, "Identifier status");
  assertAllowedOption("accessLevels", args.accessLevel, "Identifier access level");
  const registrationNumber = taxRegistrationNumber(args);
  const now = new Date().toISOString();
  const payload = {
    ...cleanObject(args),
    kind: cleanText(args.kind) || "other",
    number: registrationNumber || cleanText(args.number) || "Needs review",
    ...(args.kind === "pst" ? { jurisdiction: "CA-BC" } : {}),
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
  await requireOwnedRow(ctx, "organizationIdentifiers", id);
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
  await requireSocietyMembership(ctx, societyId);
  const society = await ctx.db.get(societyId);
  if (!society) throw new Error("Society not found.");
  const existing = await ctx.db
    .query("organizationAddresses")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const now = new Date().toISOString();
  let created = 0;

  const insertLegacy = async (type: string, address: unknown) => {
    const text = society.onboardingAnswersJson && typeof address === "string" ? normalizeAddressText(address) : cleanText(address);
    if (!text) return;
    if (existing.some((row) => row.type === type && row.status === "current")) return;
    await ctx.db.insert("organizationAddresses", {
      societyId,
      type,
      status: "current",
      ...(society.onboardingAnswersJson ? guidedAddressFields(text) : { street: text, city: "Needs review", country: "Canada" }),
      notes: society.onboardingAnswersJson ? "Created from guided setup address fields. Review any missing details." : "Created from legacy society address text. Review and split into structured fields.",
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
  await requireSocietyMembership(ctx, societyId);
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
    const text = society.onboardingAnswersJson && typeof address === "string" ? normalizeAddressText(address) : cleanText(address);
    if (!text) return;
    if (addresses.some((row) => row.type === type && row.status === "current")) return;
    await ctx.db.insert("organizationAddresses", {
      societyId,
      type,
      status: "current",
      ...(society.onboardingAnswersJson ? guidedAddressFields(text) : { street: text, city: "Needs review", country: "Canada" }),
      notes: society.onboardingAnswersJson ? "Backfilled from guided setup address fields. Review any missing details." : "Backfilled from legacy society address text. Review and split into structured fields.",
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

/** New guided records use the shared positional codec; legacy free text stays for review. */
function guidedAddressFields(text: string) {
  const address = parseAddressText(text);
  return { ...address, street: address.street || "Needs review", city: address.city || "Needs review", country: address.country || "Needs review" };
}

// ---------------------------------------------------------------------------
// Registry facts, recording an incorporation, and applying a registry import.
// ---------------------------------------------------------------------------

export const REGISTRATION_ATTORNEY_STATUSES = ["required", "not_required", "appointed"] as const;
export type RegistrationAttorneyStatus = (typeof REGISTRATION_ATTORNEY_STATUSES)[number];

/** One person who holds registry portal access (Online Filing Centre, BC Registry). */
export type RegistrationPortalAccess = { name: string; role?: string; updatedAtISO?: string; notes?: string };

/** Registry facts an `organizationRegistrations` row can carry beyond its number and date. */
export type RegistrationRegistryFacts = {
  /** "HH:mm" in the registry's local time. */
  registrationTime?: string;
  /** IANA zone of `registrationTime`, e.g. "America/Vancouver". */
  registrationTimeZone?: string;
  /** The entity's number in its home jurisdiction (on an extra-provincial registration). */
  homeCorporationNumber?: string;
  nameInHomeJurisdiction?: string;
  attorneyStatus?: RegistrationAttorneyStatus;
  attorneyNotRequiredReason?: string;
  reminderEmailsSubscribed?: boolean;
  publicRecordUrl?: string;
  certificateDocumentId?: string;
  portalAccess?: RegistrationPortalAccess[];
};

const REGISTRY_TEXT_MAX = 2000;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
/** Registry access keys are secrets; they go to the vault, never an identifier row. */
const KEY_IDENTIFIER_KINDS = new Set(["corporation_key", "company_key", "ontario_company_key"]);

function validateRegistrationRegistryFacts(args: RegistrationRegistryFacts) {
  if (args.registrationTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(args.registrationTime)) throw new Error("Registration time must be a 24-hour time (HH:mm).");
  if (args.registrationTimeZone && !isTimeZone(args.registrationTimeZone)) throw new Error("Registration time zone must be a time zone name such as America/Vancouver.");
  if (args.attorneyStatus && !(REGISTRATION_ATTORNEY_STATUSES as readonly string[]).includes(args.attorneyStatus)) throw new Error("Attorney status must be required, not required or appointed.");
  if (args.publicRecordUrl && !isHttpUrl(args.publicRecordUrl)) throw new Error("The public record link must be a web address (https://…).");
  for (const person of args.portalAccess ?? []) {
    if (!cleanText(person?.name)) throw new Error("Each person with registry portal access needs a name.");
  }
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** GST/HST and BC PST numbers in their registry form; validates the identifier's tax fields. */
function taxRegistrationNumber(args: { kind: string; number?: string; status?: string; jurisdiction?: string; registeredAt?: string }) {
  const registrationNumber = args.kind === "gst" ? normalizeGstRegistration(args.number ?? "")
    : args.kind === "pst" ? normalizeBcPstRegistration(args.number ?? "") : undefined;
  if (args.status === "active" && args.kind === "gst" && !registrationNumber) throw new Error("Enter the full GST/HST account number: nine digits, RT, then four digits (for example, 123456789RT0001). Keep uncertain registrations marked Needs review.");
  if (args.status === "active" && args.kind === "pst" && !registrationNumber) throw new Error("Enter the BC PST registration number in the form PST-1234-5678. Keep uncertain registrations marked Needs review.");
  if (args.kind === "pst" && args.jurisdiction && !["CA-BC", "british_columbia"].includes(args.jurisdiction)) throw new Error("The BC PST registration kind requires British Columbia. Use a separate identifier for another tax jurisdiction.");
  if (["gst", "pst"].includes(args.kind) && args.registeredAt && !isCalendarDate(args.registeredAt)) throw new Error("Choose a valid registration effective date.");
  return registrationNumber;
}

function requireRegistryText(value: unknown, label: string, max = REGISTRY_TEXT_MAX): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  if (CONTROL_CHARACTERS.test(trimmed)) throw new Error(`${label} contains characters that can't be saved.`);
  return trimmed;
}

function requireRegistryDate(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (!isCalendarDate(value)) throw new Error(`${label} must be a valid date (YYYY-MM-DD).`);
  return value;
}

function actorDisplayName(ctx: PortableQueryCtx, user: Record<string, unknown>) {
  return String(user.displayName ?? "").trim() || (ctx.principal.kind === "service" ? "Service" : "You");
}

async function logOrganizationActivity(ctx: PortableMutationCtx, societyId: string, actor: string, action: string, summary: string) {
  await ctx.db.insert("activity", {
    societyId, actor, entityType: "society", subjectId: societyId,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
    entityId: societyId,
    action, summary: summary.slice(0, 300), createdAtISO: new Date().toISOString(),
  });
}

/** The society's own registration row: the linked primary when it is a home row, else any home row. */
async function findHomeRegistration(ctx: PortableQueryCtx, society: PortableDoc) {
  const societyId = String(society._id);
  if (society.primaryRegistrationId) {
    const primary = await ctx.db.get(String(society.primaryRegistrationId), "organizationRegistrations");
    if (primary && primary.societyId === societyId && (!primary.registrationType || primary.registrationType === "home")) return primary;
  }
  const rows = await ctx.db
    .query("organizationRegistrations")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  return rows.find((row) => row.registrationType === "home") ?? null;
}

export type RecordIncorporationArgs = {
  societyId: string;
  incorporationNumber: string;
  /** YYYY-MM-DD, the date on the certificate. */
  incorporationDate: string;
  certificateEvidenceDocumentId: string;
  /** Defaults to the incorporation number. */
  certificateReference?: string;
  actFormedUnder?: string;
  /** Defaults to the incorporation date. */
  registeredOfficeEffectiveFrom?: string;
  /** Defaults to true. */
  makeRegisteredOfficeCurrent?: boolean;
};

export type RecordIncorporationResult = {
  registeredOfficeUpdated: boolean;
  /** Null only when there is no home row and no home jurisdiction to create one in. */
  homeRegistrationId: string | null;
};

/**
 * Turns a preparing or submitted organization into a verified incorporated one
 * from its certificate: the certificate must be an uploaded file that passes
 * `validateFormationEvidence`. Also makes the proposed registered office
 * current and activates the home registration with the number and date.
 */
export async function recordIncorporationPortable(ctx: PortableMutationCtx, args: RecordIncorporationArgs): Promise<RecordIncorporationResult> {
  const user = await requirePermissionPortable(ctx, args.societyId, "society:write");
  const society = await ctx.db.get(args.societyId, "societies");
  if (!society) throw new Error("Organization not found.");
  const incorporationNumber = requireRegistryText(args.incorporationNumber, "Incorporation number", 64);
  if (!incorporationNumber) throw new Error("Enter the number shown on the certificate.");
  const incorporationDate = requireRegistryDate(args.incorporationDate, "Incorporation date");
  if (!incorporationDate) throw new Error("Enter the date shown on the certificate.");
  if (incorporationDate > organizationToday(society)) throw new Error("The incorporation date can't be in the future.");
  const certificateReference = requireRegistryText(args.certificateReference, "Certificate reference", 120) ?? incorporationNumber;
  const actFormedUnder = requireRegistryText(args.actFormedUnder, "Act formed under", 200);
  assertAllowedOption("actsFormedUnder", actFormedUnder, "Act formed under");
  const effectiveFrom = requireRegistryDate(args.registeredOfficeEffectiveFrom, "Registered office effective date") ?? incorporationDate;
  // Recording again with the same number and date is a no-op; anything else is a correction, not a recording.
  if (society.formationStatus === "incorporated") {
    if (registrationNumberKey(society.incorporationNumber) === registrationNumberKey(incorporationNumber) && society.incorporationDate === incorporationDate) {
      const home = await findHomeRegistration(ctx, society);
      return { registeredOfficeUpdated: false, homeRegistrationId: home ? String(home._id) : null };
    }
    throw new Error("The incorporation is already recorded with a different number or date. Correct those on the Legal profile instead.");
  }

  const document = await getOwned(ctx, "documents", args.certificateEvidenceDocumentId, args.societyId);
  const versions = await ctx.db.query("documentVersions").withIndex("by_document", (q) => q.eq("documentId", document._id)).collect();
  const formation = {
    ...society,
    formationStatus: "incorporated",
    certificateEvidenceDocumentId: args.certificateEvidenceDocumentId,
    certificateReference,
    certificateDate: incorporationDate,
    incorporationNumber,
    incorporationDate,
    ...(actFormedUnder ? { actFormedUnder } : {}),
  };
  validateEntitySetup(formation);
  validateFormationEvidence(formation, args.societyId, document, versions);
  const organizationStatus = organizationStatusForFormation("incorporated", society.organizationStatus);
  const anniversaryDate = certificateAnniversaryDate(society, formation);
  const patch = {
    formationStatus: "incorporated",
    incorporationNumber,
    incorporationDate,
    certificateDate: incorporationDate,
    certificateReference,
    certificateEvidenceDocumentId: args.certificateEvidenceDocumentId,
    ...(anniversaryDate ? { anniversaryDate } : {}),
    ...(organizationStatus ? { organizationStatus } : {}),
    ...(actFormedUnder ? { actFormedUnder } : {}),
    updatedAt: Date.now(),
  };
  validateWorkspaceLegalIdentity({ ...society, ...patch });

  const nowISO = new Date().toISOString();
  let registeredOfficeUpdated = false;
  if (args.makeRegisteredOfficeCurrent !== false) {
    const offices = await ctx.db
      .query("organizationAddresses")
      .withIndex("by_society_type", (q) => q.eq("societyId", args.societyId).eq("type", "registered_office"))
      .collect();
    const proposed = proposedRegisteredOffice(offices);
    if (proposed) {
      for (const row of offices) {
        if (row._id === proposed._id || row.status !== "current") continue;
        await ctx.db.patch(row._id, { status: "past", effectiveTo: effectiveFrom, updatedAtISO: nowISO });
      }
      await ctx.db.patch(proposed._id, { status: "current", effectiveFrom, updatedAtISO: nowISO });
      registeredOfficeUpdated = true;
    }
  }

  const home = await findHomeRegistration(ctx, society);
  const registration = {
    status: "active",
    registrationNumber: incorporationNumber,
    registrationDate: incorporationDate,
    certificateDocumentId: args.certificateEvidenceDocumentId,
    updatedAtISO: nowISO,
  };
  let homeRegistrationId: string | null = home ? String(home._id) : null;
  if (home) {
    // A note someone wrote on the home row is kept.
    const keepNotes = Boolean(cleanText(home.notes));
    await ctx.db.patch(String(home._id), { ...registration, ...(home.status === "pending" && !keepNotes ? { notes: "Created automatically from the workspace home jurisdiction." } : {}) });
  } else {
    const jurisdiction = society.homeJurisdictionCode ?? society.jurisdictionCode;
    if (jurisdiction) {
      homeRegistrationId = await ctx.db.insert("organizationRegistrations", {
        societyId: args.societyId, registrationType: "home", jurisdiction, homeJurisdiction: jurisdiction,
        representativeIds: [], notes: "Created automatically from the workspace home jurisdiction.", createdAtISO: nowISO, ...registration,
      });
    }
  }
  await ctx.db.patch(args.societyId, { ...patch, ...(homeRegistrationId && !society.primaryRegistrationId ? { primaryRegistrationId: homeRegistrationId } : {}) });
  await logOrganizationActivity(ctx, args.societyId, actorDisplayName(ctx, user), "incorporation_recorded",
    `Incorporation recorded from the certificate (${incorporationNumber}, ${incorporationDate})${registeredOfficeUpdated ? "; registered office now current" : ""}`);
  return { registeredOfficeUpdated, homeRegistrationId };
}

// --- applyRegistryImport ---------------------------------------------------

export type RegistryImportProfile = {
  name?: string;
  incorporationNumber?: string;
  incorporationDate?: string;
  anniversaryDate?: string;
  actFormedUnder?: string;
  jurisdictionCode?: string;
  articlesMinDirectors?: number;
  articlesMaxDirectors?: number;
  articlesShareTransferRestrictions?: string;
  articlesBusinessRestrictions?: string;
  articlesOtherProvisions?: string;
  articlesSourceDocumentId?: string;
  craBnStatus?: string;
  craRcStatus?: string;
  officialEmail?: string;
};

export type RegistryImportRegistration = RegistrationRegistryFacts & {
  /** The stored row to patch (the one the review compared against); without it rows are matched. */
  id?: string;
  registrationType: string;
  jurisdiction: string;
  homeJurisdiction?: string;
  registrationNumber?: string;
  registrationDate?: string;
  sourceDocumentIds?: string[];
  status?: string;
};

export type RegistryImportAddress = {
  type: string;
  status: string;
  street: string;
  unit?: string;
  city: string;
  provinceState?: string;
  postalCode?: string;
  country: string;
  effectiveFrom?: string;
  sourceDocumentIds?: string[];
};

export type RegistryImportIdentifier = {
  /** The stored row to patch (the one the review compared against); without it rows are matched. */
  id?: string;
  kind: string;
  number: string;
  jurisdiction?: string;
  registeredAt?: string;
  status: string;
  accessLevel: string;
  sourceDocumentIds?: string[];
};

export type RegistryImportCorporationKey = {
  /** The key itself. Never logged, never written to activity text. */
  value: string;
  /** Vault record name, e.g. "Corporation key". */
  label: string;
  /** Where the key was read from (the restricted information sheet). */
  sourceDocumentIds?: string[];
};

export type ApplyRegistryImportArgs = {
  societyId: string;
  profile?: RegistryImportProfile;
  registrations?: RegistryImportRegistration[];
  addresses?: RegistryImportAddress[];
  identifiers?: RegistryImportIdentifier[];
  corporationKey?: RegistryImportCorporationKey;
};

export type RegistryImportSectionResult = { created: number; updated: number; unchanged: number; ids: string[] };

export type ApplyRegistryImportResult = {
  /**
   * `updated` is 1 when any profile field changed; `fields` names them.
   * `deferred`: fields left for "Record incorporation" (the number and date of
   * an organization still preparing or filed).
   */
  profile: RegistryImportSectionResult & { fields: string[]; deferred: string[] };
  registrations: RegistryImportSectionResult;
  /**
   * `demotedIds`: current rows of the same type moved to past. `pastIds`:
   * imported addresses kept as past because a newer current one is on file.
   */
  addresses: RegistryImportSectionResult & { demotedIds: string[]; pastIds: string[] };
  identifiers: RegistryImportSectionResult;
  /** `valueStored` is false when the runtime can't encrypt: only where the key is kept is recorded. */
  corporationKey: (RegistryImportSectionResult & { valueStored: boolean }) | null;
};

/**
 * Stores a corporation key in the vault. Hosted Convex supplies one that
 * encrypts the value; without it the import records custody only.
 */
export type CorporationKeyVaultWriter = (input: {
  societyId: string;
  value: string;
  label: string;
  existingVaultItemId?: string;
  sourceDocumentIds: string[];
  actorName: string;
}) => Promise<{ vaultItemId: string; outcome: "created" | "updated" | "unchanged" }>;

export const CORPORATION_KEY_CUSTODY_LOCATION = "Corporation Information Sheet, restricted document";

const PROFILE_TEXT_FIELDS = [
  "name", "incorporationNumber", "actFormedUnder", "jurisdictionCode",
  "articlesShareTransferRestrictions", "articlesBusinessRestrictions", "articlesOtherProvisions",
  "craBnStatus", "craRcStatus", "officialEmail",
] as const;

const REGISTRATION_TEXT_FIELDS = [
  "homeJurisdiction", "registrationNumber", "registrationTime", "registrationTimeZone",
  "homeCorporationNumber", "nameInHomeJurisdiction", "attorneyStatus", "attorneyNotRequiredReason",
  "publicRecordUrl", "status",
] as const;

function emptySection(): RegistryImportSectionResult {
  return { created: 0, updated: 0, unchanged: 0, ids: [] };
}

function sameValue(a: unknown, b: unknown) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Only the fields whose value differs from the stored row. */
function changedFields(row: PortableDoc, candidate: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(candidate).filter(([key, value]) => value !== undefined && !sameValue(row[key], value)));
}

function unionIds(existing: unknown, incoming: string[] | undefined) {
  const current = Array.isArray(existing) ? existing.map(String) : [];
  const merged = Array.from(new Set([...current, ...(incoming ?? []).map(String)]));
  return merged.length === current.length ? undefined : merged;
}

function registrationNumberKey(value: unknown) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function streetKey(value: unknown) {
  return String(value ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function postalKey(value: unknown) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function identifierDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

/** People with portal access, merged by name: an incoming entry replaces the one with the same name. */
function mergePortalAccess(existing: unknown, incoming: RegistrationPortalAccess[] | undefined) {
  if (!incoming) return undefined;
  const rows = Array.isArray(existing) ? (existing as RegistrationPortalAccess[]).slice() : [];
  for (const person of incoming) {
    const name = cleanText(person.name) ?? "";
    const role = cleanText(person.role);
    const updatedAtISO = cleanText(person.updatedAtISO);
    const notes = cleanText(person.notes);
    const entry: RegistrationPortalAccess = {
      name,
      ...(role ? { role } : {}),
      ...(updatedAtISO ? { updatedAtISO } : {}),
      ...(notes ? { notes } : {}),
    };
    const index = rows.findIndex((row) => String(row.name ?? "").trim().toLowerCase() === name.toLowerCase());
    if (index >= 0) rows[index] = { ...rows[index], ...entry };
    else rows.push(entry);
  }
  return rows;
}

async function requireOwnedDocuments(ctx: PortableQueryCtx, societyId: string, ids: (string | undefined)[]) {
  await Promise.all(Array.from(new Set(ids.filter((id): id is string => Boolean(id))))
    .map((documentId) => getOwned(ctx, "documents", documentId, societyId)));
}

function validateImportProfile(profile: RegistryImportProfile) {
  const cleaned: Record<string, string | number> = {};
  for (const field of PROFILE_TEXT_FIELDS) {
    const value = requireRegistryText(profile[field], field === "name" ? "Name" : field, field.startsWith("articles") ? 20000 : 300);
    if (value !== undefined) cleaned[field] = value;
  }
  for (const field of ["incorporationDate", "anniversaryDate"] as const) {
    const value = requireRegistryDate(profile[field], field === "incorporationDate" ? "Incorporation date" : "Anniversary date");
    if (value) cleaned[field] = value;
  }
  for (const field of ["articlesMinDirectors", "articlesMaxDirectors"] as const) {
    const value = profile[field];
    if (value !== undefined && value !== null) cleaned[field] = value;
  }
  validateArticlesProvisions(cleaned);
  for (const field of ["craBnStatus", "craRcStatus"] as const) {
    if (cleaned[field] && !TAX_STATUS_OPTIONS.some((option) => option.value === cleaned[field])) throw new Error(`${field === "craBnStatus" ? "Business number" : "Corporate income tax account"} status must be unknown, not required, pending or confirmed.`);
  }
  assertAllowedOption("actsFormedUnder", cleaned.actFormedUnder, "Act formed under");
  if (cleaned.officialEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(cleaned.officialEmail))) throw new Error("Enter a valid registry notification email.");
  if (profile.articlesSourceDocumentId) cleaned.articlesSourceDocumentId = profile.articlesSourceDocumentId;
  return cleaned;
}

function validateImportRegistration(row: RegistryImportRegistration) {
  assertAllowedOption("registrationTypes", row.registrationType, "Registration type", false);
  assertAllowedOption("entityJurisdictions", row.jurisdiction, "Registration jurisdiction", false);
  assertAllowedOption("entityJurisdictions", row.homeJurisdiction, "Home jurisdiction");
  assertAllowedOption("registrationStatuses", row.status, "Registration status");
  const cleaned: Record<string, string | boolean> = {
    registrationType: cleanText(row.registrationType) ?? "",
    jurisdiction: cleanText(row.jurisdiction) ?? "",
  };
  for (const field of REGISTRATION_TEXT_FIELDS) {
    const value = requireRegistryText(row[field], field);
    if (value !== undefined) cleaned[field] = value;
  }
  const registrationDate = requireRegistryDate(row.registrationDate, "Registration date");
  if (registrationDate) cleaned.registrationDate = registrationDate;
  if (row.reminderEmailsSubscribed !== undefined) cleaned.reminderEmailsSubscribed = row.reminderEmailsSubscribed;
  if (row.certificateDocumentId) cleaned.certificateDocumentId = row.certificateDocumentId;
  validateRegistrationRegistryFacts({ ...cleaned, portalAccess: row.portalAccess } as RegistrationRegistryFacts);
  return cleaned;
}

function validateImportAddress(row: RegistryImportAddress) {
  assertAllowedOption("addressTypes", row.type, "Address type", false);
  assertAllowedOption("addressStatuses", row.status, "Address status", false);
  const street = requireRegistryText(row.street, "Street", 300);
  const city = requireRegistryText(row.city, "City", 120);
  const country = requireRegistryText(row.country, "Country", 120);
  if (!street || !city || !country) throw new Error("Each address needs a street, city and country.");
  return {
    type: cleanText(row.type) ?? "",
    status: cleanText(row.status) ?? "",
    street,
    city,
    country,
    unit: requireRegistryText(row.unit, "Unit", 60),
    provinceState: requireRegistryText(row.provinceState, "Province or state", 120),
    postalCode: requireRegistryText(row.postalCode, "Postal code", 20),
    effectiveFrom: requireRegistryDate(row.effectiveFrom, "Address effective date"),
  };
}

function validateImportIdentifier(row: RegistryImportIdentifier) {
  const kind = cleanText(row.kind) ?? "";
  if (KEY_IDENTIFIER_KINDS.has(kind)) throw new Error("A registry access key is a secret. Import it as the corporation key so only the vault holds it.");
  assertAllowedOption("taxNumberTypes", kind, "Identifier kind", false);
  assertAllowedOption("entityJurisdictions", row.jurisdiction, "Identifier jurisdiction");
  assertAllowedOption("identifierStatuses", row.status, "Identifier status", false);
  assertAllowedOption("accessLevels", row.accessLevel, "Identifier access level", false);
  const number = requireRegistryText(row.number, "Identifier number", 64);
  if (!number) throw new Error("Each identifier needs a number.");
  const registeredAt = requireRegistryDate(row.registeredAt, "Identifier registration date");
  const normalized = taxRegistrationNumber({ kind, number, status: row.status, jurisdiction: row.jurisdiction, registeredAt });
  return {
    kind,
    number: normalized || number,
    jurisdiction: kind === "pst" ? "CA-BC" : cleanText(row.jurisdiction),
    registeredAt,
    status: cleanText(row.status) ?? "",
    accessLevel: cleanText(row.accessLevel) ?? "",
  };
}

/**
 * Atomically applies a reviewed registry-document proposal. Rows are matched
 * rather than duplicated, only provided fields are merged, and source document
 * lists are unioned. It never changes `formationStatus`: an incorporation is
 * recorded only through `recordIncorporationPortable`.
 */
export async function applyRegistryImportPortable(
  ctx: PortableMutationCtx,
  args: ApplyRegistryImportArgs,
  options: { corporationKeyVault?: CorporationKeyVaultWriter } = {},
): Promise<ApplyRegistryImportResult> {
  const { societyId } = args;
  const user = await requirePermissionPortable(ctx, societyId, "society:write");
  const society = await ctx.db.get(societyId, "societies");
  if (!society) throw new Error("Organization not found.");
  const actor = actorDisplayName(ctx, user);
  const nowISO = new Date().toISOString();

  // Validate everything before the first write.
  const profile = args.profile ? validateImportProfile(args.profile) : undefined;
  const registrations = (args.registrations ?? []).map((row) => ({ input: row, cleaned: validateImportRegistration(row) }));
  const addresses = (args.addresses ?? []).map((row) => ({ input: row, cleaned: validateImportAddress(row) }));
  const identifiers = (args.identifiers ?? []).map((row) => ({ input: row, cleaned: validateImportIdentifier(row) }));
  const currentTypes = addresses.filter((row) => row.cleaned.status === "current").map((row) => row.cleaned.type);
  if (new Set(currentTypes).size !== currentTypes.length) throw new Error("Only one current address of each type can be imported at a time.");
  const corporationKeyValue = args.corporationKey ? requireRegistryText(args.corporationKey.value, "Corporation key", 200) : undefined;
  const corporationKeyLabel = args.corporationKey ? requireRegistryText(args.corporationKey.label, "Corporation key label", 120) : undefined;
  if (args.corporationKey && (!corporationKeyValue || !corporationKeyLabel)) throw new Error("The corporation key needs a value and a label.");
  if (args.corporationKey) await requireRolePortable(ctx, { societyId, required: "Admin" });
  await requireOwnedDocuments(ctx, societyId, [
    args.profile?.articlesSourceDocumentId,
    ...registrations.flatMap(({ input }) => [input.certificateDocumentId, ...(input.sourceDocumentIds ?? [])]),
    ...addresses.flatMap(({ input }) => input.sourceDocumentIds ?? []),
    ...identifiers.flatMap(({ input }) => input.sourceDocumentIds ?? []),
    ...(args.corporationKey?.sourceDocumentIds ?? []),
  ]);
  // Rows the review compared against must belong to this organization.
  const registrationTargets = new Map<string, PortableDoc>();
  for (const { input } of registrations) if (input.id) registrationTargets.set(input.id, await getOwned(ctx, "organizationRegistrations", input.id, societyId));
  const identifierTargets = new Map<string, PortableDoc>();
  for (const { input, cleaned } of identifiers) {
    if (!input.id) continue;
    const row = await getOwned(ctx, "organizationIdentifiers", input.id, societyId);
    if (row.kind !== cleaned.kind) throw new Error("An imported identifier can only replace one of the same kind.");
    identifierTargets.set(input.id, row);
  }

  const result: ApplyRegistryImportResult = {
    profile: { ...emptySection(), fields: [], deferred: [] },
    registrations: emptySection(),
    addresses: { ...emptySection(), demotedIds: [], pastIds: [] },
    identifiers: emptySection(),
    corporationKey: null,
  };

  // Profile. formationStatus is never part of it.
  if (profile) {
    const candidate: Record<string, unknown> = { ...profile };
    if (profile.jurisdictionCode) candidate.homeJurisdictionCode = profile.jurisdictionCode;
    if (society.formationStatus === "incorporated" && profile.incorporationDate && profile.incorporationDate !== society.certificateDate) {
      throw new Error("The incorporation date comes from the recorded certificate. Correct it on the Legal profile instead.");
    }
    // Before the certificate is recorded, the number and date wait for
    // "Record incorporation"; a preparing organization can't hold them yet.
    if (isPreparingIncorporation({ formationStatus: society.formationStatus, organizationStatus: society.organizationStatus })) {
      for (const field of ["incorporationNumber", "incorporationDate"] as const) {
        if (candidate[field] === undefined) continue;
        delete candidate[field];
        result.profile.deferred.push(field);
      }
    }
    const patch = changedFields(society, candidate);
    validateArticlesProvisions({
      articlesMinDirectors: "articlesMinDirectors" in patch ? patch.articlesMinDirectors : society.articlesMinDirectors,
      articlesMaxDirectors: "articlesMaxDirectors" in patch ? patch.articlesMaxDirectors : society.articlesMaxDirectors,
    });
    validateWorkspaceLegalIdentityUpdate(society, patch);
    if (Object.keys(patch).length) {
      await ctx.db.patch(societyId, { ...patch, updatedAt: Date.now() });
      result.profile.updated = 1;
      result.profile.ids.push(societyId);
      result.profile.fields = Object.keys(patch).filter((key) => key !== "homeJurisdictionCode");
    } else {
      result.profile.unchanged = 1;
    }
  }

  // Registrations: the row the review compared against, else by number, else by type and jurisdiction.
  if (registrations.length) {
    const existing = await ctx.db
      .query("organizationRegistrations")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    for (const { input, cleaned } of registrations) {
      const numberKey = registrationNumberKey(cleaned.registrationNumber);
      const jurisdictionKey = canonicalizeJurisdictionCode(String(cleaned.jurisdiction));
      const match = input.id ? existing.find((row) => String(row._id) === input.id) ?? registrationTargets.get(input.id)
        : (numberKey ? existing.find((row) => registrationNumberKey(row.registrationNumber) === numberKey) : undefined)
        ?? existing.find((row) => (row.registrationType ?? "extra_provincial") === cleaned.registrationType
          && canonicalizeJurisdictionCode(row.jurisdiction) === jurisdictionKey
          && (!numberKey || !registrationNumberKey(row.registrationNumber)));
      const candidate: Record<string, unknown> = { ...cleaned };
      if (match) {
        delete candidate.registrationType;
        delete candidate.jurisdiction;
        // The same number spelled differently ("1234567-8", "12345678") keeps its stored form.
        if (numberKey && registrationNumberKey(match.registrationNumber) === numberKey) delete candidate.registrationNumber;
        const sourceDocumentIds = unionIds(match.sourceDocumentIds, input.sourceDocumentIds);
        if (sourceDocumentIds) candidate.sourceDocumentIds = sourceDocumentIds;
        const portalAccess = mergePortalAccess(match.portalAccess, input.portalAccess);
        if (portalAccess) candidate.portalAccess = portalAccess;
        const patch = changedFields(match, candidate);
        if (Object.keys(patch).length) {
          await ctx.db.patch(match._id, { ...patch, updatedAtISO: nowISO });
          Object.assign(match, patch);
          result.registrations.updated += 1;
        } else {
          result.registrations.unchanged += 1;
        }
        result.registrations.ids.push(String(match._id));
        continue;
      }
      const row = {
        ...candidate,
        societyId,
        representativeIds: [],
        status: cleaned.status ?? "needs_review",
        ...(input.sourceDocumentIds?.length ? { sourceDocumentIds: Array.from(new Set(input.sourceDocumentIds)) } : {}),
        ...(input.portalAccess ? { portalAccess: mergePortalAccess([], input.portalAccess) } : {}),
        createdAtISO: nowISO,
        updatedAtISO: nowISO,
      };
      const id = await ctx.db.insert("organizationRegistrations", row);
      existing.push({ ...row, _id: id });
      result.registrations.created += 1;
      result.registrations.ids.push(String(id));
    }
  }

  // Addresses: by type, street and postal code. A current one retires the other
  // current rows of its type, unless one of them is newer: then the import is
  // the older address and is kept as past.
  if (addresses.length) {
    const existing = await ctx.db
      .query("organizationAddresses")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const currentByType = new Map<string, { id: string; effectiveFrom?: string }>();
    for (const { input, cleaned } of addresses) {
      const match = existing.find((row) => row.type === cleaned.type
        && streetKey(row.street) === streetKey(cleaned.street)
        && postalKey(row.postalCode) === postalKey(cleaned.postalCode));
      const newer = cleaned.status === "current" && cleaned.effectiveFrom
        ? existing.find((row) => row !== match && row.type === cleaned.type && row.status === "current" && row.effectiveFrom && String(row.effectiveFrom) > String(cleaned.effectiveFrom))
        : undefined;
      const status = newer ? "past" : cleaned.status;
      const effectiveTo = newer ? String(newer.effectiveFrom) : undefined;
      let id: string;
      if (match) {
        const candidate: Record<string, unknown> = { status, effectiveFrom: cleaned.effectiveFrom, effectiveTo };
        const sourceDocumentIds = unionIds(match.sourceDocumentIds, input.sourceDocumentIds);
        if (sourceDocumentIds) candidate.sourceDocumentIds = sourceDocumentIds;
        const patch = changedFields(match, candidate);
        if (Object.keys(patch).length) {
          await ctx.db.patch(match._id, { ...patch, updatedAtISO: nowISO });
          Object.assign(match, patch);
          result.addresses.updated += 1;
        } else {
          result.addresses.unchanged += 1;
        }
        id = String(match._id);
      } else {
        const row = {
          ...cleanObject({ ...cleaned, status, effectiveTo }),
          societyId,
          ...(input.sourceDocumentIds?.length ? { sourceDocumentIds: Array.from(new Set(input.sourceDocumentIds)) } : {}),
          createdAtISO: nowISO,
          updatedAtISO: nowISO,
        };
        id = await ctx.db.insert("organizationAddresses", row);
        existing.push({ ...row, _id: id });
        result.addresses.created += 1;
      }
      result.addresses.ids.push(id);
      if (newer) result.addresses.pastIds.push(id);
      if (status === "current") currentByType.set(cleaned.type, { id, effectiveFrom: cleaned.effectiveFrom });
    }
    for (const row of existing) {
      const current = currentByType.get(String(row.type));
      if (!current || row.status !== "current" || String(row._id) === current.id) continue;
      // Never retire a row that took effect after the imported one.
      if (current.effectiveFrom && row.effectiveFrom && String(row.effectiveFrom) > current.effectiveFrom) continue;
      await ctx.db.patch(row._id, { status: "past", ...(current.effectiveFrom && !row.effectiveTo ? { effectiveTo: current.effectiveFrom } : {}), updatedAtISO: nowISO });
      row.status = "past";
      result.addresses.demotedIds.push(String(row._id));
    }
  }

  // Identifiers: the row the review compared against, else by kind and the digits of the number.
  if (identifiers.length) {
    const existing = await ctx.db
      .query("organizationIdentifiers")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    for (const { input, cleaned } of identifiers) {
      const digits = identifierDigits(cleaned.number);
      const match = input.id ? existing.find((row) => String(row._id) === input.id) ?? identifierTargets.get(input.id)
        : digits ? existing.find((row) => row.kind === cleaned.kind && identifierDigits(row.number) === digits) : undefined;
      if (match) {
        const candidate: Record<string, unknown> = {
          // The same digits keep their stored spelling; a different number replaces it.
          ...(identifierDigits(match.number) !== digits ? { number: cleaned.number } : {}),
          jurisdiction: cleaned.jurisdiction,
          registeredAt: cleaned.registeredAt,
          status: cleaned.status,
          // An import never loosens access to a restricted identifier.
          accessLevel: match.accessLevel === "restricted" ? "restricted" : cleaned.accessLevel,
        };
        const sourceDocumentIds = unionIds(match.sourceDocumentIds, input.sourceDocumentIds);
        if (sourceDocumentIds) candidate.sourceDocumentIds = sourceDocumentIds;
        const patch = changedFields(match, candidate);
        if (Object.keys(patch).length) {
          await ctx.db.patch(match._id, { ...patch, updatedAtISO: nowISO });
          Object.assign(match, patch);
          result.identifiers.updated += 1;
        } else {
          result.identifiers.unchanged += 1;
        }
        result.identifiers.ids.push(String(match._id));
        continue;
      }
      const row = {
        ...cleanObject(cleaned),
        societyId,
        ...(input.sourceDocumentIds?.length ? { sourceDocumentIds: Array.from(new Set(input.sourceDocumentIds)) } : {}),
        createdAtISO: nowISO,
        updatedAtISO: nowISO,
      };
      const id = await ctx.db.insert("organizationIdentifiers", row);
      existing.push({ ...row, _id: id });
      result.identifiers.created += 1;
      result.identifiers.ids.push(String(id));
    }
  }

  // Corporation key: only the vault holds it.
  if (args.corporationKey && corporationKeyValue && corporationKeyLabel) {
    const linked = society.corporationKeyVaultItemId
      ? await ctx.db.get(String(society.corporationKeyVaultItemId), "secretVaultItems")
      : null;
    const existing = linked && linked.societyId === societyId ? linked : null;
    const sourceDocumentIds = Array.from(new Set(args.corporationKey.sourceDocumentIds ?? []));
    const stored = options.corporationKeyVault
      ? { ...(await options.corporationKeyVault({ societyId, value: corporationKeyValue, label: corporationKeyLabel, existingVaultItemId: existing ? String(existing._id) : undefined, sourceDocumentIds, actorName: actor })), valueStored: true }
      : { ...(await recordCorporationKeyCustody(ctx, { societyId, label: corporationKeyLabel, existing, sourceDocumentIds, actor, nowISO })), valueStored: false };
    if (stored.vaultItemId !== String(society.corporationKeyVaultItemId ?? "")) {
      await ctx.db.patch(societyId, { corporationKeyVaultItemId: stored.vaultItemId, updatedAt: Date.now() });
    }
    result.corporationKey = {
      created: stored.outcome === "created" ? 1 : 0,
      updated: stored.outcome === "updated" ? 1 : 0,
      unchanged: stored.outcome === "unchanged" ? 1 : 0,
      ids: [stored.vaultItemId],
      valueStored: stored.valueStored,
    };
  }

  const parts = [
    result.profile.fields.length ? `${result.profile.fields.length} profile field${result.profile.fields.length === 1 ? "" : "s"}` : "",
    sectionSummary("registration", result.registrations),
    sectionSummary("address", result.addresses, "addresses"),
    sectionSummary("identifier", result.identifiers),
    result.corporationKey ? (result.corporationKey.valueStored ? "corporation key held in the vault" : "corporation key custody recorded") : "",
  ].filter(Boolean);
  await logOrganizationActivity(ctx, societyId, actor, "registry_import_applied",
    `Registry documents imported: ${parts.length ? parts.join(", ") : "nothing changed"}`);
  return result;
}

function sectionSummary(noun: string, section: RegistryImportSectionResult, plural = `${noun}s`) {
  const changed = section.created + section.updated;
  if (!changed) return "";
  return `${changed} ${changed === 1 ? noun : plural}`;
}

/**
 * Without server-side encryption the key value is not stored anywhere: the
 * vault record says where the key is kept instead.
 */
async function recordCorporationKeyCustody(ctx: PortableMutationCtx, input: {
  societyId: string; label: string; existing: PortableDoc | null; sourceDocumentIds: string[]; actor: string; nowISO: string;
}): Promise<{ vaultItemId: string; outcome: "created" | "updated" | "unchanged" }> {
  const custody = {
    name: input.label,
    storageMode: "external_reference",
    externalLocation: CORPORATION_KEY_CUSTODY_LOCATION,
  };
  if (input.existing) {
    const existingId = String(input.existing._id);
    // A linked record that already holds an encrypted value keeps it.
    if (input.existing.secretEncrypted) return { vaultItemId: existingId, outcome: "unchanged" };
    const sourceDocumentIds = unionIds(input.existing.sourceDocumentIds, input.sourceDocumentIds);
    const patch = changedFields(input.existing, { ...custody, ...(sourceDocumentIds ? { sourceDocumentIds } : {}) });
    if (!Object.keys(patch).length) return { vaultItemId: existingId, outcome: "unchanged" };
    await ctx.db.patch(existingId, { ...patch, updatedAtISO: input.nowISO });
    await logVaultActivity(ctx, input.societyId, existingId, input.actor, "updated", `Updated access vault record "${input.label}".`);
    return { vaultItemId: existingId, outcome: "updated" };
  }
  const id = await ctx.db.insert("secretVaultItems", {
    societyId: input.societyId,
    ...custody,
    service: "Corporate registry",
    credentialType: "registry_key",
    revealPolicy: "owner_admin_custodian",
    status: "NeedsReview",
    sensitivity: "high",
    accessLevel: "restricted",
    ...(input.sourceDocumentIds.length ? { sourceDocumentIds: input.sourceDocumentIds } : {}),
    notes: "The key itself is not stored here. It is on the restricted Corporation Information Sheet.",
    createdAtISO: input.nowISO,
    updatedAtISO: input.nowISO,
  });
  await logVaultActivity(ctx, input.societyId, id, input.actor, "created", `Created access vault record "${input.label}".`);
  return { vaultItemId: id, outcome: "created" };
}

async function logVaultActivity(ctx: PortableMutationCtx, societyId: string, id: string, actor: string, action: string, summary: string) {
  await ctx.db.insert("activity", {
    societyId,
    actor,
    entityType: "secretVaultItem",
    subjectId: id,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
    entityId: id,
    action,
    summary,
    createdAtISO: new Date().toISOString(),
  });
}
