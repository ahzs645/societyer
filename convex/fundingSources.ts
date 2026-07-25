// @ts-nocheck
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  fundingSourcesList,
  fundingSourcesRollup,
  applyOtenFeeStructurePortable,
  upsertSourcePortable,
  removeSourcePortable,
  upsertEventPortable,
  removeEventPortable,
  importStudentLevyPortable,
} from "../shared/functions/fundingSources";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => fundingSourcesList(await toPortableQueryCtx(ctx), args),
});

export const rollup = query({
  args: {
    societyId: v.id("societies"),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => fundingSourcesRollup(await toPortableQueryCtx(ctx), args),
});

export const upsertSource = mutation({
  args: {
    id: v.optional(v.id("fundingSources")),
    societyId: v.id("societies"),
    name: v.string(),
    sourceType: v.string(),
    status: v.string(),
    contactName: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    website: v.optional(v.string()),
    collectionAgentName: v.optional(v.string()),
    collectionModel: v.optional(v.string()),
    memberDisclosureLevel: v.optional(v.string()),
    estimatedMemberCount: v.optional(v.number()),
    collectionFrequency: v.optional(v.string()),
    collectionScheduleNotes: v.optional(v.string()),
    nextExpectedCollectionDate: v.optional(v.string()),
    reconciliationCadence: v.optional(v.string()),
    linkedMemberId: v.optional(v.id("members")),
    linkedGrantId: v.optional(v.id("grants")),
    expectedAnnualCents: v.optional(v.number()),
    committedCents: v.optional(v.number()),
    receivedToDateCents: v.optional(v.number()),
    currency: v.string(),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    restrictedPurpose: v.optional(v.string()),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertSourcePortable(await toPortableMutationCtx(ctx), args),
});

export const removeSource = mutation({
  args: { id: v.id("fundingSources"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, args) => removeSourcePortable(await toPortableMutationCtx(ctx), args),
});

export const upsertEvent = mutation({
  args: {
    id: v.optional(v.id("fundingSourceEvents")),
    societyId: v.id("societies"),
    sourceId: v.id("fundingSources"),
    eventDate: v.string(),
    kind: v.string(),
    label: v.string(),
    amountCents: v.optional(v.number()),
    memberCount: v.optional(v.number()),
    periodStart: v.optional(v.string()),
    periodEnd: v.optional(v.string()),
    attributionStatus: v.optional(v.string()),
    notes: v.optional(v.string()),
    financialTransactionId: v.optional(v.id("financialTransactions")),
    donationReceiptId: v.optional(v.id("donationReceipts")),
    documentId: v.optional(v.id("documents")),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertEventPortable(await toPortableMutationCtx(ctx), args),
});

export const removeEvent = mutation({
  args: { id: v.id("fundingSourceEvents"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, args) => removeEventPortable(await toPortableMutationCtx(ctx), args),
});

export const importStudentLevy = mutation({
  args: {
    societyId: v.id("societies"),
    sourceId: v.optional(v.id("fundingSources")),
    sourceName: v.string(),
    sourceType: v.optional(v.string()),
    status: v.string(),
    contactName: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    website: v.optional(v.string()),
    collectionAgentName: v.optional(v.string()),
    collectionModel: v.optional(v.string()),
    memberDisclosureLevel: v.optional(v.string()),
    estimatedMemberCount: v.optional(v.number()),
    collectionFrequency: v.optional(v.string()),
    collectionScheduleNotes: v.optional(v.string()),
    nextExpectedCollectionDate: v.optional(v.string()),
    reconciliationCadence: v.optional(v.string()),
    expectedAnnualCents: v.optional(v.number()),
    committedCents: v.optional(v.number()),
    receivedToDateCents: v.optional(v.number()),
    currency: v.string(),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    restrictedPurpose: v.optional(v.string()),
    notes: v.optional(v.string()),
    feePeriods: v.array(
      v.object({
        id: v.optional(v.id("membershipFeePeriods")),
        label: v.string(),
        membershipClass: v.optional(v.string()),
        priceCents: v.number(),
        currency: v.string(),
        interval: v.string(),
        effectiveFrom: v.string(),
        effectiveTo: v.optional(v.string()),
        status: v.string(),
        notes: v.optional(v.string()),
      }),
    ),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => importStudentLevyPortable(await toPortableMutationCtx(ctx), args),
});

export const applyOtenFeeStructure = mutation({
  args: {
    confirm: v.string(),
    societyId: v.optional(v.id("societies")),
    societyName: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => applyOtenFeeStructurePortable(await toPortableMutationCtx(ctx), args),
});
