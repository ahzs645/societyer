import assert from "node:assert/strict";

import {
  personReferenceConstraint,
  validatePersonReference,
} from "../shared/personReference";

// Setting → constraint mapping (defaults to free).
assert.equal(personReferenceConstraint(true), "strict");
assert.equal(personReferenceConstraint(false), "free");
assert.equal(personReferenceConstraint(undefined), "free");
assert.equal(personReferenceConstraint(null), "free");

const existing = new Set(["dir1", "dir2"]);
const exists = (id: string) => existing.has(id);

// --- free mode: anything goes; unresolved ids are dropped ---
{
  const noId = validatePersonReference({ name: "Jane Doe" }, "free", exists);
  assert.equal(noId.ok, true);
  assert.equal(noId.directoryPersonId, null);

  const badId = validatePersonReference({ name: "Jane", directoryPersonId: "ghost" }, "free", exists);
  assert.equal(badId.ok, true, "free mode never blocks");
  assert.equal(badId.directoryPersonId, null, "unresolved id dropped");

  const goodId = validatePersonReference({ name: "Jane", directoryPersonId: "dir1" }, "free", exists);
  assert.equal(goodId.ok, true);
  assert.equal(goodId.directoryPersonId, "dir1", "resolving id kept");
}

// --- strict mode: a resolving directory id is required ---
{
  const noId = validatePersonReference({ name: "Jane Doe" }, "strict", exists);
  assert.equal(noId.ok, false, "free text rejected in strict mode");
  assert.ok(noId.error);
  assert.equal(noId.directoryPersonId, null);

  const badId = validatePersonReference({ name: "Jane", directoryPersonId: "ghost" }, "strict", exists);
  assert.equal(badId.ok, false, "unresolved id rejected in strict mode");
  assert.ok(badId.error);

  const goodId = validatePersonReference({ name: "Jane", directoryPersonId: "dir2" }, "strict", exists);
  assert.equal(goodId.ok, true);
  assert.equal(goodId.directoryPersonId, "dir2");
}

console.log("OK person-reference");
