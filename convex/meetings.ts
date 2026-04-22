import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  buildQuorumSnapshot,
  getBylawRuleSetForDate,
} from "./lib/bylawRules";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("meetings")
      .withIndex("by_society_date", (q) => q.eq("societyId", societyId))
      .order("desc")
      .collect(),
});

export const get = query({
  args: { id: v.id("meetings") },
  returns: v.any(),
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
    sourceReviewStatus: v.optional(v.string()),
    sourceReviewNotes: v.optional(v.string()),
    sourceReviewedAtISO: v.optional(v.string()),
    sourceReviewedByUserId: v.optional(v.id("users")),
    packageReviewStatus: v.optional(v.string()),
    packageReviewNotes: v.optional(v.string()),
    packageReviewedAtISO: v.optional(v.string()),
    packageReviewedByUserId: v.optional(v.id("users")),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
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
      sourceReviewStatus: v.optional(v.string()),
      sourceReviewNotes: v.optional(v.string()),
      sourceReviewedAtISO: v.optional(v.string()),
      sourceReviewedByUserId: v.optional(v.id("users")),
      packageReviewStatus: v.optional(v.string()),
      packageReviewNotes: v.optional(v.string()),
      packageReviewedAtISO: v.optional(v.string()),
      packageReviewedByUserId: v.optional(v.id("users")),
      notes: v.optional(v.string()),
    }),
  },
  returns: v.any(),
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, patch);
  },
});

export const markSourceReview = mutation({
  args: {
    id: v.id("meetings"),
    status: v.string(),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, { id, status, notes, actingUserId }) => {
    const meeting = await ctx.db.get(id);
    if (!meeting) throw new Error("Meeting not found.");
    const actor = actingUserId ? await ctx.db.get(actingUserId) : null;
    if (actor && actor.societyId !== meeting.societyId) {
      throw new Error("Reviewer is not part of this society.");
    }
    const now = new Date().toISOString();
    const patch: any = {
      sourceReviewStatus: status,
      sourceReviewNotes: notes || undefined,
    };
    if (status === "source_reviewed") {
      patch.sourceReviewedAtISO = now;
      patch.sourceReviewedByUserId = actingUserId;
    }
    await ctx.db.patch(id, patch);

    const minutes = await ctx.db
      .query("minutes")
      .withIndex("by_meeting", (q) => q.eq("meetingId", id))
      .first();
    if (minutes) {
      await ctx.db.patch(minutes._id, {
        sourceReviewStatus: status,
        sourceReviewNotes: notes || undefined,
        sourceReviewedAtISO: status === "source_reviewed" ? now : undefined,
        sourceReviewedByUserId: status === "source_reviewed" ? actingUserId : undefined,
      });
    }

    await ctx.db.insert("activity", {
      societyId: meeting.societyId,
      actor: actor?.displayName ?? "You",
      entityType: "meeting",
      entityId: id,
      action: "source-review",
      summary: `Marked source review ${status.replace(/_/g, " ")} for ${meeting.title}`,
      createdAtISO: now,
    });
  },
});

export const setPackageReviewStatus = mutation({
  args: {
    id: v.id("meetings"),
    status: v.string(),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, { id, status, notes, actingUserId }) => {
    const meeting = await ctx.db.get(id);
    if (!meeting) throw new Error("Meeting not found.");
    const actor = actingUserId ? await ctx.db.get(actingUserId) : null;
    if (actor && actor.societyId !== meeting.societyId) {
      throw new Error("Reviewer is not part of this society.");
    }
    const now = new Date().toISOString();
    const patch: any = {
      packageReviewStatus: status,
      packageReviewNotes: notes || undefined,
    };
    if (status === "ready" || status === "released") {
      patch.packageReviewedAtISO = now;
      patch.packageReviewedByUserId = actingUserId;
    }
    await ctx.db.patch(id, patch);
    await ctx.db.insert("activity", {
      societyId: meeting.societyId,
      actor: actor?.displayName ?? "You",
      entityType: "meeting",
      entityId: id,
      action: "package-review",
      summary: `Marked board package ${status.replace(/_/g, " ")} for ${meeting.title}`,
      createdAtISO: now,
    });
  },
});

export const backfillQuorumSnapshot = mutation({
  args: { id: v.id("meetings") },
  returns: v.any(),
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
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
