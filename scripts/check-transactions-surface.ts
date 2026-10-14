// The transactions surface on the portable engine, seeded with the demo
// workspace: notes and receipt attach on a transaction, bulk edits with an
// exact undo, payee rename rules, and the pure helpers behind the "Needs
// attention" view, the rule prompt and "Create rule from selection".
import assert from "node:assert/strict";
import { tables } from "../src/lib/staticConvexFixtures";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import * as hub from "../shared/functions/financialHub";
import * as aliasesFns from "../shared/functions/payeeAliases";
import {
  aliasedCounterparty,
  countPayeeAliasMatches,
  findPayeeAlias,
  payeeDisplayName,
  validatePayeeAlias,
} from "../shared/payeeAliases";
import {
  attentionReasons,
  categorizedByValue,
  RECEIPT_ATTENTION_THRESHOLD_CENTS,
} from "../shared/transactionAttention";
import { draftFromSelection, selectionPayees } from "../src/features/financials/transactions/selectionRuleDraft";

const seed: Record<string, any[]> = {};
for (const [k, v] of Object.entries(tables as Record<string, any[]>)) seed[k] = JSON.parse(JSON.stringify(v));
seed.users = seed.users.map((u: any) => ({ ...u, status: "Active", authIssuer: "https://issuer.test", authSubject: `sub-${u._id}` }));
const db = new MemoryDb({ seed });
const S = seed.users[0].societyId;
const ctxFor = (userId: string): any => ({
  db,
  principal: { kind: "user", runtime: "test", assurance: "trusted-workspace", subject: `sub-${userId}`, issuer: "https://issuer.test", userId, societyId: S },
  capabilities: makeCapabilities({}),
  runQuery: async () => { throw new Error("nested"); },
});
const owner = ctxFor(seed.users[0]._id);

// ---- notes and receipt on one transaction
const txnId = "static_tx_space";
const docId = seed.documents.find((doc: any) => doc.societyId === S)._id;
await hub.updateTransactionPortable(owner, { id: txnId, patch: { memo: "  Saturday booking  " } });
assert.equal((await db.get<any>(txnId))!.memo, "Saturday booking", "notes are trimmed and saved");
await hub.updateTransactionPortable(owner, { id: txnId, patch: { receiptDocumentId: docId } });
let row = await db.get<any>(txnId);
assert.equal(row!.receiptDocumentId, docId);
assert.equal(row!.receiptStatus, "attached", "attaching a document marks the receipt attached");
await hub.updateTransactionPortable(owner, { id: txnId, patch: { receiptDocumentId: null } });
row = await db.get<any>(txnId);
assert.equal(row!.receiptDocumentId, undefined);
assert.equal(row!.receiptStatus, "missing", "removing the document marks the receipt missing");
const foreignDoc = await db.insert("documents", { societyId: "static_society_other", title: "Other org receipt", category: "Receipt", tags: [], createdAtISO: "2026-01-01T00:00:00.000Z" });
await assert.rejects(
  hub.updateTransactionPortable(owner, { id: txnId, patch: { receiptDocumentId: foreignDoc } }),
  "another organization's document cannot be attached",
);

// ---- bulk edit + undo restores every touched field exactly
const ruleRow = seed.financialTransactions.find((t: any) => t.categorizedBy === "rule" && t.ruleApplication);
const plainRows = seed.financialTransactions.filter((t: any) => !t.categorizedBy && t.category).slice(0, 2);
const ids = [ruleRow._id, ...plainRows.map((t: any) => t._id)];
const before = await Promise.all(ids.map((id) => db.get<any>(id)));
const foreignTxn = await db.insert("financialTransactions", { societyId: "static_society_other", connectionId: "x", accountId: "y", externalId: "z", date: "2026-01-01", description: "Other org", amountCents: -100 });
const result = await hub.bulkUpdateTransactionsPortable(owner, { societyId: S, ids: [...ids, foreignTxn], patch: { category: "Bulk test", reviewed: true } });
assert.equal(result.updated, 3);
assert.equal(result.skipped, 1, "another organization's line is skipped");
assert.ok(!JSON.stringify(result).includes(foreignTxn), "the skipped line is counted, never named");
for (const id of ids) {
  const after = await db.get<any>(id);
  assert.equal(after!.category, "Bulk test");
  assert.equal(after!.categorizedBy, "manual", "a bulk category is a manual category");
  assert.equal(after!.ruleApplication, undefined);
  assert.ok(after!.reviewedAtISO, "marked reviewed");
}
const undone = await hub.restoreTransactionsPortable(owner, { societyId: S, rows: result.previous });
assert.equal(undone.restored, 3);
for (const [index, id] of ids.entries()) {
  const after = await db.get<any>(id);
  for (const field of ["category", "categorizedBy", "ruleId", "reviewedAtISO", "fundRestrictionId"]) {
    assert.deepEqual(after![field], before[index]![field], `undo restores ${field}`);
  }
  assert.deepEqual(after!.ruleApplication, before[index]!.ruleApplication, "undo restores the rule application");
}
const fund = seed.fundRestrictions[0]._id;
const funded = await hub.bulkUpdateTransactionsPortable(owner, { societyId: S, ids: plainRows.map((t: any) => t._id), patch: { fundRestrictionId: fund } });
assert.equal(funded.updated, 2);
assert.equal((await db.get<any>(plainRows[0]._id))!.fundRestrictionId, fund);
await assert.rejects(hub.bulkUpdateTransactionsPortable(owner, { societyId: S, ids: [], patch: { reviewed: true } }));
await assert.rejects(hub.bulkUpdateTransactionsPortable(owner, { societyId: S, ids, patch: { category: "  " } }));

// ---- payee rename rules
const created = await aliasesFns.upsertPortable(owner, { societyId: S, match: "greenway market", matchType: "exact", displayName: "Greenway Market Co-op" });
const again = await aliasesFns.upsertPortable(owner, { societyId: S, match: "Greenway  Market", matchType: "exact", displayName: "Greenway Co-op" });
assert.equal(String(again), String(created), "renaming the same payee again replaces the earlier name");
let list = await aliasesFns.listPortable(owner, { societyId: S });
assert.equal(list.length, 1);
assert.equal(list[0].displayName, "Greenway Co-op");
await assert.rejects(aliasesFns.upsertPortable(owner, { societyId: S, match: "", matchType: "exact", displayName: "x" }));
await aliasesFns.removePortable(owner, { id: String(created) });
list = await aliasesFns.listPortable(owner, { societyId: S });
assert.equal(list.length, 0);

const aliases = [
  { match: "e-transfer", matchType: "contains", displayName: "Interac e-Transfer" },
  { match: "E-TRANSFER DEPOSIT N AHMADI", matchType: "exact", displayName: "Noor Ahmadi" },
  { match: "e-transfer deposit", matchType: "contains", displayName: "Member deposit" },
];
assert.equal(findPayeeAlias(aliases, "E-TRANSFER DEPOSIT N AHMADI")?.displayName, "Noor Ahmadi", "an exact rename wins");
assert.equal(findPayeeAlias(aliases, "E-TRANSFER DEPOSIT B LEE")?.displayName, "Member deposit", "the longest contained match wins");
assert.equal(payeeDisplayName(aliases, { description: "Coffee", amountCents: -500 }), "Coffee");
assert.equal(aliasedCounterparty(aliases, { description: "E-TRANSFER WESTSIDE", counterparty: "", amountCents: 100 }), "Interac e-Transfer");
assert.equal(countPayeeAliasMatches(aliases[0], [{ description: "E-TRANSFER A", amountCents: 1 }, { description: "Cheque", amountCents: 1 }]), 1);
assert.deepEqual(validatePayeeAlias({ match: "a", matchType: "exact", displayName: "A" }), ["The new name is the same as the payee."]);

// ---- needs attention + categorised by
assert.deepEqual(attentionReasons({ amountCents: -100, category: "" }), ["uncategorized"]);
assert.deepEqual(attentionReasons({ amountCents: -RECEIPT_ATTENTION_THRESHOLD_CENTS, category: "Supplies", receiptStatus: "missing" }), ["receipt"]);
assert.deepEqual(attentionReasons({ amountCents: -100, category: "Supplies", receiptStatus: "missing" }), [], "small purchases do not need a receipt");
assert.deepEqual(attentionReasons({ amountCents: -100, category: "Fees", categorizedBy: "rule" }), ["unreviewed"]);
assert.deepEqual(attentionReasons({ amountCents: -100, category: "Fees", categorizedBy: "rule", reviewedAtISO: "2026-01-01" }), []);
assert.equal(categorizedByValue({ amountCents: 1, category: "Grants" }), "imported");
assert.equal(categorizedByValue({ amountCents: 1, category: "" }), undefined);
assert.equal(categorizedByValue({ amountCents: 1, category: "Grants", categorizedBy: "manual" }), "manual");

// ---- create rule from selection
const one = draftFromSelection([{ counterparty: "Coastal Hydro", description: "COASTAL HYDRO 0042", amountCents: -4200, category: "Utilities" }]);
assert.equal(one!.actions.category, "Utilities");
assert.deepEqual(one!.conditions.find((c) => c.field === "payee"), { field: "payee", operator: "equals", value: "Coastal Hydro" });
assert.deepEqual(one!.conditions.find((c) => c.field === "direction"), { field: "direction", value: "out" });
const many = draftFromSelection([
  { counterparty: "Ticketbay", description: "", amountCents: -900 },
  { counterparty: "ticketbay", description: "", amountCents: -800 },
  { counterparty: "Metro Transit fares", description: "", amountCents: 300 },
]);
assert.deepEqual(selectionPayees([{ counterparty: "A", amountCents: 1 }, { counterparty: "a", amountCents: 1 }]), ["A"]);
const payeeCondition: any = many!.conditions.find((c) => c.field === "payee");
assert.equal(payeeCondition.operator, "in", "several payees become payee is any of");
assert.deepEqual(payeeCondition.values, ["Ticketbay", "Metro Transit fares"]);
assert.ok(!many!.conditions.some((c) => c.field === "direction"), "mixed directions drop the direction condition");

console.log("transactions surface checks passed: receipt attach, bulk edit + undo, payee names, attention, selection rules");
