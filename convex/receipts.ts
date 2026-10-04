// @ts-nocheck
import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  receiptsListPortable,
  receiptIssuePortable,
  receiptVoidPortable,
  receiptRemovePortable,
} from "../shared/functions/receipts";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = authorizedQuery("receipts:list", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => receiptsListPortable(await toPortableQueryCtx(ctx), args),
});

export const issue = authorizedMutation("receipts:issue", mutation)({
  args: {
    societyId: v.id("societies"),
    charityNumber: v.string(),
    donorName: v.string(),
    donorEmail: v.optional(v.string()),
    donorAddress: v.optional(v.string()),
    amountCents: v.number(),
    eligibleAmountCents: v.number(),
    receivedOnISO: v.string(),
    location: v.string(),
    description: v.optional(v.string()),
    isNonCash: v.boolean(),
    appraiserName: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => receiptIssuePortable(await toPortableMutationCtx(ctx), args),
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
