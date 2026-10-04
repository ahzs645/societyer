import assert from "node:assert/strict";
import {
  createSubmissionAdapterRegistry, dispatchSubmission, submissionIdentitySha256, submissionPayloadSha256,
  type SubmissionDispatchDependencies, type SubmissionDispatchStore, type SubmissionRecord, type TrustedSubmissionAdapter,
} from "../shared/pathways/submissions";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import type { PortableQueryCtx } from "../shared/portable/ctx";
import { requirePermissionPortable } from "../shared/functions/permissions";
import { requireDocumentAccess } from "../shared/functions/documents";

const payloadJson = JSON.stringify({ pathwayKey: "bc-society-incorporation", version: "1", input: { name: "Approved society" }, evidence: [{ documentId: "document", versionId: "version", contentSha256: "a".repeat(64) }] });
const seed: SubmissionRecord = {
  _id: "submission", societyId: "society", runId: "run", stepKey: "file", adapterId: "test-api",
  payloadJson, approvedSha256: await submissionPayloadSha256(payloadJson), idempotencyKey: "run:file:approved-snapshot",
  actorId: "actor", documentIds: ["document"], status: "queued", createdAtISO: "2026-10-04T00:00:00.000Z", updatedAtISO: "2026-10-04T00:00:00.000Z",
};

// A serialized in-memory transaction emulates the durable atomic claim contract.
class Store implements SubmissionDispatchStore {
  row: SubmissionRecord = structuredClone(seed);
  providerCalls = 0;
  claims = 0;
  failReceipt = false;
  onClaim?: () => Promise<void>;
  private transaction: Promise<unknown> = Promise.resolve();
  async load() { return structuredClone(this.row); }
  claim(args: Parameters<SubmissionDispatchStore["claim"]>[0]) {
    const result = this.transaction.then(async () => {
      if (this.row.status !== "queued" || await submissionIdentitySha256(this.row) !== args.expectedIdentitySha256) return null;
      this.claims++;
      this.row = { ...this.row, status: "dispatching", attemptId: args.attemptId, updatedAtISO: args.startedAtISO };
      await this.onClaim?.();
      return structuredClone(this.row);
    });
    this.transaction = result.then(() => undefined, () => undefined);
    return result;
  }
  async complete(args: Parameters<SubmissionDispatchStore["complete"]>[0]) {
    if (this.failReceipt) throw new Error("Database unavailable");
    assert.equal(this.row.status, "dispatching");
    assert.equal(this.row.attemptId, args.attemptId);
    this.row = { ...this.row, status: args.outcome, receiptJson: args.receiptJson, error: args.error, updatedAtISO: args.completedAtISO };
  }
}

const db = new MemoryDb({ seed: {
  societies: [{ _id: "society", name: "Submission test" }],
  users: [{ _id: "actor", societyId: "society", role: "Admin", status: "Active", authIssuer: "https://issuer.test", authSubject: "subject" }],
  documents: [{ _id: "document", societyId: "society", title: "Approved evidence", category: "Policy", tags: [] }],
} });
const ctx: PortableQueryCtx = {
  db, principal: { kind: "user", runtime: "test", assurance: "verified-jwt", subject: "subject", issuer: "https://issuer.test", userId: "actor", societyId: "society" },
  capabilities: makeCapabilities({}), runQuery: async () => { throw new Error("Unexpected nested query"); },
};
const authorize = async (row: Readonly<SubmissionRecord>) => {
  const actor = await requirePermissionPortable(ctx, row.societyId, "filings:submit");
  assert.equal(actor._id, row.actorId);
  for (const id of row.documentIds) await requireDocumentAccess(ctx, id);
};
const configuredAdapter = (store: Store, overrides: Partial<TrustedSubmissionAdapter> = {}): TrustedSubmissionAdapter => ({
  id: "test-api", label: "Test registered API", supportsIdempotency: true, isConfigured: () => true,
  submit: async (request) => {
    store.providerCalls++;
    assert.ok(Object.isFrozen(request));
    assert.ok(Object.isFrozen(request.documentIds));
    assert.equal(request.payloadJson, payloadJson);
    assert.equal(request.approvedSha256, seed.approvedSha256);
    assert.equal(request.idempotencyKey, seed.idempotencyKey);
    return { status: "accepted", providerReference: "TEST-RECEIPT-42", receipt: { confirmation: "accepted" } };
  }, ...overrides,
});
const deps = (store: Store, adapter = configuredAdapter(store)): SubmissionDispatchDependencies => ({
  store, adapters: createSubmissionAdapterRegistry([adapter]), authorize, now: () => new Date("2026-10-04T12:00:00.000Z"),
});
const dispatch = (store: Store, dependencies = deps(store)) => dispatchSubmission({ submissionId: "submission" }, dependencies);

// Competing workers submit the exact approved bytes only once, then reuse the immutable receipt.
{
  const store = new Store();
  const results = await Promise.all(Array.from({ length: 12 }, () => dispatch(store)));
  assert.equal(store.providerCalls, 1);
  assert.equal(store.claims, 1);
  assert.equal(store.row.status, "accepted");
  assert.ok(results.some((result) => result.status === "accepted"));
  const receipt = store.row.receiptJson;
  assert.equal(JSON.parse(receipt!).approvedSha256, seed.approvedSha256);
  assert.equal(JSON.parse(receipt!).providerReference, "TEST-RECEIPT-42");
  assert.equal((await dispatch(store)).receiptJson, receipt);
  assert.equal(store.providerCalls, 1);
}

// Only explicit server registration can enable transport. Manual filing never calls an API.
for (const adapterId of ["official-portal", "https://client-controlled.example/send", "missing-provider"]) {
  const store = new Store();
  store.row.adapterId = adapterId;
  const result = await dispatch(store);
  assert.equal(result.status, adapterId === "official-portal" ? "manual_required" : "adapter-unavailable");
  assert.equal(store.claims, 0);
  assert.equal(store.providerCalls, 0);
}
{
  const store = new Store();
  assert.equal((await dispatch(store, deps(store, configuredAdapter(store, { isConfigured: () => false })))).status, "adapter-unavailable");
  assert.equal(store.claims, 0);
}
assert.throws(() => createSubmissionAdapterRegistry([configuredAdapter(new Store(), { id: "official-portal" })]), /reserved/);
for (const id of ["namespace.provider", "namespace:provider", "BadCase", "x".repeat(81)]) {
  assert.throws(() => createSubmissionAdapterRegistry([configuredAdapter(new Store(), { id })]), /identifier/);
}

// Changed bytes or routing cannot ride an older approval / claim.
{
  const store = new Store();
  store.row.payloadJson = JSON.stringify({ input: { name: "Unapproved society" } });
  assert.equal((await dispatch(store)).status, "blocked");
  assert.equal(store.providerCalls, 0);
}
{
  const store = new Store();
  const dependencies = deps(store);
  dependencies.authorize = async (row) => { await authorize(row); store.row.actorId = "different-actor"; };
  assert.equal((await dispatch(store, dependencies)).status, "dispatching");
  assert.equal(store.claims, 0);
  assert.equal(store.providerCalls, 0);
}

// Current authority, membership and evidence access are checked, including after claiming.
for (const patch of [{ role: "Director" }, { status: "Disabled" }]) {
  const store = new Store();
  await db.patch("actor", patch);
  await assert.rejects(() => dispatch(store), /Permission|membership|inactive|disabled|status/i);
  assert.equal(store.providerCalls, 0);
  await db.patch("actor", { role: "Admin", status: "Active" });
}
{
  const store = new Store();
  await db.patch("document", { societyId: "other-society" });
  await assert.rejects(() => dispatch(store), /membership|not found/i);
  assert.equal(store.providerCalls, 0);
  await db.patch("document", { societyId: "society" });
}
{
  const store = new Store();
  store.onClaim = async () => { await db.patch("actor", { role: "Director" }); };
  assert.equal((await dispatch(store)).status, "blocked");
  assert.equal(store.row.status, "blocked");
  assert.equal(store.providerCalls, 0);
  await db.patch("actor", { role: "Admin" });
}

// Unknown transport outcomes and failed receipt persistence cannot automatically resend.
for (const submit of [
  async () => { throw new Error("Transport failed after receiving request: https://secret:token@example.test"); },
  async () => ({ status: "accepted" as const }),
  async () => ({ status: "uncertain" as const }),
]) {
  const store = new Store();
  const dependencies = deps(store, configuredAdapter(store, { submit: async (request) => { store.providerCalls++; assert.equal(request.idempotencyKey, seed.idempotencyKey); return submit(); } }));
  assert.equal((await dispatch(store, dependencies)).status, "uncertain");
  assert.equal(store.row.status, "uncertain");
  assert.ok(!store.row.receiptJson?.includes("secret:token"));
  await dispatch(store, dependencies);
  assert.equal(store.providerCalls, 1, "supportsIdempotency is not permission to retry uncertain success");
}
for (const receipt of [
  { headers: { Authorization: "Bearer credential" } },
  { access_token: "credential" },
  { details: "Bearer credential" },
  { transfer: "https://storage.test/content?X-Amz-Signature=credential" },
  { transfer: "https://user:password@storage.test/content" },
  { response: "x".repeat(4097) },
  { response: new Date() },
]) {
  const store = new Store();
  const dependencies = deps(store, configuredAdapter(store, { submit: async () => {
    store.providerCalls++;
    return { status: "accepted", providerReference: "TEST-REF", receipt };
  } }));
  assert.equal((await dispatch(store, dependencies)).status, "uncertain");
  assert.ok(!store.row.receiptJson?.includes("credential"));
  assert.ok(!store.row.receiptJson?.includes("password"));
  await dispatch(store, dependencies);
  assert.equal(store.providerCalls, 1);
}
{
  const store = new Store();
  const dependencies = deps(store, configuredAdapter(store, { submit: async () => {
    store.providerCalls++;
    return { status: "rejected", providerReference: "REJECTED-42", receipt: { reason: "Unsupported filing type" } };
  } }));
  assert.equal((await dispatch(store, dependencies)).status, "rejected");
  const originalReceipt = store.row.receiptJson;
  assert.equal((await dispatch(store, dependencies)).receiptJson, originalReceipt);
  assert.equal(store.providerCalls, 1);
}
{
  const store = new Store();
  store.failReceipt = true;
  assert.equal((await dispatch(store)).status, "uncertain");
  assert.equal(store.row.status, "dispatching");
  store.failReceipt = false;
  assert.equal((await dispatch(store)).status, "dispatching");
  assert.equal(store.providerCalls, 1);
}
for (const status of ["manual_required", "attested", "rejected", "blocked", "uncertain"] as const) {
  const store = new Store();
  store.row.status = status;
  assert.equal((await dispatch(store)).status, status);
  assert.equal(store.providerCalls, 0);
}
{
  const store = new Store();
  await dispatch(store);
  await db.patch("actor", { status: "Disabled" });
  await assert.rejects(() => dispatch(store), /membership|inactive|disabled|status/i, "terminal receipts still require current authority");
  await db.patch("actor", { status: "Active" });
}

console.log("Pathway submission dispatcher: approved bytes, trusted adapters, concurrent claims, current authority, manual handoff and uncertain-outcome no-retry checks passed.");
