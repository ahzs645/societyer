/**
 * PORTABLE FUNCTIONS: the document-comments domain
 * (listForDocument / create / setStatus / remove).
 *
 * Reads/writes the `documentComments` table over `ctx.db`. Each handler runs
 * unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, principalUserId, requireSocietyMembership } from "./access";

export async function listForDocumentPortable(ctx: PortableQueryCtx, { documentId }: { documentId: string }) {
  const document = await ctx.db.get(documentId, "documents");
  if (!document) throw new Error("documents not found.");
  await requireSocietyMembership(ctx, String(document.societyId));
  await getOwned(ctx, "documents", documentId, String(document.societyId));
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
  await requireSocietyMembership(ctx, args.societyId);
  const document = await getOwned(ctx, "documents", args.documentId, args.societyId);
  const authorUserId = args.authorUserId
    ? await principalUserId(ctx, args.societyId)
    : undefined;
  if (args.authorUserId) await getOwned(ctx, "users", args.authorUserId, args.societyId);
  const id = await ctx.db.insert("documentComments", {
    societyId: args.societyId,
    documentId: args.documentId,
    pageNumber: args.pageNumber,
    anchorText: args.anchorText || undefined,
    authorName: args.authorName,
    authorUserId,
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
  const comment = await ctx.db.get(id, "documentComments");
  if (!comment) return;
  await requireSocietyMembership(ctx, String(comment.societyId));
  await getOwned(ctx, "documentComments", id, String(comment.societyId));
  const resolvedByUserId = status === "resolved"
    ? await principalUserId(ctx, String(comment.societyId))
    : undefined;
  await ctx.db.patch(id, {
    status,
    resolvedAtISO: status === "resolved" ? new Date().toISOString() : undefined,
    resolvedByUserId,
  });
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const comment = await ctx.db.get(id, "documentComments");
  if (!comment) return;
  await requireSocietyMembership(ctx, String(comment.societyId));
  await getOwned(ctx, "documentComments", id, String(comment.societyId));
  await ctx.db.delete(id);
}
