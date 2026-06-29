/**
 * PORTABLE FUNCTIONS: the organization-history domain
 * (list / removeSource / bulkSetItemReviewStatus / removeItem).
 *
 * Org-history sources and items are stored as `documents` rows tagged with
 * `org-history` (+ source/item tags), with their structured payload JSON-encoded
 * into `content`. These handlers read/write the `documents` table (plus
 * `minutes` and `meetings` for motion reconciliation) over `ctx.db`. Each
 * handler runs unchanged on hosted Convex, the local Dexie runtime, and the
 * convex-test oracle.
 *
 * Note: saveSource / saveItem / extractBudgetSourceDetails / bulkImport remain
 * on the hosted-Convex side (pending ledger) and are not ported here.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

const HISTORY_TAG = "org-history";
const SOURCE_TAG = "org-history-source";
const ITEM_TAG = "org-history-item";
const SOURCE_CATEGORY = "Org History Source";
const ITEM_CATEGORY = "Org History Item";
const LARGE_SOURCE_CONTENT_PARSE_LIMIT = 100_000;

export async function listPortable(
  ctx: PortableQueryCtx,
  { societyId }: { societyId: string },
) {
  const [sourceDocs, itemDocs, minutesRows, meetingRows] = await Promise.all([
    docsByCategory(ctx, societyId, SOURCE_CATEGORY),
    docsByCategory(ctx, societyId, ITEM_CATEGORY),
    ctx.db
      .query("minutes")
      .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
      .collect(),
    ctx.db
      .query("meetings")
      .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
      .collect(),
  ]);
  const docs = [...sourceDocs, ...itemDocs];

  const sources: any[] = [];
  const facts: any[] = [];
  const events: any[] = [];
  const boardTerms: any[] = [];
  const motions: any[] = [];
  const budgets: any[] = [];

  for (const doc of docs) {
    if (!doc.tags.includes(HISTORY_TAG)) continue;

    if (doc.tags.includes(SOURCE_TAG)) {
      sources.push(hydrateSource(doc));
      continue;
    }

    if (!doc.tags.includes(ITEM_TAG)) continue;
    const record = hydrateItem(doc);
    if (record.kind === "fact") facts.push(record);
    if (record.kind === "event") events.push(record);
    if (record.kind === "boardTerm") boardTerms.push(record);
    if (record.kind === "motion") motions.push(record);
    if (record.kind === "budget") budgets.push(record);
  }

  return {
    sources: sources.sort((a, b) => (a.sourceDate ?? "").localeCompare(b.sourceDate ?? "")),
    facts: facts.sort((a, b) => String(a.label ?? "").localeCompare(String(b.label ?? ""))),
    events: events.sort((a, b) => String(a.eventDate ?? "").localeCompare(String(b.eventDate ?? ""))),
    boardTerms: boardTerms.sort((a, b) => String(a.startDate ?? "").localeCompare(String(b.startDate ?? ""))),
    motions: mergeMotionRecords(motions, minutesRows, meetingRows, sources),
    budgets: budgets.sort((a, b) => String(a.fiscalYear ?? "").localeCompare(String(b.fiscalYear ?? ""))),
  };
}

export async function removeSourcePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const source = await ctx.db.get(id);
  if (!isHistorySource(source)) return;

  const docs = await docsByCategory(ctx, String(source.societyId), ITEM_CATEGORY);

  await Promise.all([
    ...docs.filter(isHistoryItem).map((doc) => {
      const item = hydrateItem(doc);
      const sourceIds = Array.isArray(item.sourceIds)
        ? item.sourceIds.filter((sourceId: string) => sourceId !== id)
        : [];
      return ctx.db.patch(doc._id, {
        content: JSON.stringify({ ...item, sourceIds, kind: item.kind }),
      });
    }),
    ctx.db.delete(id),
  ]);
}

export async function bulkSetItemReviewStatusPortable(
  ctx: PortableMutationCtx,
  { updates }: {
    updates: Array<{
      id: string;
      kind: string;
      status: string;
      confidence?: string;
      notes?: string;
    }>;
  },
) {
  const results: any[] = [];

  for (const update of updates) {
    if (!isItemKind(update.kind)) {
      results.push({ id: String(update.id), updated: false, reason: "invalid-kind" });
      continue;
    }

    const existing = await ctx.db.get(update.id);
    if (!isHistoryItem(existing)) {
      results.push({ id: String(update.id), updated: false, reason: "not-history-item" });
      continue;
    }

    const current = hydrateItem(existing);
    if (current.kind !== update.kind) {
      results.push({ id: String(update.id), updated: false, reason: "kind-mismatch" });
      continue;
    }

    const next = stripRuntimeFields({
      ...current,
      kind: update.kind,
      status: update.status,
      confidence: update.confidence ?? current.confidence,
      notes: update.notes ? appendUniqueNote(current.notes, update.notes) : current.notes,
    });

    await ctx.db.patch(update.id, {
      title: itemTitle(update.kind, next),
      content: JSON.stringify(next),
      tags: itemTags(update.kind),
    });

    results.push({
      id: String(update.id),
      updated: true,
      previousStatus: optionalText(current.status),
      status: update.status,
    });
  }

  return results;
}

export async function removeItemPortable(
  ctx: PortableMutationCtx,
  { id, kind }: { id: string; kind: string },
) {
  if (!isItemKind(kind)) return;
  const existing = await ctx.db.get(id);
  if (!isHistoryItem(existing)) return;
  const current = hydrateItem(existing);
  if (current.kind !== kind) return;
  await ctx.db.delete(id);
}

async function docsByCategory(ctx: any, societyId: string, category: string) {
  return await ctx.db
    .query("documents")
    .withIndex("by_society_category", (q: any) => q.eq("societyId", societyId).eq("category", category))
    .collect();
}

function hydrateSource(doc: any, includeRestrictedContent = false) {
  const content = String(doc.content ?? "");
  const payload =
    !includeRestrictedContent && content.length > LARGE_SOURCE_CONTENT_PARSE_LIMIT
      ? {}
      : parseContent(doc.content);
  const safePayload = { ...payload };
  if (!includeRestrictedContent && safePayload.paperlessMetadata) {
    safePayload.paperlessMetadata = { ...safePayload.paperlessMetadata };
    delete safePayload.paperlessMetadata.content;
  }
  return {
    ...safePayload,
    _id: doc._id,
    _creationTime: doc._creationTime,
    title: safePayload.title ?? doc.title,
    url: safePayload.url ?? safePayload.paperlessDocumentUrl ?? doc.url,
    storageId: doc.storageId,
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    fileSizeBytes: doc.fileSizeBytes,
    category: safePayload.category ?? doc.category ?? "Other",
    confidence: safePayload.confidence ?? "Review",
    tags: doc.tags ?? [],
  };
}

function hydrateItem(doc: any) {
  const payload = parseContent(doc.content);
  return {
    ...payload,
    _id: doc._id,
    _creationTime: doc._creationTime,
    sourceIds: Array.isArray(payload.sourceIds) ? payload.sourceIds : [],
    createdAtISO: doc.createdAtISO,
  };
}

function parseContent(content: unknown) {
  if (typeof content !== "string") return {};
  try {
    return JSON.parse(content);
  } catch {
    return {};
  }
}

function itemTitle(kind: string, payload: any) {
  if (kind === "fact") return String(payload?.label ?? "Profile fact").trim();
  if (kind === "event") return String(payload?.title ?? "History event").trim();
  if (kind === "boardTerm") return String(payload?.personName ?? "Board term").trim();
  if (kind === "motion") return String(payload?.motionText ?? payload?.meetingTitle ?? "Motion").trim();
  if (kind === "budget") return String(payload?.title ?? payload?.fiscalYear ?? "Budget").trim();
  return "History item";
}

function itemTags(kind: string) {
  return [HISTORY_TAG, ITEM_TAG, tagValue(kind)].filter(Boolean);
}

function tagValue(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, "-");
}

function optionalText(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? text : undefined;
}

function numberOrUndefined(value: unknown) {
  if (value === "" || value === undefined || value === null) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function mergeMotionRecords(historyMotions: any[], minutesRows: any[], meetingRows: any[], sources: any[]) {
  const sourceById = new Map(sources.map((source) => [source._id, source]));
  const sourceIdByExternalId = new Map(
    sources
      .map((source) => [String(source.externalId ?? ""), source._id] as const)
      .filter(([externalId]) => externalId),
  );
  const meetingById = new Map(meetingRows.map((meeting) => [meeting._id, meeting]));
  const rows = historyMotions.map((motion) => {
    const sourceIds = uniqueStrings(motion.sourceIds);
    const sourceExternalIds = uniqueStrings([
      ...arrayOfStrings(motion.sourceExternalIds),
      ...sourceIds
        .map((id) => sourceById.get(id)?.externalId)
        .filter(Boolean),
    ]);

    return {
      ...motion,
      sourceIds,
      sourceExternalIds,
      motionRecordSource: "orgHistory",
      matchedPaperlessMinutes: false,
    };
  });

  for (const minutesRow of minutesRows) {
    const meeting = meetingById.get(minutesRow.meetingId);
    const meetingDate = dateOnly(minutesRow.heldAt) || dateOnly(meeting?.scheduledAt);
    const meetingTitle = optionalText(meeting?.title) ?? "Imported meeting minutes";
    const sourceExternalIds = uniqueStrings(minutesRow.sourceExternalIds);
    const sourceIds = uniqueStrings([
      ...arrayOfStrings(minutesRow.sourceDocumentIds).filter((id) => sourceById.has(id)),
      ...sourceExternalIds.map((externalId) => sourceIdByExternalId.get(externalId)).filter(Boolean),
    ]);

    for (const [index, motion] of arrayOf(minutesRow.motions).entries()) {
      const motionText = optionalText(motion?.text);
      if (!motionText) continue;

      const candidate = {
        _id: `minutes:${minutesRow._id}:${index}`,
        kind: "motion",
        meetingDate,
        meetingTitle,
        motionText,
        outcome: optionalText(motion?.outcome) ?? "NeedsReview",
        movedByName: optionalText(motion?.movedBy),
        secondedByName: optionalText(motion?.secondedBy),
        votesFor: numberOrUndefined(motion?.votesFor),
        votesAgainst: numberOrUndefined(motion?.votesAgainst),
        abstentions: numberOrUndefined(motion?.abstentions),
        resolutionType: optionalText(motion?.resolutionType),
        category: "Governance",
        sourceIds,
        sourceExternalIds,
        motionRecordSource: "paperlessMinutes",
        matchedPaperlessMinutes: true,
        meetingId: minutesRow.meetingId,
        minutesId: minutesRow._id,
        minutesMotionIndex: index,
        motionSortIndex: index,
        createdAtISO: minutesRow._creationTime ? new Date(minutesRow._creationTime).toISOString() : undefined,
      };

      const duplicate = rows.find((row) => isSameMotionRecord(row, candidate));
      if (duplicate) {
        duplicate.sourceIds = uniqueStrings([...(duplicate.sourceIds ?? []), ...sourceIds]);
        duplicate.sourceExternalIds = uniqueStrings([...(duplicate.sourceExternalIds ?? []), ...sourceExternalIds]);
        duplicate.matchedPaperlessMinutes = true;
        duplicate.paperlessMinutesId = duplicate.paperlessMinutesId ?? minutesRow._id;
        duplicate.paperlessMeetingId = duplicate.paperlessMeetingId ?? minutesRow.meetingId;
        duplicate.motionSortIndex = duplicate.motionSortIndex ?? index;
        duplicate.meetingTitle = duplicate.meetingTitle ?? meetingTitle;
        duplicate.meetingDate = duplicate.meetingDate ?? meetingDate;
        duplicate.movedByName = duplicate.movedByName ?? candidate.movedByName;
        duplicate.secondedByName = duplicate.secondedByName ?? candidate.secondedByName;
        duplicate.votesFor = duplicate.votesFor ?? candidate.votesFor;
        duplicate.votesAgainst = duplicate.votesAgainst ?? candidate.votesAgainst;
        duplicate.abstentions = duplicate.abstentions ?? candidate.abstentions;
        duplicate.resolutionType = duplicate.resolutionType ?? candidate.resolutionType;
      } else {
        rows.push(candidate);
      }
    }
  }

  return rows.sort(compareMotionRecords);
}

function compareMotionRecords(a: any, b: any) {
  const date = String(a.meetingDate ?? "").localeCompare(String(b.meetingDate ?? ""));
  if (date !== 0) return date;
  const meeting = String(a.meetingTitle ?? "").localeCompare(String(b.meetingTitle ?? ""));
  if (meeting !== 0) return meeting;
  const sortIndex = motionSortIndex(a) - motionSortIndex(b);
  if (sortIndex !== 0) return sortIndex;
  const creation = Number(a._creationTime ?? 0) - Number(b._creationTime ?? 0);
  if (creation !== 0) return creation;
  return String(a.motionText ?? "").localeCompare(String(b.motionText ?? ""));
}

function motionSortIndex(motion: any) {
  const index = Number(motion.motionSortIndex ?? motion.minutesMotionIndex);
  return Number.isFinite(index) ? index : Number.MAX_SAFE_INTEGER;
}

function isSameMotionRecord(a: any, b: any) {
  const aText = comparableMotionText(a.motionText);
  const bText = comparableMotionText(b.motionText);
  if (!aText || !bText) return false;

  const sameDate = dateOnly(a.meetingDate) === dateOnly(b.meetingDate);
  const sharedSource = hasOverlap(a.sourceIds, b.sourceIds) || hasOverlap(a.sourceExternalIds, b.sourceExternalIds);
  if (!sameDate && !sharedSource) return false;

  if (aText === bText) return true;
  if (containsComparableMotion(aText, bText)) return true;
  if (sameDate && sharedSource && sameMotionIntent(aText, bText)) return true;

  const score = tokenOverlapScore(aText, bText);
  const lengthRatio = Math.max(aText.length, bText.length) / Math.max(1, Math.min(aText.length, bText.length));
  if (sameDate && sharedSource) return score >= 0.74 && lengthRatio >= 1.25;
  if (sharedSource) return score >= 0.68;
  return score >= 0.78;
}

function sameMotionIntent(a: string, b: string) {
  return [
    ["board", "directors", "approve", "positions"],
    ["editor", "chief", "salary", "summer"],
    ["editor", "chief", "honorarium", "$800"],
  ].some((tokens) => tokens.every((token) => a.includes(token) && b.includes(token)));
}

function comparableMotionText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\b(be it resolved that|resolved that|upon motion|it was moved|motion\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)|motion to|motion|birt|bifrt)\b[:\s-]*/gi, " ")
    .replace(/\b(this motion has been|this motion is|motion has been)\s+(passed|carried|approved|tabled|defeated)\b/gi, " ")
    .replace(/\b(vote|yes|no|abstain(?:ed|ing)?|for|against)\b[:\s-]*\d*/gi, " ")
    .replace(/[^a-z0-9$]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsComparableMotion(a: string, b: string) {
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  return shorter.length >= 36 && longer.includes(shorter);
}

function tokenOverlapScore(a: string, b: string) {
  const aTokens = new Set(a.split(" ").filter((token) => token.length > 2));
  const bTokens = new Set(b.split(" ").filter((token) => token.length > 2));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let shared = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) shared += 1;
  }
  return shared / Math.min(aTokens.size, bTokens.size);
}

function hasOverlap(a: unknown, b: unknown) {
  const left = new Set(arrayOfStrings(a));
  if (left.size === 0) return false;
  return arrayOfStrings(b).some((value) => left.has(value));
}

function arrayOf(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function uniqueStrings(value: unknown) {
  return Array.from(new Set(arrayOfStrings(value)));
}

function dateOnly(value: unknown) {
  return optionalText(value)?.slice(0, 10);
}

function appendUniqueNote(existing: unknown, note: string) {
  const current = optionalText(existing);
  if (!current) return note;
  if (current.includes(note)) return current;
  return `${current}\n${note}`;
}

function stripRuntimeFields(value: any) {
  const copy = { ...(value ?? {}) };
  delete copy._id;
  delete copy._creationTime;
  delete copy.createdAtISO;
  return copy;
}

function isItemKind(kind: string) {
  return ["fact", "event", "boardTerm", "motion", "budget"].includes(kind);
}

function isHistorySource(doc: any): doc is Record<string, any> {
  return Boolean(doc?.tags?.includes(HISTORY_TAG) && doc?.tags?.includes(SOURCE_TAG));
}

function isHistoryItem(doc: any): doc is Record<string, any> {
  return Boolean(doc?.tags?.includes(HISTORY_TAG) && doc?.tags?.includes(ITEM_TAG));
}
