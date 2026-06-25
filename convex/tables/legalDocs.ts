import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Legal document-generation tables (template data fields, templates, precedents, precedent runs, generated documents, signers).
 * Extracted from convex/schema.ts (modularization); spread back into defineSchema.
 */
export const legalDocsTables = {
  legalTemplateDataFields: defineTable({
    societyId: v.optional(v.id("societies")),
    name: v.string(),
    label: v.optional(v.string()),
    fieldType: v.optional(v.string()),
    number: v.optional(v.number()),
    dynamicIndicator: v.optional(v.string()),
    required: v.optional(v.boolean()),
    reviewRequired: v.optional(v.boolean()),
    notes: v.optional(v.string()),
    sourceExternalIds: v.array(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_name", ["name"]),

  legalTemplates: defineTable({
    societyId: v.optional(v.id("societies")),
    templateType: v.string(), // document | policy | filing | search | registration | purpose | vertical | other
    name: v.string(),
    status: v.string(), // active | draft | archived | needs_review
    templateDocumentId: v.optional(v.id("documents")),
    docxDocumentId: v.optional(v.id("documents")),
    pdfDocumentId: v.optional(v.id("documents")),
    html: v.optional(v.string()),
    notes: v.optional(v.string()),
    owner: v.optional(v.string()),
    ownerIsTobuso: v.optional(v.boolean()),
    signatureRequired: v.optional(v.boolean()),
    documentTag: v.optional(v.string()),
    entityTypes: v.array(v.string()),
    jurisdictions: v.array(v.string()),
    requiredSigners: v.array(v.string()),
    requiredDataFieldIds: v.array(v.id("legalTemplateDataFields")),
    optionalDataFieldIds: v.array(v.id("legalTemplateDataFields")),
    reviewDataFieldIds: v.array(v.id("legalTemplateDataFields")),
    requiredDataFields: v.array(v.string()),
    optionalDataFields: v.array(v.string()),
    reviewDataFields: v.array(v.string()),
    timeline: v.optional(v.string()),
    deliverable: v.optional(v.string()),
    terms: v.optional(v.string()),
    filingType: v.optional(v.string()),
    priceItems: v.array(v.string()),
    sourceExternalIds: v.array(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_type", ["societyId", "templateType"])
    .index("by_society_status", ["societyId", "status"]),

  legalPrecedents: defineTable({
    societyId: v.optional(v.id("societies")),
    packageName: v.string(),
    partType: v.optional(v.string()),
    status: v.string(), // active | draft | archived | needs_review
    description: v.optional(v.string()),
    shortDescription: v.optional(v.string()),
    timeline: v.optional(v.string()),
    deliverables: v.optional(v.string()),
    internalNotes: v.optional(v.string()),
    addOnTerms: v.optional(v.string()),
    templateIds: v.array(v.id("legalTemplates")),
    templateNames: v.array(v.string()),
    templateFilingNames: v.array(v.string()),
    templateSearchNames: v.array(v.string()),
    templateRegistrationNames: v.array(v.string()),
    requiresAmendmentRecord: v.optional(v.boolean()),
    requiresAnnualMaintenanceRecord: v.optional(v.boolean()),
    priceItems: v.array(v.string()),
    entityTypes: v.array(v.string()),
    jurisdictions: v.array(v.string()),
    subloopPairs: v.array(v.any()),
    sourceExternalIds: v.array(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  }).index("by_society", ["societyId"]),

  legalPrecedentRuns: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    status: v.string(), // draft | data_review | generating | signing | complete | cancelled | needs_review
    precedentId: v.optional(v.id("legalPrecedents")),
    eventId: v.optional(v.string()),
    dateTime: v.optional(v.string()),
    dataJson: v.optional(v.string()),
    dataJsonList: v.array(v.any()),
    dataReviewed: v.optional(v.boolean()),
    externalNotes: v.optional(v.string()),
    searchIds: v.array(v.string()),
    registrationIds: v.array(v.string()),
    filingIds: v.array(v.id("filings")),
    generatedDocumentIds: v.array(v.id("generatedLegalDocuments")),
    signerRoleHolderIds: v.array(v.id("roleHolders")),
    priceItems: v.array(v.string()),
    abstainingDirectorIds: v.array(v.string()),
    abstainingRightsholderIds: v.array(v.string()),
    sourceExternalIds: v.array(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_precedent", ["precedentId"])
    .index("by_society_status", ["societyId", "status"]),

  generatedLegalDocuments: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    status: v.string(), // draft | out_for_signing | signed | final | void | needs_review
    draftDocumentId: v.optional(v.id("documents")),
    signedDocumentId: v.optional(v.id("documents")),
    draftFileUrl: v.optional(v.string()),
    sourceTemplateId: v.optional(v.id("legalTemplates")),
    sourceTemplateName: v.optional(v.string()),
    precedentRunId: v.optional(v.id("legalPrecedentRuns")),
    eventId: v.optional(v.string()),
    effectiveDate: v.optional(v.string()),
    documentTag: v.optional(v.string()),
    dataJson: v.optional(v.string()),
    subloopJsonList: v.array(v.any()),
    syngrafiiFileId: v.optional(v.string()),
    syngrafiiDocumentId: v.optional(v.string()),
    syngrafiiPackageId: v.optional(v.string()),
    signersRequiredRoleHolderIds: v.array(v.id("roleHolders")),
    signersWhoSignedIds: v.array(v.id("legalSigners")),
    signerTagsRequired: v.array(v.string()),
    signerTagsSigned: v.array(v.string()),
    sourceDocumentIds: v.array(v.id("documents")),
    sourceExternalIds: v.array(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"])
    .index("by_precedent_run", ["precedentRunId"]),

  legalSigners: defineTable({
    societyId: v.id("societies"),
    status: v.string(), // unsigned | opened_package | signed | declined | needs_review
    fullName: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    signerId: v.optional(v.string()),
    signerTag: v.optional(v.string()),
    eventId: v.optional(v.string()),
    generatedDocumentId: v.optional(v.id("generatedLegalDocuments")),
    roleHolderId: v.optional(v.id("roleHolders")),
    sourceExternalIds: v.array(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_document", ["generatedDocumentId"])
    .index("by_society_status", ["societyId", "status"]),
};
