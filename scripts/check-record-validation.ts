/**
 * Gate: finance, operations and admin writes reject empty or invalid records
 * on the server (portable handlers), not only in the forms, and grant removal
 * keeps financial history.
 *
 * Runs against the synthetic demo seed through the local runtime, so every
 * assertion exercises the same portable handler that hosted Convex runs.
 */
import assert from "node:assert/strict";
import { StaticConvexClient } from "../src/lib/staticConvex";
import {
  isValidEmail,
  validateBudgetLineInput,
  validateFiscalPeriodInput,
  validateGrantInput,
  validateOutboxEmailInput,
  validateWorkspaceUserInput,
} from "../shared/recordValidation";
import { isRecordNotFoundError } from "../src/lib/detailRecordQueries";

// --- Pure validators --------------------------------------------------------
assert.equal(isValidEmail("owner@local"), true, "single-label local hosts stay valid");
assert.equal(isValidEmail("treasurer@example.org"), true);
assert.equal(isValidEmail("not-an-email"), false);
assert.equal(isValidEmail("a b@example.org"), false);
assert.ok(validateGrantInput({}).title);
assert.ok(validateGrantInput({ title: "T", funder: "F", fitScore: 150 }).fitScore);
assert.ok(validateGrantInput({ title: "T", funder: "F", amountRequestedCents: -10000 }).amountRequestedCents);
assert.deepEqual(validateGrantInput({ title: "Ledger", funder: "F" }, { partial: true }), {});
assert.ok(validateWorkspaceUserInput({ displayName: "A", email: "a@x.org" }, [{ _id: "u1", email: "A@X.org" }]).email, "email uniqueness is case-insensitive");
assert.deepEqual(validateWorkspaceUserInput({ displayName: "A", email: "a@x.org" }, [{ _id: "u1", email: "a@x.org" }], "u1"), {}, "a user keeps their own email");
assert.ok(validateFiscalPeriodInput({ fiscalYear: "", periodLabel: "FY", startDate: "2026-01-01", endDate: "2026-12-31" }).fiscalYear);
assert.ok(validateFiscalPeriodInput({ fiscalYear: "2026", periodLabel: "FY", startDate: "2026-12-31", endDate: "2026-01-01" }).endDate);
assert.ok(validateFiscalPeriodInput(
  { fiscalYear: "2026", periodLabel: "Q4", startDate: "2026-10-01", endDate: "2026-12-31" },
  [{ _id: "p1", fiscalYear: "2026", periodLabel: "FY 2026", startDate: "2026-01-01", endDate: "2026-12-31", status: "open" }],
).startDate, "overlapping periods are rejected");
assert.deepEqual(validateFiscalPeriodInput(
  { fiscalYear: "2027", periodLabel: "FY 2027", startDate: "2027-01-01", endDate: "2027-12-31" },
  [{ _id: "p1", fiscalYear: "2026", periodLabel: "FY 2026", startDate: "2026-01-01", endDate: "2026-12-31", status: "open" }],
), {});
assert.ok(validateBudgetLineInput({ fiscalYear: "2026", category: " facilities ", plannedCents: 100 }, [{ _id: "b1", fiscalYear: "2026", category: "Facilities", plannedCents: 5 }]).category);
assert.ok(validateBudgetLineInput({ fiscalYear: "2026", category: "Rent", plannedCents: -1 }).plannedCents);
assert.ok(validateOutboxEmailInput({ status: "draft" }).subject, "an entirely empty draft is rejected");
assert.deepEqual(validateOutboxEmailInput({ status: "draft", subject: "Agenda" }), {}, "a draft may be incomplete");
assert.ok(validateOutboxEmailInput({ status: "ready", to: "a@x.org", subject: "Hi" }).body);
assert.ok(validateOutboxEmailInput({ status: "draft", to: "nope" }).to);
assert.equal(isRecordNotFoundError(new Error("Record not found.")), true);
assert.equal(isRecordNotFoundError(new Error("grants not found.")), true);
assert.equal(isRecordNotFoundError(new Error("Society membership not found.")), false);

// --- Server-side enforcement on the demo seed ---------------------------------
const client = new StaticConvexClient({ databaseName: `societyer-record-validation-${Date.now()}` });
const [society] = await client.query("society:list", {});
const societyId = society._id as string;
const rejects = (label: string, promise: Promise<unknown>, pattern: RegExp) =>
  assert.rejects(promise, pattern, label);

// Grants: required fields and ranges.
await rejects("empty grant", client.mutation("grants:upsertGrant", { societyId, title: "", funder: "", status: "Prospecting" }), /grant title/i);
await rejects("fit score 150", client.mutation("grants:upsertGrant", { societyId, title: "Synthetic grant", funder: "Synthetic funder", status: "Prospecting", fitScore: 150 }), /between 0 and 100/);
await rejects("negative request", client.mutation("grants:upsertGrant", { societyId, title: "Synthetic grant", funder: "Synthetic funder", status: "Prospecting", amountRequestedCents: -10000 }), /cannot be negative/);
const grantId = await client.mutation("grants:upsertGrant", { societyId, title: "  Synthetic grant  ", funder: "Synthetic funder", status: "Prospecting" });
assert.equal((await client.query("grants:get", { id: grantId }) as any).title, "Synthetic grant");
await rejects("empty ledger entry", client.mutation("grants:upsertTransaction", { societyId, grantId, date: "", direction: "outflow", amountCents: 0, description: "" }), /valid date|greater than zero/);

// Grants: removal keeps financial history.
const blocked: any = await client.query("grants:deletionImpact", { id: "static_grant_gaming" });
assert.equal(blocked.canHardDelete, false);
assert.ok(blocked.ledgerTransactionCount >= 1);
await rejects("delete grant with ledger rows", client.mutation("grants:removeGrant", { id: "static_grant_gaming" }), /Archive the grant instead/);
assert.ok(await client.query("grants:get", { id: "static_grant_gaming" }), "blocked grant still exists");
await client.mutation("grants:setArchived", { id: "static_grant_gaming", archived: true, reason: "Program ended" });
const archived: any = await client.query("grants:get", { id: "static_grant_gaming" });
assert.ok(archived.archivedAtISO);
const summary: any = await client.query("grants:summary", { societyId });
assert.ok(summary.archived >= 1, "archived grants leave the pipeline counts");
const transactions: any[] = await client.query("grants:transactions", { societyId });
assert.ok(transactions.some((row) => row.grantId === "static_grant_gaming"), "archiving keeps ledger rows");
await client.mutation("grants:setArchived", { id: "static_grant_gaming", archived: false });
const deletable: any = await client.query("grants:deletionImpact", { id: "static_grant" });
assert.equal(deletable.canHardDelete, true);
assert.equal(deletable.reports.length, 1);
const removed: any = await client.mutation("grants:removeGrant", { id: "static_grant" });
assert.equal(removed.deletedReports, 1);
// The authorization gate rejects a missing id as "Record not found."; detail
// pages map exactly that to their not-found state (src/lib/detailRecordQueries.ts).
await assert.rejects(client.query("grants:get", { id: "static_grant" }), (error) => isRecordNotFoundError(error), "a deleted grant is reported as not found");

// Insurance.
await rejects("empty policy", client.mutation("insurance:create", { societyId, kind: "", insurer: "", policyNumber: "", startDate: "", renewalDate: "", status: "Active" }), /coverage type|insurer/);
await rejects("negative coverage", client.mutation("insurance:create", { societyId, kind: "GeneralLiability", insurer: "Synthetic Mutual", policyNumber: "SYN-1", startDate: "2026-01-01", renewalDate: "2027-01-01", status: "Active", coverageCents: -500 }), /cannot be negative/);
await client.mutation("insurance:create", { societyId, kind: "GeneralLiability", insurer: "Synthetic Mutual", policyNumber: "SYN-1", startDate: "2026-01-01", endDate: "2027-01-01", renewalDate: "2027-01-01", status: "Active", coverageCents: 200000000 });

// Documents.
await rejects("untitled document", client.mutation("documents:create", { societyId, title: "  ", category: "Other", tags: [] }), /document title/);

// Users: name, email format and uniqueness.
await rejects("empty user", client.mutation("users:upsert", { societyId, email: "", displayName: "", role: "Member", status: "Active" }), /name|email/i);
await rejects("bad email", client.mutation("users:upsert", { societyId, email: "not-an-email", displayName: "Synthetic Person", role: "Member", status: "Active" }), /valid email/);
const roster: any[] = await client.query("users:list", { societyId });
const takenEmail = roster.find((user) => user.email)?.email;
assert.ok(takenEmail);
await rejects("duplicate email", client.mutation("users:upsert", { societyId, email: String(takenEmail).toUpperCase(), displayName: "Synthetic Duplicate", role: "Member", status: "Active" }), /already uses this email/);
await client.mutation("users:upsert", { societyId, email: "synthetic.member@example.org", displayName: "Synthetic Member", role: "Member", status: "Active" });
const activity: any[] = await client.query("activity:list", { societyId, limit: 50 });
const membership = activity.find((row) => row.entityType === "user" && row.action === "created");
assert.ok(membership && !/^static_user_/.test(membership.actor), "audit entries name the actor instead of a raw id");

// Outbox.
await rejects("empty email", client.mutation("pendingEmails:create", { societyId, to: "", subject: "", body: "" }), /recipient|subject/i);
await rejects("bad recipient", client.mutation("pendingEmails:create", { societyId, to: "someone", subject: "Hello", body: "Body", status: "ready" }), /valid email/);
const draftId = await client.mutation("pendingEmails:create", { societyId, to: "", subject: "Draft agenda", body: "", status: "draft" });
await rejects("mark incomplete draft sent", client.mutation("pendingEmails:markSent", { id: draftId }), /Complete the email/);

// Fiscal periods.
await rejects("period without year", client.mutation("accounting:upsertFiscalPeriod", { societyId, fiscalYear: "", periodLabel: "FY", startDate: "2027-01-01", endDate: "2027-12-31", status: "open" }), /fiscal year/);
await rejects("duplicate period", client.mutation("accounting:upsertFiscalPeriod", { societyId, fiscalYear: "2026", periodLabel: "FY 2026", startDate: "2026-01-01", endDate: "2026-12-31", status: "open" }), /overlap/);
await client.mutation("accounting:upsertFiscalPeriod", { societyId, fiscalYear: "2027", periodLabel: "FY 2027", startDate: "2027-01-01", endDate: "2027-12-31", status: "open" });

// Counterparties.
await rejects("counterparty email", client.mutation("accounting:upsertCounterparty", { societyId, name: "Synthetic Vendor", kind: "vendor", email: "not-an-email" }), /valid email/);

// Budget lines.
await client.mutation("financialHub:upsertBudget", { societyId, fiscalYear: "2031", category: "Synthetic facilities", plannedCents: 4000000 });
await rejects("duplicate budget category", client.mutation("financialHub:upsertBudget", { societyId, fiscalYear: "2031", category: "synthetic facilities", plannedCents: 100 }), /already has a budget line/);
await rejects("negative budget", client.mutation("financialHub:upsertBudget", { societyId, fiscalYear: "2031", category: "Synthetic rent", plannedCents: -50000 }), /cannot be negative/);

// Assets: custody, maintenance and disposal.
await rejects("checkout without custodian", client.mutation("assets:recordEvent", { assetId: "static_asset_projector", event: { eventType: "checkout" } }), /custodian/);
await rejects("maintenance without title", client.mutation("assets:scheduleMaintenance", { assetId: "static_asset_projector", title: " ", kind: "maintenance", dueDate: "" }), /maintenance is due|due date/);
await rejects("disposal without reason", client.mutation("assets:dispose", { assetId: "static_asset_projector", disposedAt: "2026-05-01", disposalMethod: "sold", disposalReason: "" }), /why the asset/);
await client.mutation("assets:dispose", { assetId: "static_asset_projector", disposedAt: "2026-05-01", disposalMethod: "sold", disposalReason: "Replaced by a newer projector" });
await rejects("dispose twice", client.mutation("assets:dispose", { assetId: "static_asset_projector", disposedAt: "2026-05-02", disposalMethod: "sold", disposalReason: "Again" }), /already disposed/);

// Access custody (local runtime persists records but refuses plaintext secret values).
await rejects("empty access record", client.mutation("secrets:create", { societyId, name: "", service: "", credentialType: "" }), /Name the access record/);
await rejects("local secret value", client.mutation("secrets:create", { societyId, name: "Synthetic bank login", service: "Synthetic bank", credentialType: "password", secretValue: "hunter2" }), /encryption/);
const secretId = await client.mutation("secrets:create", { societyId, name: "Synthetic bank login", service: "Synthetic bank", credentialType: "password", externalLocation: "Board binder" });
const secrets: any[] = await client.query("secrets:list", { societyId });
assert.ok(secrets.some((row) => row._id === secretId), "a saved access record is listed");

// Financial statements presented at a meeting (schema B7).
await client.mutation("financials:update", { id: "static_financials_2025", patch: { statementsDocId: "static_document_financials", approvedByBoardAt: "2026-05-20" } });
let financial: any = (await client.query("financials:detailByFiscalYear", { societyId, fiscalYear: "2025-2026" })).financial;
assert.equal(financial.statementsDocId, "static_document_financials");
await client.mutation("financials:update", { id: "static_financials_2025", patch: {}, clear: ["presentedAtMeetingId"] });
financial = (await client.query("financials:detailByFiscalYear", { societyId, fiscalYear: "2025-2026" })).financial;
assert.equal(financial.presentedAtMeetingId, undefined);
await rejects("clear unknown field", client.mutation("financials:update", { id: "static_financials_2025", patch: {}, clear: ["revenueCents"] }), /cannot be cleared/);

console.log("Record validation checks passed: grants (incl. archive/delete guard), insurance, documents, users, outbox, fiscal periods, counterparties, budgets, assets, access custody, statement presentation.");
process.exit(0);
