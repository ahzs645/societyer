/**
 * PORTABLE FUNCTIONS: the effective-dated corporate NAME history domain
 * (list / asOf / narrative / upsert / remove).
 *
 * Reads/writes the `societyNameHistory` table over `ctx.db`. Each handler runs
 * unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle. All reconstruction logic lives in the pure, unit-tested shared module
 * (shared/nameHistory.ts); these handlers are thin load-and-delegate wrappers
 * that map rows into plain NameRecord objects before delegating.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import {
  nameAsOf,
  currentName,
  nameTimeline,
  nameChangeNarrative,
  type NameRecord,
} from "../nameHistory";

function toNameRecord(row: Record<string, any>): NameRecord {
  return {
    name: String(row.name ?? ""),
    shortName: row.shortName == null ? undefined : String(row.shortName),
    startISO: String(row.startISO ?? ""),
    regPosn: typeof row.regPosn === "number" ? row.regPosn : undefined,
  };
}

/** Full name timeline (sorted by startISO, tie-broken by regPosn). */
export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const rows = await ctx.db
    .query("societyNameHistory")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const records = rows.map(toNameRecord);
  return nameTimeline(records);
}

/** The legal name in effect on a specific ISO date. */
export async function asOfPortable(ctx: PortableQueryCtx, { societyId, asOf }: { societyId: string; asOf: string }) {
  const rows = await ctx.db
    .query("societyNameHistory")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const records = rows.map(toNameRecord);
  return nameAsOf(records, asOf);
}

/** Human-readable summary of the society's name-change history. */
export async function narrativePortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const rows = await ctx.db
    .query("societyNameHistory")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const records = rows.map(toNameRecord);
  return nameChangeNarrative(records);
}

/** Create a new name record or patch an existing one. Returns the id. */
export async function upsertPortable(
  ctx: PortableMutationCtx,
  args: {
    id?: string;
    societyId: string;
    name: string;
    shortName?: string;
    startISO: string;
    regPosn?: number;
    nowISO: string;
  },
) {
  const { id, societyId, name, shortName, startISO, regPosn, nowISO } = args;
  if (id) {
    await ctx.db.patch(id, { name, shortName, startISO, regPosn });
    return id;
  }
  return ctx.db.insert("societyNameHistory", {
    societyId,
    name,
    shortName,
    startISO,
    regPosn,
    createdAtISO: nowISO,
  });
}

/** Delete a name record. */
export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }): Promise<void> {
  await ctx.db.delete(id);
}

// `currentName` is re-used by callers needing the present-moment name without a
// separate query round-trip; referenced here to keep the import surface aligned
// with the shared module's public API.
void currentName;
