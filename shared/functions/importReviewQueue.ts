/**
 * PORTABLE FUNCTIONS: the cross-session import review queue (findings D-06 to
 * D-10, D-19).
 *
 *  - `importSessions:reviewQueue` — one queue over the candidates of every
 *    import session: status/kind/target/session/risk/source/search filters,
 *    priority ordering, progress (x of N reviewed), facets with counts and a
 *    page of light items carrying provenance (source file, locator, excerpt).
 *  - `importSessions:getRecord` — the full candidate for the detail pane.
 *  - `importSessions:removalImpact` — what deleting a session would affect, so
 *    the confirmation can name counts.
 *  - `importSessions:pendingByTarget` — pending candidates per target module
 *    and record kind, for "N candidates awaiting review" links on the pages
 *    those records will land on.
 *
 * Candidate rows store their state as JSON in `content`. Parsed projections
 * are memoized per row id and content string, so the reactive re-run after an
 * approve only re-parses the rows that changed.
 */

import type { PortableQueryCtx } from "../portable/ctx";
import { requireSocietyMembership } from "./access";
import {
  RECORD_CATEGORY,
  SESSION_CATEGORY,
  docsByCategory,
  hydrateRecord,
  hydrateSession,
  isImportRecord,
  isImportSession,
  recordSortKey,
} from "./importSessionHelpers";
import { deriveReviewRisk, type ReviewRisk, type ReviewRiskLevel } from "../importReviewRisk";
import { excerptOf, externalIdSystem, sourceSystemLabel } from "../documentProvenance";

type QueueItem = {
  _id: string;
  sessionId: string;
  recordKind: string;
  targetModule: string;
  title: string;
  description?: string;
  status: string;
  confidence: string;
  storedFlags: string[];
  risk: ReviewRisk;
  sourceExternalIds: string[];
  sourceSystem: string;
  fileName?: string;
  url?: string;
  sha256?: string;
  locator: { path?: string; page?: string; section?: string };
  sourceDate?: string;
  excerpt?: string;
  extractedTextLength: number;
  hasNotes: boolean;
  importedTargets: Record<string, unknown>;
  updatedAtISO?: string;
  sortKey: string;
  searchText: string;
};

const ITEM_CACHE = new Map<string, { content: unknown; item: QueueItem }>();

function str(value: unknown) {
  return typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function uniqueStrings(values: unknown[]) {
  return [...new Set(values.map(str).filter(Boolean))];
}

function queueItem(doc: any): QueueItem {
  const cached = ITEM_CACHE.get(String(doc._id));
  if (cached && cached.content === doc.content) return cached.item;
  const record = hydrateRecord(doc);
  const payload = record.payload && typeof record.payload === "object" ? record.payload : {};
  const sourceExternalIds = uniqueStrings([...(record.sourceExternalIds ?? []), ...(Array.isArray(payload.sourceExternalIds) ? payload.sourceExternalIds : []), payload.externalId]);
  const extracted = str(payload.extractedText) || str(payload.rawText) || str(payload.evidenceText);
  const notes = str(payload.notes);
  const folderPath = notes.match(/Original folder path:\s*(.+)/i)?.[1]?.trim();
  const system = str(payload.externalSystem).toLowerCase() || externalIdSystem(sourceExternalIds[0]) || (sourceExternalIds[0]?.split(":")[0] ?? "") || "other";
  const title = str(record.title) || str(payload.title) || "Untitled candidate";
  const item: QueueItem = {
    _id: String(doc._id),
    sessionId: String(record.sessionId ?? doc.importSessionId ?? ""),
    recordKind: String(record.recordKind ?? doc.importRecordKind ?? "source"),
    targetModule: str(record.targetModule) || "unassigned",
    title,
    description: str(record.description) ? excerptOf(str(record.description), 280) : undefined,
    status: String(record.status ?? "Pending"),
    confidence: str(record.confidence) || str(payload.confidence) || "Review",
    storedFlags: Array.isArray(record.riskFlags) ? record.riskFlags.map(String) : [],
    risk: deriveReviewRisk({ recordKind: String(record.recordKind), targetModule: record.targetModule, title, payload, riskFlags: record.riskFlags, confidence: record.confidence }),
    sourceExternalIds: sourceExternalIds.slice(0, 6),
    sourceSystem: system,
    fileName: str(payload.fileName) || undefined,
    url: /^https?:\/\//i.test(str(payload.url)) ? str(payload.url) : undefined,
    sha256: /^[a-f0-9]{64}$/i.test(str(payload.sha256)) ? str(payload.sha256).toLowerCase() : undefined,
    locator: {
      path: folderPath || str(payload.localPath) || str(payload.path) || undefined,
      page: str(payload.pageRef) || str(payload.page) || str(payload.sourceLocator?.pageRef) || undefined,
      section: str(payload.sectionTitle) || str(payload.sourceLocator?.sectionReference) || undefined,
    },
    sourceDate: str(payload.sourceDate) || str(payload.meetingDate) || str(payload.eventDate) || str(payload.effectiveDate) || str(payload.periodEnd) || str(payload.created).slice(0, 10) || undefined,
    excerpt: extracted ? excerptOf(extracted, 700) : undefined,
    extractedTextLength: extracted.length,
    hasNotes: Boolean(str(record.reviewNotes) || notes),
    importedTargets: record.importedTargets ?? {},
    updatedAtISO: record.updatedAtISO,
    sortKey: recordSortKey(record),
    searchText: [title, record.description, record.targetModule, record.recordKind, payload.fileName, folderPath, ...sourceExternalIds]
      .map(str).join(" ").toLowerCase(),
  };
  ITEM_CACHE.set(String(doc._id), { content: doc.content, item });
  return item;
}

function countInto(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function facetList(map: Map<string, number>) {
  return [...map.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

const RISK_ORDER: Record<ReviewRiskLevel, number> = { high: 0, medium: 1, low: 2 };

async function loadQueue(ctx: PortableQueryCtx, societyId: string) {
  const [sessionDocs, recordDocs] = await Promise.all([
    docsByCategory(ctx, societyId, SESSION_CATEGORY),
    docsByCategory(ctx, societyId, RECORD_CATEGORY),
  ]);
  const sessions = new Map<string, { _id: string; name: string; sourceSystem?: string; createdAtISO?: string }>();
  for (const doc of sessionDocs.filter(isImportSession)) {
    const session = hydrateSession(doc);
    sessions.set(String(doc._id), { _id: String(doc._id), name: String(session.name ?? doc.title ?? "Import session"), sourceSystem: session.sourceSystem, createdAtISO: session.createdAtISO });
  }
  const items = recordDocs.filter(isImportRecord).map(queueItem).filter((item) => sessions.has(item.sessionId));
  return { sessions, items };
}

export async function reviewQueuePortable(
  ctx: PortableQueryCtx,
  args: {
    societyId: string;
    status?: string;
    recordKind?: string;
    targetModule?: string;
    sessionId?: string;
    risk?: string;
    source?: string;
    search?: string;
    sort?: string;
    offset?: number;
    limit?: number;
  },
) {
  await requireSocietyMembership(ctx, args.societyId);
  const { sessions, items } = await loadQueue(ctx, args.societyId);
  const status = args.status && args.status !== "all" ? args.status : args.status === "all" ? null : "Pending";

  const progress = { total: items.length, pending: 0, approved: 0, rejected: 0, reviewed: 0 };
  const sessionStats = new Map<string, { total: number; pending: number }>();
  for (const item of items) {
    if (item.status === "Approved") progress.approved += 1;
    else if (item.status === "Rejected") progress.rejected += 1;
    else progress.pending += 1;
    const stats = sessionStats.get(item.sessionId) ?? { total: 0, pending: 0 };
    stats.total += 1;
    if (item.status === "Pending") stats.pending += 1;
    sessionStats.set(item.sessionId, stats);
  }
  progress.reviewed = progress.approved + progress.rejected;

  const inStatus = status ? items.filter((item) => item.status === status) : items;
  const shaCounts = new Map<string, number>();
  for (const item of inStatus) if (item.sha256) countInto(shaCounts, item.sha256);

  const query = str(args.search).toLowerCase();
  const matches = (item: QueueItem, skip?: string) =>
    (skip === "kind" || !args.recordKind || item.recordKind === args.recordKind) &&
    (skip === "target" || !args.targetModule || item.targetModule === args.targetModule) &&
    (skip === "session" || !args.sessionId || item.sessionId === args.sessionId) &&
    (skip === "risk" || !args.risk || item.risk.level === args.risk) &&
    (skip === "source" || !args.source || item.sourceSystem === args.source) &&
    (!query || item.searchText.includes(query));

  // Each facet counts the other active filters, so its numbers say what the
  // reviewer would get by switching that one filter.
  const facets = { kinds: new Map<string, number>(), targets: new Map<string, number>(), sessions: new Map<string, number>(), risks: new Map<string, number>(), sources: new Map<string, number>() };
  for (const item of inStatus) {
    if (matches(item, "kind")) countInto(facets.kinds, item.recordKind);
    if (matches(item, "target")) countInto(facets.targets, item.targetModule);
    if (matches(item, "session")) countInto(facets.sessions, item.sessionId);
    if (matches(item, "risk")) countInto(facets.risks, item.risk.level);
    if (matches(item, "source")) countInto(facets.sources, item.sourceSystem);
  }

  const sessionOrder = new Map([...sessions.values()]
    .sort((a, b) => String(b.createdAtISO ?? "").localeCompare(String(a.createdAtISO ?? "")) || a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((session, index) => [session._id, index]));
  const filtered = inStatus.filter((item) => matches(item));
  filtered.sort(args.sort === "session"
    ? (a, b) => (sessionOrder.get(a.sessionId) ?? 0) - (sessionOrder.get(b.sessionId) ?? 0) || a.sortKey.localeCompare(b.sortKey) || a._id.localeCompare(b._id)
    : (a, b) => b.risk.score - a.risk.score || RISK_ORDER[a.risk.level] - RISK_ORDER[b.risk.level] || (sessionOrder.get(a.sessionId) ?? 0) - (sessionOrder.get(b.sessionId) ?? 0) || a.sortKey.localeCompare(b.sortKey) || a._id.localeCompare(b._id));

  const limit = Math.max(1, Math.min(Number(args.limit) || 50, 200));
  const offset = Math.max(0, Math.min(Number(args.offset) || 0, Math.max(0, filtered.length - 1)));
  const page = filtered.slice(offset, offset + limit).map(({ searchText: _searchText, sortKey: _sortKey, ...item }) => {
    const duplicateCount = item.sha256 ? shaCounts.get(item.sha256) ?? 1 : 1;
    const session = sessions.get(item.sessionId);
    return {
      ...item,
      risk: duplicateCount > 1 ? { ...item.risk, reasons: [...item.risk.reasons, `same file staged ${duplicateCount}×`] } : item.risk,
      duplicateCount,
      sessionName: session?.name ?? "Import session",
      sourceSystemLabel: sourceSystemLabel(item.sourceSystem === "other" ? undefined : item.sourceSystem) ?? "Other source",
    };
  });

  return {
    items: page,
    total: filtered.length,
    offset,
    limit,
    status: status ?? "all",
    progress,
    facets: {
      kinds: facetList(facets.kinds),
      targets: facetList(facets.targets),
      sessions: facetList(facets.sessions),
      risks: facetList(facets.risks).sort((a, b) => RISK_ORDER[a.value as ReviewRiskLevel] - RISK_ORDER[b.value as ReviewRiskLevel]),
      sources: facetList(facets.sources).map((facet) => ({ ...facet, label: sourceSystemLabel(facet.value === "other" ? undefined : facet.value) ?? "Other source" })),
    },
    sessions: [...sessions.values()]
      .map((session) => ({ ...session, total: sessionStats.get(session._id)?.total ?? 0, pending: sessionStats.get(session._id)?.pending ?? 0 }))
      .sort((a, b) => (sessionOrder.get(a._id) ?? 0) - (sessionOrder.get(b._id) ?? 0)),
  };
}

export async function getRecordPortable(ctx: PortableQueryCtx, { recordId }: { recordId: string }) {
  const doc = await ctx.db.get(recordId, "documents");
  if (!isImportRecord(doc)) return null;
  await requireSocietyMembership(ctx, String(doc.societyId));
  const record = hydrateRecord(doc);
  const item = queueItem(doc);
  return { ...record, risk: item.risk, locator: item.locator, sourceSystem: item.sourceSystem, sourceSystemLabel: sourceSystemLabel(item.sourceSystem === "other" ? undefined : item.sourceSystem) };
}

/** Rows that keep a reference to an import session after it is deleted. */
export async function sessionReferences(ctx: PortableQueryCtx, societyId: string, sessionId: string) {
  const docs = await ctx.db.query("documents").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  const marker = `"importSessionId":"${sessionId}"`;
  const linkedDocuments = docs.filter((doc: any) =>
    !isImportRecord(doc) && String(doc._id) !== sessionId &&
    (String(doc.importSessionId ?? "") === sessionId || (typeof doc.content === "string" && doc.content.includes(marker))));
  const gaps = await ctx.db.query("representationGaps").withIndex("by_import_session", (q) => q.eq("importSessionId", sessionId)).collect();
  return { linkedDocuments, gaps };
}

export async function removalImpactPortable(ctx: PortableQueryCtx, { sessionId }: { sessionId: string }) {
  const session = await ctx.db.get(sessionId, "documents");
  if (!isImportSession(session)) return null;
  await requireSocietyMembership(ctx, String(session.societyId));
  const records = (await ctx.db.query("documents").withIndex("by_import_session", (q) => q.eq("importSessionId", sessionId)).collect())
    .filter(isImportRecord)
    .map(hydrateRecord)
    .filter((record: any) => String(record.sessionId) === sessionId);
  const { linkedDocuments, gaps } = await sessionReferences(ctx, String(session.societyId), sessionId);
  const applied = records.filter((record: any) => Object.values(record.importedTargets ?? {}).some(Boolean)).length;
  return {
    name: hydrateSession(session).name ?? session.title,
    records: records.length,
    pending: records.filter((record: any) => record.status === "Pending").length,
    approved: records.filter((record: any) => record.status === "Approved").length,
    rejected: records.filter((record: any) => record.status === "Rejected").length,
    applied,
    linkedDocuments: linkedDocuments.length,
    gaps: gaps.length,
  };
}

export async function pendingByTargetPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const { items } = await loadQueue(ctx, societyId);
  const byTarget = new Map<string, number>();
  const byKind = new Map<string, number>();
  const approvedByTarget = new Map<string, number>();
  const approvedByKind = new Map<string, number>();
  for (const item of items) {
    if (item.status === "Pending") {
      countInto(byTarget, item.targetModule);
      countInto(byKind, item.recordKind);
    } else if (item.status === "Approved" && !Object.values(item.importedTargets ?? {}).some(Boolean)) {
      // Approved but never applied: the register still looks empty.
      countInto(approvedByTarget, item.targetModule);
      countInto(approvedByKind, item.recordKind);
    }
  }
  return {
    byTarget: Object.fromEntries(byTarget),
    byKind: Object.fromEntries(byKind),
    pending: [...byTarget.values()].reduce((sum, count) => sum + count, 0),
    approvedByTarget: Object.fromEntries(approvedByTarget),
    approvedByKind: Object.fromEntries(approvedByKind),
  };
}
