/**
 * PORTABLE FUNCTIONS: the document catalog (findings D-04, D-12–D-16, D-21, A8).
 *
 *  - `documents:browse` — the Documents list. Every non-internal document the
 *    actor may open, whatever its category, as a light projection: no
 *    `content`/`sourcePayloadJson`, with provenance (source system, source
 *    date, SHA-256), review status, latest saved version, linked-record counts
 *    and duplicate/version markers computed once for the whole list (no
 *    per-row queries).
 *  - `documents:versionsFor` — the versions/duplicates panel for one document.
 *  - `documents:markDuplicate` / `clearDuplicate` / `mergeDuplicates` /
 *    `setVersionInfo` — a person's decisions about duplicates and versions.
 *
 * Runs unchanged on hosted Convex, the local runtime and the test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireSocietyMembership } from "./access";
import { documentAccessPredicate, requireDocumentAccess } from "./documents";
import {
  documentCategoryGroupKey,
  documentCategoryLabel,
  isInternalDocumentRecord,
  normalizeDocumentCategory,
} from "../documentCategories";
import { documentProvenanceCached, sourceSystemLabel } from "../documentProvenance";
import { normalizeDocumentReviewStatus } from "../documentReviewStatus";
import {
  buildDocumentGroups,
  compareVersions,
  normalizeSourceVersionStatus,
  type DocumentGroupInfo,
  type VersionableDocument,
} from "../documentVersioning";

type Row = Record<string, any>;

async function visibleSocietyDocuments(ctx: PortableQueryCtx, societyId: string) {
  const [allows, docs] = await Promise.all([
    documentAccessPredicate(ctx, societyId),
    ctx.db.query("documents").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  return docs.filter((doc: Row) => !isInternalDocumentRecord(doc) && allows(doc));
}

function latestVersionsByDocument(versions: Row[], societyId: string) {
  const latest = new Map<string, Row>();
  const counts = new Map<string, number>();
  for (const version of versions) {
    if (String(version.societyId) !== societyId) continue;
    const key = String(version.documentId);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const current = latest.get(key);
    if (!current || Number(version.isCurrent) - Number(current.isCurrent) > 0 || (Number(version.isCurrent) === Number(current.isCurrent) && Number(version.version) > Number(current.version))) {
      latest.set(key, version);
    }
  }
  return { latest, counts };
}

function versionable(doc: Row, latestVersion?: Row): VersionableDocument {
  const provenance = documentProvenanceCached(doc);
  return {
    _id: String(doc._id),
    title: doc.title,
    fileName: doc.fileName ?? latestVersion?.fileName,
    createdAtISO: doc.createdAtISO,
    archivedAtISO: doc.archivedAtISO,
    sha256: provenance.sha256 ?? latestVersion?.sha256,
    externalIds: provenance.externalIds,
    versionGroupKey: doc.versionGroupKey,
    duplicateOfDocumentId: doc.duplicateOfDocumentId ? String(doc.duplicateOfDocumentId) : undefined,
    supersedesDocumentId: doc.supersedesDocumentId ? String(doc.supersedesDocumentId) : undefined,
    sourceVersionStatus: doc.sourceVersionStatus,
    sourceDate: provenance.sourceDate,
  };
}

function projectRow(doc: Row, extras: {
  group?: DocumentGroupInfo;
  latestVersion?: Row;
  versionFileCount?: number;
  evidence?: { total: number; linked: number; targets: Set<string> };
  materials?: number;
}) {
  const provenance = documentProvenanceCached(doc);
  const linkedRecordCount = (extras.evidence?.linked ?? 0) + (extras.materials ?? 0) + (doc.meetingId ? 1 : 0) + (doc.committeeId ? 1 : 0);
  return {
    _id: doc._id,
    _creationTime: doc._creationTime,
    societyId: doc.societyId,
    title: doc.title,
    category: doc.category,
    categoryKey: documentCategoryGroupKey(doc.category),
    categoryValue: normalizeDocumentCategory(doc.category),
    categoryLabel: documentCategoryLabel(doc.category),
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    url: doc.url,
    storageId: doc.storageId,
    fileSizeBytes: doc.fileSizeBytes ?? extras.latestVersion?.fileSizeBytes,
    retentionYears: doc.retentionYears,
    createdAtISO: doc.createdAtISO,
    lastOpenedAtISO: doc.lastOpenedAtISO,
    reviewStatus: normalizeDocumentReviewStatus(doc.reviewStatus),
    storedReviewStatus: doc.reviewStatus,
    librarySection: doc.librarySection,
    flaggedForDeletion: doc.flaggedForDeletion,
    archivedAtISO: doc.archivedAtISO,
    archivedReason: doc.archivedReason,
    committeeId: doc.committeeId,
    meetingId: doc.meetingId,
    importSessionId: doc.importSessionId ?? provenance.importSessionId,
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    sourceExternalIds: provenance.externalIds,
    sourceSystem: provenance.sourceSystem,
    sourceSystemLabel: sourceSystemLabel(provenance.sourceSystem),
    sourceDate: provenance.sourceDate,
    sourcePath: provenance.sourcePath,
    sha256: provenance.sha256 ?? extras.latestVersion?.sha256,
    hasContent: provenance.contentKind !== "none",
    latestVersionId: extras.latestVersion?._id,
    latestVersionFileName: extras.latestVersion?.fileName,
    versionFileCount: extras.versionFileCount ?? 0,
    evidenceCount: extras.evidence?.total ?? 0,
    linkedRecordCount,
    linkedTargets: extras.evidence ? [...extras.evidence.targets].sort() : [],
    materialCount: extras.materials ?? 0,
    versionGroupKey: doc.versionGroupKey,
    supersedesDocumentId: doc.supersedesDocumentId,
    duplicateOfDocumentId: doc.duplicateOfDocumentId,
    sourceVersionStatus: extras.group?.sourceVersionStatus,
    sourceVersionStatusDetected: extras.group?.sourceVersionStatusDetected ?? false,
    duplicateCount: extras.group?.duplicateCount ?? 1,
    duplicateCanonicalId: extras.group?.canonicalId,
    isDuplicate: extras.group?.isDuplicate ?? false,
    duplicateReason: extras.group?.duplicateReason,
    versionKey: extras.group?.versionKey,
    versionCount: extras.group?.versionCount ?? 1,
    supersededById: extras.group?.supersededById,
  };
}

export async function browsePortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const [docs, versions, evidence, materials] = await Promise.all([
    visibleSocietyDocuments(ctx, societyId),
    ctx.db.query("documentVersions").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("sourceEvidence").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("meetingMaterials").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  const { latest, counts } = latestVersionsByDocument(versions, societyId);
  const evidenceByDoc = new Map<string, { total: number; linked: number; targets: Set<string> }>();
  for (const row of evidence) {
    if (!row.sourceDocumentId) continue;
    const key = String(row.sourceDocumentId);
    const entry = evidenceByDoc.get(key) ?? { total: 0, linked: 0, targets: new Set<string>() };
    entry.total += 1;
    if (row.targetId) {
      entry.linked += 1;
      if (row.targetTable) entry.targets.add(String(row.targetTable));
    }
    evidenceByDoc.set(key, entry);
  }
  const materialsByDoc = new Map<string, number>();
  for (const row of materials) materialsByDoc.set(String(row.documentId), (materialsByDoc.get(String(row.documentId)) ?? 0) + 1);
  const groups = buildDocumentGroups(docs.map((doc: Row) => versionable(doc, latest.get(String(doc._id)))));
  const rows = docs
    .map((doc: Row) => projectRow(doc, {
      group: groups.get(String(doc._id)),
      latestVersion: latest.get(String(doc._id)),
      versionFileCount: counts.get(String(doc._id)),
      evidence: evidenceByDoc.get(String(doc._id)),
      materials: materialsByDoc.get(String(doc._id)),
    }))
    .sort((a, b) => String(b.createdAtISO ?? "").localeCompare(String(a.createdAtISO ?? "")) || String(a._id).localeCompare(String(b._id)));
  const duplicateSets = new Set(rows.filter((row) => row.duplicateCount > 1).map((row) => row.duplicateCanonicalId));
  const versionSets = new Set(rows.filter((row) => row.versionKey && row.versionCount > 1).map((row) => row.versionKey));
  return {
    rows,
    summary: {
      total: rows.length,
      needsReview: rows.filter((row) => row.reviewStatus === "needs_review" || row.reviewStatus === "in_review").length,
      duplicateCopies: rows.filter((row) => row.isDuplicate).length,
      duplicateSets: duplicateSets.size,
      versionGroups: versionSets.size,
    },
  };
}

export async function versionsForPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  const document = await requireDocumentAccess(ctx, id);
  const societyId = String(document.societyId);
  const [docs, versions] = await Promise.all([
    visibleSocietyDocuments(ctx, societyId),
    ctx.db.query("documentVersions").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  const { latest } = latestVersionsByDocument(versions, societyId);
  const groups = buildDocumentGroups(docs.map((doc: Row) => versionable(doc, latest.get(String(doc._id)))));
  const self = groups.get(String(id));
  const byId = new Map(docs.map((doc: Row) => [String(doc._id), doc]));
  const item = (doc: Row) => {
    const group = groups.get(String(doc._id));
    const provenance = documentProvenanceCached(doc);
    return {
      _id: doc._id,
      title: doc.title,
      fileName: doc.fileName ?? latest.get(String(doc._id))?.fileName,
      category: doc.category,
      createdAtISO: doc.createdAtISO,
      archivedAtISO: doc.archivedAtISO,
      reviewStatus: normalizeDocumentReviewStatus(doc.reviewStatus),
      sourceDate: provenance.sourceDate,
      sha256: provenance.sha256 ?? latest.get(String(doc._id))?.sha256,
      sourceSystemLabel: sourceSystemLabel(provenance.sourceSystem),
      sourceVersionStatus: group?.sourceVersionStatus,
      sourceVersionStatusDetected: group?.sourceVersionStatusDetected ?? false,
      duplicateOfDocumentId: doc.duplicateOfDocumentId,
      supersedesDocumentId: doc.supersedesDocumentId,
      supersededById: group?.supersededById,
      isCanonical: group?.canonicalId === String(doc._id),
      isDuplicate: group?.isDuplicate ?? false,
      duplicateReason: group?.duplicateReason,
      current: String(doc._id) === String(id),
    };
  };
  const duplicates = self?.duplicateKey
    ? docs.filter((doc: Row) => groups.get(String(doc._id))?.duplicateKey === self.duplicateKey).map(item)
    : [];
  // One row per exact-duplicate set in the version list: its canonical copy.
  const versionMembers = self?.versionKey
    ? docs.filter((doc: Row) => {
      const group = groups.get(String(doc._id));
      if (group?.versionKey !== self.versionKey) return false;
      return !group?.isDuplicate || String(doc._id) === String(id);
    })
    : [];
  // The current document stands in for its own duplicate set.
  const selfCanonical = self?.canonicalId;
  if (self?.isDuplicate && selfCanonical) {
    const index = versionMembers.findIndex((doc: Row) => String(doc._id) === selfCanonical);
    if (index >= 0) versionMembers.splice(index, 1);
  }
  const linked = [document.supersedesDocumentId, self?.supersededById]
    .filter(Boolean)
    .map((linkedId) => byId.get(String(linkedId)))
    .filter((doc): doc is Row => Boolean(doc) && !versionMembers.some((member: Row) => String(member._id) === String(doc!._id)));
  const versionsList = [...versionMembers, ...linked].map(item).sort(compareVersions);
  return {
    document: item(document),
    duplicates: duplicates.sort((a, b) => Number(b.isCanonical) - Number(a.isCanonical) || String(a.createdAtISO ?? "").localeCompare(String(b.createdAtISO ?? ""))),
    versions: versionsList.length > 1 ? versionsList : [],
    versionKey: self?.versionKey,
    versionKeySource: self?.versionKeySource,
  };
}

async function ownedDocumentPair(ctx: PortableMutationCtx, id: string, otherId: string) {
  if (String(id) === String(otherId)) throw new Error("Choose a different document.");
  const candidate = await ctx.db.get(id, "documents");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("documents not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  const document: Row = await getOwned(ctx, "documents", id, candidate.societyId);
  const other: Row = await getOwned(ctx, "documents", otherId, candidate.societyId);
  await requireDocumentAccess(ctx, id);
  await requireDocumentAccess(ctx, otherId);
  if (isInternalDocumentRecord(document) || isInternalDocumentRecord(other)) throw new Error("documents not found.");
  return { document, other, societyId: candidate.societyId };
}

async function logDocumentActivity(ctx: PortableMutationCtx, societyId: string, documentId: string, action: string, summary: string) {
  const actor = await requireSocietyMembership(ctx, societyId);
  await ctx.db.insert("activity", {
    societyId,
    actor: actor.displayName ?? "You",
    entityType: "document",
    subjectId: documentId,
    entityId: documentId,
    action,
    summary,
    createdAtISO: new Date().toISOString(),
  });
}

export async function markDuplicatePortable(
  ctx: PortableMutationCtx,
  { id, duplicateOfDocumentId }: { id: string; duplicateOfDocumentId: string },
) {
  const { document, other, societyId } = await ownedDocumentPair(ctx, id, duplicateOfDocumentId);
  // Follow the target's chain: marking A as a copy of B when B is (eventually)
  // a copy of A would leave no canonical document.
  const seen = new Set<string>([String(id)]);
  let cursor: Row | null = other;
  while (cursor?.duplicateOfDocumentId) {
    const next = String(cursor.duplicateOfDocumentId);
    if (seen.has(next)) throw new Error(`"${other.title}" is already marked as a copy of this document.`);
    seen.add(next);
    cursor = await ctx.db.get(next, "documents");
  }
  await ctx.db.patch(id, { duplicateOfDocumentId: duplicateOfDocumentId });
  await logDocumentActivity(ctx, societyId, id, "document-duplicate", `Marked ${document.title} as a duplicate of ${other.title}`);
  return id;
}

export async function clearDuplicatePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const candidate = await ctx.db.get(id, "documents");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("documents not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  const document = await getOwned(ctx, "documents", id, candidate.societyId);
  await requireDocumentAccess(ctx, id);
  if (!document.duplicateOfDocumentId) return id;
  await ctx.db.patch(id, { duplicateOfDocumentId: undefined });
  await logDocumentActivity(ctx, candidate.societyId, id, "document-duplicate", `Cleared the duplicate mark on ${document.title}`);
  return id;
}

export async function setVersionInfoPortable(
  ctx: PortableMutationCtx,
  args: { id: string; versionGroupKey?: string | null; supersedesDocumentId?: string | null; sourceVersionStatus?: string | null },
) {
  const candidate = await ctx.db.get(args.id, "documents");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("documents not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  const document = await getOwned(ctx, "documents", args.id, candidate.societyId);
  await requireDocumentAccess(ctx, args.id);
  const patch: Row = {};
  if (args.versionGroupKey !== undefined) {
    const key = String(args.versionGroupKey ?? "").replace(/\s+/g, " ").trim();
    if (key.length > 160) throw new Error("Keep the version group name under 160 characters.");
    patch.versionGroupKey = key || undefined;
  }
  if (args.supersedesDocumentId !== undefined) {
    if (args.supersedesDocumentId) {
      if (String(args.supersedesDocumentId) === String(args.id)) throw new Error("A document cannot supersede itself.");
      await getOwned(ctx, "documents", args.supersedesDocumentId, candidate.societyId);
      await requireDocumentAccess(ctx, args.supersedesDocumentId);
    }
    patch.supersedesDocumentId = args.supersedesDocumentId || undefined;
  }
  if (args.sourceVersionStatus !== undefined) {
    if (args.sourceVersionStatus) {
      const status = normalizeSourceVersionStatus(args.sourceVersionStatus);
      if (!status) throw new Error("Choose draft, final, approved, signed or revised.");
      patch.sourceVersionStatus = status;
    } else {
      patch.sourceVersionStatus = undefined;
    }
  }
  if (!Object.keys(patch).length) return args.id;
  await ctx.db.patch(args.id, patch);
  await logDocumentActivity(ctx, candidate.societyId, args.id, "document-version", `Updated version details for ${document.title}`);
  return args.id;
}

/**
 * Merge exact duplicates into one kept document: tags and source ids are
 * combined, missing file details are filled in, meeting materials and source
 * evidence are re-pointed, and each copy is archived with a duplicate link (so
 * nothing is deleted and the merge can be reviewed).
 */
export async function mergeDuplicatesPortable(
  ctx: PortableMutationCtx,
  { keepId, duplicateIds }: { keepId: string; duplicateIds: string[] },
) {
  const ids = [...new Set(duplicateIds.map(String))].filter((id) => id !== String(keepId));
  if (!ids.length) throw new Error("Choose at least one copy to merge.");
  if (ids.length > 50) throw new Error("Merge at most 50 copies at a time.");
  const pairs: Array<{ document: Row; other: Row; societyId: string }> = [];
  for (const id of ids) pairs.push(await ownedDocumentPair(ctx, keepId, id));
  const keep = pairs[0].document;
  const societyId = pairs[0].societyId;
  const tags = new Set<string>((keep.tags ?? []).map(String));
  const tagKeys = new Set([...tags].map((tag) => tag.toLowerCase()));
  const patch: Row = {};
  let repointed = 0;
  const [materials, evidence] = await Promise.all([
    ctx.db.query("meetingMaterials").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("sourceEvidence").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  const keepMaterialMeetings = new Set(materials.filter((row: Row) => String(row.documentId) === String(keepId)).map((row: Row) => String(row.meetingId)));
  for (const { other } of pairs) {
    for (const tag of other.tags ?? []) {
      const key = String(tag).toLowerCase();
      if (!tagKeys.has(key)) { tagKeys.add(key); tags.add(String(tag)); }
    }
    for (const field of ["fileName", "mimeType", "fileSizeBytes", "url", "meetingId", "committeeId", "agendaItemId"]) {
      if (keep[field] == null && patch[field] == null && other[field] != null) patch[field] = other[field];
    }
    for (const row of materials) {
      if (String(row.documentId) !== String(other._id)) continue;
      if (keepMaterialMeetings.has(String(row.meetingId))) continue;
      await ctx.db.patch(row._id, { documentId: keepId });
      keepMaterialMeetings.add(String(row.meetingId));
      repointed += 1;
    }
    for (const row of evidence) {
      if (String(row.sourceDocumentId ?? "") !== String(other._id)) continue;
      await ctx.db.patch(row._id, { sourceDocumentId: keepId });
      repointed += 1;
    }
    await ctx.db.patch(other._id, {
      duplicateOfDocumentId: keepId,
      archivedAtISO: other.archivedAtISO ?? new Date().toISOString(),
      archivedReason: `Merged into "${keep.title}" as a duplicate copy.`,
      flaggedForDeletion: false,
    });
  }
  const sourceIds = new Set<string>([...(keep.sourceExternalIds ?? []), ...pairs.flatMap(({ other }) => other.sourceExternalIds ?? [])].map(String));
  if (sourceIds.size) patch.sourceExternalIds = [...sourceIds];
  patch.tags = [...tags];
  await ctx.db.patch(keepId, patch);
  await logDocumentActivity(ctx, societyId, keepId, "document-merge", `Merged ${ids.length} duplicate cop${ids.length === 1 ? "y" : "ies"} into ${keep.title}`);
  return { merged: ids.length, repointed };
}
