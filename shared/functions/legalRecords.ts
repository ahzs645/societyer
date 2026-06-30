/**
 * PORTABLE FUNCTIONS: the plain entity-record CRUD domain of legalOperations.
 *
 * These are the document/template/precedent/formation/maintenance record
 * upsert+remove mutations that are pure `ctx.db` writes — they only validate
 * option codes (`assertAllowedOption`), normalize text (`cleanText`/`cleanList`),
 * and `insert`/`patch`/`delete` rows. No storage, scheduler, auth, fetch, crypto,
 * or template/catalog GENERATION helpers are touched, so each handler runs
 * unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle. The bodies are moved verbatim from convex/legalOperations.ts.
 */

import { assertAllowedOption } from "../orgHubOptions";
import { cleanText, cleanList } from "./text";
import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

export interface UpsertLegalTemplateArgs {
  id?: string;
  societyId?: string;
  templateType: string;
  name: string;
  status?: string;
  templateDocumentId?: string;
  docxDocumentId?: string;
  pdfDocumentId?: string;
  html?: string;
  notes?: string;
  owner?: string;
  ownerIsTobuso?: boolean;
  signatureRequired?: boolean;
  documentTag?: string;
  entityTypes?: string[];
  jurisdictions?: string[];
  requiredSigners?: string[];
  requiredDataFieldIds?: string[];
  optionalDataFieldIds?: string[];
  reviewDataFieldIds?: string[];
  requiredDataFields?: string[];
  optionalDataFields?: string[];
  reviewDataFields?: string[];
  timeline?: string;
  deliverable?: string;
  terms?: string;
  filingType?: string;
  priceItems?: string[];
  sourceExternalIds?: string[];
}

export async function upsertLegalTemplatePortable(
  ctx: PortableMutationCtx,
  { id, ...args }: UpsertLegalTemplateArgs,
): Promise<string> {
  assertAllowedOption("templateTypes", args.templateType, "Template type", false);
  assertAllowedOption("templateStatuses", args.status, "Template status");
  assertAllowedOption("documentTags", args.documentTag, "Document tag");
  assertAllowedOption("filingTypes", args.filingType, "Filing type");
  const now = new Date().toISOString();
  const payload = {
    societyId: args.societyId,
    templateType: cleanText(args.templateType) || "document",
    name: cleanText(args.name) || "Untitled template",
    status: cleanText(args.status) || "draft",
    templateDocumentId: args.templateDocumentId,
    docxDocumentId: args.docxDocumentId,
    pdfDocumentId: args.pdfDocumentId,
    html: cleanText(args.html),
    notes: cleanText(args.notes),
    owner: cleanText(args.owner),
    ownerIsTobuso: args.ownerIsTobuso,
    signatureRequired: args.signatureRequired,
    documentTag: cleanText(args.documentTag),
    entityTypes: cleanList(args.entityTypes),
    jurisdictions: cleanList(args.jurisdictions),
    requiredSigners: cleanList(args.requiredSigners),
    requiredDataFieldIds: args.requiredDataFieldIds ?? [],
    optionalDataFieldIds: args.optionalDataFieldIds ?? [],
    reviewDataFieldIds: args.reviewDataFieldIds ?? [],
    requiredDataFields: cleanList(args.requiredDataFields),
    optionalDataFields: cleanList(args.optionalDataFields),
    reviewDataFields: cleanList(args.reviewDataFields),
    timeline: cleanText(args.timeline),
    deliverable: cleanText(args.deliverable),
    terms: cleanText(args.terms),
    filingType: cleanText(args.filingType),
    priceItems: cleanList(args.priceItems),
    sourceExternalIds: cleanList(args.sourceExternalIds),
    updatedAtISO: now,
  };
  if (id) {
    await ctx.db.patch(id, payload);
    return id;
  }
  return await ctx.db.insert("legalTemplates", { ...payload, createdAtISO: now });
}

export async function removeLegalTemplatePortable(
  ctx: PortableMutationCtx,
  { id }: { id: string },
): Promise<void> {
  await ctx.db.delete(id);
}

export interface UpsertLegalPrecedentArgs {
  id?: string;
  societyId?: string;
  packageName: string;
  partType?: string;
  status?: string;
  description?: string;
  shortDescription?: string;
  timeline?: string;
  deliverables?: string;
  internalNotes?: string;
  addOnTerms?: string;
  templateIds?: string[];
  templateNames?: string[];
  templateFilingNames?: string[];
  templateSearchNames?: string[];
  templateRegistrationNames?: string[];
  requiresAmendmentRecord?: boolean;
  requiresAnnualMaintenanceRecord?: boolean;
  priceItems?: string[];
  entityTypes?: string[];
  jurisdictions?: string[];
  subloopPairs?: any[];
  sourceExternalIds?: string[];
}

export async function upsertLegalPrecedentPortable(
  ctx: PortableMutationCtx,
  { id, ...args }: UpsertLegalPrecedentArgs,
): Promise<string> {
  assertAllowedOption("precedentStatuses", args.status, "Precedent status");
  assertAllowedOption("partTypes", args.partType, "Part type");
  const now = new Date().toISOString();
  const payload = {
    societyId: args.societyId,
    packageName: cleanText(args.packageName) || "Untitled precedent",
    partType: cleanText(args.partType),
    status: cleanText(args.status) || "draft",
    description: cleanText(args.description),
    shortDescription: cleanText(args.shortDescription),
    timeline: cleanText(args.timeline),
    deliverables: cleanText(args.deliverables),
    internalNotes: cleanText(args.internalNotes),
    addOnTerms: cleanText(args.addOnTerms),
    templateIds: args.templateIds ?? [],
    templateNames: cleanList(args.templateNames),
    templateFilingNames: cleanList(args.templateFilingNames),
    templateSearchNames: cleanList(args.templateSearchNames),
    templateRegistrationNames: cleanList(args.templateRegistrationNames),
    requiresAmendmentRecord: args.requiresAmendmentRecord,
    requiresAnnualMaintenanceRecord: args.requiresAnnualMaintenanceRecord,
    priceItems: cleanList(args.priceItems),
    entityTypes: cleanList(args.entityTypes),
    jurisdictions: cleanList(args.jurisdictions),
    subloopPairs: args.subloopPairs ?? [],
    sourceExternalIds: cleanList(args.sourceExternalIds),
    updatedAtISO: now,
  };
  if (id) {
    await ctx.db.patch(id, payload);
    return id;
  }
  return await ctx.db.insert("legalPrecedents", { ...payload, createdAtISO: now });
}

export async function removeLegalPrecedentPortable(
  ctx: PortableMutationCtx,
  { id }: { id: string },
): Promise<void> {
  await ctx.db.delete(id);
}

export interface UpsertLegalPrecedentRunArgs {
  id?: string;
  societyId: string;
  name: string;
  status?: string;
  precedentId?: string;
  eventId?: string;
  dateTime?: string;
  dataJson?: string;
  dataJsonList?: any[];
  dataReviewed?: boolean;
  externalNotes?: string;
  searchIds?: string[];
  registrationIds?: string[];
  filingIds?: string[];
  generatedDocumentIds?: string[];
  signerRoleHolderIds?: string[];
  priceItems?: string[];
  abstainingDirectorIds?: string[];
  abstainingRightsholderIds?: string[];
  sourceExternalIds?: string[];
  notes?: string;
}

export async function upsertLegalPrecedentRunPortable(
  ctx: PortableMutationCtx,
  { id, ...args }: UpsertLegalPrecedentRunArgs,
): Promise<string> {
  assertAllowedOption("precedentRunStatuses", args.status, "Precedent run status");
  const now = new Date().toISOString();
  const payload = {
    societyId: args.societyId,
    name: cleanText(args.name) || "Untitled package run",
    status: cleanText(args.status) || "draft",
    precedentId: args.precedentId,
    eventId: cleanText(args.eventId),
    dateTime: cleanText(args.dateTime),
    dataJson: cleanText(args.dataJson),
    dataJsonList: args.dataJsonList ?? [],
    dataReviewed: args.dataReviewed,
    externalNotes: cleanText(args.externalNotes),
    searchIds: cleanList(args.searchIds),
    registrationIds: cleanList(args.registrationIds),
    filingIds: args.filingIds ?? [],
    generatedDocumentIds: args.generatedDocumentIds ?? [],
    signerRoleHolderIds: args.signerRoleHolderIds ?? [],
    priceItems: cleanList(args.priceItems),
    abstainingDirectorIds: cleanList(args.abstainingDirectorIds),
    abstainingRightsholderIds: cleanList(args.abstainingRightsholderIds),
    sourceExternalIds: cleanList(args.sourceExternalIds),
    notes: cleanText(args.notes),
    updatedAtISO: now,
  };
  if (id) {
    await ctx.db.patch(id, payload);
    return id;
  }
  return await ctx.db.insert("legalPrecedentRuns", { ...payload, createdAtISO: now });
}

export async function removeLegalPrecedentRunPortable(
  ctx: PortableMutationCtx,
  { id }: { id: string },
): Promise<void> {
  await ctx.db.delete(id);
}

export interface UpsertGeneratedLegalDocumentArgs {
  id?: string;
  societyId: string;
  title: string;
  status?: string;
  draftDocumentId?: string;
  signedDocumentId?: string;
  draftFileUrl?: string;
  sourceTemplateId?: string;
  sourceTemplateName?: string;
  precedentRunId?: string;
  eventId?: string;
  effectiveDate?: string;
  documentTag?: string;
  dataJson?: string;
  subloopJsonList?: any[];
  syngrafiiFileId?: string;
  syngrafiiDocumentId?: string;
  syngrafiiPackageId?: string;
  signersRequiredRoleHolderIds?: string[];
  signersWhoSignedIds?: string[];
  signerTagsRequired?: string[];
  signerTagsSigned?: string[];
  sourceDocumentIds?: string[];
  sourceExternalIds?: string[];
  notes?: string;
}

export async function upsertGeneratedLegalDocumentPortable(
  ctx: PortableMutationCtx,
  { id, ...args }: UpsertGeneratedLegalDocumentArgs,
): Promise<string> {
  assertAllowedOption("generatedDocumentStatuses", args.status, "Generated document status");
  assertAllowedOption("documentTags", args.documentTag, "Generated document tag");
  const now = new Date().toISOString();
  const payload = {
    societyId: args.societyId,
    title: cleanText(args.title) || "Untitled generated document",
    status: cleanText(args.status) || "draft",
    draftDocumentId: args.draftDocumentId,
    signedDocumentId: args.signedDocumentId,
    draftFileUrl: cleanText(args.draftFileUrl),
    sourceTemplateId: args.sourceTemplateId,
    sourceTemplateName: cleanText(args.sourceTemplateName),
    precedentRunId: args.precedentRunId,
    eventId: cleanText(args.eventId),
    effectiveDate: cleanText(args.effectiveDate),
    documentTag: cleanText(args.documentTag),
    dataJson: cleanText(args.dataJson),
    subloopJsonList: args.subloopJsonList ?? [],
    syngrafiiFileId: cleanText(args.syngrafiiFileId),
    syngrafiiDocumentId: cleanText(args.syngrafiiDocumentId),
    syngrafiiPackageId: cleanText(args.syngrafiiPackageId),
    signersRequiredRoleHolderIds: args.signersRequiredRoleHolderIds ?? [],
    signersWhoSignedIds: args.signersWhoSignedIds ?? [],
    signerTagsRequired: cleanList(args.signerTagsRequired),
    signerTagsSigned: cleanList(args.signerTagsSigned),
    sourceDocumentIds: args.sourceDocumentIds ?? [],
    sourceExternalIds: cleanList(args.sourceExternalIds),
    notes: cleanText(args.notes),
    updatedAtISO: now,
  };
  if (id) {
    await ctx.db.patch(id, payload);
    return id;
  }
  return await ctx.db.insert("generatedLegalDocuments", { ...payload, createdAtISO: now });
}

export async function removeGeneratedLegalDocumentPortable(
  ctx: PortableMutationCtx,
  { id }: { id: string },
): Promise<void> {
  await ctx.db.delete(id);
}

export interface UpsertLegalSignerArgs {
  id?: string;
  societyId: string;
  status?: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  signerId?: string;
  signerTag?: string;
  eventId?: string;
  generatedDocumentId?: string;
  roleHolderId?: string;
  sourceExternalIds?: string[];
  notes?: string;
}

export async function upsertLegalSignerPortable(
  ctx: PortableMutationCtx,
  { id, ...args }: UpsertLegalSignerArgs,
): Promise<string> {
  assertAllowedOption("signerStatuses", args.status, "Signer status");
  const now = new Date().toISOString();
  const payload = {
    societyId: args.societyId,
    status: cleanText(args.status) || "unsigned",
    fullName: cleanText(args.fullName) || [args.firstName, args.lastName].map(cleanText).filter(Boolean).join(" ") || "Unnamed signer",
    firstName: cleanText(args.firstName),
    lastName: cleanText(args.lastName),
    email: cleanText(args.email),
    phone: cleanText(args.phone),
    signerId: cleanText(args.signerId),
    signerTag: cleanText(args.signerTag),
    eventId: cleanText(args.eventId),
    generatedDocumentId: args.generatedDocumentId,
    roleHolderId: args.roleHolderId,
    sourceExternalIds: cleanList(args.sourceExternalIds),
    notes: cleanText(args.notes),
    updatedAtISO: now,
  };
  if (id) {
    await ctx.db.patch(id, payload);
    return id;
  }
  return await ctx.db.insert("legalSigners", { ...payload, createdAtISO: now });
}

export async function removeLegalSignerPortable(
  ctx: PortableMutationCtx,
  { id }: { id: string },
): Promise<void> {
  await ctx.db.delete(id);
}

export async function formationMaintenancePortable(
  ctx: PortableQueryCtx,
  { societyId }: { societyId: string },
) {
  const [formations, nameSearches, amendments, annualRecords, jurisdictionRows, logs] = await Promise.all([
    ctx.db.query("formationRecords").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("nameSearchItems").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("entityAmendments").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("annualMaintenanceRecords").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("jurisdictionMetadata").collect(),
    ctx.db.query("supportLogs").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  return {
    formations: formations.sort((a, b) => String(b.createdAtISO).localeCompare(String(a.createdAtISO))),
    nameSearches: nameSearches.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || String(a.name).localeCompare(String(b.name))),
    amendments: amendments.sort((a, b) => String(b.effectiveDate ?? b.createdAtISO).localeCompare(String(a.effectiveDate ?? a.createdAtISO))),
    annualRecords: annualRecords.sort((a, b) => String(b.yearFilingFor ?? b.createdAtISO).localeCompare(String(a.yearFilingFor ?? a.createdAtISO))),
    jurisdictionMetadata: jurisdictionRows.sort((a, b) => String(a.label).localeCompare(String(b.label))),
    logs: logs.sort((a, b) => String(b.createdAtISO).localeCompare(String(a.createdAtISO))),
  };
}

export interface UpsertFormationRecordArgs {
  id?: string;
  societyId: string;
  status?: string;
  statusNumber?: number;
  logStartDate?: string;
  nuansDate?: string;
  nuansNumber?: string;
  relatedUserId?: string;
  addressRental?: boolean;
  stepDataInput?: string;
  assignedStaffIds?: string[];
  signingPackageIds?: string[];
  articlesRestrictionOnActivities?: string;
  purposeStatement?: string;
  additionalProvisions?: string;
  classesOfMembership?: string;
  distributionOfProperty?: string;
  draftDocumentIds?: string[];
  supportingDocumentIds?: string[];
  relatedIncorporationEventId?: string;
  relatedOrganizingEventId?: string;
  priceItems?: string[];
  jurisdiction?: string;
  extraProvincialRegistrationJurisdiction?: string;
  sourceExternalIds?: string[];
  notes?: string;
}

export async function upsertFormationRecordPortable(
  ctx: PortableMutationCtx,
  { id, ...args }: UpsertFormationRecordArgs,
): Promise<string> {
  assertAllowedOption("formationStatuses", args.status, "Formation status");
  assertAllowedOption("entityJurisdictions", args.jurisdiction, "Formation jurisdiction");
  assertAllowedOption("entityJurisdictions", args.extraProvincialRegistrationJurisdiction, "Extra-provincial jurisdiction");
  const now = new Date().toISOString();
  const payload = {
    societyId: args.societyId,
    status: cleanText(args.status) || "draft",
    statusNumber: args.statusNumber,
    logStartDate: cleanText(args.logStartDate),
    nuansDate: cleanText(args.nuansDate),
    nuansNumber: cleanText(args.nuansNumber),
    relatedUserId: args.relatedUserId,
    addressRental: args.addressRental,
    stepDataInput: cleanText(args.stepDataInput),
    assignedStaffIds: cleanList(args.assignedStaffIds),
    signingPackageIds: cleanList(args.signingPackageIds),
    articlesRestrictionOnActivities: cleanText(args.articlesRestrictionOnActivities),
    purposeStatement: cleanText(args.purposeStatement),
    additionalProvisions: cleanText(args.additionalProvisions),
    classesOfMembership: cleanText(args.classesOfMembership),
    distributionOfProperty: cleanText(args.distributionOfProperty),
    draftDocumentIds: args.draftDocumentIds ?? [],
    supportingDocumentIds: args.supportingDocumentIds ?? [],
    relatedIncorporationEventId: cleanText(args.relatedIncorporationEventId),
    relatedOrganizingEventId: cleanText(args.relatedOrganizingEventId),
    priceItems: cleanList(args.priceItems),
    jurisdiction: cleanText(args.jurisdiction),
    extraProvincialRegistrationJurisdiction: cleanText(args.extraProvincialRegistrationJurisdiction),
    sourceExternalIds: cleanList(args.sourceExternalIds),
    notes: cleanText(args.notes),
    updatedAtISO: now,
  };
  if (id) {
    await ctx.db.patch(id, payload);
    return id;
  }
  return await ctx.db.insert("formationRecords", { ...payload, createdAtISO: now });
}

export async function removeFormationRecordPortable(
  ctx: PortableMutationCtx,
  { id }: { id: string },
): Promise<void> {
  await ctx.db.delete(id);
}

export interface UpsertNameSearchItemArgs {
  id?: string;
  societyId: string;
  formationRecordId?: string;
  name: string;
  success?: boolean;
  errors?: string[];
  reportUrl?: string;
  reportDocumentId?: string;
  rank?: number;
  expressService?: boolean;
  descriptiveElement?: string;
  distinctiveElement?: string;
  nuansReportNumber?: string;
  suffix?: string;
  sourceExternalIds?: string[];
  notes?: string;
}

export async function upsertNameSearchItemPortable(
  ctx: PortableMutationCtx,
  { id, ...args }: UpsertNameSearchItemArgs,
): Promise<string> {
  assertAllowedOption("suffixCompanyNames", args.suffix, "Name suffix");
  const now = new Date().toISOString();
  const payload = {
    societyId: args.societyId,
    formationRecordId: args.formationRecordId,
    name: cleanText(args.name) || "Unnamed search",
    success: args.success,
    errors: cleanList(args.errors),
    reportUrl: cleanText(args.reportUrl),
    reportDocumentId: args.reportDocumentId,
    rank: args.rank,
    expressService: args.expressService,
    descriptiveElement: cleanText(args.descriptiveElement),
    distinctiveElement: cleanText(args.distinctiveElement),
    nuansReportNumber: cleanText(args.nuansReportNumber),
    suffix: cleanText(args.suffix),
    sourceExternalIds: cleanList(args.sourceExternalIds),
    notes: cleanText(args.notes),
    updatedAtISO: now,
  };
  if (id) {
    await ctx.db.patch(id, payload);
    return id;
  }
  return await ctx.db.insert("nameSearchItems", { ...payload, createdAtISO: now });
}

export async function removeNameSearchItemPortable(
  ctx: PortableMutationCtx,
  { id }: { id: string },
): Promise<void> {
  await ctx.db.delete(id);
}

export interface UpsertEntityAmendmentArgs {
  id?: string;
  societyId: string;
  status?: string;
  effectiveDate?: string;
  entityNameNew?: string;
  directorsMinimum?: number;
  directorsMaximum?: number;
  relatedPrecedentRunId?: string;
  shareClassAmendmentText?: string;
  jurisdictionNew?: string;
  sourceDocumentIds?: string[];
  sourceExternalIds?: string[];
  notes?: string;
}

export async function upsertEntityAmendmentPortable(
  ctx: PortableMutationCtx,
  { id, ...args }: UpsertEntityAmendmentArgs,
): Promise<string> {
  assertAllowedOption("amendmentStatuses", args.status, "Amendment status");
  assertAllowedOption("entityJurisdictions", args.jurisdictionNew, "New jurisdiction");
  const now = new Date().toISOString();
  const payload = {
    societyId: args.societyId,
    status: cleanText(args.status) || "draft",
    effectiveDate: cleanText(args.effectiveDate),
    entityNameNew: cleanText(args.entityNameNew),
    directorsMinimum: args.directorsMinimum,
    directorsMaximum: args.directorsMaximum,
    relatedPrecedentRunId: args.relatedPrecedentRunId,
    shareClassAmendmentText: cleanText(args.shareClassAmendmentText),
    jurisdictionNew: cleanText(args.jurisdictionNew),
    sourceDocumentIds: args.sourceDocumentIds ?? [],
    sourceExternalIds: cleanList(args.sourceExternalIds),
    notes: cleanText(args.notes),
    updatedAtISO: now,
  };
  if (id) {
    await ctx.db.patch(id, payload);
    return id;
  }
  return await ctx.db.insert("entityAmendments", { ...payload, createdAtISO: now });
}

export async function removeEntityAmendmentPortable(
  ctx: PortableMutationCtx,
  { id }: { id: string },
): Promise<void> {
  await ctx.db.delete(id);
}

export interface UpsertAnnualMaintenanceRecordArgs {
  id?: string;
  societyId: string;
  status?: string;
  yearFilingFor?: string;
  lastAgmDate?: string;
  filingDate?: string;
  draftFilingDocumentId?: string;
  signedFilingDocumentId?: string;
  processedFilingDocumentId?: string;
  relatedPrecedentRunId?: string;
  filingId?: string;
  keyVaultItemId?: string;
  templateFilingId?: string;
  authorizingPhone?: string;
  authorizingRoleHolderId?: string;
  financialStatementsDocumentId?: string;
  fiscalYearEndDate?: string;
  incomeTaxReturnDate?: string;
  annualFinancialStatementType?: string;
  financialStatementReportDate?: string;
  financialStatementReportType?: string;
  auditedFinancialStatements?: boolean;
  auditedFinancialStatementsNextYear?: boolean;
  annualFinancialsEngagementLevel?: string;
  annualFinancialStatementOption?: string;
  sourceDocumentIds?: string[];
  sourceExternalIds?: string[];
  notes?: string;
}

export async function upsertAnnualMaintenanceRecordPortable(
  ctx: PortableMutationCtx,
  { id, ...args }: UpsertAnnualMaintenanceRecordArgs,
): Promise<string> {
  assertAllowedOption("annualMaintenanceStatuses", args.status, "Annual maintenance status");
  assertAllowedOption("annualFinancialStatementOptions", args.annualFinancialStatementOption, "Annual financial statement option");
  const now = new Date().toISOString();
  const payload = {
    societyId: args.societyId,
    status: cleanText(args.status) || "draft",
    yearFilingFor: cleanText(args.yearFilingFor),
    lastAgmDate: cleanText(args.lastAgmDate),
    filingDate: cleanText(args.filingDate),
    draftFilingDocumentId: args.draftFilingDocumentId,
    signedFilingDocumentId: args.signedFilingDocumentId,
    processedFilingDocumentId: args.processedFilingDocumentId,
    relatedPrecedentRunId: args.relatedPrecedentRunId,
    filingId: args.filingId,
    keyVaultItemId: args.keyVaultItemId,
    templateFilingId: args.templateFilingId,
    authorizingPhone: cleanText(args.authorizingPhone),
    authorizingRoleHolderId: args.authorizingRoleHolderId,
    financialStatementsDocumentId: args.financialStatementsDocumentId,
    fiscalYearEndDate: cleanText(args.fiscalYearEndDate),
    incomeTaxReturnDate: cleanText(args.incomeTaxReturnDate),
    annualFinancialStatementType: cleanText(args.annualFinancialStatementType),
    financialStatementReportDate: cleanText(args.financialStatementReportDate),
    financialStatementReportType: cleanText(args.financialStatementReportType),
    auditedFinancialStatements: args.auditedFinancialStatements,
    auditedFinancialStatementsNextYear: args.auditedFinancialStatementsNextYear,
    annualFinancialsEngagementLevel: cleanText(args.annualFinancialsEngagementLevel),
    annualFinancialStatementOption: cleanText(args.annualFinancialStatementOption),
    sourceDocumentIds: args.sourceDocumentIds ?? [],
    sourceExternalIds: cleanList(args.sourceExternalIds),
    notes: cleanText(args.notes),
    updatedAtISO: now,
  };
  if (id) {
    await ctx.db.patch(id, payload);
    return id;
  }
  return await ctx.db.insert("annualMaintenanceRecords", { ...payload, createdAtISO: now });
}

export async function removeAnnualMaintenanceRecordPortable(
  ctx: PortableMutationCtx,
  { id }: { id: string },
): Promise<void> {
  await ctx.db.delete(id);
}

export interface UpsertJurisdictionMetadataArgs {
  id?: string;
  jurisdiction: string;
  label: string;
  actFormedUnder?: string;
  nuansJurisdictionNumber?: string;
  nuansReservationReportTypeId?: string;
  incorporationServiceEligible?: boolean;
  sourceOptionId?: string;
  notes?: string;
}

export async function upsertJurisdictionMetadataPortable(
  ctx: PortableMutationCtx,
  { id, ...args }: UpsertJurisdictionMetadataArgs,
): Promise<string> {
  assertAllowedOption("entityJurisdictions", args.jurisdiction, "Jurisdiction", false);
  assertAllowedOption("actsFormedUnder", args.actFormedUnder, "Act formed under");
  const now = new Date().toISOString();
  const payload = {
    jurisdiction: cleanText(args.jurisdiction) || "foreign",
    label: cleanText(args.label) || cleanText(args.jurisdiction) || "Jurisdiction",
    actFormedUnder: cleanText(args.actFormedUnder),
    nuansJurisdictionNumber: cleanText(args.nuansJurisdictionNumber),
    nuansReservationReportTypeId: cleanText(args.nuansReservationReportTypeId),
    incorporationServiceEligible: args.incorporationServiceEligible,
    sourceOptionId: cleanText(args.sourceOptionId),
    notes: cleanText(args.notes),
    updatedAtISO: now,
  };
  if (id) {
    await ctx.db.patch(id, payload);
    return id;
  }
  return await ctx.db.insert("jurisdictionMetadata", { ...payload, createdAtISO: now });
}

export async function removeJurisdictionMetadataPortable(
  ctx: PortableMutationCtx,
  { id }: { id: string },
): Promise<void> {
  await ctx.db.delete(id);
}

export interface UpsertSupportLogArgs {
  id?: string;
  societyId?: string;
  logType: string;
  severity?: string;
  page?: string;
  pageLocationUrl?: string;
  userId?: string;
  relatedUserId?: string;
  relatedEventId?: string;
  relatedEntityId?: string;
  relatedSubscriptionId?: string;
  relatedIncorporationId?: string;
  errorCode?: string;
  errorMessage?: string;
  detailsHeading?: string;
  detailsBody?: string;
  sourceExternalIds?: string[];
  createdAtISO?: string;
}

export async function upsertSupportLogPortable(
  ctx: PortableMutationCtx,
  { id, ...args }: UpsertSupportLogArgs,
): Promise<string> {
  assertAllowedOption("logTypes", args.logType, "Log type", false);
  assertAllowedOption("logSeverities", args.severity, "Log severity");
  const payload = {
    societyId: args.societyId,
    logType: cleanText(args.logType) || "edit",
    severity: cleanText(args.severity) || "info",
    page: cleanText(args.page),
    pageLocationUrl: cleanText(args.pageLocationUrl),
    userId: args.userId,
    relatedUserId: args.relatedUserId,
    relatedEventId: cleanText(args.relatedEventId),
    relatedEntityId: args.relatedEntityId,
    relatedSubscriptionId: cleanText(args.relatedSubscriptionId),
    relatedIncorporationId: cleanText(args.relatedIncorporationId),
    errorCode: cleanText(args.errorCode),
    errorMessage: cleanText(args.errorMessage),
    detailsHeading: cleanText(args.detailsHeading),
    detailsBody: cleanText(args.detailsBody),
    sourceExternalIds: cleanList(args.sourceExternalIds),
    createdAtISO: cleanText(args.createdAtISO) || new Date().toISOString(),
  };
  if (id) {
    await ctx.db.patch(id, payload);
    return id;
  }
  return await ctx.db.insert("supportLogs", payload);
}

export async function removeSupportLogPortable(
  ctx: PortableMutationCtx,
  { id }: { id: string },
): Promise<void> {
  await ctx.db.delete(id);
}
