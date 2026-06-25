import assert from "node:assert/strict";

import {
  normalizeReferenceInput,
  validateReference,
} from "../shared/referenceField";

const directory = new Set<string>(["dir_alice", "dir_bob"]);
const exists = (id: string): boolean => directory.has(id);

// strict + valid resolvedId that exists -> ok, id kept.
{
  const result = validateReference(
    { raw: "Alice", resolvedId: "dir_alice" },
    "strict",
    exists,
  );
  assert.equal(result.ok, true);
  assert.equal(result.error, undefined);
  assert.equal(result.normalized.raw, "Alice");
  assert.equal(result.normalized.resolvedId, "dir_alice");
}

// strict + missing id -> !ok with error.
{
  const result = validateReference({ raw: "Nobody" }, "strict", exists);
  assert.equal(result.ok, false);
  assert.ok(typeof result.error === "string" && result.error.length > 0);
  assert.equal(result.normalized.resolvedId, null);
  assert.equal(result.normalized.raw, "Nobody");
}

// strict + unknown id -> !ok with error, id nulled.
{
  const result = validateReference(
    { raw: "Ghost", resolvedId: "dir_ghost" },
    "strict",
    exists,
  );
  assert.equal(result.ok, false);
  assert.ok(typeof result.error === "string" && result.error.length > 0);
  assert.equal(result.normalized.resolvedId, null);
  assert.equal(result.normalized.raw, "Ghost");
}

// free + arbitrary raw, no id -> ok with resolvedId null.
{
  const result = validateReference({ raw: "some free text" }, "free", exists);
  assert.equal(result.ok, true);
  assert.equal(result.normalized.resolvedId, null);
  assert.equal(result.normalized.raw, "some free text");
}

// free + unknown id -> ok, id dropped to null, raw kept.
{
  const result = validateReference(
    { raw: "Mystery", resolvedId: "dir_ghost" },
    "free",
    exists,
  );
  assert.equal(result.ok, true);
  assert.equal(result.normalized.resolvedId, null);
  assert.equal(result.normalized.raw, "Mystery");
}

// free + valid id -> ok with resolvedId kept.
{
  const result = validateReference(
    { raw: "Bob", resolvedId: "dir_bob" },
    "free",
    exists,
  );
  assert.equal(result.ok, true);
  assert.equal(result.normalized.resolvedId, "dir_bob");
  assert.equal(result.normalized.raw, "Bob");
}

// normalizeReferenceInput convenience wrapper: strict valid.
{
  const result = normalizeReferenceInput("Alice", "dir_alice", "strict", exists);
  assert.equal(result.ok, true);
  assert.equal(result.normalized.resolvedId, "dir_alice");
}

// normalizeReferenceInput convenience wrapper: strict invalid (null candidate).
{
  const result = normalizeReferenceInput("Alice", null, "strict", exists);
  assert.equal(result.ok, false);
  assert.equal(result.normalized.resolvedId, null);
}

// normalizeReferenceInput convenience wrapper: free with null candidate.
{
  const result = normalizeReferenceInput("freeform", null, "free", exists);
  assert.equal(result.ok, true);
  assert.equal(result.normalized.resolvedId, null);
  assert.equal(result.normalized.raw, "freeform");
}

console.log("OK reference-field-constraint");
