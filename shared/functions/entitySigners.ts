/**
 * PORTABLE FUNCTIONS: the entity-signers domain
 * (list / activeAsOf / upsert / remove).
 *
 * Thin persistence/query wrapper for the `entitySigners` table over `ctx.db`.
 * Signers record their validity as a `validFromISO`/`validToISO` interval, so
 * point-in-time reconstruction delegates to the pure, unit-tested `activeAsOf`
 * helper in shared/registerHistory.ts (with the interval field names remapped).
 * Each handler runs unchanged on hosted Convex, the local Dexie runtime, and the
 * convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { activeAsOf, type IntervalRow } from "../registerHistory";
import {
  personReferenceConstraint,
  validatePersonReference,
} from "../personReference";

/** Sort comparator: ascending signOrder, undefined/null last. */
function bySignOrder(a: any, b: any) {
  const av = typeof a.signOrder === "number" ? a.signOrder : Infinity;
  const bv = typeof b.signOrder === "number" ? b.signOrder : Infinity;
  return av - bv;
}

/**
 * Validate a person reference and return the directoryPersonId to persist.
 *
 * - strict societies (restrictPeoplePicker on): a directoryPersonId that resolves
 *   to an existing directory record is required, else this throws.
 * - free societies: returns the id when it resolves, otherwise undefined.
 */
async function enforcePersonReference(
  ctx: PortableMutationCtx,
  societyId: any,
  name: string,
  directoryPersonId: any,
): Promise<any> {
  const society = await ctx.db.get(societyId);
  const constraint = personReferenceConstraint(society?.restrictPeoplePicker);
  const candidate = directoryPersonId ? String(directoryPersonId) : null;

  let exists = false;
  if (candidate) {
    const person = await ctx.db.get(directoryPersonId);
    exists = person != null;
  }

  const result = validatePersonReference(
    { name, directoryPersonId: candidate },
    constraint,
    (id) => id === candidate && exists,
  );
  if (!result.ok) {
    throw new Error(
      result.error ?? "This society requires people to be selected from the directory.",
    );
  }
  return result.directoryPersonId ? directoryPersonId : undefined;
}

/** All signers for a society, ordered by signOrder ascending (undefined last). */
export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const rows = await ctx.db
    .query("entitySigners")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  return [...rows].sort(bySignOrder);
}

/** Signers whose validity interval covers a specific ISO date, ordered by signOrder. */
export async function activeAsOfQueryPortable(
  ctx: PortableQueryCtx,
  { societyId, asOf }: { societyId: string; asOf: string },
) {
  const rows = await ctx.db
    .query("entitySigners")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const active = activeAsOf(rows as unknown as IntervalRow[], asOf, {
    start: "validFromISO",
    end: "validToISO",
  });
  return [...(active as Array<{ signOrder?: unknown }>)].sort(bySignOrder);
}

/** Create or update a signer. Patches when `id` is given, otherwise inserts. */
export async function upsertPortable(
  ctx: PortableMutationCtx,
  args: {
    id?: string;
    societyId: string;
    directoryPersonId?: string;
    name: string;
    signOrder?: number;
    validFromISO?: string;
    validToISO?: string;
    corpSign?: string;
    nowISO: string;
  },
) {
  const {
    id,
    societyId,
    directoryPersonId,
    name,
    signOrder,
    validFromISO,
    validToISO,
    corpSign,
    nowISO,
  } = args;
  // Enforce the society's People Directory constraint (free unless restricted).
  const resolvedDirectoryPersonId = await enforcePersonReference(
    ctx,
    societyId,
    name,
    directoryPersonId,
  );
  const fields = {
    societyId,
    directoryPersonId: resolvedDirectoryPersonId,
    name,
    signOrder,
    validFromISO,
    validToISO,
    corpSign,
  };
  if (id) {
    await ctx.db.patch(id, fields);
    return id;
  }
  return ctx.db.insert("entitySigners", { ...fields, createdAtISO: nowISO });
}

/** Delete a signer. */
export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  await ctx.db.delete(id);
}
