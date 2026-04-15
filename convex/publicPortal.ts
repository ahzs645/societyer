// @ts-nocheck
import { query } from "./_generated/server";
import { v } from "convex/values";
import { isSocietyModuleEnabled } from "./lib/moduleSettings";

export const getSocietyBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const societies = await ctx.db.query("societies").collect();
    const society = societies.find((row) => row.publicSlug === slug) ?? null;
    if (!society) return null;
    return {
      _id: society._id,
      name: society.name,
      publicSlug: society.publicSlug,
      publicSummary: society.publicSummary,
      publicContactEmail: society.publicContactEmail ?? society.privacyOfficerEmail,
      publicTransparencyEnabled: society.publicTransparencyEnabled ?? false,
    };
  },
});

export const volunteerIntakeContext = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const societies = await ctx.db.query("societies").collect();
    const society = societies.find((row) => row.publicSlug === slug) ?? null;
    if (!society || !isSocietyModuleEnabled(society, "volunteers")) return null;

    const committees = await ctx.db
      .query("committees")
      .withIndex("by_society", (q) => q.eq("societyId", society._id))
      .collect();

    return {
      society: {
        _id: society._id,
        name: society.name,
        publicSlug: society.publicSlug,
        publicContactEmail: society.publicContactEmail ?? society.privacyOfficerEmail,
      },
      committees: committees.map((committee) => ({
        _id: committee._id,
        name: committee.name,
        summary: committee.mandate ?? committee.description ?? committee.notes,
      })),
    };
  },
});

export const grantIntakeContext = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const societies = await ctx.db.query("societies").collect();
    const society = societies.find((row) => row.publicSlug === slug) ?? null;
    if (!society || !isSocietyModuleEnabled(society, "grants")) return null;

    const grants = await ctx.db
      .query("grants")
      .withIndex("by_society", (q) => q.eq("societyId", society._id))
      .collect();

    return {
      society: {
        _id: society._id,
        name: society.name,
        publicSlug: society.publicSlug,
        publicContactEmail: society.publicContactEmail ?? society.privacyOfficerEmail,
      },
      grants: grants
        .filter((grant) => grant.allowPublicApplications)
        .map((grant) => ({
          _id: grant._id,
          title: grant.title,
          funder: grant.funder,
          program: grant.program,
          applicationDueDate: grant.applicationDueDate,
          publicDescription: grant.publicDescription ?? grant.notes,
          applicationInstructions: grant.applicationInstructions,
        })),
    };
  },
});
