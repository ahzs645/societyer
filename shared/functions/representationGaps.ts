/**
 * PORTABLE FUNCTIONS: representation gaps (system gaps, finding A14).
 *
 * A representation gap records a source detail the app cannot hold natively:
 * typed by information type (controlled list in `shared/gapCatalog.ts`) and
 * reason, linked to its source and to the record it affects, and triaged
 * through a small status lifecycle with a review history.
 *
 * Fed by: the import contract (`representationGaps` bundle key), import
 * preflight (`importBundlePreflightGaps`, recorded when a session is created
 * from a bundle), reviewer "can't represent" entries, and the backfill that
 * converts legacy untyped `sourceEvidence` "model evidence" rows.
 *
 * Runs unchanged on hosted Convex, the local Dexie runtime and the oracle.
 */

import type { PortableDoc, PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireSocietyMembership } from "./access";
import { requirePermissionPortable } from "./permissions";
import {
  classifyLegacySourceEvidence,
  GAP_STATUSES,
  infoTypeDefinition,
  isGapReason,
  isGapStatus,
  isLegacyUnsupportedEvidence,
  normalizeInfoType,
  type CommitteeHint,
  type GapStatus,
  type LegacySourceEvidence,
  type PreflightGapDraft,
} from "../gapCatalog";
import { importBundlePreflightGaps } from "../importBundlePreflight";

type GapRow = PortableDoc & {
  societyId: string;
  infoType: string;
  reason: string;
  status: string;
  reviewHistory: any[];
  affectedTable?: string;
  affectedId?: string;
  sourceEvidenceId?: string;
  dedupeKey?: string;
  observedDate?: string;
  bodyKey?: string;
};

export type GapLocator = {
  page?: string;
  section?: string;
  sheet?: string;
  cellRange?: string;
  lineRange?: string;
  blockIndex?: number;
  charStart?: number;
  charEnd?: number;
  path?: string;
  sha256?: string;
};

const MAX_EXCERPT = 2000;
const MAX_LIST = 2000;

function clean(value: unknown, max = 500): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? text.slice(0, max) : undefined;
}

function cleanLocator(value: any): GapLocator | undefined {
  if (!value || typeof value !== "object") return undefined;
  const locator: GapLocator = {};
  for (const key of ["page", "section", "sheet", "cellRange", "lineRange", "path", "sha256"] as const) {
    const text = value[key] === undefined || value[key] === null ? undefined : clean(String(value[key]), 300);
    if (text) locator[key] = text;
  }
  for (const key of ["blockIndex", "charStart", "charEnd"] as const) {
    if (typeof value[key] === "number" && Number.isFinite(value[key])) locator[key] = value[key];
  }
  return Object.keys(locator).length ? locator : undefined;
}

function cleanObservedDate(value: unknown): string | undefined {
  const text = clean(value, 40);
  if (!text) return undefined;
  const match = text.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  return match ? match[0] : undefined;
}

function assertStatus(status: unknown): asserts status is GapStatus {
  if (!isGapStatus(status)) throw new Error(`Unsupported gap status: ${String(status)}.`);
}

async function actorName(ctx: PortableQueryCtx, societyId: string) {
  try {
    const user = await requireSocietyMembership(ctx, societyId);
    return { actorUserId: String(user._id), actorName: typeof (user as any).displayName === "string" ? (user as any).displayName : undefined };
  } catch {
    return { actorUserId: undefined, actorName: undefined };
  }
}

/* ------------------------------- inserts --------------------------------- */

export type NewGapInput = {
  infoType: string;
  reason: string;
  status?: string;
  origin?: string;
  title?: string;
  sourceDocumentId?: string;
  sourceExternalId?: string;
  sourceTitle?: string;
  sourceEvidenceId?: string;
  locator?: GapLocator;
  excerpt?: string;
  observedDate?: string;
  bodyKey?: string;
  affectedTable?: string;
  affectedId?: string;
  proposedTargetTable?: string;
  proposedField?: string;
  proposedValue?: unknown;
  importSessionId?: string;
  importRecordId?: string;
  dedupeKey?: string;
  sensitivity?: string;
  notes?: string;
};

/** Validates and inserts one gap. Callers have already authorized the write. */
async function insertGap(ctx: PortableMutationCtx, societyId: string, input: NewGapInput, actor?: { actorUserId?: string; actorName?: string }) {
  const reason = isGapReason(input.reason) ? input.reason : "ambiguous_source";
  const status = input.status ?? "open";
  assertStatus(status);
  const nowISO = new Date().toISOString();
  const restricted = input.sensitivity === "restricted";
  const row: Record<string, unknown> = {
    societyId,
    infoType: normalizeInfoType(input.infoType),
    reason,
    status,
    origin: clean(input.origin, 40) ?? "manual",
    title: clean(input.title, 240),
    sourceDocumentId: input.sourceDocumentId || undefined,
    sourceExternalId: clean(input.sourceExternalId, 300),
    sourceTitle: clean(input.sourceTitle, 300),
    sourceEvidenceId: input.sourceEvidenceId || undefined,
    locator: cleanLocator(input.locator),
    excerpt: restricted ? undefined : clean(input.excerpt, MAX_EXCERPT),
    observedDate: cleanObservedDate(input.observedDate),
    bodyKey: clean(input.bodyKey, 120),
    affectedTable: clean(input.affectedTable, 80),
    affectedId: clean(input.affectedId, 120),
    proposedTargetTable: clean(input.proposedTargetTable, 80),
    proposedField: clean(input.proposedField, 120),
    proposedValue: restricted ? undefined : input.proposedValue,
    importSessionId: input.importSessionId || undefined,
    importRecordId: input.importRecordId || undefined,
    dedupeKey: clean(input.dedupeKey, 300),
    sensitivity: restricted ? "restricted" : undefined,
    reviewHistory: [{ atISO: nowISO, ...(actor?.actorUserId ? { actorUserId: actor.actorUserId } : {}), ...(actor?.actorName ? { actorName: actor.actorName } : {}), toStatus: status, note: clean(input.notes, 1000) ?? `Recorded (${clean(input.origin, 40) ?? "manual"})` }],
    createdAtISO: nowISO,
    updatedAtISO: nowISO,
  };
  for (const key of Object.keys(row)) if (row[key] === undefined) delete row[key];
  return ctx.db.insert("representationGaps", row);
}

async function existingDedupeKeys(ctx: PortableQueryCtx, societyId: string): Promise<Set<string>> {
  const rows = await ctx.db.query<GapRow>("representationGaps").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  return new Set(rows.map((row) => row.dedupeKey).filter((key): key is string => typeof key === "string"));
}

/**
 * Import-contract handler for the `representationGaps` bundle key. The import
 * promotion flow has already checked `representationGaps:importSection`.
 */
export async function insertRepresentationGapFromImport(
  ctx: PortableMutationCtx,
  societyId: string,
  payload: any,
  links: { importRecordId?: string; importSessionId?: string; sourceDocumentId?: string },
) {
  return insertGap(ctx, societyId, {
    infoType: payload?.infoType,
    reason: payload?.reason,
    status: isGapStatus(payload?.status) ? payload.status : "open",
    origin: clean(payload?.origin, 40) ?? "import",
    title: payload?.title,
    sourceDocumentId: links.sourceDocumentId,
    sourceExternalId: payload?.sourceExternalId ?? (Array.isArray(payload?.sourceExternalIds) ? payload.sourceExternalIds[0] : undefined),
    sourceTitle: payload?.sourceTitle,
    locator: payload?.locator,
    excerpt: payload?.excerpt,
    observedDate: payload?.observedDate,
    bodyKey: payload?.bodyKey,
    affectedTable: payload?.affectedTable,
    affectedId: payload?.affectedId,
    proposedTargetTable: payload?.proposedTargetTable ?? payload?.suggestedTarget?.split?.(".")[0],
    proposedField: payload?.proposedField ?? payload?.suggestedTarget?.split?.(".").slice(1).join(".") ?? undefined,
    proposedValue: payload?.proposedValue,
    importSessionId: links.importSessionId,
    importRecordId: links.importRecordId,
    dedupeKey: payload?.dedupeKey,
    sensitivity: payload?.sensitivity,
    notes: payload?.notes,
  });
}

/** Store preflight losses for a bundle (best effort; never blocks the import). */
export async function recordPreflightGapsForBundle(
  ctx: PortableMutationCtx,
  societyId: string,
  bundle: unknown,
  importSessionId?: string,
  limit = 500,
): Promise<number> {
  let drafts: PreflightGapDraft[];
  try {
    drafts = importBundlePreflightGaps(bundle);
  } catch {
    return 0;
  }
  if (!drafts.length) return 0;
  const seen = await existingDedupeKeys(ctx, societyId);
  let created = 0;
  for (const draft of drafts.slice(0, limit)) {
    const dedupeKey = `preflight:${importSessionId ?? "bundle"}:${draft.location}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    await insertGap(ctx, societyId, {
      infoType: draft.infoType,
      reason: draft.reason,
      origin: "preflight",
      title: draft.title,
      sourceExternalId: draft.sourceExternalId,
      locator: { path: draft.location },
      excerpt: draft.excerpt,
      proposedTargetTable: draft.proposedTargetTable,
      proposedField: draft.proposedField,
      proposedValue: draft.proposedValue,
      importSessionId,
      dedupeKey,
    });
    created += 1;
  }
  return created;
}

/* -------------------------------- queries -------------------------------- */

export async function listPortable(
  ctx: PortableQueryCtx,
  args: { societyId: string; status?: string; infoType?: string; reason?: string; limit?: number },
) {
  await requireSocietyMembership(ctx, args.societyId);
  let rows: GapRow[];
  if (args.infoType) {
    rows = await ctx.db.query<GapRow>("representationGaps").withIndex("by_society_info_type", (q) => q.eq("societyId", args.societyId).eq("infoType", args.infoType)).collect();
  } else if (args.status) {
    rows = await ctx.db.query<GapRow>("representationGaps").withIndex("by_society_status", (q) => q.eq("societyId", args.societyId).eq("status", args.status)).collect();
  } else {
    rows = await ctx.db.query<GapRow>("representationGaps").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).collect();
  }
  const filtered = rows.filter((row) => (!args.status || row.status === args.status) && (!args.reason || row.reason === args.reason));
  filtered.sort((a, b) => String(b.createdAtISO ?? "").localeCompare(String(a.createdAtISO ?? "")) || String(a._id).localeCompare(String(b._id)));
  const limit = Math.max(1, Math.min(args.limit ?? 200, MAX_LIST));
  return { total: filtered.length, rows: filtered.slice(0, limit) };
}

export async function getPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  const candidate = await ctx.db.get<GapRow>(id, "representationGaps");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("representationGaps not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  return getOwned(ctx, "representationGaps", id, candidate.societyId);
}

/** Backlog summary grouped by info type and reason, plus legacy backfill status. */
export async function summaryPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const [rows, evidence] = await Promise.all([
    ctx.db.query<GapRow>("representationGaps").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query<LegacySourceEvidence & PortableDoc>("sourceEvidence").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  const byStatus: Record<string, number> = Object.fromEntries(GAP_STATUSES.map((status) => [status, 0]));
  const groups = new Map<string, { infoType: string; label: string; area: string; suggestedTarget?: string; reason: string; total: number; byStatus: Record<string, number>; latestISO?: string; examples: { _id: string; title?: string; sourceTitle?: string }[] }>();
  const byArea = new Map<string, { area: string; total: number; open: number; keptAsText: number; resolved: number }>();
  const sessions = new Map<string, number>();
  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    const definition = infoTypeDefinition(row.infoType);
    const key = `${row.infoType}|${row.reason}`;
    const group = groups.get(key) ?? { infoType: row.infoType, label: definition.label, area: definition.area, suggestedTarget: definition.suggestedTarget, reason: row.reason, total: 0, byStatus: {}, examples: [] };
    group.total += 1;
    group.byStatus[row.status] = (group.byStatus[row.status] ?? 0) + 1;
    if (!group.latestISO || String(row.createdAtISO) > group.latestISO) group.latestISO = String(row.createdAtISO);
    if (group.examples.length < 3) group.examples.push({ _id: row._id, title: row.title, sourceTitle: row.sourceTitle });
    groups.set(key, group);
    const area = byArea.get(definition.area) ?? { area: definition.area, total: 0, open: 0, keptAsText: 0, resolved: 0 };
    area.total += 1;
    if (row.status === "open" || row.status === "schema_change_requested") area.open += 1;
    if (row.status === "kept_as_text") area.keptAsText += 1;
    if (row.status === "resolved_native") area.resolved += 1;
    byArea.set(definition.area, area);
    if (row.importSessionId) sessions.set(String(row.importSessionId), (sessions.get(String(row.importSessionId)) ?? 0) + 1);
  }
  const converted = new Set(rows.map((row) => row.sourceEvidenceId).filter(Boolean).map(String));
  const legacy = evidence.filter((row) => isLegacyUnsupportedEvidence(row));
  return {
    total: rows.length,
    byStatus,
    groups: [...groups.values()].sort((a, b) => (b.byStatus.open ?? 0) - (a.byStatus.open ?? 0) || b.total - a.total || a.infoType.localeCompare(b.infoType)),
    byArea: [...byArea.values()].sort((a, b) => b.total - a.total),
    byImportSession: [...sessions.entries()].map(([importSessionId, count]) => ({ importSessionId, count })),
    legacyEvidence: { total: legacy.length, converted: legacy.filter((row) => converted.has(String(row._id))).length },
  };
}

export async function forRecordPortable(
  ctx: PortableQueryCtx,
  { societyId, affectedTable, affectedId }: { societyId: string; affectedTable: string; affectedId: string },
) {
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query<GapRow>("representationGaps")
    .withIndex("by_affected", (q) => q.eq("societyId", societyId).eq("affectedTable", affectedTable).eq("affectedId", affectedId))
    .collect();
}

/** Counts for the "N unsupported details" badge. */
export async function countForRecordPortable(
  ctx: PortableQueryCtx,
  args: { societyId: string; affectedTable: string; affectedId: string },
) {
  const rows = await forRecordPortable(ctx, args);
  return {
    total: rows.length,
    open: rows.filter((row) => row.status === "open" || row.status === "schema_change_requested").length,
    keptAsText: rows.filter((row) => row.status === "kept_as_text").length,
  };
}

/* ------------------------------- mutations ------------------------------- */

export async function createPortable(
  ctx: PortableMutationCtx,
  args: NewGapInput & { societyId: string },
) {
  await requireSocietyMembership(ctx, args.societyId);
  if (args.sourceDocumentId) await getOwned(ctx, "documents", args.sourceDocumentId, args.societyId);
  if (args.affectedTable && args.affectedId) {
    const affected = await ctx.db.get(args.affectedId);
    if (!affected || String(affected.societyId ?? "") !== args.societyId) throw new Error("Affected record not found.");
  }
  if (!isGapReason(args.reason)) throw new Error(`Unsupported gap reason: ${String(args.reason)}.`);
  const { societyId, ...input } = args;
  return insertGap(ctx, societyId, { ...input, origin: input.origin ?? "reviewer" }, await actorName(ctx, societyId));
}

async function transition(
  ctx: PortableMutationCtx,
  row: GapRow,
  status: GapStatus,
  extra: { note?: string; resolvedTable?: string; resolvedId?: string },
  actor: { actorUserId?: string; actorName?: string },
) {
  const nowISO = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status,
    updatedAtISO: nowISO,
    reviewHistory: [
      ...(Array.isArray(row.reviewHistory) ? row.reviewHistory : []),
      {
        atISO: nowISO,
        ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
        ...(actor.actorName ? { actorName: actor.actorName } : {}),
        fromStatus: row.status,
        toStatus: status,
        ...(clean(extra.note, 1000) ? { note: clean(extra.note, 1000) } : {}),
      },
    ].slice(-50),
  };
  if (status === "resolved_native") {
    patch.resolvedTable = clean(extra.resolvedTable, 80);
    patch.resolvedId = clean(extra.resolvedId, 120);
  }
  if (extra.note) patch.resolutionNote = clean(extra.note, 1000);
  for (const key of Object.keys(patch)) if (patch[key] === undefined) delete patch[key];
  await ctx.db.patch(row._id, patch);
}

export async function setStatusPortable(
  ctx: PortableMutationCtx,
  args: { id: string; status: string; note?: string; resolvedTable?: string; resolvedId?: string },
) {
  const candidate = await ctx.db.get<GapRow>(args.id, "representationGaps");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("representationGaps not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  const row = await getOwned<GapRow>(ctx, "representationGaps", args.id, candidate.societyId);
  assertStatus(args.status);
  if (args.status === "resolved_native" && args.resolvedId) {
    const resolved = await ctx.db.get(args.resolvedId);
    if (!resolved || String(resolved.societyId ?? "") !== candidate.societyId) throw new Error("Resolved record not found.");
  }
  await transition(ctx, row, args.status, args, await actorName(ctx, candidate.societyId));
  return { ok: true };
}

/** Bulk triage: explicit ids, or every gap matching a group filter (capped). */
export async function bulkSetStatusPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; status: string; note?: string; ids?: string[]; infoType?: string; reason?: string; fromStatus?: string; limit?: number },
) {
  await requireSocietyMembership(ctx, args.societyId);
  assertStatus(args.status);
  if (args.status === "resolved_native") throw new Error("Resolve gaps natively one at a time so each links its native record.");
  const limit = Math.max(1, Math.min(args.limit ?? 1000, 2000));
  let rows: GapRow[];
  if (args.ids?.length) {
    rows = [];
    for (const id of args.ids.slice(0, limit)) rows.push(await getOwned<GapRow>(ctx, "representationGaps", id, args.societyId));
  } else {
    if (!args.infoType && !args.reason && !args.fromStatus) throw new Error("Select gaps or a group to update.");
    const all = await ctx.db.query<GapRow>("representationGaps").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).collect();
    rows = all.filter((row) => (!args.infoType || row.infoType === args.infoType) && (!args.reason || row.reason === args.reason) && (!args.fromStatus || row.status === args.fromStatus)).slice(0, limit);
  }
  const actor = await actorName(ctx, args.societyId);
  let updated = 0;
  for (const row of rows) {
    if (row.status === args.status) continue;
    await transition(ctx, row, args.status, { note: args.note }, actor);
    updated += 1;
  }
  return { updated, matched: rows.length };
}

export async function linkAffectedPortable(
  ctx: PortableMutationCtx,
  args: { id: string; affectedTable: string; affectedId: string },
) {
  const candidate = await ctx.db.get<GapRow>(args.id, "representationGaps");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("representationGaps not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  await getOwned(ctx, "representationGaps", args.id, candidate.societyId);
  const affected = await ctx.db.get(args.affectedId);
  if (!affected || String(affected.societyId ?? "") !== candidate.societyId) throw new Error("Affected record not found.");
  await ctx.db.patch(args.id, { affectedTable: clean(args.affectedTable, 80), affectedId: clean(args.affectedId, 120), updatedAtISO: new Date().toISOString() });
  return { ok: true };
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const candidate = await ctx.db.get<GapRow>(id, "representationGaps");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("representationGaps not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  await getOwned(ctx, "representationGaps", id, candidate.societyId);
  await ctx.db.delete(id);
  return { ok: true };
}

/** Record preflight losses for a bundle (e.g. before a scripted import). */
export async function recordPreflightPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; bundle: unknown; importSessionId?: string },
) {
  await requireSocietyMembership(ctx, args.societyId);
  if (args.importSessionId) await getOwned(ctx, "documents", args.importSessionId, args.societyId);
  const created = await recordPreflightGapsForBundle(ctx, args.societyId, args.bundle, args.importSessionId);
  return { created };
}

/**
 * Migration: convert legacy untyped `sourceEvidence` "model evidence" rows
 * (a source mapped to a model area with no target record) into typed gaps.
 * Idempotent (one gap per evidence row, keyed by `sourceEvidenceId`) and
 * batched so it stays under hosted mutation limits; call until `remaining` is 0.
 * The evidence rows are left untouched.
 */
export async function backfillFromSourceEvidencePortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; limit?: number },
) {
  await requireSocietyMembership(ctx, args.societyId);
  const limit = Math.max(1, Math.min(args.limit ?? 400, 1000));
  const [evidence, gaps, committees] = await Promise.all([
    ctx.db.query<LegacySourceEvidence & PortableDoc>("sourceEvidence").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).collect(),
    ctx.db.query<GapRow>("representationGaps").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).collect(),
    ctx.db.query("committees").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).collect(),
  ]);
  const converted = new Set(gaps.map((row) => row.sourceEvidenceId).filter(Boolean).map(String));
  const candidates = evidence.filter((row) => isLegacyUnsupportedEvidence(row) && !converted.has(String(row._id)));
  const hints: CommitteeHint[] = committees.map((row: any) => ({ _id: String(row._id), name: String(row.name ?? "") }));
  const batch = candidates.slice(0, limit);
  const byInfoType: Record<string, number> = {};
  for (const row of batch) {
    const draft = classifyLegacySourceEvidence(row, hints);
    await insertGap(ctx, args.societyId, {
      infoType: draft.infoType,
      reason: draft.reason,
      origin: "backfill",
      title: draft.title,
      sourceDocumentId: row.sourceDocumentId,
      sourceExternalId: row.externalId,
      sourceTitle: row.sourceTitle,
      sourceEvidenceId: String(row._id),
      excerpt: row.excerpt ? String(row.excerpt).slice(0, 600) : undefined,
      observedDate: draft.observedDate,
      bodyKey: draft.bodyKey,
      proposedTargetTable: draft.proposedTargetTable,
      dedupeKey: `legacy:${row._id}`,
      sensitivity: row.sensitivity,
      notes: `Converted from untyped source evidence (target area ${row.targetTable ?? "unknown"}).`,
    });
    byInfoType[draft.infoType] = (byInfoType[draft.infoType] ?? 0) + 1;
  }
  return { created: batch.length, remaining: candidates.length - batch.length, byInfoType };
}

/* ---------------------------- native coverage ---------------------------- */

type CoverageSource = { table: string; label: string; permission: string; count?: (rows: any[]) => number };

/** Native record families per gap area, each read only with its own read permission. */
const COVERAGE_AREAS: Record<string, CoverageSource[]> = {
  meetings: [
    { table: "meetings", label: "Meetings", permission: "meetings:read" },
    { table: "minutes", label: "Minutes", permission: "minutes:read" },
  ],
  motions: [{ table: "motions", label: "Motions", permission: "motions:read" }],
  people: [
    { table: "peopleDirectory", label: "People", permission: "members:read" },
    { table: "meetingAttendanceRecords", label: "Person-linked attendance", permission: "members:read", count: (rows) => rows.filter((row) => row.directoryPersonId || row.memberId || row.directorId).length },
    { table: "directors", label: "Directors", permission: "directors:read" },
    { table: "members", label: "Members", permission: "members:read" },
  ],
  committees: [
    { table: "committees", label: "Committees", permission: "committees:read" },
    { table: "committeeMembers", label: "Committee members", permission: "committees:read" },
  ],
  governance: [
    { table: "policies", label: "Policies", permission: "documents:read" },
    { table: "bylawAmendments", label: "Bylaw amendments", permission: "documents:read" },
    { table: "filings", label: "Filings", permission: "filings:read" },
  ],
  finance: [
    { table: "financials", label: "Official financial statements", permission: "financials:read" },
    { table: "financialStatementImports", label: "Imported statements", permission: "financials:read" },
    { table: "budgetSnapshots", label: "Budget snapshots", permission: "financials:read" },
    { table: "transactionCandidates", label: "Transaction candidates", permission: "financials:read" },
  ],
  insurance: [{ table: "insurancePolicies", label: "Insurance policies", permission: "financials:read" }],
  grants: [{ table: "grants", label: "Grants", permission: "grants:read" }],
  communications: [{ table: "communicationCampaigns", label: "Campaigns", permission: "communications:read" }],
  programs: [
    { table: "goals", label: "Goals", permission: "commitments:read" },
    { table: "commitments", label: "Commitments", permission: "commitments:read" },
  ],
  assets: [{ table: "assets", label: "Assets", permission: "financials:read" }],
  agreements: [],
  documents: [],
  other: [],
};

/**
 * Native coverage per area: native records ÷ (native + open + kept-as-text
 * gaps). Families the caller cannot read are reported as `null`, not zero.
 */
export async function coveragePortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const allowed = new Map<string, boolean>();
  const can = async (permission: string) => {
    if (!allowed.has(permission)) {
      try {
        await requirePermissionPortable(ctx, societyId, permission as any);
        allowed.set(permission, true);
      } catch (error) {
        if (error instanceof Error && /^(?:Permission|Service scope) [a-zA-Z]+:read required\.$/.test(error.message)) allowed.set(permission, false);
        else throw error;
      }
    }
    return allowed.get(permission)!;
  };
  const gaps = await ctx.db.query<GapRow>("representationGaps").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  const gapCounts = new Map<string, { open: number; keptAsText: number; resolved: number; total: number }>();
  for (const row of gaps) {
    const area = infoTypeDefinition(row.infoType).area;
    const entry = gapCounts.get(area) ?? { open: 0, keptAsText: 0, resolved: 0, total: 0 };
    entry.total += 1;
    if (row.status === "open" || row.status === "schema_change_requested") entry.open += 1;
    else if (row.status === "kept_as_text") entry.keptAsText += 1;
    else if (row.status === "resolved_native") entry.resolved += 1;
    gapCounts.set(area, entry);
  }
  const areas: { area: string; native: { table: string; label: string; count: number | null }[]; nativeTotal: number; gaps: { open: number; keptAsText: number; resolved: number; total: number }; coverage: number | null; partial: boolean }[] = [];
  for (const [area, sources] of Object.entries(COVERAGE_AREAS)) {
    const native: { table: string; label: string; count: number | null }[] = [];
    for (const source of sources) {
      if (!(await can(source.permission))) {
        native.push({ table: source.table, label: source.label, count: null });
        continue;
      }
      const rows = await ctx.db.query(source.table).withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
      native.push({ table: source.table, label: source.label, count: source.count ? source.count(rows) : rows.length });
    }
    const gapsForArea = gapCounts.get(area) ?? { open: 0, keptAsText: 0, resolved: 0, total: 0 };
    if (!native.length && !gapsForArea.total) continue;
    const nativeTotal = native.reduce((sum, item) => sum + (item.count ?? 0), 0);
    const denominator = nativeTotal + gapsForArea.open + gapsForArea.keptAsText;
    areas.push({
      area,
      native,
      nativeTotal,
      gaps: gapsForArea,
      coverage: denominator ? Math.round((nativeTotal / denominator) * 1000) / 10 : null,
      partial: native.some((item) => item.count === null),
    });
  }
  const nativeAll = areas.reduce((sum, area) => sum + area.nativeTotal, 0);
  const unresolvedAll = areas.reduce((sum, area) => sum + area.gaps.open + area.gaps.keptAsText, 0);
  return { areas, overall: nativeAll + unresolvedAll ? Math.round((nativeAll / (nativeAll + unresolvedAll)) * 1000) / 10 : null };
}

