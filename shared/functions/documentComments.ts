/**
 * PORTABLE FUNCTIONS: the document-comments domain
 * (listForDocument / create / setStatus / remove).
 *
 * Reads/writes the `documentComments` table over `ctx.db`. Each handler runs
 * unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

export async function listForDocumentPortable(ctx: PortableQueryCtx, { documentId }: { documentId: string }) {
  return ctx.db
    .query("documentComments")
    .withIndex("by_document", (q) => q.eq("documentId", documentId))
    .collect()
    .then((rows) => rows.sort((a, b) => String(b.createdAtISO).localeCompare(String(a.createdAtISO))));
}

export async function createPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    documentId: string;
    pageNumber?: number;
    anchorText?: string;
    authorName: string;
    authorUserId?: string;
    body: string;
  },
) {
  if (!args.body.trim()) throw new Error("Comment body is required.");
  const document = await ctx.db.get(args.documentId);
  if (!document || document.societyId !== args.societyId) {
    throw new Error("Document not found for this society.");
  }
  const id = await ctx.db.insert("documentComments", {
    societyId: args.societyId,
    documentId: args.documentId,
    pageNumber: args.pageNumber,
    anchorText: args.anchorText || undefined,
    authorName: args.authorName,
    authorUserId: args.authorUserId,
    body: args.body,
    status: "open",
    createdAtISO: new Date().toISOString(),
  });
  await ctx.db.patch(args.documentId, {
    reviewStatus: document.reviewStatus === "approved" ? "in_review" : document.reviewStatus ?? "in_review",
  });
  return id;
}

export async function setStatusPortable(
  ctx: PortableMutationCtx,
  { id, status, actingUserId }: { id: string; status: string; actingUserId?: string },
) {
  const comment = await ctx.db.get(id);
  if (!comment) return;
  await ctx.db.patch(id, {
    status,
    resolvedAtISO: status === "resolved" ? new Date().toISOString() : undefined,
    resolvedByUserId: status === "resolved" ? actingUserId : undefined,
  });
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  await ctx.db.delete(id);
}
