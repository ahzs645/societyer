import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getActiveBylawRuleSet } from "./lib/bylawRules";

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
    quorumRequired: v.optional(v.number()),
    status: v.string(),
    attendeeIds: v.array(v.string()),
    agendaJson: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const rules = await getActiveBylawRuleSet(ctx, args.societyId);
    if (args.electronic && !rules.allowElectronicMeetings) {
      throw new Error(
        "Electronic participation is disabled by the active bylaw rule set.",
      );
    }

    let quorumRequired = args.quorumRequired;
    if (quorumRequired == null && (args.type === "AGM" || args.type === "SGM")) {
      if (rules.quorumType === "percentage") {
        const members = await ctx.db
          .query("members")
          .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
          .collect();
        const eligible = members.filter(
          (member) => member.status === "Active" && member.votingRights,
        ).length;
        quorumRequired = Math.max(
          1,
          Math.ceil(eligible * (rules.quorumValue / 100)),
        );
      } else {
        quorumRequired = rules.quorumValue;
      }
    }

    return ctx.db.insert("meetings", {
      ...args,
      quorumRequired,
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
      noticeSentAt: v.optional(v.string()),
      quorumRequired: v.optional(v.number()),
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

export const remove = mutation({
  args: { id: v.id("meetings") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
