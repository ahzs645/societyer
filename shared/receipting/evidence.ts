/** References and content checksums retained at the time evidence was reviewed. */
export interface ReceiptEvidenceSnapshot {
  documentId: string;
  fingerprint: string;
  documentVersionId?: string;
  storageId?: string;
  fileName?: string;
  mimeType?: string;
  sha256?: string;
  fileSizeBytes?: number;
}

export type ReceiptEvidenceReview = ReceiptEvidenceSnapshot & { reviewIssue?: string };

export async function receiptEvidenceFingerprint(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function hasCompleteReceiptEvidence(ids: readonly string[] | undefined, snapshots: readonly ReceiptEvidenceSnapshot[] | undefined): boolean {
  return Boolean(ids?.length && snapshots?.length === ids.length && new Set(snapshots.map(row => row.documentId)).size === ids.length
    && ids.every(id => snapshots.some(row => row.documentId === id && /^[a-f0-9]{64}$/.test(row.fingerprint))));
}
