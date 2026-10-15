/**
 * PORTABLE FUNCTIONS: governing documents on the organization profile.
 *
 * `society:linkGoverningDocument` links a document already in this workspace
 * to one of the profile's governing-document fields (articles, by-laws,
 * constitution, bylaws), or unlinks it (`documentId: null`). Only the fields
 * this kind of organization keeps are accepted, and only a document of the
 * same workspace that the actor can open. Optionally re-files the document
 * under the field's category ("Other" chosen as the articles). Each change
 * writes an activity row; the result carries what Undo needs.
 */
import type { PortableMutationCtx } from "../portable/ctx";
import { documentCategoryLabel, isInternalDocumentRecord, normalizeDocumentCategory } from "../documentCategories";
import { categoryFitsGoverningField, governingDocumentAudience, governingDocumentSlot } from "../governingDocuments";
import { getOwned } from "./access";
import { requirePermissionPortable } from "./permissions";
import { documentAccessPredicate } from "./documents";

const TITLE_IN_SUMMARY_MAX = 120;

export async function linkGoverningDocumentPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; field: string; documentId: string | null; updateCategory?: boolean },
) {
  const user = await requirePermissionPortable(ctx, args.societyId, "society:write");
  const society = await ctx.db.get<any>(args.societyId, "societies");
  if (!society) throw new Error("societies not found.");
  const slot = governingDocumentSlot(society, args.field);
  if (!slot) throw new Error("This organization doesn't keep that document on its profile.");
  const previousDocumentId = society[slot.field] ? String(society[slot.field]) : null;
  const actor = user.displayName ?? "You";
  const log = (action: string, summary: string) => ctx.db.insert("activity", {
    societyId: args.societyId, actor, entityType: "society", subjectId: args.societyId,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
    entityId: args.societyId,
    action, summary: summary.slice(0, 300), createdAtISO: new Date().toISOString(),
  });

  if (args.documentId === null || args.documentId === undefined) {
    if (!previousDocumentId) return { field: slot.field, documentId: null, previousDocumentId, changed: false, categoryChange: null };
    const previous = await ctx.db.get<any>(previousDocumentId, "documents");
    await ctx.db.patch(args.societyId, { [slot.field]: undefined, updatedAt: Date.now() });
    // Never echo another workspace's row, even one linked by old data.
    const title = previous && String(previous.societyId) === args.societyId ? shortTitle(previous.title) : undefined;
    await log("governing-document-unlinked", title ? `Unlinked ${title} as ${slot.phrase}` : `Unlinked ${slot.phrase}`);
    return { field: slot.field, documentId: null, previousDocumentId, changed: true, categoryChange: null };
  }

  const document = await getOwned<any>(ctx, "documents", args.documentId, args.societyId);
  const allows = await documentAccessPredicate(ctx, args.societyId);
  if (isInternalDocumentRecord(document) || !allows(document)) throw new Error("documents not found.");
  if (document.archivedAtISO) throw new Error("This document is archived. Restore it before you link it.");

  let categoryChange: { from: string; to: string } | null = null;
  if (args.updateCategory && !categoryFitsGoverningField(document.category, slot.field, society)) {
    // Re-filing is a document change: it needs document edit rights too.
    await requirePermissionPortable(ctx, args.societyId, "documents:write");
    const from = document.category ?? normalizeDocumentCategory(document.category);
    await ctx.db.patch(args.documentId, { category: slot.category });
    categoryChange = { from, to: slot.category };
    await ctx.db.insert("activity", {
      societyId: args.societyId, actor, entityType: "document", subjectId: args.documentId,
      // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
      entityId: args.documentId,
      action: "category-changed",
      summary: `Filed ${shortTitle(document.title)} as ${documentCategoryLabel(slot.category, governingDocumentAudience(society))}`,
      createdAtISO: new Date().toISOString(),
    });
  }
  if (previousDocumentId === args.documentId) {
    return { field: slot.field, documentId: args.documentId, previousDocumentId, changed: Boolean(categoryChange), categoryChange };
  }
  await ctx.db.patch(args.societyId, { [slot.field]: args.documentId, updatedAt: Date.now() });
  await log(
    previousDocumentId ? "governing-document-replaced" : "governing-document-linked",
    `${previousDocumentId ? "Replaced" : "Linked"} ${slot.phrase}: ${shortTitle(document.title)}`,
  );
  return { field: slot.field, documentId: args.documentId, previousDocumentId, changed: true, categoryChange };
}

function shortTitle(value: unknown) {
  const title = String(value ?? "").replace(/\s+/g, " ").trim() || "Untitled document";
  return title.length > TITLE_IN_SUMMARY_MAX ? `${title.slice(0, TITLE_IN_SUMMARY_MAX - 1)}…` : title;
}
