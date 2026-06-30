/**
 * PORTABLE FUNCTIONS: the transparency domain
 * (listPublications / upsertPublication / removePublication).
 *
 * Reads and writes the `publications` table over `ctx.db`; role gating goes
 * through `requireRolePortable`. Each handler runs unchanged on hosted Convex,
 * the local Dexie runtime, and the convex-test oracle.
 *
 * `publicCenter` resolves published-document download URLs: a `rustfs`/`demo`
 * provider key through the portable signer, a Convex `_storage` id through the
 * injected `ctx.capabilities.storage`.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { requireRolePortable } from "./access";
import { createDownloadUrl } from "../storage/signedUrl";
import { normalizeModuleSettings, type ModuleKey } from "../../src/lib/modules";

function isSocietyModuleEnabled(society: any, key: ModuleKey) {
  return normalizeModuleSettings(society)[key];
}

export async function listPublicationsPortable(
  ctx: PortableQueryCtx,
  { societyId }: { societyId: string },
): Promise<any[]> {
  return ctx.db
    .query("publications")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function upsertPublicationPortable(
  ctx: PortableMutationCtx,
  args: {
    id?: string;
    societyId: string;
    title: string;
    summary?: string;
    category: string;
    documentId?: string;
    url?: string;
    publishedAtISO?: string;
    status: string;
    reviewStatus?: string;
    approvedByUserId?: string;
    approvedAtISO?: string;
    featured?: boolean;
    actingUserId?: string;
  },
): Promise<any> {
  await requireRolePortable(ctx, {
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
}

export async function removePublicationPortable(
  ctx: PortableMutationCtx,
  { id, actingUserId }: { id: string; actingUserId?: string },
): Promise<void> {
  const publication: any = await ctx.db.get(id);
  if (!publication) return;
  await requireRolePortable(ctx, {
    actingUserId,
    societyId: publication.societyId,
    required: "Director",
  });
  await ctx.db.delete(id);
}

export async function publicCenterPortable(
  ctx: PortableQueryCtx,
  { slug }: { slug?: string },
): Promise<any> {
  if (!slug) return null;
  const society =
    (await ctx.db
      .query("societies")
      .withIndex("by_public_slug", (q) => q.eq("publicSlug", slug))
      .first()) ?? null;
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
        if (
          !society.publicShowFinancials &&
          ["AnnualReport", "FinancialSummary"].includes(publication.category)
        ) {
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
}

async function publicDocumentDownloadUrl(ctx: PortableQueryCtx, document: any) {
  const versions = await ctx.db
    .query("documentVersions")
    .withIndex("by_document", (q: any) => q.eq("documentId", document._id))
    .collect();
  const current = versions
    .filter((version: any) => version.isCurrent)
    .sort((a: any, b: any) => b.version - a.version)[0] ?? null;
  if (current) {
    if (current.storageProvider !== "demo" && current.storageProvider !== "rustfs") {
      return undefined;
    }
    return await createDownloadUrl({
      provider: current.storageProvider,
      key: current.storageKey,
    });
  }
  return document.storageId
    ? (await ctx.capabilities.storage.getDownloadUrl({ storageKey: String(document.storageId) })).url
    : undefined;
}
