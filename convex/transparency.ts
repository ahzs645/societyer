// @ts-nocheck
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireRole } from "./users";
import { isSocietyModuleEnabled } from "./lib/moduleSettings";
import { createDownloadUrl } from "./providers/storage";

export const listPublications = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }): Promise<any[]> =>
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
    reviewStatus: v.optional(v.string()),
    approvedByUserId: v.optional(v.id("users")),
    approvedAtISO: v.optional(v.string()),
    featured: v.optional(v.boolean()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<any> => {
    await requireRole(ctx, {
      actingUserId: args.actingUserId,
      societyId: args.societyId,
      required: "Director",
    });
    const { id, actingUserId, ...rest } = args;
    if (rest.status === "Published" && rest.reviewStatus !== "Approved") {
      throw new Error("Publication must be reviewed and approved before it goes live.");
    }
    if (id) {
      await ctx.db.patch(id, rest);
      return id;
    }
    const payload: any = {
      ...rest,
      createdAtISO: new Date().toISOString(),
    };
    return await ctx.db.insert("publications", {
      ...payload,
    });
  },
});

export const removePublication = mutation({
  args: { id: v.id("publications"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, { id, actingUserId }): Promise<void> => {
    const publication: any = await ctx.db.get(id);
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
  returns: v.any(),
  handler: async (ctx, { slug }): Promise<any> => {
    if (!slug) return null;
    const societies: any[] = await ctx.db.query("societies").collect();
    const matching = societies.find((society) => society.publicSlug === slug);
    const society = matching ?? null;
    if (
      !society ||
      !society.publicTransparencyEnabled ||
      !isSocietyModuleEnabled(society, "transparency")
    ) {
      return null;
    }

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

    const documentById = new Map(
      documents.map((document: any) => [String(document._id), document]),
    );
    const publishedRows = await Promise.all(
      publications
        .filter((publication: any) => {
          if (publication.status !== "Published") return false;
          if (!society.publicShowBylaws && publication.category === "Bylaws") {
            return false;
          }
          if (!society.publicShowFinancials && publication.category === "AnnualReport") {
            return false;
          }
          return true;
        })
        .map(async (publication: any) => {
          const document = publication.documentId
            ? documentById.get(String(publication.documentId))
            : null;
          const downloadUrl = document
            ? await publicDocumentDownloadUrl(ctx, document)
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
        publicVolunteerIntakeEnabled: society.publicVolunteerIntakeEnabled ?? false,
        publicGrantIntakeEnabled: society.publicGrantIntakeEnabled ?? false,
        purposes: society.purposes,
        incorporationNumber: society.incorporationNumber,
        volunteerApplyPath: society.publicSlug
          && society.publicVolunteerIntakeEnabled
          && isSocietyModuleEnabled(society, "volunteers")
          ? `/public/${society.publicSlug}/volunteer-apply`
          : undefined,
        grantApplyPath:
          society.publicSlug &&
          society.publicGrantIntakeEnabled &&
          isSocietyModuleEnabled(society, "grants") &&
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

async function publicDocumentDownloadUrl(ctx: any, document: any) {
  const versions = await ctx.db
    .query("documentVersions")
    .withIndex("by_document", (q: any) => q.eq("documentId", document._id))
    .collect();
  const current = versions
    .filter((version: any) => version.isCurrent)
    .sort((a: any, b: any) => b.version - a.version)[0] ?? null;
  if (current) {
    return await createDownloadUrl({
      provider: current.storageProvider as "demo" | "rustfs",
      key: current.storageKey,
    });
  }
  return document.storageId ? await ctx.storage.getUrl(document.storageId) : undefined;
}
