import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  buildQuorumSnapshot,
  getBylawRuleSetForDate,
} from "./lib/bylawRules";

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("meetings")
      .withIndex("by_society_date", (q) => q.eq("societyId", societyId))
      .order("desc")
      .collect(),
});

export const get = query({
  args: { id: v.id("meetings") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    type: v.string(),
    title: v.string(),
    scheduledAt: v.string(),
    location: v.optional(v.string()),
    electronic: v.boolean(),
    remoteUrl: v.optional(v.string()),
    remoteMeetingId: v.optional(v.string()),
    remotePasscode: v.optional(v.string()),
    remoteInstructions: v.optional(v.string()),
    quorumRequired: v.optional(v.number()),
    bylawRuleSetId: v.optional(v.id("bylawRuleSets")),
    quorumRuleVersion: v.optional(v.number()),
    quorumRuleEffectiveFromISO: v.optional(v.string()),
    quorumSourceLabel: v.optional(v.string()),
    quorumComputedAtISO: v.optional(v.string()),
    status: v.string(),
    attendeeIds: v.array(v.string()),
    agendaJson: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const rules = await getBylawRuleSetForDate(
      ctx,
      args.societyId,
      args.scheduledAt,
    );
    if (args.electronic && !rules.allowElectronicMeetings) {
      throw new Error(
        "Electronic participation is disabled by the bylaw rule set effective for this meeting date.",
      );
    }

    const snapshot = await buildQuorumSnapshot(ctx, {
      societyId: args.societyId,
      meetingDateISO: args.scheduledAt,
      meetingType: args.type,
      quorumRequiredOverride: args.quorumRequired,
    });

    return ctx.db.insert("meetings", {
      ...args,
      bylawRuleSetId: args.bylawRuleSetId ?? snapshot.bylawRuleSetId,
      quorumRuleVersion: args.quorumRuleVersion ?? snapshot.quorumRuleVersion,
      quorumRuleEffectiveFromISO:
        args.quorumRuleEffectiveFromISO ??
        snapshot.quorumRuleEffectiveFromISO,
      quorumSourceLabel: args.quorumSourceLabel ?? snapshot.quorumSourceLabel,
      quorumRequired: args.quorumRequired ?? snapshot.quorumRequired,
      quorumComputedAtISO:
        args.quorumComputedAtISO ?? snapshot.quorumComputedAtISO,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("meetings"),
    patch: v.object({
      type: v.optional(v.string()),
      title: v.optional(v.string()),
      scheduledAt: v.optional(v.string()),
      location: v.optional(v.string()),
      electronic: v.optional(v.boolean()),
      remoteUrl: v.optional(v.string()),
      remoteMeetingId: v.optional(v.string()),
      remotePasscode: v.optional(v.string()),
      remoteInstructions: v.optional(v.string()),
      noticeSentAt: v.optional(v.string()),
      quorumRequired: v.optional(v.number()),
      bylawRuleSetId: v.optional(v.id("bylawRuleSets")),
      quorumRuleVersion: v.optional(v.number()),
      quorumRuleEffectiveFromISO: v.optional(v.string()),
      quorumSourceLabel: v.optional(v.string()),
      quorumComputedAtISO: v.optional(v.string()),
      status: v.optional(v.string()),
      attendeeIds: v.optional(v.array(v.string())),
      agendaJson: v.optional(v.string()),
      minutesId: v.optional(v.id("minutes")),
      notes: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, patch);
  },
});

export const backfillQuorumSnapshot = mutation({
  args: { id: v.id("meetings") },
  handler: async (ctx, { id }) => {
    const meeting = await ctx.db.get(id);
    if (!meeting) return null;
    const snapshot = await buildQuorumSnapshot(ctx, {
      societyId: meeting.societyId,
      meetingDateISO: meeting.scheduledAt,
      meetingType: meeting.type,
      quorumRequiredOverride: meeting.quorumRequired,
    });
    const patch: any = {};
    if (meeting.quorumRequired == null && snapshot.quorumRequired != null) {
      patch.quorumRequired = snapshot.quorumRequired;
    }
    if (!meeting.bylawRuleSetId && snapshot.bylawRuleSetId) {
      patch.bylawRuleSetId = snapshot.bylawRuleSetId;
    }
    if (meeting.quorumRuleVersion == null && snapshot.quorumRuleVersion != null) {
      patch.quorumRuleVersion = snapshot.quorumRuleVersion;
    }
    if (!meeting.quorumRuleEffectiveFromISO && snapshot.quorumRuleEffectiveFromISO) {
      patch.quorumRuleEffectiveFromISO = snapshot.quorumRuleEffectiveFromISO;
    }
    if (!meeting.quorumSourceLabel) {
      patch.quorumSourceLabel = snapshot.quorumSourceLabel;
    }
    if (!meeting.quorumComputedAtISO) {
      patch.quorumComputedAtISO = snapshot.quorumComputedAtISO;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(id, patch);
    }
    return { patched: Object.keys(patch) };
  },
});

export const remove = mutation({
  args: { id: v.id("meetings") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
