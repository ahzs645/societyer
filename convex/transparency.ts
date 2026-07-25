// @ts-nocheck
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  listPublicationsPortable,
  upsertPublicationPortable,
  removePublicationPortable,
  publicCenterPortable,
} from "../shared/functions/transparency";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";
import { buildConvexCapabilities } from "./providers/capabilities";

export const listPublications = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listPublicationsPortable(await toPortableQueryCtx(ctx), args),
});

export const upsertPublication = mutation({
  args: {
    id: v.optional(v.id("publications")),
    societyId: v.id("societies"),
    title: v.string(),
    summary: v.optional(v.string()),
    category: v.string(),
    documentId: v.optional(v.id("documents")),
    url: v.optional(v.string()),
    publishedAtISO: v.optional(v.string()),
    status: v.string(),
    reviewStatus: v.optional(v.string()),
    approvedByUserId: v.optional(v.id("users")),
    approvedAtISO: v.optional(v.string()),
    featured: v.optional(v.boolean()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<any> => upsertPublicationPortable(await toPortableMutationCtx(ctx), args),
});

export const removePublication = mutation({
  args: { id: v.id("publications"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, args): Promise<void> => removePublicationPortable(await toPortableMutationCtx(ctx), args),
});

export const publicCenter = query({
  args: { slug: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args): Promise<any> => publicCenterPortable(await toPortableQueryCtx(ctx, buildConvexCapabilities(ctx)), args),
});
