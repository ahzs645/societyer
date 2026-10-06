import assert from "node:assert/strict";
import { sourceSystemFromExternalId, sourceSystemLabel, sourceSystemTag } from "../shared/functions/importSessionHelpers/importSessionUtils";
import { sourceSystem } from "../shared/functions/importSessionHelpers/importSessionRecordKinds";

for (const prefix of ["gdrive", "google-drive", "drive"]) {
  assert.equal(sourceSystemFromExternalId(`${prefix}:example`), "google-drive");
  assert.equal(sourceSystemLabel(prefix), "Google Drive");
  assert.equal(sourceSystemTag(prefix), "google-drive");
}
assert.equal(sourceSystem({ metadata: { sourceSystem: "google-drive", createdFrom: "archive batch" } }), "google-drive");
assert.equal(sourceSystemFromExternalId("paperless:123"), "paperless");
assert.equal(sourceSystemFromExternalId("onedrive:abc"), "onedrive");
assert.equal(sourceSystemFromExternalId("local:sha256:abc"), "local");
console.log("Drive provenance checks passed.");
