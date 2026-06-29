import { v } from "convex/values";
import { mutation, query } from "./lib/untypedServer";
import {
  listPortable,
  getPortable,
  publicOpeningsPortable,
  applicationsPortable,
  transactionsPortable,
  reportsPortable,
  employeeLinksPortable,
  summaryPortable,
  upsertEmployeeLinkPortable,
  removeEmployeeLinkPortable,
  submitApplicationPortable,
  reviewApplicationPortable,
  convertApplicationPortable,
  upsertGrantPortable,
  importGcosProjectSnapshotPortable,
  removeGrantPortable,
  upsertReportPortable,
  removeReportPortable,
  upsertTransactionPortable,
  removeTransactionPortable,
} from "../shared/functions/grants";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

const grantRequirement = v.object({
  id: v.string(),
  category: v.string(),
  label: v.string(),
  status: v.string(),
  dueDate: v.optional(v.string()),
  documentId: v.optional(v.id("documents")),
  notes: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
  documentUrl: v.optional(v.string()),
  formNumber: v.optional(v.string()),
});

const grantUseOfFundsLine = v.object({
  label: v.string(),
  amountCents: v.optional(v.number()),
  notes: v.optional(v.string()),
});

const grantTimelineEvent = v.object({
  label: v.string(),
  date: v.string(),
  status: v.optional(v.string()),
  notes: v.optional(v.string()),
});

const grantComplianceFlag = v.object({
  label: v.string(),
  status: v.string(),
  notes: v.optional(v.string()),
  requirementId: v.optional(v.string()),
});

const grantNextStep = v.object({
  id: v.string(),
  label: v.string(),
  status: v.string(),
  priority: v.string(),
  dueHint: v.optional(v.string()),
  source: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
  actionLabel: v.optional(v.string()),
  actionUrl: v.optional(v.string()),
  reason: v.optional(v.string()),
});

const grantEmployeeLinkPatch = v.object({
  role: v.optional(v.string()),
  status: v.optional(v.string()),
  source: v.optional(v.string()),
  fundedHoursPerWeek: v.optional(v.number()),
  fundedHourlyWageCents: v.optional(v.number()),
  startDate: v.optional(v.string()),
  endDate: v.optional(v.string()),
  notes: v.optional(v.string()),
});

const grantContact = v.object({
  role: v.string(),
  name: v.optional(v.string()),
  organization: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  notes: v.optional(v.string()),
});

const grantAnswerLibraryItem = v.object({
  section: v.string(),
  title: v.string(),
  body: v.string(),
});

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => listPortable(toPortableQueryCtx(ctx), args),
});

export const get = query({
  args: { id: v.id("grants") },
  returns: v.any(),
  handler: (ctx, args) => getPortable(toPortableQueryCtx(ctx), args),
});

export const publicOpenings = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => publicOpeningsPortable(toPortableQueryCtx(ctx), args),
});

export const applications = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => applicationsPortable(toPortableQueryCtx(ctx), args),
});

export const transactions = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => transactionsPortable(toPortableQueryCtx(ctx), args),
});

export const reports = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => reportsPortable(toPortableQueryCtx(ctx), args),
});

export const employeeLinks = query({
  args: { societyId: v.id("societies"), grantId: v.optional(v.id("grants")) },
  returns: v.any(),
  handler: (ctx, args) => employeeLinksPortable(toPortableQueryCtx(ctx), args),
});

export const upsertEmployeeLink = mutation({
  args: {
    id: v.optional(v.id("grantEmployeeLinks")),
    societyId: v.id("societies"),
    grantId: v.id("grants"),
    employeeId: v.id("employees"),
    patch: v.optional(grantEmployeeLinkPatch),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: (ctx, args) => upsertEmployeeLinkPortable(toPortableMutationCtx(ctx), args),
});

export const removeEmployeeLink = mutation({
  args: { id: v.id("grantEmployeeLinks"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: (ctx, args) => removeEmployeeLinkPortable(toPortableMutationCtx(ctx), args),
});

export const summary = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => summaryPortable(toPortableQueryCtx(ctx), args),
});

export const submitApplication = mutation({
  args: {
    societyId: v.id("societies"),
    grantId: v.optional(v.id("grants")),
    memberId: v.optional(v.id("members")),
    applicantName: v.string(),
    organizationName: v.optional(v.string()),
    email: v.string(),
    phone: v.optional(v.string()),
    amountRequestedCents: v.optional(v.number()),
    projectTitle: v.string(),
    projectSummary: v.string(),
    proposedUseOfFunds: v.optional(v.string()),
    expectedOutcomes: v.optional(v.string()),
    source: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => submitApplicationPortable(toPortableMutationCtx(ctx), args),
});

export const reviewApplication = mutation({
  args: {
    id: v.id("grantApplications"),
    status: v.string(),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: (ctx, args) => reviewApplicationPortable(toPortableMutationCtx(ctx), args),
});

export const convertApplication = mutation({
  args: {
    id: v.id("grantApplications"),
    funder: v.string(),
    program: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: (ctx, args) => convertApplicationPortable(toPortableMutationCtx(ctx), args),
});

export const upsertGrant = mutation({
  args: {
    id: v.optional(v.id("grants")),
    societyId: v.id("societies"),
    committeeId: v.optional(v.id("committees")),
    boardOwnerUserId: v.optional(v.id("users")),
    linkedFinancialAccountId: v.optional(v.id("financialAccounts")),
    opportunityUrl: v.optional(v.string()),
    opportunityType: v.optional(v.string()),
    priority: v.optional(v.string()),
    fitScore: v.optional(v.number()),
    nextAction: v.optional(v.string()),
    publicDescription: v.optional(v.string()),
    allowPublicApplications: v.optional(v.boolean()),
    applicationInstructions: v.optional(v.string()),
    requirements: v.optional(v.array(grantRequirement)),
    confirmationCode: v.optional(v.string()),
    sourcePath: v.optional(v.string()),
    sourceImportedAtISO: v.optional(v.string()),
    sourceFileCount: v.optional(v.number()),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    confidence: v.optional(v.string()),
    sensitivity: v.optional(v.string()),
    riskFlags: v.optional(v.array(v.string())),
    sourceNotes: v.optional(v.string()),
    keyFacts: v.optional(v.array(v.string())),
    useOfFunds: v.optional(v.array(grantUseOfFundsLine)),
    timelineEvents: v.optional(v.array(grantTimelineEvent)),
    complianceFlags: v.optional(v.array(grantComplianceFlag)),
    nextSteps: v.optional(v.array(grantNextStep)),
    contacts: v.optional(v.array(grantContact)),
    answerLibrary: v.optional(v.array(grantAnswerLibraryItem)),
    title: v.string(),
    funder: v.string(),
    program: v.optional(v.string()),
    status: v.string(),
    amountRequestedCents: v.optional(v.number()),
    amountAwardedCents: v.optional(v.number()),
    restrictedPurpose: v.optional(v.string()),
    applicationDueDate: v.optional(v.string()),
    submittedAtISO: v.optional(v.string()),
    decisionAtISO: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    nextReportDueAtISO: v.optional(v.string()),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: (ctx, args) => upsertGrantPortable(toPortableMutationCtx(ctx), args),
});

export const importGcosProjectSnapshot = mutation({
  args: {
    societyId: v.id("societies"),
    normalizedGrant: v.any(),
    snapshot: v.optional(v.any()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: (ctx, args) => importGcosProjectSnapshotPortable(toPortableMutationCtx(ctx), args),
});

export const removeGrant = mutation({
  args: { id: v.id("grants"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: (ctx, args) => removeGrantPortable(toPortableMutationCtx(ctx), args),
});

export const upsertReport = mutation({
  args: {
    id: v.optional(v.id("grantReports")),
    societyId: v.id("societies"),
    grantId: v.id("grants"),
    title: v.string(),
    dueAtISO: v.string(),
    submittedAtISO: v.optional(v.string()),
    status: v.string(),
    spendingToDateCents: v.optional(v.number()),
    outcomeSummary: v.optional(v.string()),
    documentId: v.optional(v.id("documents")),
    submittedByUserId: v.optional(v.id("users")),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: (ctx, args) => upsertReportPortable(toPortableMutationCtx(ctx), args),
});

export const removeReport = mutation({
  args: { id: v.id("grantReports"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: (ctx, args) => removeReportPortable(toPortableMutationCtx(ctx), args),
});

export const upsertTransaction = mutation({
  args: {
    id: v.optional(v.id("grantTransactions")),
    societyId: v.id("societies"),
    grantId: v.id("grants"),
    financialTransactionId: v.optional(v.id("financialTransactions")),
    documentId: v.optional(v.id("documents")),
    date: v.string(),
    direction: v.string(),
    amountCents: v.number(),
    description: v.string(),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: (ctx, args) => upsertTransactionPortable(toPortableMutationCtx(ctx), args),
});

export const removeTransaction = mutation({
  args: { id: v.id("grantTransactions"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: (ctx, args) => removeTransactionPortable(toPortableMutationCtx(ctx), args),
});
