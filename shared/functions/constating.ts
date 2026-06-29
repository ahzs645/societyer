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
import {
  constatingTimeline,
  currentRegime as computeCurrentRegime,
  regimeNarrative,
  validateConstatingEvent,
  type ConstatingEvent,
} from "../constating";

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
  const rows = await ctx.db
    .query("constatingEvents")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const events = rows.map(toConstatingEvent);
  return constatingTimeline(events);
}

/** The governing Act as of a given ISO date (null when none has taken effect). */
export async function currentRegimePortable(
  ctx: PortableQueryCtx,
  { societyId, asOf }: { societyId: string; asOf: string },
) {
  const rows = await ctx.db
    .query("constatingEvents")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const events = rows.map(toConstatingEvent);
  return computeCurrentRegime(events, asOf);
}

/** Human-readable narrative of the constating chain. */
export async function narrativePortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
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
  }: {
    societyId: string;
    action: string;
    jurisdiction: string;
    legislation: string;
    regNumber?: string;
    startISO: string;
    nowISO: string;
  },
) {
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
  return ctx.db.insert("constatingEvents", {
    societyId,
    action,
    jurisdiction,
    legislation,
    regNumber,
    startISO,
    createdAtISO: nowISO,
  });
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  await ctx.db.delete(id);
}
