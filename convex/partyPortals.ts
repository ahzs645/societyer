import { v } from "convex/values";
import { mutation, query } from "./lib/untypedServer";
import { createDownloadUrl } from "./providers/storage";

/**
 * External stakeholder portals (Corporify's auditor portal): a society shares a
 * token-scoped, read-only room with an outside party. The token in the URL is
 * the only credential (Convex has no ctx.auth), so it must be unguessable and
 * revocable. `scopes` gates which sections are visible; `allowDownload` gates
 * whether files can be pulled (vs. read-only metadata).
 */

const VALID_SCOPES = ["board", "publications", "documents"];

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    (await ctx.db
      .query("partyPortals")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect())
      .sort((a: any, b: any) => String(b.createdAtISO).localeCompare(String(a.createdAtISO))),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    token: v.string(),
    label: v.string(),
    partyEmail: v.optional(v.string()),
    scopes: v.array(v.string()),
    allowDownload: v.boolean(),
    expiresAtISO: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const scopes = args.scopes.filter((s) => VALID_SCOPES.includes(s));
    return await ctx.db.insert("partyPortals", {
      societyId: args.societyId,
      token: args.token,
      label: args.label,
      partyEmail: args.partyEmail || undefined,
      scopes,
      allowDownload: args.allowDownload,
      expiresAtISO: args.expiresAtISO || undefined,
      createdAtISO: new Date().toISOString(),
    });
  },
});

export const revoke = mutation({
  args: { id: v.id("partyPortals") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { revokedAtISO: new Date().toISOString() });
  },
});

/** Public, token-gated view. Returns null for an unknown/revoked/expired token,
 *  otherwise only the sections the token's scopes allow. */
export const center = query({
  args: { token: v.string() },
  returns: v.any(),
  handler: async (ctx, { token }) => {
    if (!token) return null;
    const portal: any = await ctx.db
      .query("partyPortals")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (!portal || portal.revokedAtISO) return null;
    if (portal.expiresAtISO && portal.expiresAtISO < new Date().toISOString()) return null;

    const society: any = await ctx.db.get(portal.societyId);
    if (!society) return null;

    const scopes: string[] = portal.scopes ?? [];
    const allowDownload: boolean = Boolean(portal.allowDownload);

    let board: any[] = [];
    if (scopes.includes("board")) {
      const directors = await ctx.db
        .query("directors")
        .withIndex("by_society", (q) => q.eq("societyId", society._id))
        .collect();
      board = directors
        .filter((d: any) => d.status === "Active")
        .map((d: any) => ({ name: `${d.firstName} ${d.lastName}`.trim(), position: d.position }));
    }

    let publications: any[] = [];
    if (scopes.includes("publications")) {
      const rows = await ctx.db
        .query("publications")
        .withIndex("by_society", (q) => q.eq("societyId", society._id))
        .collect();
      const docs = await ctx.db
        .query("documents")
        .withIndex("by_society", (q) => q.eq("societyId", society._id))
        .collect();
      const docById = new Map(docs.map((d: any) => [String(d._id), d]));
      publications = await Promise.all(
        rows
          .filter((p: any) => p.status === "Published")
          .map(async (p: any) => {
            const doc: any = p.documentId ? docById.get(String(p.documentId)) : null;
            return {
              _id: p._id,
              title: p.title,
              summary: p.summary,
              category: p.category,
              publishedAtISO: p.publishedAtISO ?? p.createdAtISO,
              fileName: doc?.fileName,
              downloadUrl: allowDownload && doc ? await documentDownloadUrl(ctx, doc) : undefined,
            };
          }),
      );
    }

    let documents: any[] = [];
    if (scopes.includes("documents")) {
      const docs = await ctx.db
        .query("documents")
        .withIndex("by_society", (q) => q.eq("societyId", society._id))
        .collect();
      documents = await Promise.all(
        docs.map(async (d: any) => ({
          _id: d._id,
          title: d.title,
          category: d.category,
          fileName: d.fileName,
          downloadUrl: allowDownload ? await documentDownloadUrl(ctx, d) : undefined,
        })),
      );
    }

    return {
      portal: { label: portal.label, scopes, allowDownload },
      society: {
        name: society.name,
        incorporationNumber: society.incorporationNumber ?? null,
        publicSummary: society.publicSummary ?? null,
      },
      board,
      publications,
      documents,
    };
  },
});

async function documentDownloadUrl(ctx: any, document: any) {
  const versions = await ctx.db
    .query("documentVersions")
    .withIndex("by_document", (q: any) => q.eq("documentId", document._id))
    .collect();
  const current = versions
    .filter((vrow: any) => vrow.isCurrent)
    .sort((a: any, b: any) => b.version - a.version)[0] ?? null;
  if (current) {
    if (current.storageProvider !== "demo" && current.storageProvider !== "rustfs") return undefined;
    return await createDownloadUrl({ provider: current.storageProvider, key: current.storageKey });
  }
  return document.storageId ? await ctx.storage.getUrl(document.storageId) : undefined;
}
