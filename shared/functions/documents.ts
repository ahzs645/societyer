import { buildPrivacyPolicyDraft, privacyPolicyDraftTitle, privacyPolicyDraftTags } from "../privacyPolicyTemplate";
/**
 * PORTABLE FUNCTIONS: the documents domain (list / get / getMany / create /
 * markOpened / updateReviewStatus / reviewQueues / PIPA + member-data-gap draft
 * generation / connector imports / flagForDeletion / archive / remove).
 *
 * Reads/writes the `documents`, `documentVersions`, `meetingMaterials`,
 * `activity`, `tasks`, `documentComments`, `signatures`, and `committeeMembers`
 * tables over `ctx.db`. Each handler runs unchanged on hosted Convex, the local
 * Dexie runtime, and the convex-test oracle.
 *
 * The document-access helpers below are pure (`ctx.db`-only for the actor
 * resolver) copies of convex/lib/access/documentAccess.ts and
 * convex/lib/access/materialAccess.ts, inlined so this file stays free of the
 * Convex-coupled access modules. Logic preserved exactly.
 */

import { assertValid, validateDocumentInput } from "../recordValidation";
import { documentCategoryLabel, governanceSlotForCategory, isInternalDocumentRecord, normalizeDocumentCategory } from "../documentCategories";
import { governingDocumentAudience, governingDocumentSlot, type GoverningDocumentField } from "../governingDocuments";
import { normalizeDocumentReviewStatus, storedDocumentReviewStatus } from "../documentReviewStatus";
import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import {
  getOwned,
  principalUserId,
  requireSocietyMembership,
} from "./access";
import { todayDateOnly } from "../dateOnly";
import { organizationRuleScope } from "../entityRuleScope";
import { documentPreparationReviewView, isAnnualPacketRecord } from "../preparationDocumentState";

// Documents are listed whatever their category (finding D-04): categories are
// an open, normalized model (shared/documentCategories.ts). Only Societyer's
// own bookkeeping rows (import sessions/candidates, org history scaffolding)
// are internal and kept out of document lists.

const DOCUMENT_QUEUE_LIMIT = 8;
const DOCUMENT_QUEUE_RELATED_SCAN_LIMIT = 250;
const DOCUMENT_QUEUE_RELATED_DOC_LIMIT = 64;

/* ---------------------- inlined access helpers (pure) ---------------------- */

type AccessSubjectContext = {
  userId?: string | null;
  userRole?: string | null;
  memberId?: string | null;
  directorId?: string | null;
  committeeIds?: string[];
  attendeeNames?: string[];
  groups?: string[];
};

const ACCESS_RANK: Record<string, number> = {
  view: 10,
  comment: 20,
  sign: 30,
  manage: 40,
};

function normalizeAccessGrants(grants: any[] | undefined) {
  if (!Array.isArray(grants)) return [];
  return grants
    .map((grant) => ({
      subjectType: String(grant.subjectType ?? "").trim(),
      subjectId: grant.subjectId ? String(grant.subjectId).trim() : undefined,
      subjectLabel: String(grant.subjectLabel ?? "").trim(),
      access: String(grant.access ?? "view").trim() || "view",
      note: grant.note ? String(grant.note).trim() : undefined,
    }))
    .filter((grant) => grant.subjectType && grant.subjectLabel);
}

function materialEffectiveStatus(material: any, nowMs = Date.now()): string {
  if (!material) return "available";
  if (material.availabilityStatus === "withdrawn") return "withdrawn";
  if (isMaterialExpired(material, nowMs)) return "expired";
  return material.availabilityStatus ?? "available";
}

function isMaterialExpired(material: any, nowMs = Date.now()) {
  if (!material?.expiresAtISO) return false;
  const expires = new Date(material.expiresAtISO).getTime();
  return Number.isFinite(expires) && expires < nowMs;
}

function canAccessMeetingMaterial(
  material: any,
  context: AccessSubjectContext,
  requiredAccess = "view",
) {
  if (!material || ["withdrawn", "expired", "pending"].includes(materialEffectiveStatus(material))) return false;
  if (roleCanBypass(context.userRole)) return true;
  if (hasExplicitGrant(material, context, requiredAccess)) return true;
  return (requiredAccess === "view" || roleAtLeast(context.userRole, "Director")) && broadAccessAllows(material.accessLevel, context);
}

function hasExplicitGrant(
  material: any,
  context: AccessSubjectContext,
  requiredAccess = "view",
) {
  const requiredRank = ACCESS_RANK[requiredAccess] ?? ACCESS_RANK.view;
  return normalizeAccessGrants(material?.accessGrants).some((grant) => {
    const grantRank = ACCESS_RANK[grant.access] ?? ACCESS_RANK.view;
    return grantRank >= requiredRank && grantMatchesContext(grant, context);
  });
}

function grantMatchesContext(grant: any, context: AccessSubjectContext) {
  const subjectId = grant.subjectId ? String(grant.subjectId) : "";
  const subjectLabel = normalizeMaterialLabel(grant.subjectLabel);
  if (grant.subjectType === "user") return !!subjectId && subjectId === String(context.userId ?? "");
  if (grant.subjectType === "member") return !!subjectId && subjectId === String(context.memberId ?? "");
  if (grant.subjectType === "director") return !!subjectId && subjectId === String(context.directorId ?? "");
  if (grant.subjectType === "committee") return !!subjectId && (context.committeeIds ?? []).map(String).includes(subjectId);
  if (grant.subjectType === "attendee") {
    return (context.attendeeNames ?? []).some((name) => normalizeMaterialLabel(name) === subjectLabel);
  }
  if (grant.subjectType === "group") {
    return (context.groups ?? []).some((name) => normalizeMaterialLabel(name) === subjectLabel);
  }
  return false;
}

function broadAccessAllows(accessLevel: string | undefined, context: AccessSubjectContext) {
  if (accessLevel === "public") return true;
  if (accessLevel === "members") return !!context.memberId || roleAtLeast(context.userRole, "Member");
  if (accessLevel === "committee") return (context.committeeIds ?? []).length > 0 || roleAtLeast(context.userRole, "Director");
  if (accessLevel === "board") return !!context.directorId || roleAtLeast(context.userRole, "Director");
  if (accessLevel === "restricted") return false;
  return roleAtLeast(context.userRole, "Director");
}

function roleCanBypass(role: string | null | undefined) {
  return role === "Owner" || role === "Admin";
}

function roleAtLeast(role: string | null | undefined, required: "Viewer" | "Member" | "Director" | "Admin" | "Owner") {
  const ranks: Record<string, number> = {
    Viewer: 20,
    Member: 40,
    Director: 60,
    Admin: 80,
    Owner: 100,
  };
  return (ranks[role ?? ""] ?? 0) >= ranks[required];
}

function normalizeMaterialLabel(value: string) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function canAccessDocument(
  document: any,
  linkedMaterials: any[],
  context: AccessSubjectContext,
  requiredAccess = "view",
) {
  if (!document) return false;
  if (context.userRole === "Owner" || context.userRole === "Admin") return true;
  if (document.archivedAtISO || document.flaggedForDeletion) return false;

  const materialLinks = linkedMaterials.filter(
    (material) => String(material.documentId) === String(document._id),
  );
  if (materialLinks.length > 0) {
    return materialLinks.some((material) =>
      canAccessMeetingMaterial(material, material.accessLevel === "committee"
        ? { ...context, committeeIds: document.committeeId ? (context.committeeIds ?? []).filter((id) => String(id) === String(document.committeeId)) : [] }
        : context, requiredAccess),
    );
  }

  if (requiredAccess !== "view") return roleAtLeast(context.userRole, "Director");
  if (document.tags?.includes("public") || document.librarySection === "public") return true;
  if (document.committeeId && (context.committeeIds ?? []).map(String).includes(String(document.committeeId))) return true;
  if (document.category === "Policy" || document.category === "Bylaws" || document.category === "Constitution") {
    return !!context.memberId || roleAtLeast(context.userRole, "Member");
  }
  return roleAtLeast(context.userRole, "Director");
}

function documentAccessContextFromUser(user: any, committeeIds: string[] = []): AccessSubjectContext {
  return {
    userId: user?._id ? String(user._id) : undefined,
    userRole: user?.role,
    memberId: user?.memberId ? String(user.memberId) : undefined,
    directorId: user?.directorId ? String(user.directorId) : undefined,
    committeeIds,
  };
}

async function documentAccessContextForActor(
  ctx: PortableQueryCtx | PortableMutationCtx,
  societyId: any,
  actingUserId?: any,
): Promise<AccessSubjectContext | null> {
  const user = await requireSocietyMembership(ctx, String(societyId));
  if (actingUserId && String(actingUserId) !== String(user._id)) throw new Error("Authenticated actor does not match the current principal.");

  const committeeRows = await ctx.db
    .query("committeeMembers")
    .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
    .collect();
  const committeeIds = committeeRows
    .filter((row: any) =>
      committeeAppointmentIsActive(row) && (
        (user.memberId && String(row.memberId ?? "") === String(user.memberId)) ||
        (user.directorId && String(row.directorId ?? "") === String(user.directorId))
      ),
    )
    .map((row: any) => String(row.committeeId));

  return documentAccessContextFromUser(user, Array.from(new Set(committeeIds)));
}

/** Labels/email are review hints, never authorization keys. */
export function committeeAppointmentIsActive(row: { joinedAt?: string; leftAt?: string }, now = Date.now()) {
  const joined = Date.parse(row.joinedAt ?? "");
  const left = row.leftAt ? Date.parse(row.leftAt) : Infinity;
  return Number.isFinite(joined) && joined <= now && left > now;
}

/** Resolve the authenticated actor once and apply the same ACL to every delivery path. */
export async function documentAccessPredicate(ctx: PortableQueryCtx, societyId: string) {
  const [context, materials] = await Promise.all([
    documentAccessContextForActor(ctx, societyId),
    ctx.db.query("meetingMaterials").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  return (document: any, access = "view") => !!context && String(document?.societyId) === societyId && canAccessDocument(document, materials, context, access);
}

export async function requireDocumentAccess(ctx: PortableQueryCtx, documentId: string, access = "view") {
  const document = await ctx.db.get(documentId, "documents");
  if (!document || typeof document.societyId !== "string") throw new Error("documents not found.");
  const allows = await documentAccessPredicate(ctx, document.societyId);
  if (!allows(document, access)) throw new Error("documents not found.");
  return document;
}

/** Apply document policy to rows that embed document previews, content or evidence. */
export async function filterDocumentLinkedRows(ctx: PortableQueryCtx, societyId: string, rows: any[], table = "") {
  const actor = await requireSocietyMembership(ctx, societyId);
  const allows = await documentAccessPredicate(ctx, societyId);
  const admin = actor.role === "Owner" || actor.role === "Admin";
  const generated = table === "legalPrecedentRuns"
    ? await ctx.db.query("generatedLegalDocuments").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect() : [];
  const results = await Promise.all(rows.map(async (row) => {
    if (row.societyId && String(row.societyId) !== societyId) return false;
    if (admin) return true;
    const relatedRows = [row];
    if (row.generatedDocumentId) {
      const parent = await ctx.db.get(String(row.generatedDocumentId), "generatedLegalDocuments");
      if (!parent || String(parent.societyId) !== societyId) return false;
      relatedRows.push(parent);
    }
    if (table === "legalPrecedentRuns") relatedRows.push(...generated.filter((item) => String(item.precedentRunId) === String(row._id)));
    const ids = new Set<string>();
    for (const related of relatedRows) {
      for (const field of ["documentId", "draftDocumentId", "sourceDocumentId", "docxDocumentId", "pdfDocumentId", "signedDocumentId"]) if (related[field]) ids.add(String(related[field]));
      for (const field of ["documentIds", "sourceDocumentIds"]) for (const id of related[field] ?? []) ids.add(String(id));
    }
    if (!ids.size) return roleAtLeast(actor.role, "Director");
    const documents = await Promise.all([...ids].map((id) => ctx.db.get(id, "documents")));
    return documents.every((document) => allows(document));
  }));
  return rows.filter((_, index) => results[index]);
}

export async function publicDocumentAccessPredicate(ctx: PortableQueryCtx, societyId: string) {
  const materials = await ctx.db.query("meetingMaterials").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  return (document: any) => String(document?.societyId) === societyId && canAccessDocument(document, materials, { userRole: "Viewer" });
}

/* ------------------------------- handlers --------------------------------- */

export async function listPortable(
  ctx: PortableQueryCtx,
  args: { societyId: string; actingUserId?: string },
) {
  return listVisibleDocuments(ctx, args, []);
}

/**
 * Fields `documents:listSummaries` leaves out. `content` holds the extracted
 * text of imported files (up to hundreds of KB per row); list screens and
 * pickers never show it, and on the local runtime it is never even loaded.
 * Open a single document with `documents:get` for its content.
 */
export const DOCUMENT_SUMMARY_OMITTED_FIELDS = ["content"] as const;

/** `documents:list` without the heavy `content` field — for tables and pickers. */
export async function listSummariesPortable(
  ctx: PortableQueryCtx,
  args: { societyId: string; actingUserId?: string },
) {
  return listVisibleDocuments(ctx, args, DOCUMENT_SUMMARY_OMITTED_FIELDS);
}

async function withPreparationReview(ctx: PortableQueryCtx, societyId: string, documents: any[]): Promise<any[]> {
  if (!documents.some(isAnnualPacketRecord)) return documents;
  const generated = await ctx.db.query("generatedLegalDocuments").withIndex("by_society", q => q.eq("societyId", societyId)).collect();
  return documents.map(document => documentPreparationReviewView(document, generated));
}

async function listVisibleDocuments(
  ctx: PortableQueryCtx,
  { societyId }: { societyId: string; actingUserId?: string },
  omitted: readonly string[],
) {
  const principalId = await principalUserId(ctx, societyId);
  const [docs, linkedMaterials, accessContext] = await Promise.all([
    // Internal import rows are excluded inside the query, so the local engine
    // never loads their (large) content; `omitted` projects heavy fields away.
    ctx.db
      .query("documents")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .filter((doc) => !isInternalDocumentRecord(doc))
      .omitFields(...omitted)
      .collect(),
    ctx.db
      .query("meetingMaterials")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
    documentAccessContextForActor(ctx, societyId, principalId),
  ]);
  const visible = docs
    .filter((doc) => !isInternalDocumentRecord(doc))
    .filter((doc) => accessContext && canAccessDocument(doc, linkedMaterials, accessContext))
    .sort((a, b) => String(b.createdAtISO ?? "").localeCompare(String(a.createdAtISO ?? "")));
  return withPreparationReview(ctx, societyId, visible);
}

export async function getPortable(
  ctx: PortableQueryCtx,
  { id, actingUserId }: { id: string; actingUserId?: string },
) {
  const candidate = await ctx.db.get(id, "documents");
  if (!candidate) return null;
  await requireSocietyMembership(ctx, String(candidate.societyId));
  const document = await getOwned(ctx, "documents", id, String(candidate.societyId));
  const principalId = await principalUserId(ctx, String(document.societyId));
  const [linkedMaterials, accessContext] = await Promise.all([
    ctx.db
      .query("meetingMaterials")
      .withIndex("by_society", (q) => q.eq("societyId", document.societyId))
      .collect(),
    documentAccessContextForActor(ctx, document.societyId, principalId),
  ]);
  return accessContext && canAccessDocument(document, linkedMaterials, accessContext) ? (await withPreparationReview(ctx, String(document.societyId), [document]))[0] : null;
}

export async function getManyPortable(
  ctx: PortableQueryCtx,
  { ids, actingUserId }: { ids: string[]; actingUserId?: string },
) {
  const documents: any[] = [];
  for (const id of ids) {
    const candidate = await ctx.db.get(id, "documents");
    if (!candidate) continue;
    await requireSocietyMembership(ctx, String(candidate.societyId));
    documents.push(await getOwned(ctx, "documents", id, String(candidate.societyId)));
  }
  if (!documents.length) return documents;

  const societyIds = Array.from(new Set(documents.map((doc: any) => String(doc.societyId))));
  const materialsBySociety = new Map<string, any[]>();
  const contextBySociety = new Map<string, any>();
  for (const societyId of societyIds) {
    const principalId = await principalUserId(ctx, societyId);
    const [materials, accessContext] = await Promise.all([
      ctx.db
        .query("meetingMaterials")
        .withIndex("by_society", (q) => q.eq("societyId", societyId as any))
        .collect(),
      documentAccessContextForActor(ctx, societyId as any, principalId),
    ]);
    materialsBySociety.set(societyId, materials);
    contextBySociety.set(societyId, accessContext);
  }
  const visible = documents.filter((document: any) => {
    const societyId = String(document.societyId);
    const accessContext = contextBySociety.get(societyId);
    return accessContext && canAccessDocument(document, materialsBySociety.get(societyId) ?? [], accessContext);
  });
  const reviewed = (await Promise.all(societyIds.map(societyId => withPreparationReview(ctx, societyId, visible.filter(document => String(document.societyId) === societyId))))).flat();
  const byId = new Map(reviewed.map(document => [String(document._id), document]));
  return visible.map(document => byId.get(String(document._id)));
}

export async function createPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    committeeId?: string;
    meetingId?: string;
    agendaItemId?: string;
    title: string;
    category: string;
    fileName?: string;
    mimeType?: string;
    content?: string;
    url?: string;
    retentionYears?: number;
    reviewStatus?: string;
    librarySection?: string;
    tags: string[];
  },
) {
  await requireSocietyMembership(ctx, args.societyId);
  if (args.committeeId) await getOwned(ctx, "committees", args.committeeId, args.societyId);
  if (args.meetingId) await getOwned(ctx, "meetings", args.meetingId, args.societyId);
  if (args.agendaItemId) await getOwned(ctx, "agendaItems", args.agendaItemId, args.societyId);
  assertValid(validateDocumentInput(args));
  const category = normalizeDocumentCategory(args.category);
  const documentId = await ctx.db.insert("documents", {
    ...args,
    category,
    ...(args.reviewStatus !== undefined ? { reviewStatus: storedDocumentReviewStatus(args.reviewStatus) } : {}),
    title: args.title.trim(),
    tags: uniqueStrings(args.tags),
    createdAtISO: new Date().toISOString(),
    flaggedForDeletion: false,
  });
  await fillEmptyGovernanceSlot(ctx, args.societyId, documentId, category);
  return documentId;
}

/**
 * The first governing document uploaded or re-filed under its category
 * (articles or the certificate they come with, a constitution, bylaws) goes on
 * file on the organization profile, so "Articles: Missing" and the setup and
 * dashboard document checks clear. A document already on file is never
 * replaced (people replace it from the profile); the BC Registry import keeps
 * its own replace option. Returns the field it filled, if any.
 */
async function fillEmptyGovernanceSlot(ctx: PortableMutationCtx, societyId: string, documentId: string, category: string): Promise<GoverningDocumentField | undefined> {
  const society = await ctx.db.get<any>(societyId, "societies");
  if (!society) return undefined;
  const slot = governanceSlotForCategory(category, governingDocumentAudience(society));
  if (!slot || society[slot]) return undefined;
  await ctx.db.patch(societyId, { [slot]: documentId, updatedAt: Date.now() });
  return slot;
}

/**
 * File a document under another category. Re-filing it as a governing
 * document fills that profile field when it is empty, as an upload does; a
 * linked document filed away from its category stays linked (the profile
 * notes the new category). `fillProfile: false` only re-files (Undo).
 */
export async function updateCategoryPortable(
  ctx: PortableMutationCtx,
  { id, category, fillProfile = true }: { id: string; category: string; fillProfile?: boolean },
) {
  const candidate = await ctx.db.get(id, "documents");
  if (!candidate) throw new Error("documents not found.");
  const societyId = String(candidate.societyId);
  const user = await requireSocietyMembership(ctx, societyId);
  const document = await getOwned(ctx, "documents", id, societyId);
  const allows = await documentAccessPredicate(ctx, societyId);
  if (isInternalDocumentRecord(document) || !allows(document)) throw new Error("documents not found.");
  if (!String(category ?? "").trim()) throw new Error("Choose a category.");
  const next = normalizeDocumentCategory(category);
  const previous = normalizeDocumentCategory(document.category);
  if (next === document.category) return { previousCategory: previous, category: next, changed: false, filledField: null };
  await ctx.db.patch(id, { category: next });
  const society = await ctx.db.get<any>(societyId, "societies");
  const label = documentCategoryLabel(next, governingDocumentAudience(society));
  await ctx.db.insert("activity", {
    societyId,
    actor: user.displayName ?? "You",
    entityType: "document",
    subjectId: id,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
    entityId: id,
    action: "category-changed",
    summary: `Filed ${document.title} as ${label}`,
    createdAtISO: new Date().toISOString(),
  });
  const filledField = fillProfile ? await fillEmptyGovernanceSlot(ctx, societyId, id, next) ?? null : null;
  return {
    previousCategory: document.category ?? previous,
    category: next,
    changed: true,
    filledField,
    filledLabel: filledField ? governingDocumentSlot(society, filledField)?.label ?? null : null,
  };
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export async function markOpenedPortable(
  ctx: PortableMutationCtx,
  { id, userId, actorName }: { id: string; userId?: string; actorName?: string },
) {
  const candidate = await ctx.db.get(id, "documents");
  if (!candidate) throw new Error("documents not found.");
  const user = await requireSocietyMembership(ctx, String(candidate.societyId));
  const document = await getOwned(ctx, "documents", id, String(candidate.societyId));
  const nowISO = new Date().toISOString();
  const patch: any = { lastOpenedAtISO: nowISO, lastOpenedByUserId: user._id };
  if (userId) await getOwned(ctx, "users", userId, String(document.societyId));
  await ctx.db.patch(id, patch);
  await ctx.db.insert("activity", {
    societyId: document.societyId,
    actor: user.displayName ?? "You",
    entityType: "document",
    subjectId: id,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
    entityId: id,
    action: "opened",
    summary: `Opened ${document.title}`,
    createdAtISO: nowISO,
  });
  return { openedAtISO: nowISO };
}

export async function updateReviewStatusPortable(
  ctx: PortableMutationCtx,
  { id, reviewStatus, actorName }: { id: string; reviewStatus?: string; actorName?: string },
) {
  const candidate = await ctx.db.get(id, "documents");
  if (!candidate) throw new Error("documents not found.");
  const user = await requireSocietyMembership(ctx, String(candidate.societyId));
  const document = await getOwned(ctx, "documents", id, String(candidate.societyId));
  const projected = (await withPreparationReview(ctx, String(document.societyId), [document]))[0];
  const requested = storedDocumentReviewStatus(reviewStatus);
  const stored = projected.preparationReviewWarning ? "needs_review" : requested;
  reviewStatus = stored;
  await ctx.db.patch(id, { reviewStatus: stored });
  await ctx.db.insert("activity", {
    societyId: document.societyId,
    actor: user.displayName ?? "You",
    entityType: "document",
    subjectId: id,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
    entityId: id,
    action: "review-status",
    summary: `Marked ${document.title} ${reviewStatus ? reviewStatus.replace(/_/g, " ") : "not reviewed"}`,
    createdAtISO: new Date().toISOString(),
  });
}

export async function reviewQueuesPortable(
  ctx: PortableQueryCtx,
  { societyId, actingUserId }: { societyId: string; actingUserId?: string },
) {
  const principalId = await principalUserId(ctx, societyId);
  const [documentGroups, recentlyOpened, tasks, comments, signatures, materials, accessContext] = await Promise.all([
    ctx.db
      .query("documents")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .filter((doc) => !isInternalDocumentRecord(doc))
      .omitFields(...DOCUMENT_SUMMARY_OMITTED_FIELDS)
      .collect()
      .then((rows) => [rows]),
    ctx.db
      .query("documents")
      .withIndex("by_last_opened", (q) => q.eq("societyId", societyId))
      .order("desc")
      .omitFields(...DOCUMENT_SUMMARY_OMITTED_FIELDS)
      .take(DOCUMENT_QUEUE_LIMIT),
    ctx.db
      .query("tasks")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .take(DOCUMENT_QUEUE_RELATED_SCAN_LIMIT),
    ctx.db
      .query("documentComments")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .take(DOCUMENT_QUEUE_RELATED_SCAN_LIMIT),
    ctx.db
      .query("signatures")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .take(DOCUMENT_QUEUE_RELATED_SCAN_LIMIT),
    ctx.db
      .query("meetingMaterials")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .take(DOCUMENT_QUEUE_RELATED_SCAN_LIMIT),
    documentAccessContextForActor(ctx, societyId, principalId),
  ]);

  const documentsById = new Map<string, any>();
  for (const doc of [...documentGroups.flat(), ...recentlyOpened]) {
    if (
      !isInternalDocumentRecord(doc) &&
      (!accessContext || canAccessDocument(doc, materials, accessContext))
    ) {
      documentsById.set(String(doc._id), doc);
    }
  }
  const taskCounts = countByDocument(tasks.filter((task) => task.status !== "Done"));
  const openCommentCounts = countByDocument(comments.filter((comment) => comment.status !== "resolved"));
  const signatureCounts = new Map<string, number>();
  for (const signature of signatures) {
    if (signature.entityType !== "document") continue;
    const subjectId = signature.subjectId ?? signature.entityId;
    if (!subjectId) continue;
    signatureCounts.set(subjectId, (signatureCounts.get(subjectId) ?? 0) + 1);
  }
  const materialDocIds = new Set(materials.map((row) => String(row.documentId)));

  const relatedDocIds = topDocumentIds([taskCounts, openCommentCounts, signatureCounts], materialDocIds)
    .filter((id) => !documentsById.has(id))
    .slice(0, DOCUMENT_QUEUE_RELATED_DOC_LIMIT);
  const relatedDocuments = await Promise.all(
    relatedDocIds.map((id) => getOwned(ctx, "documents", id, societyId)),
  );
  for (const doc of relatedDocuments) {
    if (
      doc &&
      !isInternalDocumentRecord(doc) &&
      (!accessContext || canAccessDocument(doc, materials, accessContext))
    ) {
      documentsById.set(String(doc._id), doc);
    }
  }

  const docs = await withPreparationReview(ctx, societyId, [...documentsById.values()]);
  const annotate = (doc: any) => ({
    _id: doc._id,
    title: doc.title,
    category: doc.category,
    createdAtISO: doc.createdAtISO,
    lastOpenedAtISO: doc.lastOpenedAtISO,
    reviewStatus: normalizeDocumentReviewStatus(doc.reviewStatus),
    preparationReviewWarning: doc.preparationReviewWarning,
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    meetingId: doc.meetingId,
    openTaskCount: taskCounts.get(String(doc._id)) ?? 0,
    openCommentCount: openCommentCounts.get(String(doc._id)) ?? 0,
    signatureCount: signatureCounts.get(String(doc._id)) ?? 0,
    linkedToMeetingPackage: materialDocIds.has(String(doc._id)) || !!doc.meetingId,
  });

  const annotated = docs.map(annotate);
  // Opened documents first (most recent first), then the newest additions.
  const recent = [
    ...annotated.filter((doc) => doc.lastOpenedAtISO).sort((a, b) => String(b.lastOpenedAtISO).localeCompare(String(a.lastOpenedAtISO))),
    ...annotated.filter((doc) => !doc.lastOpenedAtISO && doc.createdAtISO).sort((a, b) => String(b.createdAtISO).localeCompare(String(a.createdAtISO)) || String(a._id).localeCompare(String(b._id))),
  ].slice(0, DOCUMENT_QUEUE_LIMIT);
  const recentIds = new Set(recent.map((doc) => String(doc._id)));
  const actionRequired = annotated
    .filter((doc) =>
      doc.reviewStatus === "needs_signature" ||
      doc.reviewStatus === "blocked" ||
      doc.openTaskCount > 0 ||
      doc.openCommentCount > 0 ||
      (doc.tags ?? []).includes("needs-signature") ||
      (doc.tags ?? []).includes("action-required"),
    )
    .sort((a, b) => Number(b.openTaskCount + b.openCommentCount) - Number(a.openTaskCount + a.openCommentCount))
    .slice(0, DOCUMENT_QUEUE_LIMIT);
  // In-progress work not already shown under "Recent", so the two cards differ
  // even when every imported document is awaiting review.
  const inProgress = annotated.filter((doc) =>
    doc.reviewStatus === "in_review" ||
    doc.reviewStatus === "needs_review" ||
    doc.reviewStatus === "needs_signature" ||
    doc.linkedToMeetingPackage ||
    doc.openCommentCount > 0,
  );
  const actionIds = new Set(actionRequired.map((doc) => String(doc._id)));
  const workInProgress = inProgress
    .filter((doc) => !recentIds.has(String(doc._id)) && !actionIds.has(String(doc._id)))
    .sort((a, b) =>
      Number(b.openCommentCount + b.openTaskCount) - Number(a.openCommentCount + a.openTaskCount) ||
      Number(b.linkedToMeetingPackage) - Number(a.linkedToMeetingPackage) ||
      String(b.createdAtISO).localeCompare(String(a.createdAtISO)) ||
      String(a._id).localeCompare(String(b._id)))
    .slice(0, DOCUMENT_QUEUE_LIMIT);

  return {
    recent,
    actionRequired,
    workInProgress,
    counts: {
      documents: annotated.length,
      recent: recent.length,
      actionRequired: actionRequired.length,
      workInProgress: workInProgress.length,
      inProgressTotal: inProgress.length,
    },
  };
}

export async function createPipaPolicyDraftPortable(
  ctx: PortableMutationCtx,
  { societyId }: { societyId: string },
) {
  await requireSocietyMembership(ctx, societyId);
  const society = await ctx.db.get(societyId, "societies");
  if (!society) throw new Error("Society not found.");

  const existing = await findExistingPrivacyDraft(ctx, societyId, "privacy-policy");
  if (existing) {
    const refreshed = await refreshGenericPipaPolicyDraft(ctx, existing, society);
    return { document: refreshed ?? existing, reused: true, refreshed: !!refreshed };
  }

  const nowISO = new Date().toISOString();
  const documentId = await ctx.db.insert("documents", {
    societyId,
    title: privacyPolicyDraftTitle(society),
    category: "Policy",
    fileName: "privacy-policy-draft.md",
    mimeType: "text/markdown",
    content: buildPrivacyPolicyDraft(society),
    retentionYears: 10,
    createdAtISO: nowISO,
    flaggedForDeletion: false,
    tags: privacyPolicyDraftTags(society),
  });

  await ctx.db.insert("activity", {
    societyId,
    actor: "Societyer",
    entityType: "document",
    subjectId: documentId,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
    entityId: documentId,
    action: "document-created",
    summary: "Created a privacy policy draft using the recorded activity and jurisdiction assessment.",
    createdAtISO: nowISO,
  });

  const document = await getOwned(ctx, "documents", documentId, societyId);
  return { document, reused: false };
}

export async function rebuildPipaPolicyDraftFromSocietyPortable(
  ctx: PortableMutationCtx,
  { id }: { id: string },
) {
  const candidate = await ctx.db.get(id, "documents");
  if (!candidate) throw new Error("documents not found.");
  await requireSocietyMembership(ctx, String(candidate.societyId));
  const document = await getOwned(ctx, "documents", id, String(candidate.societyId));
  const society = await ctx.db.get(String(document.societyId), "societies");
  if (!society) throw new Error("Society not found.");

  const title = privacyPolicyDraftTitle(society);
  await ctx.db.patch(id, {
    title,
    content: buildPrivacyPolicyDraft(society),
    tags: withTags(document.tags, [...privacyPolicyDraftTags(society), "society-filled"]),
  });
  await ctx.db.insert("activity", {
    societyId: document.societyId,
    actor: "Societyer",
    entityType: "document",
    subjectId: id,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
    entityId: id,
    action: "document-updated",
    summary: `Rebuilt ${title} from the current society details.`,
    createdAtISO: new Date().toISOString(),
  });
  return await getOwned(ctx, "documents", id, String(document.societyId));
}

export async function createMemberDataGapMemoDraftPortable(
  ctx: PortableMutationCtx,
  { societyId }: { societyId: string },
) {
  await requireSocietyMembership(ctx, societyId);
  const society = await ctx.db.get(societyId, "societies");
  if (!society) throw new Error("Society not found.");

  const existing = await findExistingPrivacyDraft(ctx, societyId, "member-data-gap");
  if (existing) return { document: existing, reused: true };

  const nowISO = new Date().toISOString();
  const documentId = await ctx.db.insert("documents", {
    societyId,
    title: `Draft member-data access gap memo - ${society.name}`,
    category: "Policy",
    fileName: "member-data-access-gap-memo-draft.md",
    mimeType: "text/markdown",
    content: buildMemberDataGapMemoDraft(society),
    retentionYears: 10,
    createdAtISO: nowISO,
    flaggedForDeletion: false,
    tags: ["privacy", "member-data-gap", "pipa", "draft", "societyer-template"],
  });

  await ctx.db.insert("activity", {
    societyId,
    actor: "Societyer",
    entityType: "document",
    subjectId: documentId,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
    entityId: documentId,
    action: "document-created",
    summary: "Created a draft member-data access gap memo from the Societyer starter template.",
    createdAtISO: nowISO,
  });

  const document = await getOwned(ctx, "documents", documentId, societyId);
  return { document, reused: false };
}

export async function updateDraftContentPortable(
  ctx: PortableMutationCtx,
  args: { id: string; title: string; content: string; tags?: string[] },
) {
  const candidate = await ctx.db.get(args.id, "documents");
  if (!candidate) throw new Error("documents not found.");
  await requireSocietyMembership(ctx, String(candidate.societyId));
  const document = await getOwned(ctx, "documents", args.id, String(candidate.societyId));
  const tags = args.tags ? Array.from(new Set(args.tags)) : document.tags;
  await ctx.db.patch(args.id, {
    title: args.title.trim() || document.title,
    content: args.content,
    tags,
  });
  await ctx.db.insert("activity", {
    societyId: document.societyId,
    actor: "Societyer",
    entityType: "document",
    subjectId: args.id,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
    entityId: args.id,
    action: "document-updated",
    summary: `Updated ${args.title.trim() || document.title}.`,
    createdAtISO: new Date().toISOString(),
  });
  return await getOwned(ctx, "documents", args.id, String(document.societyId));
}

export async function linkPrivacyPolicyEvidencePortable(
  ctx: PortableMutationCtx,
  { societyId, documentId }: { societyId: string; documentId: string },
) {
  await requireSocietyMembership(ctx, societyId);
  const [society, document] = await Promise.all([
    ctx.db.get(societyId, "societies"),
    getOwned(ctx, "documents", documentId, societyId),
  ]);
  if (!society) throw new Error("Society not found.");
  if (!document || document.societyId !== societyId) {
    throw new Error("Document not found for this society.");
  }
  await ctx.db.patch(societyId, {
    privacyPolicyDocId: documentId,
    updatedAt: Date.now(),
  });
  await ctx.db.insert("activity", {
    societyId,
    actor: "Societyer",
    entityType: "society",
    subjectId: societyId,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
    entityId: societyId,
    action: "privacy-policy-linked",
    summary: `Linked ${document.title} as PIPA policy evidence.`,
    createdAtISO: new Date().toISOString(),
  });
  return { documentId };
}

export async function createGovernanceDocumentFromLocalFilePortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    documentKind: "constitution" | "bylaws" | "constitutionAndBylaws" | "privacyPolicy";
    title: string;
    category?: string;
    fileName: string;
    mimeType?: string;
    fileSizeBytes?: number;
    storageKey: string;
    sha256?: string;
    tags: string[];
    sourceUrl?: string;
    changeNote?: string;
    actingUserId?: string;
    replaceExisting?: boolean;
  },
) {
  const uploader = await requireSocietyMembership(ctx, args.societyId);
  const society = await ctx.db.get(args.societyId, "societies");
  if (!society) throw new Error("Society not found.");

  const nowISO = new Date().toISOString();
  const uploadedByUserId = await principalUserId(ctx, args.societyId);
  if (args.actingUserId && args.actingUserId !== uploadedByUserId) {
    throw new Error("Authenticated actor does not match the current principal.");
  }
  const category =
    args.category ??
    (args.documentKind === "privacyPolicy"
      ? "Policy"
      : args.documentKind === "constitution"
        ? "Constitution"
        : "Bylaws");
  const tags = Array.from(new Set(args.tags));

  const documentId = await ctx.db.insert("documents", {
    societyId: args.societyId,
    title: args.title,
    category,
    fileName: args.fileName,
    mimeType: args.mimeType,
    fileSizeBytes: args.fileSizeBytes,
    url: args.sourceUrl,
    createdAtISO: nowISO,
    flaggedForDeletion: false,
    tags,
  });

  const versionId = await ctx.db.insert("documentVersions", {
    societyId: args.societyId,
    documentId,
    version: 1,
    storageProvider: "local",
    storageKey: args.storageKey,
    fileName: args.fileName,
    mimeType: args.mimeType,
    fileSizeBytes: args.fileSizeBytes,
    sha256: args.sha256,
    uploadedByUserId,
    uploadedByName: uploader?.displayName ?? "BC Registry connector",
    uploadedAtISO: nowISO,
    changeNote: args.changeNote ?? "Imported from BC Registry filing history.",
    isCurrent: true,
  });

  const patch: any = { updatedAt: Date.now() };
  if (
    (args.documentKind === "constitution" || args.documentKind === "constitutionAndBylaws") &&
    (args.replaceExisting || !society.constitutionDocId)
  ) {
    patch.constitutionDocId = documentId;
  }
  if (
    (args.documentKind === "bylaws" || args.documentKind === "constitutionAndBylaws") &&
    (args.replaceExisting || !society.bylawsDocId)
  ) {
    patch.bylawsDocId = documentId;
  }
  if (
    args.documentKind === "privacyPolicy" &&
    (args.replaceExisting || !society.privacyPolicyDocId)
  ) {
    patch.privacyPolicyDocId = documentId;
  }
  if (Object.keys(patch).length > 1) {
    await ctx.db.patch(args.societyId, patch);
  }

  await ctx.db.insert("activity", {
    societyId: args.societyId,
    actor: uploader?.displayName ?? "BC Registry connector",
    entityType: "document",
    subjectId: documentId,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
    entityId: documentId,
    action: "document-imported",
    summary: `Imported ${args.title} from BC Registry.`,
    createdAtISO: nowISO,
  });

  return {
    documentId,
    versionId,
    linked: {
      constitution: patch.constitutionDocId === documentId,
      bylaws: patch.bylawsDocId === documentId,
      privacyPolicy: patch.privacyPolicyDocId === documentId,
    },
  };
}

export async function createLocalDocumentFromConnectorPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    title: string;
    category: string;
    fileName: string;
    mimeType?: string;
    fileSizeBytes?: number;
    storageKey: string;
    sha256?: string;
    tags: string[];
    sourceUrl?: string;
    sourceExternalIds?: string[];
    sourcePayloadJson?: string;
    changeNote?: string;
    actingUserId?: string;
    skipDuplicateCheck?: boolean;
  },
) {
  const uploader = await requireSocietyMembership(ctx, args.societyId);
  const sourceIds = args.sourceExternalIds ?? [];
  if (!args.skipDuplicateCheck) {
    const existing = await ctx.db
      .query("documents")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .collect();
    const duplicate = existing.find((document) => {
      if (document.fileName && document.fileName === args.fileName) return true;
      const existingSourceIds = document.sourceExternalIds ?? [];
      return sourceIds.some((sourceId) => existingSourceIds.includes(sourceId));
    });
    if (duplicate) {
      return { documentId: duplicate._id, versionId: null, reused: true };
    }
  }

  const nowISO = new Date().toISOString();
  const uploadedByUserId = await principalUserId(ctx, args.societyId);
  if (args.actingUserId && args.actingUserId !== uploadedByUserId) {
    throw new Error("Authenticated actor does not match the current principal.");
  }
  const tags = Array.from(new Set(args.tags));
  const documentId = await ctx.db.insert("documents", {
    societyId: args.societyId,
    title: args.title,
    category: args.category,
    fileName: args.fileName,
    mimeType: args.mimeType,
    fileSizeBytes: args.fileSizeBytes,
    url: args.sourceUrl,
    sourceExternalIds: sourceIds.length ? sourceIds : undefined,
    sourcePayloadJson: args.sourcePayloadJson,
    createdAtISO: nowISO,
    flaggedForDeletion: false,
    tags,
  });

  const versionId = await ctx.db.insert("documentVersions", {
    societyId: args.societyId,
    documentId,
    version: 1,
    storageProvider: "local",
    storageKey: args.storageKey,
    fileName: args.fileName,
    mimeType: args.mimeType,
    fileSizeBytes: args.fileSizeBytes,
    sha256: args.sha256,
    uploadedByUserId,
    uploadedByName: uploader?.displayName ?? "Browser connector",
    uploadedAtISO: nowISO,
    changeNote: args.changeNote ?? "Imported from browser connector export.",
    isCurrent: true,
  });

  await ctx.db.insert("activity", {
    societyId: args.societyId,
    actor: uploader?.displayName ?? "Browser connector",
    entityType: "document",
    subjectId: documentId,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
    entityId: documentId,
    action: "document-imported",
    summary: `Imported ${args.title} from browser connector export.`,
    createdAtISO: nowISO,
  });

  return { documentId, versionId, reused: false };
}

export async function mergeConnectorDocumentMetadataPortable(
  ctx: PortableMutationCtx,
  args: {
    documentId: string;
    title?: string;
    category?: string;
    fileName?: string;
    mimeType?: string;
    fileSizeBytes?: number;
    sha256?: string;
    tags?: string[];
    sourceUrl?: string;
    sourceExternalIds?: string[];
    sourcePayloadJson?: string;
    changeNote?: string;
  },
) {
  const candidate = await ctx.db.get(args.documentId, "documents");
  if (!candidate) throw new Error("documents not found.");
  await requireSocietyMembership(ctx, String(candidate.societyId));
  const document = await getOwned(
    ctx,
    "documents",
    args.documentId,
    String(candidate.societyId),
  );
  const existingTags = document.tags ?? [];
  const existingSourceIds = document.sourceExternalIds ?? [];
  await ctx.db.patch(args.documentId, {
    title: args.title ?? document.title,
    category: args.category ?? document.category,
    fileName: args.fileName ?? document.fileName,
    mimeType: args.mimeType ?? document.mimeType,
    fileSizeBytes: args.fileSizeBytes ?? document.fileSizeBytes,
    url: args.sourceUrl ?? document.url,
    sourceExternalIds: args.sourceExternalIds?.length
      ? Array.from(new Set([...existingSourceIds, ...args.sourceExternalIds]))
      : document.sourceExternalIds,
    sourcePayloadJson: args.sourcePayloadJson ?? document.sourcePayloadJson,
    tags: args.tags?.length ? Array.from(new Set([...existingTags, ...args.tags])) : existingTags,
  });

  const versions = await ctx.db
    .query("documentVersions")
    .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
    .collect();
  const currentVersion = versions.find((version) => version.isCurrent) ?? versions[0];
  if (currentVersion) {
    await getOwned(
      ctx,
      "documentVersions",
      currentVersion._id,
      String(document.societyId),
    );
    await ctx.db.patch(currentVersion._id, {
      fileName: args.fileName ?? currentVersion.fileName,
      mimeType: args.mimeType ?? currentVersion.mimeType,
      fileSizeBytes: args.fileSizeBytes ?? currentVersion.fileSizeBytes,
      sha256: args.sha256 ?? currentVersion.sha256,
      changeNote: args.changeNote ?? currentVersion.changeNote,
    });
  }
  // Re-filed under a governing category: fill the empty profile field.
  if (args.category !== undefined && normalizeDocumentCategory(args.category) !== normalizeDocumentCategory(document.category)) {
    await fillEmptyGovernanceSlot(ctx, String(document.societyId), args.documentId, args.category);
  }

  return { documentId: args.documentId, versionId: currentVersion?._id ?? null, reused: true };
}

export async function flagForDeletionPortable(
  ctx: PortableMutationCtx,
  { id, flagged }: { id: string; flagged: boolean },
) {
  const candidate = await ctx.db.get(id, "documents");
  if (!candidate) return;
  await requireSocietyMembership(ctx, String(candidate.societyId));
  await getOwned(ctx, "documents", id, String(candidate.societyId));
  await ctx.db.patch(id, { flaggedForDeletion: flagged });
}

export async function archivePortable(
  ctx: PortableMutationCtx,
  { id, reason }: { id: string; reason: string },
) {
  const candidate = await ctx.db.get(id, "documents");
  if (!candidate) return;
  await requireSocietyMembership(ctx, String(candidate.societyId));
  await getOwned(ctx, "documents", id, String(candidate.societyId));
  await ctx.db.patch(id, {
    archivedAtISO: new Date().toISOString(),
    archivedReason: reason,
    flaggedForDeletion: false,
  });
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const candidate = await ctx.db.get(id, "documents");
  if (!candidate) return;
  await requireSocietyMembership(ctx, String(candidate.societyId));
  await getOwned(ctx, "documents", id, String(candidate.societyId));
  await ctx.db.delete(id);
}

/* ------------------------------ pure helpers ------------------------------ */

async function findExistingPrivacyDraft(ctx: PortableMutationCtx, societyId: string, tag: string) {
  const docs = await ctx.db
    .query("documents")
    .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
    .collect();
  return docs.find((doc: any) => {
    if (doc.archivedAtISO || doc.flaggedForDeletion) return false;
    const tags = Array.isArray(doc.tags) ? doc.tags : [];
    if (tags.includes(tag) && tags.includes("draft")) return true;
    const title = String(doc.title ?? "").toLowerCase();
    const normalizedTitle = title.replace(/[-_]+/g, " ");
    if (tag === "privacy-policy") return title.includes("draft") && title.includes("privacy policy");
    return normalizedTitle.includes("draft") && normalizedTitle.includes("member data") && normalizedTitle.includes("gap");
  }) ?? null;
}

async function refreshGenericPipaPolicyDraft(ctx: PortableMutationCtx, document: any, society: any) {
  if (!isGenericPipaPolicyTemplate(document)) return null;
  const title = privacyPolicyDraftTitle(society);
  await ctx.db.patch(document._id, {
    title,
    content: buildPrivacyPolicyDraft(society),
    tags: withTags(document.tags, [...privacyPolicyDraftTags(society), "society-filled"]),
  });
  await ctx.db.insert("activity", {
    societyId: document.societyId,
    actor: "Societyer",
    entityType: "document",
    subjectId: document._id,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
    entityId: document._id,
    action: "document-updated",
    summary: `Filled ${title} with current society details.`,
    createdAtISO: new Date().toISOString(),
  });
  return await getOwned(ctx, "documents", document._id, String(document.societyId));
}

function isGenericPipaPolicyTemplate(document: any) {
  const title = String(document.title ?? "").toLowerCase();
  const content = String(document.content ?? "");
  const hasGenericName = content.includes("[Legal organization name]") || content.includes("[legal name]");
  if (!hasGenericName) return false;
  return (
    title.includes("draft pipa privacy policy template") ||
    content.includes("This template is not legal advice") ||
    content.includes("PIPA Privacy Policy Template")
  );
}

function withTags(existing: unknown, additions: string[]) {
  const tags = Array.isArray(existing) ? existing.map(String) : [];
  return Array.from(new Set([...tags, ...additions]));
}

function countByDocument(rows: Array<Record<string, any>>) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.documentId) continue;
    const key = String(row.documentId);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function topDocumentIds(countMaps: Map<string, number>[], materialDocIds: Set<string>) {
  const scores = new Map<string, number>();
  for (const counts of countMaps) {
    for (const [id, count] of counts) {
      scores.set(id, (scores.get(id) ?? 0) + count);
    }
  }
  for (const id of materialDocIds) {
    scores.set(id, (scores.get(id) ?? 0) + 1);
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
}


function buildMemberDataGapMemoDraft(society: any) {
  const today = todayDateOnly();
  const legalName = valueOrPlaceholder(society.name, "Legal organization name");
  const currentStatus = valueOrPlaceholder(society.memberDataAccessStatus, "Institution-held / Partially available / Society-controlled / Unknown");
  return `# ${legalName} Member-Data Access Gap Memo

Draft created: ${today}

Status: Draft - complete this memo before marking the member-data access gap documented.

## 1. Purpose

This memo records whether ${legalName} controls its member list or whether a university, parent body, collection agent, or other institution holds some or all member or eligibility information.

Current Societyer member-data access status: ${currentStatus}.

## 2. Institution or External Holder

- Institution or external holder: [name]
- Contact person or office: [name / office]
- Contact email: [email]
- Relevant agreement, policy, funding rule, or correspondence: [reference]

## 3. What the Society Controls

List the personal information the society actually has, can access, or can direct.

- [example: director/officer contacts]
- [example: volunteer records]
- [example: newsletter consent records]
- [example: event registration records]
- [example: partial member eligibility list]

## 4. What the Institution Holds

List the personal information the institution or external holder keeps and does not share with the society.

- [example: full student membership or levy payer list]
- [example: student number or enrolment status]
- [example: fee assessment or collection records]

## 5. Access Limits

Describe what the society has requested, what was provided, what was refused or unavailable, and why.

- Request made on: [date]
- Response received on: [date]
- Summary of response: [summary]
- Evidence stored at: [document link / email / meeting minutes]

## 6. Privacy Handling

For information the society controls, describe safeguards, access limits, retention, disposal, and request handling.

For institution-held information, describe how individuals are redirected to the institution or how the society handles requests it cannot fulfill directly.

## 7. Societies Act Member-Register Handling

Record the society's working approach to member-register obligations and inspection requests.

- Does the society maintain its own member register? [yes/no/partial]
- If partial, what fields are kept? [fields]
- How will member inspection requests be handled? [process]
- Who reviews uncertain requests? [role]

## 8. Follow-Up Actions

- [ ] Confirm the external holder's current position in writing.
- [ ] Store correspondence or agreement evidence in Documents.
- [ ] Update Societyer member-data access status.
- [ ] Review this memo annually or when the institution's data-sharing process changes.

Prepared by: [name / role]

Reviewed by: [board / executive / privacy officer]

Review date: ${today}
`;
}

function valueOrPlaceholder(value: unknown, placeholder: string) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || `[${placeholder}]`;
}
