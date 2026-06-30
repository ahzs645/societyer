/**
 * PORTABLE FUNCTIONS: the role-holder (directors/officers/members register) and
 * rights-ledger read domains of legalOperations.
 *
 * Only the pure `ctx.db` handlers live here:
 *   - listRoleHolders   (query)    — the live register, name-sorted.
 *   - upsertRoleHolder  (mutation) — insert/patch with edit-history revisioning
 *                                    and the People Directory reference gate.
 *   - removeRoleHolder  (mutation) — delete with a final closed revision.
 *   - rightsLedger      (query)    — cap-table snapshot (optionally as-of a date).
 *
 * Option validation (`assertAllowedOption`), text normalization, the person
 * reference constraint, and the revision planner are all dependency-free shared
 * modules, so every handler runs unchanged on hosted Convex, the local Dexie
 * runtime, and the convex-test oracle.
 */

import { assertAllowedOption } from "../orgHubOptions";
import { cleanText, cleanList } from "./text";
import { normalizeGender } from "../nlg";
import { planRoleHolderRevision } from "../roleHolderHistory";
import { personReferenceConstraint, validatePersonReference } from "../personReference";
import { materializeRightsHoldings } from "../equityLedger";
import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

/** Keep transfers on/before an as-of date (date-only compare, inclusive). */
function transfersAsOf(transfers: any[], asOf?: string): any[] {
  if (!asOf) return transfers;
  return transfers.filter((t) => String(t.transferDate ?? t.createdAtISO ?? "").slice(0, 10) <= asOf);
}

/**
 * Validate a person reference and return the directoryPersonId to persist.
 * Strict societies require a resolving directory record; free societies drop an
 * unresolved id. Pure `ctx.db.get` reads, so it ports cleanly.
 */
async function enforcePersonReference(
  ctx: PortableMutationCtx,
  societyId: string,
  name: string,
  directoryPersonId: any,
): Promise<any> {
  const society = await ctx.db.get(societyId);
  const constraint = personReferenceConstraint(society?.restrictPeoplePicker);
  const candidate = directoryPersonId ? String(directoryPersonId) : null;

  let exists = false;
  if (candidate) {
    const person = await ctx.db.get(directoryPersonId);
    exists = person != null;
  }

  const result = validatePersonReference(
    { name, directoryPersonId: candidate },
    constraint,
    (id) => id === candidate && exists,
  );
  if (!result.ok) {
    throw new Error(
      result.error ?? "This society requires people to be selected from the directory.",
    );
  }
  return result.directoryPersonId ? directoryPersonId : undefined;
}

export async function listRoleHoldersPortable(
  ctx: PortableQueryCtx,
  { societyId }: { societyId: string },
) {
  const rows = await ctx.db.query("roleHolders").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  return rows.sort((a, b) => String(a.fullName).localeCompare(String(b.fullName)));
}

export interface UpsertRoleHolderArgs {
  id?: string;
  societyId: string;
  roleType: string;
  status?: string;
  fullName: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  signerTag?: string;
  membershipId?: string;
  membershipClassName?: string;
  membershipClassId?: string;
  officerTitle?: string;
  directorTerm?: string;
  startDate?: string;
  endDate?: string;
  referenceDate?: string;
  street?: string;
  unit?: string;
  city?: string;
  provinceState?: string;
  postalCode?: string;
  country?: string;
  alternateStreet?: string;
  alternateUnit?: string;
  alternateCity?: string;
  alternateProvinceState?: string;
  alternatePostalCode?: string;
  alternateCountry?: string;
  serviceStreet?: string;
  serviceUnit?: string;
  serviceCity?: string;
  serviceProvinceState?: string;
  servicePostalCode?: string;
  serviceCountry?: string;
  ageOver18?: boolean;
  dateOfBirth?: string;
  occupation?: string;
  citizenshipResidency?: string;
  citizenshipCountries?: string[];
  taxResidenceCountries?: string[];
  nonNaturalPerson?: boolean;
  nonNaturalPersonType?: string;
  nonNaturalJurisdiction?: string;
  natureOfControl?: string;
  authorizedRepresentative?: boolean;
  relatedRoleHolderId?: string;
  relatedShareholderIds?: string[];
  controllingIndividualIds?: string[];
  extraProvincialRegistrationId?: string;
  directoryPersonId?: string;
  gender?: string;
  pronouns?: string;
  actorUserId?: string;
  sourceDocumentIds?: string[];
  sourceExternalIds?: string[];
  notes?: string;
}

export async function upsertRoleHolderPortable(
  ctx: PortableMutationCtx,
  { id, ...args }: UpsertRoleHolderArgs,
): Promise<string> {
  assertAllowedOption("representativeTypes", args.roleType, "Role-holder type", false);
  assertAllowedOption("roleHolderStatuses", args.status, "Role-holder status");
  assertAllowedOption("officerTitles", args.officerTitle, "Officer title");
  assertAllowedOption("directorTerms", args.directorTerm, "Director term");
  assertAllowedOption("citizenshipResidencies", args.citizenshipResidency, "Citizenship/residency");
  // Enforce the society's People Directory constraint (free unless restricted).
  const directoryPersonId = await enforcePersonReference(
    ctx,
    args.societyId,
    args.fullName,
    args.directoryPersonId,
  );
  const now = new Date().toISOString();
  const payload = {
    societyId: args.societyId,
    roleType: cleanText(args.roleType) || "authorized_representative",
    status: cleanText(args.status) || "current",
    fullName: cleanText(args.fullName) || [args.firstName, args.lastName].map(cleanText).filter(Boolean).join(" ") || "Unnamed role holder",
    firstName: cleanText(args.firstName),
    middleName: cleanText(args.middleName),
    lastName: cleanText(args.lastName),
    email: cleanText(args.email),
    phone: cleanText(args.phone),
    signerTag: cleanText(args.signerTag),
    membershipId: cleanText(args.membershipId),
    membershipClassName: cleanText(args.membershipClassName),
    membershipClassId: args.membershipClassId,
    officerTitle: cleanText(args.officerTitle),
    directorTerm: cleanText(args.directorTerm),
    startDate: cleanText(args.startDate),
    endDate: cleanText(args.endDate),
    referenceDate: cleanText(args.referenceDate),
    street: cleanText(args.street),
    unit: cleanText(args.unit),
    city: cleanText(args.city),
    provinceState: cleanText(args.provinceState),
    postalCode: cleanText(args.postalCode),
    country: cleanText(args.country),
    alternateStreet: cleanText(args.alternateStreet),
    alternateUnit: cleanText(args.alternateUnit),
    alternateCity: cleanText(args.alternateCity),
    alternateProvinceState: cleanText(args.alternateProvinceState),
    alternatePostalCode: cleanText(args.alternatePostalCode),
    alternateCountry: cleanText(args.alternateCountry),
    serviceStreet: cleanText(args.serviceStreet),
    serviceUnit: cleanText(args.serviceUnit),
    serviceCity: cleanText(args.serviceCity),
    serviceProvinceState: cleanText(args.serviceProvinceState),
    servicePostalCode: cleanText(args.servicePostalCode),
    serviceCountry: cleanText(args.serviceCountry),
    ageOver18: args.ageOver18,
    dateOfBirth: cleanText(args.dateOfBirth),
    occupation: cleanText(args.occupation),
    citizenshipResidency: cleanText(args.citizenshipResidency),
    citizenshipCountries: cleanList(args.citizenshipCountries),
    taxResidenceCountries: cleanList(args.taxResidenceCountries),
    nonNaturalPerson: args.nonNaturalPerson,
    nonNaturalPersonType: cleanText(args.nonNaturalPersonType),
    nonNaturalJurisdiction: cleanText(args.nonNaturalJurisdiction),
    natureOfControl: cleanText(args.natureOfControl),
    authorizedRepresentative: args.authorizedRepresentative,
    relatedRoleHolderId: args.relatedRoleHolderId,
    relatedShareholderIds: cleanList(args.relatedShareholderIds),
    controllingIndividualIds: cleanList(args.controllingIndividualIds),
    extraProvincialRegistrationId: args.extraProvincialRegistrationId,
    directoryPersonId,
    gender: normalizeGender(args.gender),
    pronouns: cleanText(args.pronouns),
    sourceDocumentIds: args.sourceDocumentIds ?? [],
    sourceExternalIds: cleanList(args.sourceExternalIds),
    notes: cleanText(args.notes),
    updatedAtISO: now,
  };
  if (id) {
    const existing = await ctx.db.get(id);
    if (existing) {
      // Append the prior version to the edit history, then patch the live row.
      const { revision, liveStamps } = planRoleHolderRevision(existing, now, args.actorUserId);
      await ctx.db.insert("roleHolderRevisions", { societyId: args.societyId, ...revision, createdAtISO: now });
      await ctx.db.patch(id, { ...payload, ...liveStamps });
      return id;
    }
    await ctx.db.patch(id, payload);
    return id;
  }
  return await ctx.db.insert("roleHolders", {
    ...payload,
    enteredAtISO: now,
    enteredByUserId: args.actorUserId,
    createdAtISO: now,
  });
}

export async function removeRoleHolderPortable(
  ctx: PortableMutationCtx,
  { id, actorUserId }: { id: string; actorUserId?: string },
): Promise<void> {
  // Capture a final closed revision before deleting, so the audit trail records
  // the removal (and the last known values).
  const existing = await ctx.db.get(id);
  if (existing) {
    const now = new Date().toISOString();
    const { revision } = planRoleHolderRevision(existing, now, actorUserId);
    await ctx.db.insert("roleHolderRevisions", { societyId: existing.societyId, ...revision, createdAtISO: now });
  }
  await ctx.db.delete(id);
}

export async function rightsLedgerPortable(
  ctx: PortableQueryCtx,
  { societyId, asOf }: { societyId: string; asOf?: string },
) {
  const [classes, transfers, roleHolders] = await Promise.all([
    ctx.db.query("rightsClasses").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("rightsholdingTransfers").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("roleHolders").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  const scopedTransfers = transfersAsOf(transfers, asOf);
  const holdings = asOf
    ? materializeRightsHoldings(scopedTransfers as any)
    : await ctx.db.query("rightsHoldings").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  return {
    classes: classes.sort((a, b) => String(a.className).localeCompare(String(b.className))),
    holdings,
    transfers: scopedTransfers.sort((a, b) => String(b.transferDate ?? b.createdAtISO).localeCompare(String(a.transferDate ?? a.createdAtISO))),
    roleHolders: roleHolders.sort((a, b) => String(a.fullName).localeCompare(String(b.fullName))),
  };
}
