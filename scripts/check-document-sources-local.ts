import assert from "node:assert/strict";
import { mock } from "node:test";
import { StaticConvexClient } from "../src/lib/staticConvexClient";
import { openDocumentFile, restoredDocumentFile, type OpenableDocument } from "../src/lib/documentOpen";
import { readDocumentPreview } from "../src/lib/documentPreview";

const credential = "synthetic-delegated-token-never-persist";
const client = new StaticConvexClient();
const network = mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network access"); });
try {
  const before = await client.exportLocalWorkspaceSnapshotAsync();
  for (const operation of ["browse", "link", "resolve"]) {
    await assert.rejects(client.action(`documentSources:${operation}`, {
      societyId: "society-demo", sourceId: "source-test", documentId: "document-test", accessToken: credential,
    }), (error: any) => error.code === "CAPABILITY_UNAVAILABLE" && /hosted workspace/.test(error.message));
  }
  const after = await client.exportLocalWorkspaceSnapshotAsync();
  assert.deepEqual(after.tables, before.tables, "unavailable connector actions do not persist local writes");
  assert.ok(!JSON.stringify(after).includes(credential), "the credential does not enter a workspace snapshot");

  const linked: OpenableDocument = {
    _id: "document-test", title: "Board record", url: "https://example.invalid/stale-link",
    storageId: "legacy-blob", latestVersionId: "legacy-version", sha256: "f".repeat(64),
    externalReference: { sourceId: "source-test", providerId: "microsoft-sharepoint", referenceId: "reference-test", mode: "latest" },
  };
  const access = {
    getDownloadTarget: async () => { throw new Error("Uploaded-version fallback must not run"); },
    getLegacyUrl: async () => { throw new Error("Legacy-storage fallback must not run"); },
  };
  assert.equal(await restoredDocumentFile(linked), undefined, "a linked file never substitutes restored local bytes");
  await assert.rejects(openDocumentFile(linked, access), /review page/);
  await assert.rejects(openDocumentFile({ ...linked, versionOnly: true }, access), /do not have stored file versions/);
  await assert.rejects(readDocumentPreview(linked, access, new AbortController().signal), /at its source/);
  await assert.rejects(openDocumentFile(linked, {
    ...access, getExternalTarget: async () => ({ url: "javascript:alert(1)" }),
  }), /unsupported document link/);
  assert.equal(network.mock.callCount(), 0, "unavailable local actions and external preview guards make no requests");
} finally {
  network.mock.restore();
  client.close();
}

console.log("document source local boundary: no dispatch, no credential persistence, no storage/URL fallback, and no preview fetch passed");
