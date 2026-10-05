/** Trusted submission dispatch. Adapter registration is server code, never a client URL. */
export type SubmissionStatus = "queued" | "dispatching" | "accepted" | "rejected" | "uncertain" | "blocked" | "manual_required" | "attested";

export type SubmissionRecord = {
  _id: string;
  societyId: string;
  runId: string;
  stepKey: string;
  adapterId: string;
  payloadJson: string;
  approvedSha256: string;
  idempotencyKey: string;
  actorId: string;
  documentIds: string[];
  status: SubmissionStatus;
  createdAtISO: string;
  updatedAtISO: string;
  attemptId?: string;
  receiptJson?: string;
  error?: string;
};

export type SubmissionAdapterOutcome = {
  status: "accepted" | "rejected" | "uncertain";
  /** A confirmed acceptance needs an actual provider reference, not HTTP success alone. */
  providerReference?: string;
  /** Adapter-provided receipt fields must be safe to retain; never include bearer URLs or credentials. */
  receipt?: Record<string, unknown>;
};

export type SubmissionAdapterRequest = Readonly<{
  submissionId: string;
  societyId: string;
  runId: string;
  stepKey: string;
  actorId: string;
  documentIds: readonly string[];
  payloadJson: string;
  approvedSha256: string;
  idempotencyKey: string;
  attemptId: string;
}>;

export type TrustedSubmissionAdapter = Readonly<{
  id: string;
  label: string;
  /** Observe trusted runtime credential/configuration state on every dispatch. */
  isConfigured(): boolean | Promise<boolean>;
  supportsIdempotency: boolean;
  submit(request: SubmissionAdapterRequest): Promise<SubmissionAdapterOutcome>;
}>;

export const MANUAL_SUBMISSION_ADAPTER = Object.freeze({
  id: "official-portal", label: "Official portal / assisted filing", mode: "manual" as const,
  automated: false, requiresReceiptEvidence: true,
});

export type SubmissionAdapterRegistry = Readonly<{
  resolve(id: string): TrustedSubmissionAdapter | undefined;
  describe(): readonly { id: string; label: string; supportsIdempotency: boolean; mode: "trusted-api" | "manual" }[];
}>;

/** Construct once from explicitly installed server implementations. No generic HTTP fallback. */
export function createSubmissionAdapterRegistry(adapters: readonly TrustedSubmissionAdapter[]): SubmissionAdapterRegistry {
  const installed = new Map<string, TrustedSubmissionAdapter>();
  for (const adapter of adapters) {
    if (!/^[a-z][a-z0-9_-]{1,79}$/.test(adapter.id) || adapter.id === MANUAL_SUBMISSION_ADAPTER.id || installed.has(adapter.id)) {
      throw new Error("Invalid, reserved or duplicate submission adapter identifier.");
    }
    installed.set(adapter.id, Object.freeze({ ...adapter }));
  }
  return Object.freeze({
    resolve: (id: string) => installed.get(id),
    describe: () => Object.freeze([
      { id: MANUAL_SUBMISSION_ADAPTER.id, label: MANUAL_SUBMISSION_ADAPTER.label, supportsIdempotency: false, mode: "manual" as const },
      ...[...installed.values()].map((adapter) => ({ id: adapter.id, label: adapter.label, supportsIdempotency: adapter.supportsIdempotency, mode: "trusted-api" as const })),
    ]),
  });
}

export const MAX_SUBMISSION_PAYLOAD_BYTES = 1024 * 1024;
export const MAX_SUBMISSION_RECEIPT_BYTES = 64 * 1024;

export async function submissionPayloadSha256(payloadJson: string): Promise<string> {
  return sha256(payloadJson);
}

/** CAS fingerprint binds approval and routing as well as the exact approved payload bytes. */
export async function submissionIdentitySha256(record: SubmissionRecord): Promise<string> {
  return sha256(JSON.stringify({
    submissionId: record._id, societyId: record.societyId, runId: record.runId,
    stepKey: record.stepKey, adapterId: record.adapterId, payloadJson: record.payloadJson,
    approvedSha256: record.approvedSha256, idempotencyKey: record.idempotencyKey,
    actorId: record.actorId, documentIds: record.documentIds,
  }));
}

export type SubmissionDispatchStore = {
  load(submissionId: string): Promise<SubmissionRecord | null>;
  /** Atomically compare identity fingerprint and queued status, then claim this attempt. */
  claim(args: { submissionId: string; expectedIdentitySha256: string; attemptId: string; startedAtISO: string }): Promise<SubmissionRecord | null>;
  /** Atomically persist once for the matching dispatching attempt; terminal receipts are immutable. */
  complete(args: { submissionId: string; attemptId: string; outcome: "accepted" | "rejected" | "uncertain" | "blocked"; receiptJson: string; error?: string; completedAtISO: string }): Promise<void>;
};

export type SubmissionDispatchDependencies = {
  store: SubmissionDispatchStore;
  adapters: SubmissionAdapterRegistry;
  /** Re-read current actor status, action authority, approval validity and every document ACL. */
  authorize(record: Readonly<SubmissionRecord>): Promise<void>;
  now?: () => Date;
  makeAttemptId?: () => string;
};

export type SubmissionDispatchResult = {
  submissionId: string;
  status: SubmissionStatus | "adapter-unavailable" | "not-found";
  receiptJson?: string;
  error?: string;
};

/**
 * Dispatch exactly one durably claimed attempt. Timeouts, thrown transports,
 * abandoned claims and receipt-write failures never trigger automatic resend.
 */
export async function dispatchSubmission(
  command: { submissionId: string },
  dependencies: SubmissionDispatchDependencies,
): Promise<SubmissionDispatchResult> {
  const row = await dependencies.store.load(command.submissionId);
  if (!row) return { submissionId: command.submissionId, status: "not-found" };
  const record = freezeRecord(row);
  if (record._id !== command.submissionId) throw new Error("Submission store returned a different record.");
  // Authority is current even when a caller is only asking for a terminal receipt.
  await dependencies.authorize(record);
  if (record.status !== "queued") return { submissionId: record._id, status: record.status, receiptJson: record.receiptJson, error: record.error };
  validateRecord(record);
  if (await submissionPayloadSha256(record.payloadJson) !== record.approvedSha256) {
    return { submissionId: record._id, status: "blocked", error: "Approved submission payload has changed." };
  }
  if (record.adapterId === MANUAL_SUBMISSION_ADAPTER.id) {
    return { submissionId: record._id, status: "manual_required" };
  }
  const adapter = dependencies.adapters.resolve(record.adapterId);
  if (!adapter || !await adapter.isConfigured()) return { submissionId: record._id, status: "adapter-unavailable" };

  const expectedIdentitySha256 = await submissionIdentitySha256(record);
  const attemptId = dependencies.makeAttemptId?.() ?? crypto.randomUUID();
  const now = dependencies.now ?? (() => new Date());
  const claimed = await dependencies.store.claim({ submissionId: record._id, expectedIdentitySha256, attemptId, startedAtISO: now().toISOString() });
  if (!claimed) {
    // Another worker may have sent already; never infer that a resend is safe.
    return { submissionId: record._id, status: "dispatching" };
  }
  if (claimed.status !== "dispatching" || claimed.attemptId !== attemptId || await submissionIdentitySha256(claimed) !== expectedIdentitySha256) {
    throw new Error("Submission claim did not preserve the approved identity.");
  }
  // Re-evaluate after the claim too, before any provider operation.
  let authorized = true;
  try { await dependencies.authorize(freezeRecord(claimed)); } catch { authorized = false; }
  let outcome: Omit<SubmissionAdapterOutcome, "status"> & { status: SubmissionAdapterOutcome["status"] | "blocked" };
  if (!authorized) outcome = { status: "blocked" };
  else try {
    outcome = await adapter.submit(Object.freeze({
      submissionId: record._id, societyId: record.societyId, runId: record.runId,
      stepKey: record.stepKey, actorId: record.actorId, documentIds: Object.freeze([...record.documentIds]),
      payloadJson: record.payloadJson, approvedSha256: record.approvedSha256,
      idempotencyKey: record.idempotencyKey, attemptId,
    }));
    if (!["accepted", "rejected", "uncertain"].includes(outcome?.status)
      || (outcome.status === "accepted" && (!outcome.providerReference?.trim() || outcome.providerReference.length > 1024))) {
      outcome = { status: "uncertain" };
    }
    // Even installed adapters cannot persist raw headers, credentials, transfer
    // URLs or unbounded provider responses into browser-readable receipts.
    if (outcome.providerReference !== undefined) validateReceiptValue(outcome.providerReference);
    if (outcome.receipt !== undefined) {
      if (!outcome.receipt || Array.isArray(outcome.receipt) || typeof outcome.receipt !== "object") throw new Error("Invalid receipt object.");
      validateReceiptValue(outcome.receipt);
    }
  } catch {
    // Provider exceptions can contain credential URLs. Keep them out of receipts/logs.
    outcome = { status: "uncertain" };
  }
  const completedAtISO = now().toISOString();
  let receiptJson: string;
  try { receiptJson = JSON.stringify({
    schemaVersion: 1, submissionId: record._id, adapterId: record.adapterId, attemptId,
    actorId: record.actorId, idempotencyKey: record.idempotencyKey,
    approvedSha256: record.approvedSha256, outcome: outcome.status,
    providerReference: outcome.providerReference, providerReceipt: outcome.receipt, completedAtISO,
  });
    if (new TextEncoder().encode(receiptJson).byteLength > MAX_SUBMISSION_RECEIPT_BYTES) throw new Error("Receipt is too large.");
  } catch {
    return { submissionId: record._id, status: "uncertain", error: "Provider receipt could not be recorded. Reconcile the claimed attempt before another submission." };
  }
  const error = outcome.status === "uncertain" ? "Provider outcome is uncertain. Reconcile before another submission."
    : outcome.status === "blocked" ? "Submission authority changed before dispatch; no provider operation was sent." : undefined;
  try {
    await dependencies.store.complete({ submissionId: record._id, attemptId, outcome: outcome.status, receiptJson, error, completedAtISO });
  } catch {
    // The durable claim remains dispatching when receipt persistence fails. A
    // recovery operator must reconcile it; the dispatcher cannot resend it.
    return { submissionId: record._id, status: "uncertain", error: "Submission receipt could not be persisted. Reconcile the claimed attempt before another submission." };
  }
  return { submissionId: record._id, status: outcome.status, receiptJson, error };
}

/** Shared bounded provider-output validation; credentials never belong in browser-readable history. */
export function assertSafeProviderReceipt(value: unknown, secrets: readonly string[] = []) {
  const serialized = JSON.stringify(value);
  if (!serialized || new TextEncoder().encode(serialized).byteLength > MAX_SUBMISSION_RECEIPT_BYTES
    || secrets.some(secret => secret && serialized.includes(secret))) throw new Error("Unsafe provider callback receipt.");
  validateReceiptValue(value);
}

function validateReceiptValue(value: unknown, depth = 0, budget = { nodes: 0 }) {
  if (depth > 8 || ++budget.nodes > 1000) throw new Error("Receipt structure is too large.");
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Receipt contains an invalid number.");
    return;
  }
  if (typeof value === "string") {
    if (value.length > 4096 || /\bbearer\s+\S+/i.test(value)) throw new Error("Unsafe receipt text.");
    for (const candidate of value.match(/https?:\/\/[^\s<>"']+/gi) ?? []) {
      const url = new URL(candidate);
      if (url.username || url.password || [...url.searchParams.keys()].some((key) => isSecretReceiptKey(key))) throw new Error("Unsafe receipt URL.");
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) throw new Error("Receipt list is too large.");
    for (const item of value) validateReceiptValue(item, depth + 1, budget);
    return;
  }
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("Receipt must contain plain JSON values.");
  const entries = Object.entries(value);
  if (entries.length > 100) throw new Error("Receipt object is too large.");
  for (const [key, item] of entries) {
    if (key.length > 100 || isSecretReceiptKey(key)) throw new Error("Unsafe receipt field.");
    validateReceiptValue(item, depth + 1, budget);
  }
}

function isSecretReceiptKey(key: string) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return /authorization|cookie|password|secret|token|apikey|credential|headers|signedurl|downloadurl|uploadurl/.test(normalized)
    || /^(signature|sig|xamz.*|xgoog.*|se|sp|sv|sr)$/.test(normalized);
}

function validateRecord(record: Readonly<SubmissionRecord>) {
  if (!record.societyId || !record.runId || !record.stepKey || !record.actorId || !record.adapterId
    || !record.idempotencyKey || record.idempotencyKey.length > 512 || /[\r\n]/.test(record.idempotencyKey)
    || !/^[a-f0-9]{64}$/.test(record.approvedSha256)
    || new TextEncoder().encode(record.payloadJson).byteLength > MAX_SUBMISSION_PAYLOAD_BYTES
    || !Array.isArray(record.documentIds) || record.documentIds.some((id) => typeof id !== "string" || !id)) {
    throw new Error("Invalid approved submission envelope.");
  }
  const payload = JSON.parse(record.payloadJson);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Submission payload must be a JSON object.");
}

function freezeRecord(record: SubmissionRecord): Readonly<SubmissionRecord> {
  return Object.freeze({ ...record, documentIds: Object.freeze([...record.documentIds]) as unknown as string[] });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
