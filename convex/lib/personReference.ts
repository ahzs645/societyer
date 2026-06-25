/**
 * Convex-side enforcement of the People Directory reference constraint.
 *
 * Reads the society's `restrictPeoplePicker` setting, resolves the candidate
 * directory id, and runs the pure validator (shared/personReference.ts). Used by
 * upsertRoleHolder and entitySigners.upsert so both stay thin.
 */

import {
  personReferenceConstraint,
  validatePersonReference,
} from "../../shared/personReference";

/**
 * Validate a person reference and return the directoryPersonId to persist.
 *
 * - strict societies (restrictPeoplePicker on): a directoryPersonId that resolves
 *   to an existing directory record is required, else this throws.
 * - free societies: returns the id when it resolves, otherwise undefined.
 */
export async function enforcePersonReference(
  ctx: any,
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
