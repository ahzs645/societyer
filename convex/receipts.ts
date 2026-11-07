// @ts-nocheck
import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  receiptsListPortable,
  receiptIssuePortable,
  receiptVoidPortable,
  receiptRemovePortable,
  receiptRegistrationHistoryPortable,
  receiptRecordRegistrationPortable,
  receiptFinalizeOfficialPortable,
  receiptEvidenceForReviewPortable,
} from "../shared/functions/receipts";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";
import { charityRegistrationStatusValidator } from "./tables/organizationTaxRegistrations";
import { receiptDocumentKindValidator } from "./validators/receipts";

export const evidenceForReview = authorizedQuery("receipts:evidenceForReview", query)({
  args: { societyId: v.id("societies"), documentIds: v.array(v.id("documents")), requireFile: v.optional(v.boolean()) },
  returns: v.any(),
  handler: async (ctx, args) => receiptEvidenceForReviewPortable(await toPortableQueryCtx(ctx), args),
});

export const registrationHistory = authorizedQuery("receipts:registrationHistory", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => receiptRegistrationHistoryPortable(await toPortableQueryCtx(ctx), args),
});

export const recordRegistration = authorizedMutation("receipts:recordRegistration", mutation)({
  args: {
    societyId: v.id("societies"), expectedRevisionId: v.optional(v.id("organizationTaxRegistrations")),
    status: charityRegistrationStatusValidator, evidenceReviewed: v.boolean(),
    charityNumber: v.optional(v.string()), registeredName: v.optional(v.string()), registeredAddress: v.optional(v.string()),
    effectiveFrom: v.optional(v.string()), effectiveTo: v.optional(v.string()),
    evidenceDocumentIds: v.optional(v.array(v.id("documents"))), authorityReference: v.optional(v.string()), notes: v.optional(v.string()),
    expectedEvidenceFingerprints: v.optional(v.array(v.object({ documentId: v.id("documents"), fingerprint: v.string() }))),
  },
  returns: v.id("organizationTaxRegistrations"),
  handler: async (ctx, args) => receiptRecordRegistrationPortable(await toPortableMutationCtx(ctx), args),
});

export const list = authorizedQuery("receipts:list", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => receiptsListPortable(await toPortableQueryCtx(ctx), args),
});

export const issue = authorizedMutation("receipts:issue", mutation)({
  args: {
    societyId: v.id("societies"),
    documentKind: receiptDocumentKindValidator,
    idempotencyKey: v.string(),
    charityNumber: v.optional(v.string()),
    donorName: v.string(),
    donorEmail: v.optional(v.string()),
    donorAddress: v.optional(v.string()),
    amountCents: v.number(),
    eligibleAmountCents: v.optional(v.number()),
    receivedOnISO: v.string(),
    intendedIssueDate: v.optional(v.string()),
    location: v.string(),
    description: v.optional(v.string()),
    isNonCash: v.boolean(),
    appraiserName: v.optional(v.string()),
    advantageAmountCents: v.optional(v.number()),
    giftEligibilityConfirmed: v.optional(v.boolean()),
    sourceAcknowledgementId: v.optional(v.id("donationReceipts")),
    replacesReceiptId: v.optional(v.id("donationReceipts")),
  },
  returns: v.id("donationReceipts"),
  handler: async (ctx, args) => receiptIssuePortable(await toPortableMutationCtx(ctx), args),
});

export const finalizeOfficial = authorizedMutation("receipts:finalizeOfficial", mutation)({
  args: {
    id: v.id("donationReceipts"), signedCopyDocumentId: v.id("documents"), expectedSignedCopyRevision: v.string(), signedOn: v.string(), signatoryName: v.string(), authorityConfirmed: v.boolean(),
  },
  returns: v.id("donationReceipts"),
  handler: async (ctx, args) => receiptFinalizeOfficialPortable(await toPortableMutationCtx(ctx), args),
});

export const voidReceipt = authorizedMutation("receipts:voidReceipt", mutation)({
  args: { id: v.id("donationReceipts"), reason: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => receiptVoidPortable(await toPortableMutationCtx(ctx), args),
});

export const remove = authorizedMutation("receipts:remove", mutation)({
  args: { id: v.id("donationReceipts") },
  returns: v.any(),
  handler: async (ctx, args) => receiptRemovePortable(await toPortableMutationCtx(ctx), args),
});
