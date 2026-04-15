import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireRole } from "./users";

export const listPublications = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("publications")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
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
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, {
      actingUserId: args.actingUserId,
      societyId: args.societyId,
      required: "Director",
    });
    const { id, actingUserId, ...rest } = args;
    if (id) {
      await ctx.db.patch(id, rest);
      return id;
    }
    return await ctx.db.insert("publications", {
      ...rest,
      createdAtISO: new Date().toISOString(),
    });
  },
});

export const removePublication = mutation({
  args: { id: v.id("publications"), actingUserId: v.optional(v.id("users")) },
  handler: async (ctx, { id, actingUserId }) => {
    const publication = await ctx.db.get(id);
    if (!publication) return;
    await requireRole(ctx, {
      actingUserId,
      societyId: publication.societyId,
      required: "Director",
    });
    await ctx.db.delete(id);
  },
});

export const publicCenter = query({
  args: { slug: v.optional(v.string()) },
  handler: async (ctx, { slug }) => {
    const societies = await ctx.db.query("societies").collect();
    const matching = slug
      ? societies.find((society) => society.publicSlug === slug)
      : societies.find((society) => society.publicTransparencyEnabled);
    const society = matching ?? null;
    if (!society || !society.publicTransparencyEnabled) return null;

    const [directors, publications, documents, grants] = await Promise.all([
      society.publicShowBoard
        ? ctx.db
            .query("directors")
            .withIndex("by_society", (q) => q.eq("societyId", society._id))
            .collect()
        : [],
      ctx.db
        .query("publications")
        .withIndex("by_society", (q) => q.eq("societyId", society._id))
        .collect(),
      ctx.db
        .query("documents")
        .withIndex("by_society", (q) => q.eq("societyId", society._id))
        .collect(),
      ctx.db
        .query("grants")
        .withIndex("by_society", (q) => q.eq("societyId", society._id))
        .collect(),
    ]);

    const documentById = new Map(documents.map((document) => [String(document._id), document]));
    const publishedRows = await Promise.all(
      publications
        .filter((publication) => {
          if (publication.status !== "Published") return false;
          if (!society.publicShowBylaws && publication.category === "Bylaws") {
            return false;
          }
          if (!society.publicShowFinancials && publication.category === "AnnualReport") {
            return false;
          }
          return true;
        })
        .map(async (publication) => {
          const document = publication.documentId
            ? documentById.get(String(publication.documentId))
            : null;
          const downloadUrl = document?.storageId
            ? await ctx.storage.getUrl(document.storageId)
            : undefined;
          return {
            ...publication,
            documentTitle: document?.title,
            fileName: document?.fileName,
            downloadUrl,
          };
        }),
    );

    return {
      society: {
        _id: society._id,
        name: society.name,
        publicSlug: society.publicSlug,
        publicSummary: society.publicSummary,
        publicContactEmail: society.publicContactEmail ?? society.privacyOfficerEmail,
        publicTransparencyEnabled: society.publicTransparencyEnabled ?? false,
        publicShowBoard: society.publicShowBoard ?? true,
        publicShowBylaws: society.publicShowBylaws ?? true,
        publicShowFinancials: society.publicShowFinancials ?? true,
        purposes: society.purposes,
        incorporationNumber: society.incorporationNumber,
        volunteerApplyPath: society.publicSlug
          ? `/public/${society.publicSlug}/volunteer-apply`
          : undefined,
        grantApplyPath:
          society.publicSlug &&
          grants.some((grant) => grant.allowPublicApplications)
            ? `/public/${society.publicSlug}/grant-apply`
            : undefined,
      },
      directors: (directors ?? [])
        .filter((director: any) => director.status === "Active")
        .map((director: any) => ({
          _id: director._id,
          name: `${director.firstName} ${director.lastName}`,
          position: director.position,
        })),
      publications: publishedRows.sort((a, b) => {
        if (Number(b.featured ?? false) !== Number(a.featured ?? false)) {
          return Number(b.featured ?? false) - Number(a.featured ?? false);
        }
        return (b.publishedAtISO ?? b.createdAtISO).localeCompare(
          a.publishedAtISO ?? a.createdAtISO,
        );
      }),
    };
  },
});
