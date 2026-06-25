/**
 * Person-reference enforcement (pure logic).
 *
 * Bridges a society's `restrictPeoplePicker` setting (YCN
 * CORP_SETTINGS.RESTRICT_PEOPLE_YND) to the generic strict/free reference-field
 * constraint in shared/referenceField.ts. When the setting is on, every person
 * field (director/officer/signer) must resolve to a real People Directory record
 * rather than free-text — closing the typo / duplicate-entry gap.
 *
 * Framework-free: the caller supplies an `exists(id)` predicate (a Convex
 * mutation pre-resolves the candidate via ctx.db.get).
 */

import { validateReference, type ReferenceConstraint } from "./referenceField";

/** Map the per-society setting to a reference constraint. Defaults to free. */
export function personReferenceConstraint(restrictPeoplePicker?: boolean | null): ReferenceConstraint {
  return restrictPeoplePicker ? "strict" : "free";
}

export interface PersonReferenceInput {
  /** Human-entered name (free text). */
  name: string;
  /** The directory id the user picked, if any. */
  directoryPersonId?: string | null;
}

export interface PersonReferenceResult {
  ok: boolean;
  error?: string;
  /** The id to persist: kept when it resolves, else null. */
  directoryPersonId: string | null;
}

/**
 * Validate a person reference against the society's constraint.
 *
 * - strict: a resolving `directoryPersonId` is required; otherwise not ok.
 * - free: always ok; an unresolved id is dropped to null, the name is kept.
 */
export function validatePersonReference(
  input: PersonReferenceInput,
  constraint: ReferenceConstraint,
  exists: (id: string) => boolean,
): PersonReferenceResult {
  const result = validateReference(
    { raw: input.name, resolvedId: input.directoryPersonId ?? null },
    constraint,
    exists,
  );
  return {
    ok: result.ok,
    error: result.error,
    directoryPersonId: result.normalized.resolvedId ?? null,
  };
}
