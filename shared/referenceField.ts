// Reference-field strict/free constraint helper (pure logic, framework-free).
//
// YCN "restrict to directory" idea: a reference field can be constrained to
// 'strict' (the value MUST resolve to an existing directory id) or left 'free'
// (any string is accepted, optionally linkable to a directory id when one
// happens to resolve). This module is framework-free and will later inform the
// src/modules/object-record FieldType wiring (not touched here).

export type ReferenceConstraint = "strict" | "free";

export interface ReferenceValue {
  /** The raw, human-entered text for the reference field. */
  raw: string;
  /** The directory id this reference points at, if any. */
  resolvedId?: string | null;
}

export interface ReferenceValidationResult {
  ok: boolean;
  error?: string;
  /** The cleaned-up value to persist. */
  normalized: ReferenceValue;
}

/**
 * Validate a reference value against its constraint.
 *
 * - strict: ok only when `resolvedId` is provided AND `exists(resolvedId)` is
 *   true. Otherwise the result is not ok and an error is supplied. The
 *   normalized value keeps the raw text and nulls out an unresolved id.
 * - free: always ok. A `resolvedId` is kept only when `exists(resolvedId)` is
 *   true; otherwise it is dropped to null while the raw text is preserved.
 */
export function validateReference(
  value: ReferenceValue,
  constraint: ReferenceConstraint,
  exists: (id: string) => boolean,
): ReferenceValidationResult {
  const raw = value.raw;
  const candidateId =
    value.resolvedId === undefined || value.resolvedId === null
      ? null
      : value.resolvedId;

  const resolvedExists = candidateId !== null && exists(candidateId);

  if (constraint === "strict") {
    if (candidateId === null) {
      return {
        ok: false,
        error: "Reference must resolve to an existing directory id.",
        normalized: { raw, resolvedId: null },
      };
    }
    if (!resolvedExists) {
      return {
        ok: false,
        error: `Reference id "${candidateId}" does not resolve to an existing directory entry.`,
        normalized: { raw, resolvedId: null },
      };
    }
    return {
      ok: true,
      normalized: { raw, resolvedId: candidateId },
    };
  }

  // constraint === "free": any raw string is allowed. Keep the id only if it
  // resolves, otherwise drop it to null while preserving the raw text.
  return {
    ok: true,
    normalized: { raw, resolvedId: resolvedExists ? candidateId : null },
  };
}

/**
 * Convenience wrapper that builds a ReferenceValue from raw text plus a
 * candidate id and validates it in one call.
 */
export function normalizeReferenceInput(
  raw: string,
  candidateId: string | null,
  constraint: ReferenceConstraint,
  exists: (id: string) => boolean,
): ReferenceValidationResult {
  return validateReference({ raw, resolvedId: candidateId }, constraint, exists);
}
