// @ts-nocheck
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("donationReceipts")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const issue = mutation({
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
  handler: async (ctx, args) => {
    // Serial receipt numbers per society — next = count + 1, zero-padded.
    const existing = await ctx.db
      .query("donationReceipts")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .collect();
    const next = String(existing.length + 1).padStart(6, "0");
    return ctx.db.insert("donationReceipts", {
      ...args,
      receiptNumber: next,
      issuedAtISO: new Date().toISOString(),
    });
  },
});

export const voidReceipt = mutation({
  args: { id: v.id("donationReceipts"), reason: v.string() },
  returns: v.any(),
  handler: async (ctx, { id, reason }) => {
    await ctx.db.patch(id, {
      voidedAtISO: new Date().toISOString(),
      voidReason: reason,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("donationReceipts") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
