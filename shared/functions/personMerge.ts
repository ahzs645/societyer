/**
 * PORTABLE FUNCTIONS: people-directory identity maintenance (WP-H).
 *
 * - P7  duplicateSuggestions / dismissDuplicate / mergePeople / unmergePeople / mergeHistory
 * - P8  repairOrphanedEvents (history events lost by earlier re-links)
 * - P10 splitOccurrence / createPersonFromOccurrence
 *
 * A merge repoints every reference to the duplicate profile (source
 * occurrences, history events, contact points, attendance, motions, tasks,
 * committee and role registers, minutes and seat observations), keeps the
 * duplicate as a tombstone (`mergedIntoId`) and records each repointed path in
 * `personMerges.moves`, so `unmergePeople` restores exactly what moved.
 * All functions are scoped to one society and require members:write (writes)
 * plus write access to every register they change.
 */
import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned } from "./access";
import { requirePermissionPortable, type Permission } from "./permissions";
import { normalizeSearchName } from "../peopleDirectory";
import { suggestDuplicatePeople, type MatchablePerson } from "../personMatching";
import { PERSON_RECORD_PERMISSIONS } from "../personHistory";

const now = () => new Date().toISOString();

/** Tables holding people-directory references, with the write permission a move needs. */
export const PERSON_REFERENCE_TABLES: Record<string, Permission> = {
  personOccurrences: "members:write",
  personHistoryEvents: "members:write",
  personContactPoints: "members:write",
  members: "members:write",
  organizationSeats: "members:write",
  directors: "directors:write",
  signingAuthorities: "directors:write",
  roleHolders: "members:write",
  entitySigners: "documents:write",
  committeeMembers: "committees:write",
  meetingAttendanceRecords: "meetings:write",
  minutes: "minutes:write",
  motions: "motions:write",
  tasks: "tasks:write",
  conflicts: "conflicts:write",
};
const PERSON_KEYS = new Set(["personId", "directoryPersonId", "assigneePersonId", "movedByPersonId", "secondedByPersonId"]);
const SKIP_KEYS = new Set(["_id", "_creationTime", "societyId", "reviewHistory", "aliasEvidence"]);

type Path = Array<string | number>;

/** Every path (from the document root) whose value is a person reference equal to `id`. */
export function personReferencePaths(doc: any, id: string): Path[] {
  const found: Path[] = [];
  const walk = (value: any, path: Path) => {
    if (Array.isArray(value)) { value.forEach((item, index) => walk(item, [...path, index])); return; }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (path.length === 0 && SKIP_KEYS.has(key)) continue;
      if (PERSON_KEYS.has(key) && child === id) found.push([...path, key]);
      else if (child && typeof child === "object") walk(child, [...path, key]);
    }
  };
  walk(doc, []);
  return found;
}

/** Returns a patch object (top-level fields) with each path set to `to` when it currently equals `from`. */
export function repointPaths(doc: any, paths: Path[], from: string, to: string) {
  const patch: Record<string, any> = {};
  let changed = 0;
  for (const path of paths) {
    const field = String(path[0]);
    if (!(field in patch)) patch[field] = doc[field] === undefined ? undefined : JSON.parse(JSON.stringify(doc[field]));
    if (path.length === 1) {
      if (patch[field] === from) { patch[field] = to; changed++; }
      continue;
    }
    let cursor = patch[field];
    for (const step of path.slice(1, -1)) cursor = cursor?.[step as any];
    const last = path[path.length - 1];
    if (cursor && cursor[last as any] === from) { cursor[last as any] = to; changed++; }
  }
  return { patch, changed };
}

async function societyRows(ctx: PortableQueryCtx, table: string, societyId: string) {
  return ctx.db.query(table).withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
}

async function canRead(ctx: PortableQueryCtx, societyId: string, permission: Permission) {
  try { await requirePermissionPortable(ctx, societyId, permission); return true; }
  catch (e) { if (e instanceof Error && /^(Permission|Service scope) .* required\.$/.test(e.message)) return false; throw e; }
}

/** A directory person this workspace may link to: owned rows, or unowned legacy rows in the trusted local runtime. Merged tombstones are refused. */
export async function requireLinkablePerson(ctx: PortableQueryCtx, id: string, societyId: string, { allowMerged = true }: { allowMerged?: boolean } = {}) {
  const row = await ownedPerson(ctx, id, societyId);
  if (!allowMerged && row.mergedIntoId) throw new Error("That profile was merged. Choose the surviving profile.");
  return row;
}

async function ownedPerson(ctx: PortableQueryCtx, id: string, societyId: string) {
  const row = await ctx.db.get(id, "peopleDirectory");
  // Workspace-owned rows, plus unowned legacy contacts the trusted local runtime reuses.
  if (!row || (row.societyId && row.societyId !== societyId)) throw new Error("Directory person not found.");
  if (!row.societyId && !(ctx.principal.kind === "user" && ctx.principal.assurance === "trusted-workspace" && ctx.principal.runtime !== "convex-hosted")) throw new Error("Directory person not found.");
  return row;
}

/* ------------------------------ suggestions ------------------------------ */

export async function duplicateSuggestions(ctx: PortableQueryCtx, { societyId, minScore }: { societyId: string; minScore?: number }) {
  await requirePermissionPortable(ctx, societyId, "members:read");
  const people = (await societyRows(ctx, "peopleDirectory", societyId)).filter((row) => !row.mergedIntoId);
  const occurrences = await societyRows(ctx, "personOccurrences", societyId);
  const readable = new Map<string, boolean>();
  const stats = new Map<string, { meetings: Set<string>; dates: string[]; count: number }>();
  for (const o of occurrences) {
    if (!o.personId || ["not_person", "rejected"].includes(o.matchStatus)) continue;
    const resource = PERSON_RECORD_PERMISSIONS[o.recordTable];
    if (!resource) continue;
    if (!readable.has(resource)) readable.set(resource, await canRead(ctx, societyId, `${resource}:read` as Permission));
    if (!readable.get(resource)) continue;
    const s = stats.get(o.personId) ?? { meetings: new Set<string>(), dates: [], count: 0 };
    if (o.meetingId) s.meetings.add(String(o.meetingId));
    if (o.observedDate) s.dates.push(o.observedDate);
    s.count++;
    stats.set(o.personId, s);
  }
  const matchable: MatchablePerson[] = people.map((p) => {
    const s = stats.get(p._id);
    const dates = (s?.dates ?? []).sort();
    return { id: p._id, fullName: p.fullName, aliases: p.aliases, meetingIds: [...(s?.meetings ?? [])], firstObserved: dates[0], lastObserved: dates.at(-1), occurrenceCount: s?.count ?? 0, distinctFromIds: p.distinctFromIds };
  });
  const counts = new Map(matchable.map((p) => [p.id, p]));
  return suggestDuplicatePeople(matchable, { minScore: minScore ?? 35 }).map((s) => ({
    ...s,
    occurrences: s.ids.map((id) => counts.get(id)?.occurrenceCount ?? 0),
    observed: s.ids.map((id) => { const p = counts.get(id); return p?.firstObserved ? `${p.firstObserved.slice(0, 4)}–${(p.lastObserved ?? p.firstObserved).slice(0, 4)}` : "no dated observations"; }),
  }));
}

export async function dismissDuplicate(ctx: PortableMutationCtx, args: { societyId: string; personIds: string[]; rationale: string }) {
  await requirePermissionPortable(ctx, args.societyId, "members:write");
  if (args.personIds.length !== 2 || args.personIds[0] === args.personIds[1]) throw new Error("Select two different profiles.");
  if (!args.rationale.trim()) throw new Error("Record why these are different people.");
  const [a, b] = await Promise.all(args.personIds.map((id) => ownedPerson(ctx, id, args.societyId)));
  await ctx.db.patch(a._id, { distinctFromIds: Array.from(new Set([...(a.distinctFromIds ?? []), b._id])), updatedAtISO: now() });
  await ctx.db.patch(b._id, { distinctFromIds: Array.from(new Set([...(b.distinctFromIds ?? []), a._id])), updatedAtISO: now() });
  await ctx.db.insert("activity", { societyId: args.societyId, actor: "You", entityType: "person", subjectId: a._id, entityId: a._id, action: "identity_distinct", summary: `Marked ${a.fullName} and ${b.fullName} as different people: ${args.rationale.trim()}`, createdAtISO: now() });
  return { ok: true };
}

/* --------------------------------- merge --------------------------------- */

export async function mergePeople(ctx: PortableMutationCtx, args: { societyId: string; survivorId: string; mergedIds: string[]; rationale: string; keepNameAsAlias?: boolean }) {
  const actor = await requirePermissionPortable(ctx, args.societyId, "members:write");
  if (!args.rationale.trim()) throw new Error("Record why these profiles are the same person.");
  const mergedIds = Array.from(new Set(args.mergedIds)).filter((id) => id !== args.survivorId);
  if (!mergedIds.length) throw new Error("Choose at least one other profile to merge into the survivor.");
  const survivor = await ownedPerson(ctx, args.survivorId, args.societyId);
  if (survivor.mergedIntoId) throw new Error("The surviving profile was itself merged. Choose its survivor instead.");
  const results: Array<{ mergeId: string; mergedId: string; moved: number }> = [];
  for (const mergedId of mergedIds) {
    const merged = await ownedPerson(ctx, mergedId, args.societyId);
    if (merged.mergedIntoId) throw new Error(`${merged.fullName} was already merged.`);
    const survivorNow = await ctx.db.get(args.survivorId, "peopleDirectory");
    if (!survivorNow) throw new Error("Directory person not found.");
    const moves: Array<{ table: string; id: string; paths: Path[] }> = [];
    for (const [table, permission] of Object.entries(PERSON_REFERENCE_TABLES)) {
      const rows = await societyRows(ctx, table, args.societyId);
      const touched = rows.map((row) => ({ row, paths: personReferencePaths(row, mergedId) })).filter((entry) => entry.paths.length);
      if (!touched.length) continue;
      await requirePermissionPortable(ctx, args.societyId, permission);
      for (const { row, paths } of touched) {
        const { patch } = repointPaths(row, paths, mergedId, args.survivorId);
        if (table === "personHistoryEvents") patch.reviewHistory = [...(row.reviewHistory ?? []), { kind: "person_merge", fromPersonId: mergedId, toPersonId: args.survivorId, rationale: args.rationale.trim(), reviewedAtISO: now(), reviewedByUserId: actor._id }];
        if (table === "personOccurrences") patch.reviewHistory = [...(row.reviewHistory ?? []), { kind: "person_merge", previous: { personId: mergedId, status: row.matchStatus }, personId: args.survivorId, status: row.matchStatus, rationale: `Profiles merged: ${args.rationale.trim()}`, reviewedAtISO: now(), reviewedByUserId: actor._id }];
        await ctx.db.patch(row._id, patch);
        moves.push({ table, id: row._id, paths });
      }
    }
    const aliasesBefore = survivorNow.aliases ?? [];
    const aliases = Array.from(new Set([...aliasesBefore, ...(args.keepNameAsAlias === false ? [] : [merged.fullName]), ...(merged.aliases ?? [])].filter((name) => name && normalizeSearchName(name) !== normalizeSearchName(survivorNow.fullName))));
    await ctx.db.patch(args.survivorId, { aliases, aliasEvidence: [...(survivorNow.aliasEvidence ?? []), { aliases: aliases.filter((a) => !aliasesBefore.includes(a)), sourceUrl: "", sourceReference: `Profile merge: ${args.rationale.trim()}`, reviewStatus: "verified", recordedAtISO: now() }], distinctFromIds: (survivorNow.distinctFromIds ?? []).filter((id: string) => id !== mergedId), updatedAtISO: now() });
    await ctx.db.patch(mergedId, { mergedIntoId: args.survivorId, mergedAtISO: now(), identityReviewStatus: "merged", updatedAtISO: now() });
    const mergeId = await ctx.db.insert("personMerges", {
      societyId: args.societyId, survivorId: args.survivorId, mergedId,
      survivorName: survivorNow.fullName, mergedName: merged.fullName, rationale: args.rationale.trim(),
      survivorBefore: { aliases: aliasesBefore, aliasEvidence: survivorNow.aliasEvidence ?? [], distinctFromIds: survivorNow.distinctFromIds ?? [] },
      mergedBefore: { identityReviewStatus: merged.identityReviewStatus ?? null },
      moves, status: "applied", createdAtISO: now(), createdByUserId: String(actor._id),
    });
    await ctx.db.insert("activity", { societyId: args.societyId, actor: "You", entityType: "person", subjectId: args.survivorId, entityId: args.survivorId, action: "merged", summary: `Merged ${merged.fullName} into ${survivorNow.fullName} (${moves.reduce((n, m) => n + m.paths.length, 0)} references moved)`, createdAtISO: now() });
    results.push({ mergeId, mergedId, moved: moves.reduce((n, m) => n + m.paths.length, 0) });
  }
  return { survivorId: args.survivorId, merges: results };
}

export async function unmergePeople(ctx: PortableMutationCtx, args: { societyId: string; mergeId: string; notes?: string }) {
  const actor = await requirePermissionPortable(ctx, args.societyId, "members:write");
  const merge = await getOwned(ctx, "personMerges", args.mergeId, args.societyId);
  if (merge.status !== "applied") throw new Error("This merge was already undone.");
  const merged = await ctx.db.get(merge.mergedId, "peopleDirectory");
  const survivor = await ctx.db.get(merge.survivorId, "peopleDirectory");
  if (!merged || !survivor) throw new Error("A profile in this merge no longer exists.");
  if (survivor.mergedIntoId) throw new Error(`Undo the later merge of ${survivor.fullName} first.`);
  let restored = 0, skipped = 0;
  for (const move of merge.moves as Array<{ table: string; id: string; paths: Path[] }>) {
    const row = await ctx.db.get(move.id, move.table);
    if (!row) { skipped += move.paths.length; continue; }
    await requirePermissionPortable(ctx, args.societyId, PERSON_REFERENCE_TABLES[move.table] ?? "members:write");
    const { patch, changed } = repointPaths(row, move.paths, merge.survivorId, merge.mergedId);
    restored += changed; skipped += move.paths.length - changed;
    if (!changed) continue;
    if (move.table === "personHistoryEvents" || move.table === "personOccurrences") patch.reviewHistory = [...(row.reviewHistory ?? []), { kind: "person_unmerge", previous: { personId: merge.survivorId, status: row.matchStatus }, personId: merge.mergedId, status: row.matchStatus, rationale: `Merge undone${args.notes ? `: ${args.notes}` : ""}`, reviewedAtISO: now(), reviewedByUserId: actor._id }];
    await ctx.db.patch(move.id, patch);
  }
  const before = merge.survivorBefore ?? {};
  const addedAliases = new Set([merged.fullName, ...(merged.aliases ?? [])]);
  const aliases = (survivor.aliases ?? []).filter((alias: string) => (before.aliases ?? []).includes(alias) || !addedAliases.has(alias));
  await ctx.db.patch(merge.survivorId, { aliases, distinctFromIds: before.distinctFromIds ?? survivor.distinctFromIds ?? [], updatedAtISO: now() });
  await ctx.db.patch(merge.mergedId, { mergedIntoId: undefined, mergedAtISO: undefined, identityReviewStatus: merge.mergedBefore?.identityReviewStatus ?? "pending", updatedAtISO: now() });
  await ctx.db.patch(args.mergeId, { status: "undone", undoneAtISO: now(), undoneByUserId: String(actor._id), ...(args.notes ? { undoNotes: args.notes } : {}) });
  await ctx.db.insert("activity", { societyId: args.societyId, actor: "You", entityType: "person", subjectId: merge.mergedId, entityId: merge.mergedId, action: "unmerged", summary: `Undid merge of ${merge.mergedName} into ${merge.survivorName} (${restored} references restored${skipped ? `, ${skipped} changed since and left in place` : ""})`, createdAtISO: now() });
  return { restored, skipped };
}

export async function mergeHistory(ctx: PortableQueryCtx, { societyId, personId }: { societyId: string; personId?: string }) {
  await requirePermissionPortable(ctx, societyId, "members:read");
  const rows = await societyRows(ctx, "personMerges", societyId);
  return rows
    .filter((row) => !personId || row.survivorId === personId || row.mergedId === personId)
    .sort((a, b) => b.createdAtISO.localeCompare(a.createdAtISO))
    .map(({ moves, survivorBefore: _s, mergedBefore: _m, ...row }) => ({ ...row, movedReferences: (moves as any[]).reduce((n, m) => n + m.paths.length, 0), movedByTable: Object.fromEntries((moves as any[]).reduce((map: Map<string, number>, m) => map.set(m.table, (map.get(m.table) ?? 0) + m.paths.length), new Map())) }));
}

/* ------------------------- P8: orphaned history events ------------------------- */

/** History events whose source occurrence now belongs to another person. */
export async function orphanedEvents(ctx: PortableQueryCtx, societyId: string) {
  const events = await societyRows(ctx, "personHistoryEvents", societyId);
  const contacts = await societyRows(ctx, "personContactPoints", societyId);
  const occurrences = new Map((await societyRows(ctx, "personOccurrences", societyId)).map((o) => [o._id, o]));
  const rows: Array<{ table: string; row: any; occurrence: any }> = [];
  for (const [table, list] of [["personHistoryEvents", events], ["personContactPoints", contacts]] as const) {
    for (const row of list) {
      const occurrence = row.sourceOccurrenceId ? occurrences.get(row.sourceOccurrenceId) : undefined;
      if (occurrence && occurrence.personId && occurrence.personId !== row.personId) rows.push({ table, row, occurrence });
    }
  }
  return rows;
}

export async function repairOrphanedEvents(ctx: PortableMutationCtx, args: { societyId: string; dryRun?: boolean }) {
  const actor = await requirePermissionPortable(ctx, args.societyId, "members:write");
  const found = await orphanedEvents(ctx, args.societyId);
  const examples = found.slice(0, 25).map(({ table, row, occurrence }) => ({ table, id: row._id, title: row.title ?? row.value, from: row.personId, to: occurrence.personId, occurrenceId: occurrence._id }));
  if (args.dryRun) return { dryRun: true, count: found.length, examples };
  for (const { table, row, occurrence } of found) {
    const entry = { kind: "relink_repair", fromPersonId: row.personId, toPersonId: occurrence.personId, rationale: "Moved with its source occurrence after an earlier re-link", reviewedAtISO: now(), reviewedByUserId: actor._id };
    await ctx.db.patch(row._id, { personId: occurrence.personId, ...(table === "personHistoryEvents" ? { reviewHistory: [...(row.reviewHistory ?? []), entry] } : {}) });
  }
  if (found.length) await ctx.db.insert("activity", { societyId: args.societyId, actor: "You", entityType: "person", subjectId: args.societyId, entityId: args.societyId, action: "relink_repair", summary: `Moved ${found.length} history entr${found.length === 1 ? "y" : "ies"} to the person their source occurrence is linked to`, createdAtISO: now() });
  return { dryRun: false, count: found.length, examples };
}

/* ------------------------ P10: split / create from fragment ------------------------ */

export async function splitOccurrence(ctx: PortableMutationCtx, args: { societyId: string; occurrenceId: string; parts: Array<{ personName: string; personId?: string; roleTitle?: string; affiliation?: string }>; rationale: string }) {
  const actor = await requirePermissionPortable(ctx, args.societyId, "members:write");
  const occurrence = await getOwned(ctx, "personOccurrences", args.occurrenceId, args.societyId);
  const resource = PERSON_RECORD_PERMISSIONS[occurrence.recordTable];
  if (!resource) throw new Error("Unsupported person record kind.");
  await requirePermissionPortable(ctx, args.societyId, `${resource}:read` as Permission);
  const parts = args.parts.map((part) => ({ ...part, personName: part.personName.trim() })).filter((part) => part.personName);
  if (!parts.length || !args.rationale.trim()) throw new Error("Name at least one person in the fragment and record the rationale.");
  const ids: string[] = [];
  for (const [index, part] of parts.entries()) {
    if (part.personId) await ownedPerson(ctx, part.personId, args.societyId);
    const occurrenceKey = `split:${occurrence._id}:${index}:${normalizeSearchName(part.personName)}`;
    const existing = (await ctx.db.query("personOccurrences").withIndex("by_key", (q) => q.eq("societyId", args.societyId).eq("occurrenceKey", occurrenceKey)).collect())[0];
    if (existing) { ids.push(existing._id); continue; }
    const fields = ["recordTable", "recordId", "context", "observedDate", "meetingId", "documentId", "sourceUrl", "sourceReference", "sourceExternalId", "notes"];
    const copied = Object.fromEntries(fields.filter((key) => occurrence[key] !== undefined).map((key) => [key, occurrence[key]]));
    ids.push(await ctx.db.insert("personOccurrences", {
      ...copied, societyId: args.societyId, occurrenceKey, personName: part.personName,
      ...(part.roleTitle ? { roleTitle: part.roleTitle } : {}), ...(part.affiliation ? { affiliation: part.affiliation } : {}),
      ...(part.personId ? { personId: part.personId } : {}), matchStatus: part.personId ? "suggested" : "unresolved",
      reviewHistory: [{ kind: "split", fromOccurrenceId: occurrence._id, sourceFragment: occurrence.personName, rationale: args.rationale.trim(), reviewedAtISO: now(), reviewedByUserId: actor._id }],
      createdAtISO: now(),
    }));
  }
  await ctx.db.patch(occurrence._id, { personId: undefined, matchStatus: "not_person", reviewHistory: [...occurrence.reviewHistory, { kind: "split", previous: { personId: occurrence.personId ?? null, status: occurrence.matchStatus }, status: "not_person", splitInto: ids, rationale: args.rationale.trim(), sourceUrl: occurrence.sourceUrl, sourceReference: occurrence.sourceReference, reviewStatus: "pending", reviewedAtISO: now(), reviewedByUserId: actor._id }] });
  return ids;
}

export async function createPersonFromOccurrence(ctx: PortableMutationCtx, args: { societyId: string; occurrenceId: string; fullName: string; rationale: string }) {
  const actor = await requirePermissionPortable(ctx, args.societyId, "members:write");
  const occurrence = await getOwned(ctx, "personOccurrences", args.occurrenceId, args.societyId);
  const fullName = args.fullName.trim();
  if (!fullName || !args.rationale.trim()) throw new Error("Enter the person's name and the rationale.");
  const same = (await societyRows(ctx, "peopleDirectory", args.societyId)).find((p) => !p.mergedIntoId && normalizeSearchName(p.fullName) === normalizeSearchName(fullName));
  if (same) throw new Error(`${same.fullName} already has a profile. Link the occurrence to it instead.`);
  const personId = await ctx.db.insert("peopleDirectory", { societyId: args.societyId, fullName, searchName: normalizeSearchName(fullName), isIndividual: true, identityReviewStatus: "pending", createdAtISO: now(), updatedAtISO: now() });
  await ctx.db.patch(occurrence._id, { personId, matchStatus: "suggested", reviewHistory: [...occurrence.reviewHistory, { kind: "create_person", previous: { personId: occurrence.personId ?? null, status: occurrence.matchStatus }, personId, status: "suggested", rationale: args.rationale.trim(), sourceUrl: occurrence.sourceUrl, sourceReference: occurrence.sourceReference, reviewStatus: "pending", reviewedAtISO: now(), reviewedByUserId: actor._id }] });
  return personId;
}
