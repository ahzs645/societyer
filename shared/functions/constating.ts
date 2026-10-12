/**
 * PORTABLE FUNCTIONS: the constating-document timeline domain
 * (list / currentRegime / narrative / create / remove).
 *
 * Reads/writes the `constatingEvents` table over `ctx.db`. Each handler runs
 * unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle. All ordering, as-of, narrative, and validation logic lives in the
 * pure, unit-tested shared module (shared/constating.ts); these handlers are
 * thin load-and-delegate wrappers that map rows into plain ConstatingEvent
 * objects.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireSocietyMembership } from "./access";
import { assertRegisterRowMayBeDeleted } from "../registerRetention";
import {
  constatingTimeline,
  currentRegime as computeCurrentRegime,
  regimeNarrative,
  validateConstatingEvent,
  type ConstatingEvent,
} from "../constating";

/** Linked constating documents (certificate, articles, order) and the end date. */
async function constatingEvidence(ctx: PortableMutationCtx, societyId: string, args: { endISO?: string | null; sourceDocumentIds?: string[]; startISO: string }) {
  const out: Record<string, unknown> = {};
  if (args.endISO !== undefined) {
    const end = args.endISO ? String(args.endISO).slice(0, 10) : undefined;
    if (end && !/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new Error("Enter the end date as a valid date.");
    if (end && end < String(args.startISO).slice(0, 10)) throw new Error("An event cannot end before it took effect.");
    out.endISO = end;
  }
  if (args.sourceDocumentIds !== undefined) {
    for (const documentId of args.sourceDocumentIds) await getOwned(ctx, "documents", documentId, societyId);
    out.sourceDocumentIds = args.sourceDocumentIds.length ? args.sourceDocumentIds : undefined;
  }
  return out;
}

/** Map a stored constatingEvents row into the plain shared ConstatingEvent shape. */
function toConstatingEvent(row: Record<string, any>): ConstatingEvent {
  return {
    action: row.action as ConstatingEvent["action"],
    jurisdiction: row.jurisdiction,
    legislation: row.legislation,
    regNumber: row.regNumber,
    startISO: row.startISO,
  };
}

/** Constating events for a society, sorted chronologically. */
export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const rows = await ctx.db
    .query("constatingEvents")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  // Keep each row's id so the page can edit and remove events (G-14).
  const events = rows.map((row) => ({ ...toConstatingEvent(row), _id: row._id, endISO: row.endISO, sourceDocumentIds: row.sourceDocumentIds }));
  return constatingTimeline(events) as Array<ConstatingEvent & { _id: string; endISO?: string; sourceDocumentIds?: string[] }>;
}

/** The governing Act as of a given ISO date (null when none has taken effect). */
export async function currentRegimePortable(
  ctx: PortableQueryCtx,
  { societyId, asOf }: { societyId: string; asOf: string },
) {
  await requireSocietyMembership(ctx, societyId);
  const rows = await ctx.db
    .query("constatingEvents")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const events = rows.map(toConstatingEvent);
  return computeCurrentRegime(events, asOf);
}

/** Human-readable narrative of the constating chain. */
export async function narrativePortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const rows = await ctx.db
    .query("constatingEvents")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const events = rows.map(toConstatingEvent);
  return regimeNarrative(events);
}

export async function createPortable(
  ctx: PortableMutationCtx,
  {
    societyId,
    action,
    jurisdiction,
    legislation,
    regNumber,
    startISO,
    nowISO,
    endISO,
    sourceDocumentIds,
  }: {
    societyId: string;
    action: string;
    jurisdiction: string;
    legislation: string;
    regNumber?: string;
    startISO: string;
    nowISO: string;
    endISO?: string | null;
    sourceDocumentIds?: string[];
  },
) {
  await requireSocietyMembership(ctx, societyId);
  const event: ConstatingEvent = {
    action: action as ConstatingEvent["action"],
    jurisdiction,
    legislation,
    regNumber,
    startISO,
  };
  const { ok, errors } = validateConstatingEvent(event);
  if (!ok) {
    throw new Error(errors.join("; "));
  }
  const evidence = await constatingEvidence(ctx, societyId, { endISO, sourceDocumentIds, startISO });
  return ctx.db.insert("constatingEvents", {
    societyId,
    action,
    jurisdiction,
    legislation,
    regNumber,
    startISO,
    ...evidence,
    createdAtISO: nowISO,
  });
}

/** Correct an existing constating event (same validation as create). */
export async function updatePortable(
  ctx: PortableMutationCtx,
  { id, action, jurisdiction, legislation, regNumber, startISO, endISO, sourceDocumentIds }: {
    id: string;
    action: string;
    jurisdiction: string;
    legislation: string;
    regNumber?: string;
    startISO: string;
    endISO?: string | null;
    sourceDocumentIds?: string[];
  },
) {
  const candidate = await ctx.db.get(id, "constatingEvents");
  if (!candidate) throw new Error("constatingEvents not found.");
  await requireSocietyMembership(ctx, String(candidate.societyId));
  await getOwned(ctx, "constatingEvents", id, String(candidate.societyId));
  const event: ConstatingEvent = {
    action: action as ConstatingEvent["action"],
    jurisdiction: jurisdiction.trim(),
    legislation: legislation.trim(),
    regNumber: regNumber?.trim() || undefined,
    startISO,
  };
  const { ok, errors } = validateConstatingEvent(event);
  if (!ok) throw new Error(errors.join("; "));
  const evidence = await constatingEvidence(ctx, String(candidate.societyId), { endISO, sourceDocumentIds, startISO });
  await ctx.db.patch(id, { ...event, ...evidence });
  return id;
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const candidate = await ctx.db.get(id, "constatingEvents");
  if (!candidate) return;
  await requireSocietyMembership(ctx, String(candidate.societyId));
  await getOwned(ctx, "constatingEvents", id, String(candidate.societyId));
  assertRegisterRowMayBeDeleted(await ctx.db.get(String(candidate.societyId)), "constatingEvents", candidate);
  await ctx.db.delete(id);
}
