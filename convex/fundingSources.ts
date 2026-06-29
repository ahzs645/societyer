// @ts-nocheck
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireRole } from "./users";
import {
  fundingSourcesList,
  fundingSourcesRollup,
  applyOtenFeeStructurePortable,
} from "../shared/functions/fundingSources";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => fundingSourcesList(toPortableQueryCtx(ctx), args),
});

export const rollup = query({
  args: {
    societyId: v.id("societies"),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => fundingSourcesRollup(toPortableQueryCtx(ctx), args),
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
  handler: async (ctx, args) => {
    await requireRole(ctx, {
      actingUserId: args.actingUserId,
      societyId: args.societyId,
      required: "Director",
    });
    const { id, actingUserId, ...rest } = args;
    const now = new Date().toISOString();
    if (id) {
      await ctx.db.patch(id, { ...rest, updatedAtISO: now });
      return id;
    }
    return await ctx.db.insert("fundingSources", {
      ...rest,
      createdAtISO: now,
      updatedAtISO: now,
    });
  },
});

export const removeSource = mutation({
  args: { id: v.id("fundingSources"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, { id, actingUserId }) => {
    const source = await ctx.db.get(id);
    if (!source) return;
    await requireRole(ctx, { actingUserId, societyId: source.societyId, required: "Director" });
    const events = await ctx.db
      .query("fundingSourceEvents")
      .withIndex("by_source", (q) => q.eq("sourceId", id))
      .collect();
    for (const event of events) await ctx.db.delete(event._id);
    await ctx.db.delete(id);
  },
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
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (!source || source.societyId !== args.societyId) {
      throw new Error("Funding source does not belong to this society.");
    }
    await requireRole(ctx, {
      actingUserId: args.actingUserId,
      societyId: args.societyId,
      required: "Director",
    });
    const { id, actingUserId, ...rest } = args;
    const now = new Date().toISOString();
    if (id) {
      await ctx.db.patch(id, { ...rest, updatedAtISO: now });
      return id;
    }
    return await ctx.db.insert("fundingSourceEvents", {
      ...rest,
      createdAtISO: now,
      updatedAtISO: now,
    });
  },
});

export const removeEvent = mutation({
  args: { id: v.id("fundingSourceEvents"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, { id, actingUserId }) => {
    const event = await ctx.db.get(id);
    if (!event) return;
    await requireRole(ctx, { actingUserId, societyId: event.societyId, required: "Director" });
    await ctx.db.delete(id);
  },
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
  handler: async (ctx, args) => {
    await requireRole(ctx, {
      actingUserId: args.actingUserId,
      societyId: args.societyId,
      required: "Admin",
    });

    const sourceName = args.sourceName.trim();
    if (!sourceName) throw new Error("Funding source name is required.");
    if (args.feePeriods.length === 0) throw new Error("At least one fee period is required.");

    const now = new Date().toISOString();
    const sourceType = args.sourceType || "Member dues";
    const sourcePayload = {
      societyId: args.societyId,
      name: sourceName,
      sourceType,
      status: args.status,
      contactName: args.contactName,
      email: args.email,
      phone: args.phone,
      website: args.website,
      collectionAgentName: args.collectionAgentName,
      collectionModel: args.collectionModel,
      memberDisclosureLevel: args.memberDisclosureLevel,
      estimatedMemberCount: args.estimatedMemberCount,
      collectionFrequency: args.collectionFrequency,
      collectionScheduleNotes: args.collectionScheduleNotes,
      nextExpectedCollectionDate: args.nextExpectedCollectionDate,
      reconciliationCadence: args.reconciliationCadence,
      expectedAnnualCents: args.expectedAnnualCents,
      committedCents: args.committedCents,
      receivedToDateCents: args.receivedToDateCents,
      currency: args.currency,
      startDate: args.startDate,
      endDate: args.endDate,
      restrictedPurpose: args.restrictedPurpose,
      notes: args.notes,
      updatedAtISO: now,
    };

    const existingSources = await ctx.db
      .query("fundingSources")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .collect();
    const sourceFromId = args.sourceId ? await ctx.db.get(args.sourceId) : null;
    if (sourceFromId && sourceFromId.societyId !== args.societyId) {
      throw new Error("Funding source does not belong to this society.");
    }
    const sourceByName = existingSources.find(
      (source) => source.name.trim().toLowerCase() === sourceName.toLowerCase(),
    );
    const existingSource = sourceFromId ?? sourceByName ?? null;
    const sourceId = existingSource
      ? (await ctx.db.patch(existingSource._id, sourcePayload), existingSource._id)
      : await ctx.db.insert("fundingSources", { ...sourcePayload, createdAtISO: now });

    const existingPeriods = await ctx.db
      .query("membershipFeePeriods")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .collect();
    let createdFeePeriods = 0;
    let updatedFeePeriods = 0;

    for (const feePeriod of args.feePeriods) {
      const label = feePeriod.label.trim();
      if (!label) throw new Error("Every fee period needs a label.");
      if (!feePeriod.effectiveFrom) throw new Error(`Fee period "${label}" needs an effective-from date.`);
      const periodFromId = feePeriod.id ? await ctx.db.get(feePeriod.id) : null;
      if (periodFromId && periodFromId.societyId !== args.societyId) {
        throw new Error("Fee period does not belong to this society.");
      }
      const periodByKey = existingPeriods.find(
        (period) =>
          period.label.trim().toLowerCase() === label.toLowerCase() &&
          (period.membershipClass ?? "") === (feePeriod.membershipClass ?? "") &&
          period.effectiveFrom === feePeriod.effectiveFrom,
      );
      const existingPeriod = periodFromId ?? periodByKey ?? null;
      const payload = {
        societyId: args.societyId,
        planId: undefined,
        membershipClass: feePeriod.membershipClass,
        label,
        priceCents: feePeriod.priceCents,
        currency: feePeriod.currency,
        interval: feePeriod.interval,
        effectiveFrom: feePeriod.effectiveFrom,
        effectiveTo: feePeriod.effectiveTo,
        status: feePeriod.status,
        notes: feePeriod.notes,
        updatedAtISO: now,
      };
      if (existingPeriod) {
        await ctx.db.patch(existingPeriod._id, payload);
        updatedFeePeriods += 1;
      } else {
        await ctx.db.insert("membershipFeePeriods", { ...payload, createdAtISO: now });
        createdFeePeriods += 1;
      }
    }

    return {
      sourceId,
      fundingSourceAction: existingSource ? "updated" : "created",
      createdFeePeriods,
      updatedFeePeriods,
    };
  },
});

export const applyOtenFeeStructure = mutation({
  args: {
    confirm: v.string(),
    societyId: v.optional(v.id("societies")),
    societyName: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => applyOtenFeeStructurePortable(toPortableMutationCtx(ctx), args),
});
