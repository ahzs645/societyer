import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { assertAllowedOption } from "./lib/orgHubOptions";
import {
  STARTER_POLICY_TEMPLATES,
  starterTemplateHtml,
  starterTemplateMarker,
  starterTemplateRequiredFields,
} from "./starterPolicyTemplates";

export const listRoleHolders = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const rows = await ctx.db.query("roleHolders").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
    return rows.sort((a, b) => String(a.fullName).localeCompare(String(b.fullName)));
  },
});

export const upsertRoleHolder = mutation({
  args: {
    id: v.optional(v.id("roleHolders")),
    societyId: v.id("societies"),
    roleType: v.string(),
    status: v.optional(v.string()),
    fullName: v.string(),
    firstName: v.optional(v.string()),
    middleName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    signerTag: v.optional(v.string()),
    membershipId: v.optional(v.string()),
    membershipClassName: v.optional(v.string()),
    membershipClassId: v.optional(v.id("rightsClasses")),
    officerTitle: v.optional(v.string()),
    directorTerm: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    referenceDate: v.optional(v.string()),
    street: v.optional(v.string()),
    unit: v.optional(v.string()),
    city: v.optional(v.string()),
    provinceState: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    country: v.optional(v.string()),
    alternateStreet: v.optional(v.string()),
    alternateUnit: v.optional(v.string()),
    alternateCity: v.optional(v.string()),
    alternateProvinceState: v.optional(v.string()),
    alternatePostalCode: v.optional(v.string()),
    alternateCountry: v.optional(v.string()),
    serviceStreet: v.optional(v.string()),
    serviceUnit: v.optional(v.string()),
    serviceCity: v.optional(v.string()),
    serviceProvinceState: v.optional(v.string()),
    servicePostalCode: v.optional(v.string()),
    serviceCountry: v.optional(v.string()),
    ageOver18: v.optional(v.boolean()),
    dateOfBirth: v.optional(v.string()),
    occupation: v.optional(v.string()),
    citizenshipResidency: v.optional(v.string()),
    citizenshipCountries: v.optional(v.array(v.string())),
    taxResidenceCountries: v.optional(v.array(v.string())),
    nonNaturalPerson: v.optional(v.boolean()),
    nonNaturalPersonType: v.optional(v.string()),
    nonNaturalJurisdiction: v.optional(v.string()),
    natureOfControl: v.optional(v.string()),
    authorizedRepresentative: v.optional(v.boolean()),
    relatedRoleHolderId: v.optional(v.id("roleHolders")),
    relatedShareholderIds: v.optional(v.array(v.string())),
    controllingIndividualIds: v.optional(v.array(v.string())),
    extraProvincialRegistrationId: v.optional(v.id("organizationRegistrations")),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...args }) => {
    assertAllowedOption("representativeTypes", args.roleType, "Role-holder type", false);
    assertAllowedOption("roleHolderStatuses", args.status, "Role-holder status");
    assertAllowedOption("officerTitles", args.officerTitle, "Officer title");
    assertAllowedOption("directorTerms", args.directorTerm, "Director term");
    assertAllowedOption("citizenshipResidencies", args.citizenshipResidency, "Citizenship/residency");
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
      sourceDocumentIds: args.sourceDocumentIds ?? [],
      sourceExternalIds: cleanList(args.sourceExternalIds),
      notes: cleanText(args.notes),
      updatedAtISO: now,
    };
    if (id) {
      await ctx.db.patch(id, payload);
      return id;
    }
    return await ctx.db.insert("roleHolders", { ...payload, createdAtISO: now });
  },
});

export const removeRoleHolder = mutation({
  args: { id: v.id("roleHolders") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

export const rightsLedger = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const [classes, transfers, roleHolders] = await Promise.all([
      ctx.db.query("rightsClasses").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("rightsholdingTransfers").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("roleHolders").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ]);
    return {
      classes: classes.sort((a, b) => String(a.className).localeCompare(String(b.className))),
      transfers: transfers.sort((a, b) => String(b.transferDate ?? b.createdAtISO).localeCompare(String(a.transferDate ?? a.createdAtISO))),
      roleHolders: roleHolders.sort((a, b) => String(a.fullName).localeCompare(String(b.fullName))),
    };
  },
});

export const upsertRightsClass = mutation({
  args: {
    id: v.optional(v.id("rightsClasses")),
    societyId: v.id("societies"),
    className: v.string(),
    classType: v.string(),
    status: v.optional(v.string()),
    idPrefix: v.optional(v.string()),
    highestAssignedNumber: v.optional(v.number()),
    votingRights: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    conditionsToHold: v.optional(v.string()),
    conditionsToTransfer: v.optional(v.string()),
    conditionsForRemoval: v.optional(v.string()),
    otherProvisions: v.optional(v.string()),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...args }) => {
    assertAllowedOption("rightsClassTypes", args.classType, "Rights class type", false);
    assertAllowedOption("rightsClassStatuses", args.status, "Rights class status");
    const now = new Date().toISOString();
    const payload = {
      societyId: args.societyId,
      className: cleanText(args.className) || "Unnamed class",
      classType: cleanText(args.classType) || "membership",
      status: cleanText(args.status) || "active",
      idPrefix: cleanText(args.idPrefix),
      highestAssignedNumber: args.highestAssignedNumber,
      votingRights: cleanText(args.votingRights),
      startDate: cleanText(args.startDate),
      endDate: cleanText(args.endDate),
      conditionsToHold: cleanText(args.conditionsToHold),
      conditionsToTransfer: cleanText(args.conditionsToTransfer),
      conditionsForRemoval: cleanText(args.conditionsForRemoval),
      otherProvisions: cleanText(args.otherProvisions),
      sourceDocumentIds: args.sourceDocumentIds ?? [],
      sourceExternalIds: cleanList(args.sourceExternalIds),
      notes: cleanText(args.notes),
      updatedAtISO: now,
    };
    if (id) {
      await ctx.db.patch(id, payload);
      return id;
    }
    return await ctx.db.insert("rightsClasses", { ...payload, createdAtISO: now });
  },
});

export const upsertRightsholdingTransfer = mutation({
  args: {
    id: v.optional(v.id("rightsholdingTransfers")),
    societyId: v.id("societies"),
    transferType: v.string(),
    status: v.optional(v.string()),
    transferDate: v.optional(v.string()),
    eventId: v.optional(v.string()),
    precedentRunId: v.optional(v.id("legalPrecedentRuns")),
    rightsClassId: v.optional(v.id("rightsClasses")),
    sourceRoleHolderId: v.optional(v.id("roleHolders")),
    destinationRoleHolderId: v.optional(v.id("roleHolders")),
    sourceHolderName: v.optional(v.string()),
    destinationHolderName: v.optional(v.string()),
    quantity: v.optional(v.number()),
    considerationType: v.optional(v.string()),
    considerationDescription: v.optional(v.string()),
    priceToOrganizationCents: v.optional(v.number()),
    priceToOrganizationCurrency: v.optional(v.string()),
    priceToVendorCents: v.optional(v.number()),
    priceToVendorCurrency: v.optional(v.string()),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...args }) => {
    assertAllowedOption("rightsholdingTransferTypes", args.transferType, "Rights transfer type", false);
    assertAllowedOption("rightsholdingTransferStatuses", args.status, "Rights transfer status");
    assertAllowedOption("currencies", args.priceToOrganizationCurrency, "Organization consideration currency");
    assertAllowedOption("currencies", args.priceToVendorCurrency, "Vendor consideration currency");
    const now = new Date().toISOString();
    const payload = {
      societyId: args.societyId,
      transferType: cleanText(args.transferType) || "transfer",
      status: cleanText(args.status) || "draft",
      transferDate: cleanText(args.transferDate),
      eventId: cleanText(args.eventId),
      precedentRunId: args.precedentRunId,
      rightsClassId: args.rightsClassId,
      sourceRoleHolderId: args.sourceRoleHolderId,
      destinationRoleHolderId: args.destinationRoleHolderId,
      sourceHolderName: cleanText(args.sourceHolderName),
      destinationHolderName: cleanText(args.destinationHolderName),
      quantity: args.quantity,
      considerationType: cleanText(args.considerationType),
      considerationDescription: cleanText(args.considerationDescription),
      priceToOrganizationCents: args.priceToOrganizationCents,
      priceToOrganizationCurrency: cleanText(args.priceToOrganizationCurrency),
      priceToVendorCents: args.priceToVendorCents,
      priceToVendorCurrency: cleanText(args.priceToVendorCurrency),
      sourceDocumentIds: args.sourceDocumentIds ?? [],
      sourceExternalIds: cleanList(args.sourceExternalIds),
      notes: cleanText(args.notes),
      updatedAtISO: now,
    };
    if (id) {
      await ctx.db.patch(id, payload);
      return id;
    }
    return await ctx.db.insert("rightsholdingTransfers", { ...payload, createdAtISO: now });
  },
});

export const removeRightsClass = mutation({
  args: { id: v.id("rightsClasses") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

export const removeRightsholdingTransfer = mutation({
  args: { id: v.id("rightsholdingTransfers") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

export const templateEngine = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const [dataFields, templates, precedents, runs, generatedDocuments, signers] = await Promise.all([
      ctx.db.query("legalTemplateDataFields").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("legalTemplates").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("legalPrecedents").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("legalPrecedentRuns").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("generatedLegalDocuments").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("legalSigners").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ]);
    return {
      dataFields: dataFields.sort((a, b) => String(a.name).localeCompare(String(b.name))),
      templates: templates.sort((a, b) => String(a.name).localeCompare(String(b.name))),
      precedents: precedents.sort((a, b) => String(a.packageName).localeCompare(String(b.packageName))),
      runs: runs.sort((a, b) => String(b.createdAtISO).localeCompare(String(a.createdAtISO))),
      generatedDocuments: generatedDocuments.sort((a, b) => String(b.createdAtISO).localeCompare(String(a.createdAtISO))),
      signers: signers.sort((a, b) => String(a.fullName).localeCompare(String(b.fullName))),
    };
  },
});

export const seedStarterPolicyTemplates = mutation({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const now = new Date().toISOString();
    const existing = await ctx.db
      .query("legalTemplates")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const template of STARTER_POLICY_TEMPLATES) {
      const marker = starterTemplateMarker(template);
      const existingByMarker = existing.find((row) => (row.sourceExternalIds ?? []).includes(marker));
      const existingByName = existing.find((row) => row.name.toLowerCase() === template.name.toLowerCase());
      const payload = {
        societyId,
        templateType: template.templateType ?? "policy",
        name: template.name,
        status: "active",
        templateDocumentId: undefined,
        docxDocumentId: undefined,
        pdfDocumentId: undefined,
        html: starterTemplateHtml(template),
        notes: [
          template.summary,
          "Remade from local source PDF templates supplied for Societyer template inclusion.",
          `Source file: ${template.sourceFile}`,
          `Source SHA-256: ${template.sourceSha256}`,
        ].join("\n"),
        owner: "Societyer starter catalog",
        ownerIsTobuso: false,
        signatureRequired: template.signatureRequired ?? true,
        documentTag: template.documentTag ?? "other",
        entityTypes: ["society", "corporation__nfp_"],
        jurisdictions: ["british_columbia", "federal__canada_"],
        requiredSigners: template.signatureRequired === false ? [] : ["all_directors"],
        requiredDataFieldIds: [],
        optionalDataFieldIds: [],
        reviewDataFieldIds: [],
        requiredDataFields: starterTemplateRequiredFields(template),
        optionalDataFields: template.optionalDataFields ?? [],
        reviewDataFields: template.reviewDataFields ?? ["Bylaws", "SigningAuthorities", "Jurisdiction", "CharityStatus"],
        timeline: "Review and customize before board approval.",
        deliverable: template.templateType === "document" ? "Editable governance document template" : "Editable policy template with board acceptance block",
        terms: "Starter template only. Review for jurisdiction, bylaws, charity status, funder requirements, and actual operations before adoption.",
        filingType: undefined,
        priceItems: [],
        sourceExternalIds: [marker, `sha256:${template.sourceSha256}`, `source-file:${template.sourceFile}`],
        updatedAtISO: now,
      };

      if (existingByMarker) {
        await ctx.db.patch(existingByMarker._id, payload);
        updated += 1;
      } else if (existingByName) {
        skipped += 1;
      } else {
        await ctx.db.insert("legalTemplates", { ...payload, createdAtISO: now });
        inserted += 1;
      }
    }

    return { inserted, updated, skipped, total: STARTER_POLICY_TEMPLATES.length };
  },
});

export const upsertTemplateDataField = mutation({
  args: {
    id: v.optional(v.id("legalTemplateDataFields")),
    societyId: v.optional(v.id("societies")),
    name: v.string(),
    label: v.optional(v.string()),
    fieldType: v.optional(v.string()),
    number: v.optional(v.number()),
    dynamicIndicator: v.optional(v.string()),
    required: v.optional(v.boolean()),
    reviewRequired: v.optional(v.boolean()),
    notes: v.optional(v.string()),
    sourceExternalIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, ...args }) => {
    const now = new Date().toISOString();
    const payload = {
      societyId: args.societyId,
      name: cleanText(args.name) || "Unnamed data field",
      label: cleanText(args.label),
      fieldType: cleanText(args.fieldType),
      number: args.number,
      dynamicIndicator: cleanText(args.dynamicIndicator),
      required: args.required,
      reviewRequired: args.reviewRequired,
      notes: cleanText(args.notes),
      sourceExternalIds: cleanList(args.sourceExternalIds),
      updatedAtISO: now,
    };
    if (id) {
      await ctx.db.patch(id, payload);
      return id;
    }
    return await ctx.db.insert("legalTemplateDataFields", { ...payload, createdAtISO: now });
  },
});

export const upsertLegalTemplate = mutation({
  args: {
    id: v.optional(v.id("legalTemplates")),
    societyId: v.optional(v.id("societies")),
    templateType: v.string(),
    name: v.string(),
    status: v.optional(v.string()),
    templateDocumentId: v.optional(v.id("documents")),
    docxDocumentId: v.optional(v.id("documents")),
    pdfDocumentId: v.optional(v.id("documents")),
    html: v.optional(v.string()),
    notes: v.optional(v.string()),
    owner: v.optional(v.string()),
    ownerIsTobuso: v.optional(v.boolean()),
    signatureRequired: v.optional(v.boolean()),
    documentTag: v.optional(v.string()),
    entityTypes: v.optional(v.array(v.string())),
    jurisdictions: v.optional(v.array(v.string())),
    requiredSigners: v.optional(v.array(v.string())),
    requiredDataFieldIds: v.optional(v.array(v.id("legalTemplateDataFields"))),
    optionalDataFieldIds: v.optional(v.array(v.id("legalTemplateDataFields"))),
    reviewDataFieldIds: v.optional(v.array(v.id("legalTemplateDataFields"))),
    requiredDataFields: v.optional(v.array(v.string())),
    optionalDataFields: v.optional(v.array(v.string())),
    reviewDataFields: v.optional(v.array(v.string())),
    timeline: v.optional(v.string()),
    deliverable: v.optional(v.string()),
    terms: v.optional(v.string()),
    filingType: v.optional(v.string()),
    priceItems: v.optional(v.array(v.string())),
    sourceExternalIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, ...args }) => {
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
  },
});

export const upsertLegalPrecedent = mutation({
  args: {
    id: v.optional(v.id("legalPrecedents")),
    societyId: v.optional(v.id("societies")),
    packageName: v.string(),
    partType: v.optional(v.string()),
    status: v.optional(v.string()),
    description: v.optional(v.string()),
    shortDescription: v.optional(v.string()),
    timeline: v.optional(v.string()),
    deliverables: v.optional(v.string()),
    internalNotes: v.optional(v.string()),
    addOnTerms: v.optional(v.string()),
    templateIds: v.optional(v.array(v.id("legalTemplates"))),
    templateNames: v.optional(v.array(v.string())),
    templateFilingNames: v.optional(v.array(v.string())),
    templateSearchNames: v.optional(v.array(v.string())),
    templateRegistrationNames: v.optional(v.array(v.string())),
    requiresAmendmentRecord: v.optional(v.boolean()),
    requiresAnnualMaintenanceRecord: v.optional(v.boolean()),
    priceItems: v.optional(v.array(v.string())),
    entityTypes: v.optional(v.array(v.string())),
    jurisdictions: v.optional(v.array(v.string())),
    subloopPairs: v.optional(v.array(v.any())),
    sourceExternalIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, ...args }) => {
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
  },
});

export const upsertLegalPrecedentRun = mutation({
  args: {
    id: v.optional(v.id("legalPrecedentRuns")),
    societyId: v.id("societies"),
    name: v.string(),
    status: v.optional(v.string()),
    precedentId: v.optional(v.id("legalPrecedents")),
    eventId: v.optional(v.string()),
    dateTime: v.optional(v.string()),
    dataJson: v.optional(v.string()),
    dataJsonList: v.optional(v.array(v.any())),
    dataReviewed: v.optional(v.boolean()),
    externalNotes: v.optional(v.string()),
    searchIds: v.optional(v.array(v.string())),
    registrationIds: v.optional(v.array(v.string())),
    filingIds: v.optional(v.array(v.id("filings"))),
    generatedDocumentIds: v.optional(v.array(v.id("generatedLegalDocuments"))),
    signerRoleHolderIds: v.optional(v.array(v.id("roleHolders"))),
    priceItems: v.optional(v.array(v.string())),
    abstainingDirectorIds: v.optional(v.array(v.string())),
    abstainingRightsholderIds: v.optional(v.array(v.string())),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...args }) => {
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
  },
});

export const upsertGeneratedLegalDocument = mutation({
  args: {
    id: v.optional(v.id("generatedLegalDocuments")),
    societyId: v.id("societies"),
    title: v.string(),
    status: v.optional(v.string()),
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
    subloopJsonList: v.optional(v.array(v.any())),
    syngrafiiFileId: v.optional(v.string()),
    syngrafiiDocumentId: v.optional(v.string()),
    syngrafiiPackageId: v.optional(v.string()),
    signersRequiredRoleHolderIds: v.optional(v.array(v.id("roleHolders"))),
    signersWhoSignedIds: v.optional(v.array(v.id("legalSigners"))),
    signerTagsRequired: v.optional(v.array(v.string())),
    signerTagsSigned: v.optional(v.array(v.string())),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...args }) => {
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
  },
});

export const upsertLegalSigner = mutation({
  args: {
    id: v.optional(v.id("legalSigners")),
    societyId: v.id("societies"),
    status: v.optional(v.string()),
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
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...args }) => {
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
  },
});

export const removeTemplateDataField = mutation({
  args: { id: v.id("legalTemplateDataFields") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

export const removeLegalTemplate = mutation({
  args: { id: v.id("legalTemplates") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

export const removeLegalPrecedent = mutation({
  args: { id: v.id("legalPrecedents") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

export const removeLegalPrecedentRun = mutation({
  args: { id: v.id("legalPrecedentRuns") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

export const removeGeneratedLegalDocument = mutation({
  args: { id: v.id("generatedLegalDocuments") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

export const removeLegalSigner = mutation({
  args: { id: v.id("legalSigners") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

export const formationMaintenance = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
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
  },
});

export const upsertFormationRecord = mutation({
  args: {
    id: v.optional(v.id("formationRecords")),
    societyId: v.id("societies"),
    status: v.optional(v.string()),
    statusNumber: v.optional(v.number()),
    logStartDate: v.optional(v.string()),
    nuansDate: v.optional(v.string()),
    nuansNumber: v.optional(v.string()),
    relatedUserId: v.optional(v.id("users")),
    addressRental: v.optional(v.boolean()),
    stepDataInput: v.optional(v.string()),
    assignedStaffIds: v.optional(v.array(v.string())),
    signingPackageIds: v.optional(v.array(v.string())),
    articlesRestrictionOnActivities: v.optional(v.string()),
    purposeStatement: v.optional(v.string()),
    additionalProvisions: v.optional(v.string()),
    classesOfMembership: v.optional(v.string()),
    distributionOfProperty: v.optional(v.string()),
    draftDocumentIds: v.optional(v.array(v.id("documents"))),
    supportingDocumentIds: v.optional(v.array(v.id("documents"))),
    relatedIncorporationEventId: v.optional(v.string()),
    relatedOrganizingEventId: v.optional(v.string()),
    priceItems: v.optional(v.array(v.string())),
    jurisdiction: v.optional(v.string()),
    extraProvincialRegistrationJurisdiction: v.optional(v.string()),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...args }) => {
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
  },
});

export const upsertNameSearchItem = mutation({
  args: {
    id: v.optional(v.id("nameSearchItems")),
    societyId: v.id("societies"),
    formationRecordId: v.optional(v.id("formationRecords")),
    name: v.string(),
    success: v.optional(v.boolean()),
    errors: v.optional(v.array(v.string())),
    reportUrl: v.optional(v.string()),
    reportDocumentId: v.optional(v.id("documents")),
    rank: v.optional(v.number()),
    expressService: v.optional(v.boolean()),
    descriptiveElement: v.optional(v.string()),
    distinctiveElement: v.optional(v.string()),
    nuansReportNumber: v.optional(v.string()),
    suffix: v.optional(v.string()),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...args }) => {
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
  },
});

export const upsertEntityAmendment = mutation({
  args: {
    id: v.optional(v.id("entityAmendments")),
    societyId: v.id("societies"),
    status: v.optional(v.string()),
    effectiveDate: v.optional(v.string()),
    entityNameNew: v.optional(v.string()),
    directorsMinimum: v.optional(v.number()),
    directorsMaximum: v.optional(v.number()),
    relatedPrecedentRunId: v.optional(v.id("legalPrecedentRuns")),
    shareClassAmendmentText: v.optional(v.string()),
    jurisdictionNew: v.optional(v.string()),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...args }) => {
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
  },
});

export const upsertAnnualMaintenanceRecord = mutation({
  args: {
    id: v.optional(v.id("annualMaintenanceRecords")),
    societyId: v.id("societies"),
    status: v.optional(v.string()),
    yearFilingFor: v.optional(v.string()),
    lastAgmDate: v.optional(v.string()),
    filingDate: v.optional(v.string()),
    draftFilingDocumentId: v.optional(v.id("documents")),
    signedFilingDocumentId: v.optional(v.id("documents")),
    processedFilingDocumentId: v.optional(v.id("documents")),
    relatedPrecedentRunId: v.optional(v.id("legalPrecedentRuns")),
    filingId: v.optional(v.id("filings")),
    keyVaultItemId: v.optional(v.id("secretVaultItems")),
    templateFilingId: v.optional(v.id("legalTemplates")),
    authorizingPhone: v.optional(v.string()),
    authorizingRoleHolderId: v.optional(v.id("roleHolders")),
    financialStatementsDocumentId: v.optional(v.id("documents")),
    fiscalYearEndDate: v.optional(v.string()),
    incomeTaxReturnDate: v.optional(v.string()),
    annualFinancialStatementType: v.optional(v.string()),
    financialStatementReportDate: v.optional(v.string()),
    financialStatementReportType: v.optional(v.string()),
    auditedFinancialStatements: v.optional(v.boolean()),
    auditedFinancialStatementsNextYear: v.optional(v.boolean()),
    annualFinancialsEngagementLevel: v.optional(v.string()),
    annualFinancialStatementOption: v.optional(v.string()),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...args }) => {
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
  },
});

export const upsertJurisdictionMetadata = mutation({
  args: {
    id: v.optional(v.id("jurisdictionMetadata")),
    jurisdiction: v.string(),
    label: v.string(),
    actFormedUnder: v.optional(v.string()),
    nuansJurisdictionNumber: v.optional(v.string()),
    nuansReservationReportTypeId: v.optional(v.string()),
    incorporationServiceEligible: v.optional(v.boolean()),
    sourceOptionId: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...args }) => {
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
  },
});

export const upsertSupportLog = mutation({
  args: {
    id: v.optional(v.id("supportLogs")),
    societyId: v.optional(v.id("societies")),
    logType: v.string(),
    severity: v.optional(v.string()),
    page: v.optional(v.string()),
    pageLocationUrl: v.optional(v.string()),
    userId: v.optional(v.id("users")),
    relatedUserId: v.optional(v.id("users")),
    relatedEventId: v.optional(v.string()),
    relatedEntityId: v.optional(v.id("societies")),
    relatedSubscriptionId: v.optional(v.string()),
    relatedIncorporationId: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    detailsHeading: v.optional(v.string()),
    detailsBody: v.optional(v.string()),
    sourceExternalIds: v.optional(v.array(v.string())),
    createdAtISO: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...args }) => {
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
  },
});

export const removeFormationRecord = mutation({
  args: { id: v.id("formationRecords") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

export const removeNameSearchItem = mutation({
  args: { id: v.id("nameSearchItems") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

export const removeEntityAmendment = mutation({
  args: { id: v.id("entityAmendments") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

export const removeAnnualMaintenanceRecord = mutation({
  args: { id: v.id("annualMaintenanceRecords") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

export const removeJurisdictionMetadata = mutation({
  args: { id: v.id("jurisdictionMetadata") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

export const removeSupportLog = mutation({
  args: { id: v.id("supportLogs") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

function cleanText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function cleanList(values?: string[]) {
  return Array.from(new Set((values ?? []).map((value) => cleanText(value)).filter(Boolean))) as string[];
}
