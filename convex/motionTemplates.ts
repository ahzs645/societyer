import { mutation, query } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  listPortable,
  createPortable,
  updatePortable,
  removePortable,
} from "../shared/functions/motionTemplates";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => listPortable(toPortableQueryCtx(ctx), args),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    title: v.string(),
    body: v.string(),
    tags: v.optional(v.array(v.string())),
    requiresSpecialResolution: v.optional(v.boolean()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => createPortable(toPortableMutationCtx(ctx), args),
});

export const update = mutation({
  args: {
    templateId: v.id("motionTemplates"),
    title: v.optional(v.string()),
    body: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    requiresSpecialResolution: v.optional(v.boolean()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => updatePortable(toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { templateId: v.id("motionTemplates") },
  returns: v.any(),
  handler: (ctx, args) => removePortable(toPortableMutationCtx(ctx), args),
});

const SEED_MOTIONS: Array<{
  title: string;
  body: string;
  tags: string[];
  requiresSpecialResolution: boolean;
  notes?: string;
}> = [
  {
    title: "Adopt agenda",
    body: "BE IT RESOLVED THAT the agenda for this meeting be adopted as presented.",
    tags: ["governance", "approve-agenda"],
    requiresSpecialResolution: false,
  },
  {
    title: "Approve minutes of previous meeting",
    body: "BE IT RESOLVED THAT the minutes of the previous meeting, as circulated, be approved.",
    tags: ["governance", "previous-minutes"],
    requiresSpecialResolution: false,
  },
  {
    title: "Adopt annual budget",
    body: "BE IT RESOLVED THAT the annual budget, as presented by the Treasurer, be adopted.",
    tags: ["finance"],
    requiresSpecialResolution: false,
  },
  {
    title: "Appoint auditor",
    body: "BE IT RESOLVED THAT [Firm Name] be appointed as the auditor of the Society for the current fiscal year.",
    tags: ["finance"],
    requiresSpecialResolution: false,
  },
  {
    title: "Accept financial statements",
    body: "BE IT RESOLVED THAT the financial statements for the fiscal year ending [Date] be accepted as presented.",
    tags: ["finance"],
    requiresSpecialResolution: false,
  },
  {
    title: "Amend bylaws (special resolution)",
    body: "BE IT RESOLVED AS A SPECIAL RESOLUTION THAT the bylaws of the Society be amended as set out in the attached document.",
    tags: ["bylaws"],
    requiresSpecialResolution: true,
    notes: "Requires ≥2/3 or per bylaws. Must be filed with BC Registry within 30 days.",
  },
  {
    title: "Elect director to fill vacancy",
    body: "BE IT RESOLVED THAT [Name] be elected as a director of the Society to fill the vacancy created by [reason].",
    tags: ["governance"],
    requiresSpecialResolution: false,
  },
  {
    title: "Approve membership fee schedule",
    body: "BE IT RESOLVED THAT the membership fee schedule, as set out in the attached appendix, be approved effective [Date].",
    tags: ["membership"],
    requiresSpecialResolution: false,
  },
  {
    title: "Adjourn meeting",
    body: "BE IT RESOLVED THAT the meeting be adjourned.",
    tags: ["operations", "adjournment"],
    requiresSpecialResolution: false,
  },
  {
    title: "Approve strategic plan",
    body: "BE IT RESOLVED THAT the [Year] strategic plan, as presented, be adopted.",
    tags: ["governance"],
    requiresSpecialResolution: false,
  },
  {
    title: "Authorize bank signing authority",
    body: "BE IT RESOLVED THAT [Names and Positions] be authorized as signing officers for the Society's bank accounts, with any two to sign.",
    tags: ["finance"],
    requiresSpecialResolution: false,
  },
];

export const seedDefaults = mutation({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const existing = await ctx.db
      .query("motionTemplates")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    if (existing.length > 0) return { inserted: 0, existing: existing.length };
    const now = new Date().toISOString();
    let inserted = 0;
    for (const seed of SEED_MOTIONS) {
      await ctx.db.insert("motionTemplates", {
        societyId,
        title: seed.title,
        body: seed.body,
        tags: seed.tags,
        requiresSpecialResolution: seed.requiresSpecialResolution,
        notes: seed.notes,
        usageCount: 0,
        createdAtISO: now,
        updatedAtISO: now,
      });
      inserted++;
    }
    return { inserted, existing: 0 };
  },
});
