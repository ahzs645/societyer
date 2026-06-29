import { mutation, query } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  listPortable,
  createPortable,
  updatePortable,
  removePortable,
  duplicatePortable,
  createFromMeetingPortable,
} from "../shared/functions/meetingTemplates";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

const templateItem = v.object({
  title: v.string(),
  depth: v.optional(v.union(v.literal(0), v.literal(1))),
  sectionType: v.optional(v.string()),
  presenter: v.optional(v.string()),
  details: v.optional(v.string()),
  motionTemplateId: v.optional(v.id("motionTemplates")),
  motionText: v.optional(v.string()),
});

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => listPortable(toPortableQueryCtx(ctx), args),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    name: v.string(),
    description: v.optional(v.string()),
    meetingType: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
    items: v.array(templateItem),
  },
  returns: v.any(),
  handler: (ctx, args) => createPortable(toPortableMutationCtx(ctx), args),
});

export const update = mutation({
  args: {
    templateId: v.id("meetingTemplates"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    meetingType: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
    items: v.optional(v.array(templateItem)),
  },
  returns: v.any(),
  handler: (ctx, args) => updatePortable(toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { templateId: v.id("meetingTemplates") },
  returns: v.any(),
  handler: (ctx, args) => removePortable(toPortableMutationCtx(ctx), args),
});

export const duplicate = mutation({
  args: { templateId: v.id("meetingTemplates"), name: v.optional(v.string()) },
  returns: v.any(),
  handler: (ctx, args) => duplicatePortable(toPortableMutationCtx(ctx), args),
});

export const createFromMeeting = mutation({
  args: {
    meetingId: v.id("meetings"),
    name: v.string(),
    description: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: (ctx, args) => createFromMeetingPortable(toPortableMutationCtx(ctx), args),
});

export const seedDefaults = mutation({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const existing = await ctx.db
      .query("meetingTemplates")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    if (existing.length > 0) return { inserted: 0, existing: existing.length };
    const now = new Date().toISOString();
    await ctx.db.insert("meetingTemplates", {
      societyId,
      name: "Regular board meeting",
      description: "Baseline recurring board agenda with standard procedural motions.",
      meetingType: "Board",
      isDefault: true,
      items: [
        { title: "Welcome and call to order", depth: 0, sectionType: "discussion" },
        {
          title: "Indigenous acknowledgement",
          depth: 0,
          sectionType: "discussion",
          details: "Acknowledgement that the meeting is taking place on the unceded and ancestral territory of the Lheidli T'enneh, part of the Dakelh (Carrier) First Nations.",
        },
        {
          title: "Adopt agenda",
          depth: 0,
          sectionType: "motion",
          motionText: "BE IT RESOLVED THAT the agenda for this meeting be adopted as presented.",
        },
        {
          title: "Adopt previous minutes",
          depth: 0,
          sectionType: "motion",
          motionText: "BE IT RESOLVED THAT the minutes of the previous meeting, as circulated, be approved.",
        },
        { title: "Reports", depth: 0, sectionType: "report" },
        { title: "Chair report", depth: 1, sectionType: "report" },
        { title: "Treasurer report", depth: 1, sectionType: "report" },
        { title: "New business", depth: 0, sectionType: "discussion" },
        {
          title: "Adjournment",
          depth: 0,
          sectionType: "motion",
          motionText: "BE IT RESOLVED THAT the meeting be adjourned.",
        },
      ],
      createdAtISO: now,
      updatedAtISO: now,
    });
    return { inserted: 1, existing: 0 };
  },
});
