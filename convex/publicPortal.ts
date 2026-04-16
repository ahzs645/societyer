// @ts-nocheck — Convex type generation hits TS recursion limit on schemas with 50+ tables.
// The code is correct; the schema is just too large for TS inference. Track upstream:
// https://github.com/get-convex/convex-backend/issues
import { query } from "./_generated/server";
import { v } from "convex/values";
import { isSocietyModuleEnabled } from "./lib/moduleSettings";

export const getSocietyBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const society = await ctx.db
      .query("societies")
      .withIndex("by_public_slug", (q) => q.eq("publicSlug", slug))
      .first();
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
    const society = await ctx.db
      .query("societies")
      .withIndex("by_public_slug", (q) => q.eq("publicSlug", slug))
      .first();
    if (
      !society ||
      !society.publicTransparencyEnabled ||
      !society.publicVolunteerIntakeEnabled ||
      !isSocietyModuleEnabled(society, "volunteers")
    ) {
      return null;
    }

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
        summary: committee.mission ?? committee.description ?? committee.cadenceNotes ?? null,
      })),
    };
  },
});

export const grantIntakeContext = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const society = await ctx.db
      .query("societies")
      .withIndex("by_public_slug", (q) => q.eq("publicSlug", slug))
      .first();
    if (
      !society ||
      !society.publicTransparencyEnabled ||
      !society.publicGrantIntakeEnabled ||
      !isSocietyModuleEnabled(society, "grants")
    ) {
      return null;
    }

    const grants = await ctx.db
      .query("grants")
      .withIndex("by_society", (q) => q.eq("societyId", society._id))
      .collect();

    const openGrants = grants.filter((grant) => grant.allowPublicApplications);
    if (openGrants.length === 0) return null;

    return {
      society: {
        _id: society._id,
        name: society.name,
        publicSlug: society.publicSlug,
        publicContactEmail: society.publicContactEmail ?? society.privacyOfficerEmail,
      },
      grants: openGrants
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
