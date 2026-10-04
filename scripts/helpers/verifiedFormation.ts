import type { StaticConvexClient } from "../../src/lib/staticConvex";

/** Synthetic local upload metadata for statutory tests; never used by the app. */
export async function verifyFixtureFormation(client: StaticConvexClient, societyId: string, certificateDate: string) {
  const certificateId = await client.mutation("documents:create", { societyId, title: "Synthetic official certificate fixture", category: "governance", fileName: "synthetic-certificate.pdf", mimeType: "application/pdf", tags: ["certificate", "test_fixture"] });
  await client.mutation("documentVersions:recordUploadedVersion", { societyId, documentId: certificateId, storageProvider: "local-filesystem", storageKey: `test-fixtures/${societyId}/synthetic-certificate.pdf`, fileName: "synthetic-certificate.pdf", mimeType: "application/pdf", fileSizeBytes: 32, sha256: "a".repeat(64) });
  const profile = await client.query("society:getById", { id: societyId });
  await client.mutation("society:upsert", { id: societyId, name: profile.name, isCharity: profile.isCharity, isMemberFunded: profile.isMemberFunded, organizationStatus: "active", formationStatus: "incorporated", certificateEvidenceDocumentId: certificateId, certificateReference: `TEST-CERT-${societyId}`, certificateDate });
  return certificateId;
}
