// @ts-nocheck
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

const coveredParty = v.object({
  name: v.string(),
  partyType: v.optional(v.string()),
  coveredClass: v.optional(v.string()),
  sourceExternalIds: v.optional(v.array(v.string())),
  citationId: v.optional(v.string()),
  notes: v.optional(v.string()),
});

const coverageItem = v.object({
  label: v.string(),
  coverageType: v.optional(v.string()),
  coveredClass: v.optional(v.string()),
  limitCents: v.optional(v.number()),
  deductibleCents: v.optional(v.number()),
  summary: v.optional(v.string()),
  sourceExternalIds: v.optional(v.array(v.string())),
  citationId: v.optional(v.string()),
});

const coveredLocation = v.object({
  label: v.string(),
  address: v.optional(v.string()),
  room: v.optional(v.string()),
  coverageCents: v.optional(v.number()),
  sourceExternalIds: v.optional(v.array(v.string())),
  citationId: v.optional(v.string()),
  notes: v.optional(v.string()),
});

const policyDefinition = v.object({
  term: v.string(),
  definition: v.string(),
  sourceExternalIds: v.optional(v.array(v.string())),
  citationId: v.optional(v.string()),
});

const declinedCoverage = v.object({
  label: v.string(),
  reason: v.optional(v.string()),
  offeredLimitCents: v.optional(v.number()),
  premiumCents: v.optional(v.number()),
  declinedAt: v.optional(v.string()),
  sourceExternalIds: v.optional(v.array(v.string())),
  citationId: v.optional(v.string()),
  notes: v.optional(v.string()),
});

const certificateOfInsurance = v.object({
  holderName: v.string(),
  additionalInsuredLegalName: v.optional(v.string()),
  eventName: v.optional(v.string()),
  eventDate: v.optional(v.string()),
  requiredLimitCents: v.optional(v.number()),
  issuedAt: v.optional(v.string()),
  expiresAt: v.optional(v.string()),
  status: v.optional(v.string()),
  sourceExternalIds: v.optional(v.array(v.string())),
  citationId: v.optional(v.string()),
  notes: v.optional(v.string()),
});

const insuranceRequirement = v.object({
  context: v.string(),
  requirementType: v.optional(v.string()),
  coverageSource: v.optional(v.string()),
  cglLimitRequiredCents: v.optional(v.number()),
  cglLimitConfirmedCents: v.optional(v.number()),
  additionalInsuredRequired: v.optional(v.boolean()),
  additionalInsuredLegalName: v.optional(v.string()),
  coiStatus: v.optional(v.string()),
  coiDueDate: v.optional(v.string()),
  tenantLegalLiabilityLimitCents: v.optional(v.number()),
  hostLiquorLiability: v.optional(v.string()),
  indemnityRequired: v.optional(v.boolean()),
  waiverRequired: v.optional(v.boolean()),
  vendorCoiRequired: v.optional(v.boolean()),
  studentEventChecklistRequired: v.optional(v.boolean()),
  riskTriggers: v.optional(v.array(v.string())),
  sourceExternalIds: v.optional(v.array(v.string())),
  citationId: v.optional(v.string()),
  notes: v.optional(v.string()),
});

const claimsMadeTerms = v.object({
  retroactiveDate: v.optional(v.string()),
  continuityDate: v.optional(v.string()),
  reportingDeadline: v.optional(v.string()),
  extendedReportingPeriod: v.optional(v.string()),
  defenseCostsInsideLimit: v.optional(v.boolean()),
  territory: v.optional(v.string()),
  retentionCents: v.optional(v.number()),
  claimsNoticeContact: v.optional(v.string()),
  sourceExternalIds: v.optional(v.array(v.string())),
  citationId: v.optional(v.string()),
  notes: v.optional(v.string()),
});

const claimIncident = v.object({
  incidentDate: v.optional(v.string()),
  claimNoticeDate: v.optional(v.string()),
  status: v.optional(v.string()),
  privacyFlag: v.optional(v.boolean()),
  insurerNotifiedAt: v.optional(v.string()),
  brokerNotifiedAt: v.optional(v.string()),
  sourceExternalIds: v.optional(v.array(v.string())),
  citationId: v.optional(v.string()),
  notes: v.optional(v.string()),
});

const annualReview = v.object({
  reviewDate: v.string(),
  boardMeetingDate: v.optional(v.string()),
  reviewer: v.optional(v.string()),
  outcome: v.optional(v.string()),
  nextReviewDate: v.optional(v.string()),
  sourceExternalIds: v.optional(v.array(v.string())),
  citationId: v.optional(v.string()),
  notes: v.optional(v.string()),
});

const complianceCheck = v.object({
  label: v.string(),
  status: v.optional(v.string()),
  dueDate: v.optional(v.string()),
  completedAt: v.optional(v.string()),
  sourceExternalIds: v.optional(v.array(v.string())),
  citationId: v.optional(v.string()),
  notes: v.optional(v.string()),
});

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("insurancePolicies")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    kind: v.string(),
    insurer: v.string(),
    broker: v.optional(v.string()),
    policyNumber: v.string(),
    policySeriesKey: v.optional(v.string()),
    policyTermLabel: v.optional(v.string()),
    versionType: v.optional(v.string()),
    renewalOfPolicyNumber: v.optional(v.string()),
    coverageCents: v.optional(v.number()),
    premiumCents: v.optional(v.number()),
    deductibleCents: v.optional(v.number()),
    coverageSummary: v.optional(v.string()),
    additionalInsureds: v.optional(v.array(v.string())),
    coveredParties: v.optional(v.array(coveredParty)),
    coverageItems: v.optional(v.array(coverageItem)),
    coveredLocations: v.optional(v.array(coveredLocation)),
    policyDefinitions: v.optional(v.array(policyDefinition)),
    declinedCoverages: v.optional(v.array(declinedCoverage)),
    certificatesOfInsurance: v.optional(v.array(certificateOfInsurance)),
    insuranceRequirements: v.optional(v.array(insuranceRequirement)),
    claimsMadeTerms: v.optional(claimsMadeTerms),
    claimIncidents: v.optional(v.array(claimIncident)),
    annualReviews: v.optional(v.array(annualReview)),
    complianceChecks: v.optional(v.array(complianceCheck)),
    startDate: v.string(),
    endDate: v.optional(v.string()),
    renewalDate: v.string(),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    confidence: v.optional(v.string()),
    sensitivity: v.optional(v.string()),
    riskFlags: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    status: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    return await ctx.db.insert("insurancePolicies", {
      ...args,
      createdAtISO: now,
      updatedAtISO: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("insurancePolicies"),
    patch: v.object({
      kind: v.optional(v.string()),
      insurer: v.optional(v.string()),
      broker: v.optional(v.string()),
      policyNumber: v.optional(v.string()),
      policySeriesKey: v.optional(v.string()),
      policyTermLabel: v.optional(v.string()),
      versionType: v.optional(v.string()),
      renewalOfPolicyNumber: v.optional(v.string()),
      coverageCents: v.optional(v.number()),
      premiumCents: v.optional(v.number()),
      deductibleCents: v.optional(v.number()),
      coverageSummary: v.optional(v.string()),
      additionalInsureds: v.optional(v.array(v.string())),
      coveredParties: v.optional(v.array(coveredParty)),
      coverageItems: v.optional(v.array(coverageItem)),
      coveredLocations: v.optional(v.array(coveredLocation)),
      policyDefinitions: v.optional(v.array(policyDefinition)),
      declinedCoverages: v.optional(v.array(declinedCoverage)),
      certificatesOfInsurance: v.optional(v.array(certificateOfInsurance)),
      insuranceRequirements: v.optional(v.array(insuranceRequirement)),
      claimsMadeTerms: v.optional(claimsMadeTerms),
      claimIncidents: v.optional(v.array(claimIncident)),
      annualReviews: v.optional(v.array(annualReview)),
      complianceChecks: v.optional(v.array(complianceCheck)),
      startDate: v.optional(v.string()),
      endDate: v.optional(v.string()),
      renewalDate: v.optional(v.string()),
      sourceDocumentIds: v.optional(v.array(v.id("documents"))),
      sourceExternalIds: v.optional(v.array(v.string())),
      confidence: v.optional(v.string()),
      sensitivity: v.optional(v.string()),
      riskFlags: v.optional(v.array(v.string())),
      notes: v.optional(v.string()),
      status: v.optional(v.string()),
    }),
  },
  returns: v.any(),
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, { ...patch, updatedAtISO: new Date().toISOString() });
  },
});

export const remove = mutation({
  args: { id: v.id("insurancePolicies") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
