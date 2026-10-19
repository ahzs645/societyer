// Line items (splits), tags and the review queue on bank transactions, on the
// portable engine seeded with the demo workspace: split-sum validation, rules
// never clobbering a split, split journal posting with one offset line per
// line item (re-posting an edit replaces the entry's lines instead of posting
// twice), one tag per group, bulk tag assignment with Undo, the books close
// date on every re-posting path (single edits refuse, bulk edits, tags and
// Undo skip and count), lines a bill or invoice payment holds (no split,
// recode, re-match or unmatch), the tag / method / review filters and money
// summary of the transactions tab, and the export's formula guard.
import assert from "node:assert/strict";
import { tables } from "../src/lib/staticConvexFixtures";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import type { PortableDoc, PortableMutationCtx } from "../shared/portable/ctx";
import * as hub from "../shared/functions/financialHub";
import * as accounting from "../shared/functions/accounting";
import * as linesFns from "../shared/functions/transactionLines";
import * as tagsFns from "../shared/functions/financeTags";
import * as recon from "../shared/functions/reconciliation";
import {
  isSplitTransaction,
  moneyFlowSummary,
  splitEvenlyCents,
  storedLineFields,
  transactionLines,
  validateTransactionLines,
  withRemainderOn,
  withTagAssigned,
  type TransactionLine,
} from "../shared/transactionLines";
import { findApplicableRule, type TransactionRuleLike } from "../shared/transactionRules";
import { tagGroupLookup } from "../shared/financeTags";
import { categorisationMethods, filterTransactions, reviewCounts } from "../src/features/financials/transactions/transactionFilters";
import { transactionExportTextRows } from "../src/features/financials/transactions/transactionExport";
import { toDelimitedText } from "../src/lib/tableExport";

type Row = PortableDoc;
const seed: Record<string, Row[]> = {};
for (const [table, rows] of Object.entries(tables as Record<string, Row[]>)) seed[table] = JSON.parse(JSON.stringify(rows));
seed.users = seed.users.map((user) => ({ ...user, status: "Active", authIssuer: "https://issuer.test", authSubject: `sub-${user._id}` }));
const db = new MemoryDb({ seed });
const S = String(seed.users[0].societyId);
const owner = {
  db,
  principal: { kind: "user", runtime: "test", assurance: "trusted-workspace", subject: `sub-${seed.users[0]._id}`, issuer: "https://issuer.test", userId: seed.users[0]._id, societyId: S },
  capabilities: makeCapabilities({}),
  runQuery: async () => { throw new Error("nested"); },
} as unknown as PortableMutationCtx;
const get = async (id: string) => (await db.get<Row>(id))!;
const tagId = (key: string) => `static_tag_${key}`;
const groupOf = tagGroupLookup(seed.financeTags.map((tag) => ({ _id: String(tag._id), groupId: String(tag.groupId) })));

// ---- pure line helpers
assert.deepEqual(splitEvenlyCents(10000, 3), [3334, 3333, 3333], "leftover cents go to the first lines");
assert.deepEqual(splitEvenlyCents(-10000, 3), [-3334, -3333, -3333], "money out splits into negative lines");
assert.equal(splitEvenlyCents(-5, 2).reduce((a, b) => a + b, 0), -5);
const draft: TransactionLine[] = [{ id: "a", amountCents: -6000 }, { id: "b", amountCents: -2000 }];
assert.deepEqual(validateTransactionLines(-10000, draft).length, 1, "lines that do not add up are rejected");
assert.match(validateTransactionLines(-10000, draft)[0], /unallocated \$20\.00/, "the remainder is named");
assert.match(validateTransactionLines(-10000, [{ id: "a", amountCents: -12000 }, { id: "b", amountCents: 2000 }])[0] ?? "", /^$/, "mixed-sign lines that add up are fine");
assert.deepEqual(validateTransactionLines(-10000, withRemainderOn(-10000, draft, 1)), [], "putting the remainder on a line balances it");
assert.ok(validateTransactionLines(-10000, [{ id: "a", amountCents: -10000 }, { id: "b", amountCents: 0 }]).some((e) => /needs an amount/.test(e)), "an empty line is rejected");
assert.ok(validateTransactionLines(-100, [{ id: "a", amountCents: -100.5 }]).some((e) => /whole cents/.test(e)));
assert.ok(
  validateTransactionLines(-10000, [{ id: "a", amountCents: -10000, tagIds: [tagId("youth_mentoring"), tagId("arts_nights")] }], { groupOf }).some((e) => /same group/.test(e)),
  "two tags from one group on a line are rejected",
);
assert.deepEqual(validateTransactionLines(-10000, [{ id: "a", amountCents: -10000, tagIds: [tagId("youth_mentoring"), tagId("harbour_2026")] }], { groupOf }), []);
assert.deepEqual(withTagAssigned([tagId("youth_mentoring"), tagId("harbour_2026")], tagId("arts_nights"), groupOf).sort(), [tagId("arts_nights"), tagId("harbour_2026")].sort(), "assigning a tag replaces its group's other tag");
assert.equal(storedLineFields([{ id: "x", amountCents: -500, category: " Supplies ", tagIds: [tagId("fall_gala")] }]).lines, undefined, "one line folds back into the plain fields");
assert.equal(storedLineFields([{ id: "x", amountCents: -500, category: "Supplies" }]).category, "Supplies");
const folded = storedLineFields([{ id: "x", amountCents: -300, category: "Small" }, { id: "y", amountCents: -700, category: "Large" }]);
assert.equal(folded.lines?.length, 2);
assert.equal(folded.category, "Large", "a split summarises its largest line");
assert.equal(transactionLines({ amountCents: -900, category: "Rent", tagIds: [tagId("fall_gala")] })[0].amountCents, -900, "an unsplit row is one line for its whole amount");
assert.deepEqual(moneyFlowSummary([{ amountCents: 500 }, { amountCents: -200 }, { amountCents: -100 }]), { inCents: 500, outCents: -300, netCents: 200, count: 3 });

// ---- the demo carries splits and tags
const splitRows = seed.financialTransactions.filter((row) => isSplitTransaction({ lines: row.lines }));
assert.equal(splitRows.length, 2, "the demo has a split rent payment and a split registration payout");
for (const row of splitRows) assert.deepEqual(validateTransactionLines(row.amountCents, row.lines, { groupOf }), [], `demo split ${row._id} adds up`);
assert.equal(seed.financeTagGroups.map((group) => group.name).join(", "), "Program, Grant, Event");

// ---- rules never touch a split
const broadRule: TransactionRuleLike & { _id: string } = { _id: "rule-any", name: "Everything", priority: 1, enabled: true, conditions: [{ field: "amount", operator: "gte", amountCents: 0 }], actions: { category: "Ruled" } };
assert.ok(findApplicableRule([broadRule], { amountCents: -100, category: "" }), "the rule matches an uncategorised line");
assert.equal(findApplicableRule([broadRule], { amountCents: -100, category: "", lines: [{}, {}] }), null, "but never a split");

// ---- saving lines
const target = seed.financialTransactions.find((row) => !row.category && row.amountCents < -1000 && !row.lines && row.status !== "pending" && row.date > "2026-01-01")!;
assert.ok(target, "an uncategorised 2026 payment to split");
const [half1, half2] = splitEvenlyCents(target.amountCents, 2);
await assert.rejects(
  linesFns.savePortable(owner, { id: target._id, lines: [{ id: "l1", amountCents: half1, category: "Office & technology" }, { id: "l2", amountCents: half2 + 1, category: "Program supplies" }] }),
  /add up/,
  "a split that does not add up is not saved",
);
await assert.rejects(
  linesFns.savePortable(owner, { id: target._id, lines: [{ id: "l1", amountCents: target.amountCents, tagIds: [tagId("youth_mentoring"), tagId("arts_nights")] }] }),
  /same group/,
);
const grant = seed.fundRestrictions[0]._id;
const saved = await linesFns.savePortable(owner, {
  id: target._id,
  lines: [
    { id: "l1", amountCents: half1, category: "Office & technology", tagIds: [tagId("youth_mentoring")] },
    { id: "l2", amountCents: half2, category: "Program supplies", fundRestrictionId: grant, memo: "Workshop share", tagIds: [tagId("arts_nights"), tagId("harbour_2026")] },
  ],
});
assert.equal(saved.split, true);
assert.equal(saved.journal, "unposted", "saving never posts an unposted transaction");
let stored = await get(target._id);
assert.equal(stored.lines.length, 2);
assert.equal(stored.categorizedBy, "manual", "a split is a manual categorisation");
assert.ok(stored.category, "the split is summarised by its largest line");
await assert.rejects(hub.updateTransactionPortable(owner, { id: target._id, patch: { category: "Something else" } }), /split/, "a single category cannot overwrite a split");
const bulk = await hub.bulkUpdateTransactionsPortable(owner, { societyId: S, ids: [target._id], patch: { category: "Bulk", reviewed: true } });
assert.equal(bulk.splitSkipped, 1, "a bulk category leaves the split alone");
assert.equal((await get(target._id)).lines.length, 2);
assert.ok((await get(target._id)).reviewedAtISO, "the same bulk edit still marks it reviewed");
const unreviewed = await hub.bulkUpdateTransactionsPortable(owner, { societyId: S, ids: [target._id], patch: { reviewed: false } });
assert.equal(unreviewed.updated, 1);
assert.equal((await get(target._id)).reviewedAtISO, undefined, "U puts a line back in the To review queue");
await hub.restoreTransactionsPortable(owner, { societyId: S, rows: bulk.previous });

// ---- posting a split, then re-posting an edit
const posting = await accounting.backfillFinancialTransactionsToJournalPortable(owner, { societyId: S, transactionIds: [target._id], includeBeforeOpening: true });
assert.equal(posting.posted, 1);
const journalLines = async () => (await db.query<Row>("journalLines").collect()).filter((line) => line.financialTransactionId === target._id);
const balance = (lines: Row[]) => lines.reduce((sum, line) => sum + (line.side === "debit" ? line.amountCents : -line.amountCents), 0);
let posted = await journalLines();
assert.equal(posted.length, 3, "a two-line split posts the bank line and one offset line per line item");
assert.equal(balance(posted), 0, "the entry balances");
const offset2 = posted.find((line) => JSON.parse(line.rawJson).lineId === "l2")!;
assert.equal(offset2.amountCents, Math.abs(half2));
assert.equal(offset2.side, "debit", "money out debits the line accounts");
assert.equal(offset2.fundRestrictionId, grant, "the line's fund travels to the journal");
assert.deepEqual([...offset2.tagIds].sort(), [tagId("arts_nights"), tagId("harbour_2026")].sort(), "the line's tags travel to the journal");
const entryId = posted[0].journalEntryId;
const journalView = await linesFns.journalPortable(owner, { id: target._id });
assert.equal(journalView.posted?.entryId, entryId);
assert.equal(journalView.posted?.lines.length, 3);

const rebalanced = splitEvenlyCents(target.amountCents, 3);
const reposted = await linesFns.savePortable(owner, {
  id: target._id,
  lines: rebalanced.map((amountCents, index) => ({ id: `n${index}`, amountCents, category: index === 0 ? "Office & technology" : "Program supplies" })),
});
assert.equal(reposted.journal, "reposted");
posted = await journalLines();
assert.equal(posted.length, 4, "the edited split replaces the entry's lines");
assert.ok(posted.every((line) => line.journalEntryId === entryId), "in the same entry: nothing is posted twice");
assert.equal(balance(posted), 0);
await assert.rejects(
  hub.updateTransactionPortable(owner, { id: target._id, patch: { amountCents: target.amountCents - 500 } }),
  /split into lines/,
  "a posted split's amount cannot change without its lines",
);
await db.patch(target._id, { amountCents: target.amountCents - 500 });
await assert.rejects(accounting.createTransactionJournalSync(owner, S)(target._id), /not balanced/, "the journal sync never writes unbalanced lines");
assert.equal(balance(await journalLines()), 0, "the refused sync leaves the entry as it was");
await db.patch(target._id, { amountCents: target.amountCents });
const unchanged = await linesFns.savePortable(owner, {
  id: target._id,
  lines: rebalanced.map((amountCents, index) => ({ id: `n${index}`, amountCents, category: index === 0 ? "Office & technology" : "Program supplies" })),
});
assert.equal(unchanged.journal, "unchanged", "saving the same lines again is a no-op");
const retagged = await linesFns.savePortable(owner, {
  id: target._id,
  lines: rebalanced.map((amountCents, index) => ({ id: `n${index}`, amountCents, category: index === 0 ? "Office & technology" : "Program supplies", tagIds: [tagId("community_garden")] })),
});
assert.equal(retagged.journal, "updated", "a tag change updates the posted lines in place");
assert.ok((await journalLines()).filter((line) => line.lineOrder > 0).every((line) => line.tagIds?.includes(tagId("community_garden"))));
const rerun = await accounting.backfillFinancialTransactionsToJournalPortable(owner, { societyId: S, transactionIds: [target._id], includeBeforeOpening: true });
assert.equal(rerun.posted, 0, "backfill still sees the transaction as posted");
const folding = await linesFns.savePortable(owner, { id: target._id, lines: [{ id: "only", amountCents: target.amountCents, category: "Office & technology" }] });
assert.equal(folding.split, false);
assert.equal((await journalLines()).length, 2, "back to one line: the bank line and one offset");
assert.equal((await get(target._id)).lines, undefined);

// ---- a line a bill or invoice payment holds: not split, recoded, re-matched or unmatched here
{
  const billLine = await get("static_tx_bill_hydro_march");
  const invoiceLine = await get("static_tx_invoice_hannah");
  const [a, b] = splitEvenlyCents(billLine.amountCents, 2);
  await assert.rejects(linesFns.savePortable(owner, { id: billLine._id, lines: [{ id: "a", amountCents: a, category: "Utilities" }, { id: "b", amountCents: b, category: "Office & technology" }] }), /linked to a bill payment\. Remove the payment on the bill to split it/);
  await assert.rejects(linesFns.savePortable(owner, { id: billLine._id, lines: [{ id: "a", amountCents: billLine.amountCents, category: "Utilities" }] }), /Remove the payment on the bill to change its category/);
  await linesFns.savePortable(owner, { id: invoiceLine._id, lines: [{ id: "a", amountCents: invoiceLine.amountCents, category: invoiceLine.category, accountingAccountId: invoiceLine.accountingAccountId, memo: "Paid at the door" }] });
  assert.equal((await get(invoiceLine._id)).accountingAccountId, "static_financial_ar", "a memo on the held line is fine; its coding stays");
  await assert.rejects(recon.unmatchPortable(owner, { txnId: billLine._id }), /Remove the payment on the bill to unmatch it/);
  await assert.rejects(recon.matchPortable(owner, { txnId: invoiceLine._id, matchedKind: "manual", matchedId: "manual" }), /linked to an invoice payment\. Remove the payment on the invoice/);
  await assert.rejects(recon.markManualPortable(owner, { txnId: billLine._id, note: "Fee" }), /Remove the payment on the bill/);
  assert.deepEqual([(await get(billLine._id)).matchedKind, (await get(invoiceLine._id)).matchedKind], ["bill", "invoice"], "both links are untouched");
  const free = seed.financialTransactions.find((row) => !row.matchedKind && row.amountCents < 0)!;
  await assert.rejects(recon.matchPortable(owner, { txnId: free._id, matchedKind: "bill", matchedId: "static_bill_x" }), /recording the payment on the bill/, "reconciliation can't fake a bill payment link");
}

// ---- bulk tag assignment and Undo
const plain = seed.financialTransactions.filter((row) => !row.lines && !row.tagIds && row.category).slice(0, 2).map((row) => String(row._id));
const assigned = await linesFns.assignTagPortable(owner, { societyId: S, ids: [...plain, splitRows[0]._id], tagId: tagId("fall_gala") });
assert.equal(assigned.updated, 3);
assert.deepEqual((await get(plain[0])).tagIds, [tagId("fall_gala")]);
assert.ok((await get(splitRows[0]._id)).lines.every((line: TransactionLine) => line.tagIds?.includes(tagId("fall_gala"))), "every line of a split gets the tag");
await hub.restoreTransactionsPortable(owner, { societyId: S, rows: assigned.previous });
assert.equal((await get(plain[0])).tagIds, undefined, "Undo takes the tag off again");
assert.deepEqual((await get(splitRows[0]._id)).lines, splitRows[0].lines, "Undo restores the split's lines exactly");
await assert.rejects(linesFns.assignTagPortable(owner, { societyId: S, ids: plain, tagId: null }), /group/, "clearing needs the group");

// ---- the books close date: single edits refuse; bulk edits, tags, Undo skip and count
{
  const ownEntryDate = async (id: string) =>
    (await accounting.postedJournalForTransaction(owner, id)).entries.find((entry) => entry.source === accounting.TRANSACTION_BACKFILL_SOURCE && entry.status === "posted")?.date as string | undefined;
  const candidates: Array<{ id: string; date: string }> = [];
  for (const row of seed.financialTransactions.filter((txn) => !txn.lines && txn.category && txn.status !== "pending" && String(txn._id).startsWith("static_tx_feed_"))) {
    const date = await ownEntryDate(String(row._id));
    if (date) candidates.push({ id: String(row._id), date });
    if (candidates.length > 40) break;
  }
  candidates.sort((a, b) => a.date.localeCompare(b.date));
  const locked = candidates[0];
  const open = candidates.find((row) => row.date > locked.date)!;
  assert.ok(locked && open, "two posted feed lines on different dates");
  const closeDate = locked.date;
  const before = await get(locked.id);
  const earlier = await hub.bulkUpdateTransactionsPortable(owner, { societyId: S, ids: [locked.id], patch: { category: "Before the lock" } });
  const settingsId = await db.insert("booksSettings", { societyId: S, closeDate, createdAtISO: new Date().toISOString(), updatedAtISO: new Date().toISOString() });
  const refusal = new RegExp(`books are closed through ${closeDate}, so entries dated ${closeDate} can't be edited`);
  await assert.rejects(linesFns.savePortable(owner, { id: locked.id, lines: [{ id: "x", amountCents: before.amountCents, category: "Office & technology" }] }), refusal, "saving lines refuses a locked transaction");
  await assert.rejects(hub.updateTransactionPortable(owner, { id: locked.id, patch: { category: "Office & technology" } }), refusal, "a single category edit refuses");
  await assert.rejects(hub.updateTransactionPortable(owner, { id: open.id, patch: { date: closeDate } }), refusal, "moving a posted line into the locked period refuses");
  await hub.updateTransactionPortable(owner, { id: locked.id, patch: { memo: "Notes never touch the journal" } });
  assert.equal((await get(locked.id)).memo, "Notes never touch the journal", "a notes edit is not a journal write");
  const lockedBulk = await hub.bulkUpdateTransactionsPortable(owner, { societyId: S, ids: [locked.id, open.id], patch: { category: "Bulk after lock" } });
  assert.deepEqual([lockedBulk.updated, lockedBulk.skippedLocked], [1, 1], "a bulk category skips the locked line and counts it");
  assert.equal((await get(locked.id)).category, "Before the lock");
  assert.equal((await get(open.id)).category, "Bulk after lock");
  const reviewed = await hub.bulkUpdateTransactionsPortable(owner, { societyId: S, ids: [locked.id], patch: { reviewed: !(await get(locked.id)).reviewedAtISO } });
  assert.deepEqual([reviewed.updated, reviewed.skippedLocked], [1, 0], "marking reviewed (or not) is not a journal write");
  const tagged = await linesFns.assignTagPortable(owner, { societyId: S, ids: [locked.id, open.id], tagId: tagId("fall_gala") });
  assert.deepEqual([tagged.updated, tagged.skippedLocked], [1, 1], "assigning a tag skips the locked line");
  assert.equal((await get(locked.id)).tagIds, undefined);
  const undone = await hub.restoreTransactionsPortable(owner, { societyId: S, rows: [...earlier.previous, ...lockedBulk.previous] });
  assert.deepEqual([undone.restored, undone.skippedLocked], [1, 1], "Undo restores the open line and skips the locked one");
  assert.equal((await get(locked.id)).category, "Before the lock", "the locked line keeps its value");
  const sync = accounting.createTransactionJournalSync(owner, S);
  await db.patch(locked.id, { category: "Patched underneath" });
  assert.equal(await sync(locked.id, { onLocked: "skip" }), "locked", "the journal sync never re-posts a locked entry");
  await assert.rejects(sync(locked.id), refusal);
  await db.patch(locked.id, { category: "Before the lock" });
  await db.delete(settingsId);
  await hub.restoreTransactionsPortable(owner, { societyId: S, rows: [...earlier.previous, ...tagged.previous] });
  assert.equal((await get(locked.id)).category, before.category, "once the date moves, Undo works again");
}

// ---- a closed fiscal period: bulk edits, rule runs and Undo leave the transaction as it was, so register and ledger agree
{
  const row = seed.financialTransactions.find((txn) => !txn.lines && txn.category && txn.status !== "pending" && String(txn._id).startsWith("static_tx_feed_") && txn.date > "2026-01-01")!;
  const id = String(row._id);
  const entry = (await accounting.postedJournalForTransaction(owner, id)).entries.find((item) => item.source === accounting.TRANSACTION_BACKFILL_SOURCE && item.status === "posted");
  assert.ok(entry, "a posted feed line");
  const entryLines = async () => JSON.stringify((await accounting.postedJournalForTransaction(owner, id)).lines.map((line) => [line.accountId, line.side, line.amountCents]).sort());
  const ledgerBefore = await entryLines();
  const periods = (await db.query<Row>("accountingFiscalPeriods").collect()).filter((period) => period.societyId === S && period.startDate <= entry!.date && period.endDate >= entry!.date);
  const periodId = periods[0]?._id ?? (await db.insert("accountingFiscalPeriods", { societyId: S, fiscalYear: "gate", periodLabel: "Gate period", startDate: String(entry!.date), endDate: String(entry!.date), status: "open", createdAtISO: "", updatedAtISO: "" }));
  const priorStatus = (await get(String(periodId))).status;
  await db.patch(String(periodId), { status: "closed" });
  const current = await get(id);
  const recategorised = current.category === "Program supplies" ? "Office & technology" : "Program supplies";
  const bulk = await hub.bulkUpdateTransactionsPortable(owner, { societyId: S, ids: [id], patch: { category: recategorised } });
  assert.deepEqual([bulk.updated, bulk.skippedLocked], [0, 1], "a bulk category in a closed period is skipped and counted");
  assert.deepEqual(await get(id), current, "and the transaction is left exactly as it was");
  assert.equal(await entryLines(), ledgerBefore, "while its journal entry is untouched");
  const tagged = await linesFns.assignTagPortable(owner, { societyId: S, ids: [id], tagId: tagId("fall_gala") });
  assert.deepEqual([tagged.updated, tagged.skippedLocked], [1, 0], "tags still update in place in a closed period");
  const undone = await hub.restoreTransactionsPortable(owner, { societyId: S, rows: [{ id, values: { ...tagged.previous[0].values, category: recategorised } }] });
  assert.deepEqual([undone.restored, undone.skippedLocked], [0, 1], "an Undo that would re-post is skipped in a closed period");
  assert.deepEqual((await get(id)).tagIds, [tagId("fall_gala")], "and leaves the transaction as it was");
  await db.patch(String(periodId), { status: priorStatus });
  await hub.restoreTransactionsPortable(owner, { societyId: S, rows: tagged.previous });
}

// ---- tag management
await assert.rejects(tagsFns.upsertGroupPortable(owner, { societyId: S, name: " program " }), /already/, "group names are unique, ignoring case and spaces");
const groupId = await tagsFns.upsertGroupPortable(owner, { societyId: S, name: "Location", color: "blue" });
const tagIdNew = await tagsFns.upsertTagPortable(owner, { societyId: S, groupId, name: "Hall" });
await assert.rejects(tagsFns.upsertTagPortable(owner, { societyId: S, groupId, name: "hall" }), /already/);
await assert.rejects(tagsFns.upsertGroupPortable(owner, { societyId: S, name: "Colourful", color: "chartreuse" }), /colour/);
await tagsFns.setTagArchivedPortable(owner, { id: String(tagIdNew), archived: true });
await assert.rejects(linesFns.assignTagPortable(owner, { societyId: S, ids: plain, tagId: String(tagIdNew) }), /archived/, "an archived tag cannot be assigned");
// Saving lines refuses newly added archived tags, and tags in an archived group, but keeps tags a line already had.
{
  const line = await get(plain[0]);
  const save = (tagIds: string[], memo?: string) => linesFns.savePortable(owner, { id: line._id, lines: [{ id: "only", amountCents: line.amountCents, category: line.category, accountingAccountId: line.accountingAccountId, memo, tagIds }] });
  await assert.rejects(save([String(tagIdNew)]), /This tag is archived/, "saving lines can't add an archived tag either");
  const stage = await tagsFns.upsertTagPortable(owner, { societyId: S, groupId, name: "Stage" });
  await tagsFns.setGroupArchivedPortable(owner, { id: String(groupId), archived: true });
  await assert.rejects(save([String(stage)]), /group is archived/);
  await assert.rejects(linesFns.assignTagPortable(owner, { societyId: S, ids: plain, tagId: String(stage) }), /group is archived/, "nor can assigning");
  await tagsFns.setGroupArchivedPortable(owner, { id: String(groupId), archived: false });
  await save([String(stage)]);
  await tagsFns.setTagArchivedPortable(owner, { id: String(stage), archived: true });
  await save([String(stage)], "Kept after archiving");
  assert.deepEqual((await get(line._id)).tagIds, [String(stage)], "a tag the line already had stays on later saves");
  await tagsFns.setTagArchivedPortable(owner, { id: String(stage), archived: false });
  await save([]);
}
const workspace = await tagsFns.workspacePortable(owner, { societyId: S });
assert.ok(workspace.groups.find((group) => group.name === "Location")?.tags[0].archived, "archived tags stay listed, flagged");
assert.ok((workspace.groups.find((group) => group.name === "Event")?.tags[0].transactionCount ?? 0) > 0, "tags count their transactions");

// ---- the transactions tab's filters
const rows = seed.financialTransactions;
const byTag = filterTransactions(rows, { review: "to_review", tagId: tagId("youth_mentoring") });
assert.ok(byTag.every((row) => transactionLines(row).some((line) => line.tagIds?.includes(tagId("youth_mentoring")))), "the tag filter keeps only tagged lines");
const allYouth = [...filterTransactions(rows, { review: "to_review", tagId: tagId("youth_mentoring") }), ...filterTransactions(rows, { review: "reviewed", tagId: tagId("youth_mentoring") })];
assert.ok(allYouth.some((row) => isSplitTransaction({ lines: row.lines })), "a tag on one line of a split matches the split");
assert.ok(allYouth.some((row) => !row.lines), "and single-line rows tagged directly");
const counts = reviewCounts(rows, { review: "to_review" });
assert.equal(counts.to_review + counts.reviewed, rows.length);
assert.equal(counts.reviewed, rows.filter((row) => row.reviewedAtISO).length, "Reviewed holds the rows with a review date");
assert.ok(filterTransactions(rows, { review: "to_review" }).every((row) => !row.reviewedAtISO));
assert.deepEqual(categorisationMethods({ amountCents: -1, category: "" }), ["uncategorised"]);
assert.deepEqual(categorisationMethods({ amountCents: -1, category: "Fees", categorizedBy: "rule", matchedKind: "receipt" }), ["rule", "matched"]);
assert.deepEqual(categorisationMethods({ amountCents: -1, category: "Fees", matchedKind: "manual" }), ["auto"], "clearing on a statement is not a match to a record");
assert.deepEqual(categorisationMethods({ amountCents: -1, category: "", categorizedBy: "manual", lines: [{ id: "a", amountCents: -1 }, { id: "b", amountCents: 0 }] }), ["manual"], "a split is not uncategorised");
assert.ok(filterTransactions(rows, { review: "to_review", method: "rule" }).every((row) => row.categorizedBy === "rule"));

// ---- the export neutralises formulas
const exportRows = transactionExportTextRows(
  [{ date: "2026-05-01", description: "=HYPERLINK(\"http://x\")", counterparty: "+cmd", amountCents: -1234, lines: [{ id: "a", amountCents: -1000, memo: "@SUM(A1)" }, { id: "b", amountCents: -234 }] }],
  "lines",
  { tagName: () => undefined, fundName: () => undefined, accountName: () => undefined },
);
assert.equal(exportRows.length, 3, "one row per line item");
const csv = toDelimitedText(exportRows, "csv");
assert.ok(!/(^|,)"?[=+@]/m.test(csv.replace(/'[=+@-]/g, "")), "no cell starts with a formula character");
assert.ok(csv.includes("'=HYPERLINK") && csv.includes("'+cmd") && csv.includes("'@SUM"), "formula text is prefixed so it stays text");
assert.ok(csv.includes("-12.34") && !csv.includes("'-12.34"), "negative amounts stay numbers");

console.log("transaction lines checks passed: split validation, rules skip splits, split journal posting and re-posting, tags, filters, export guard");
process.exit(0);
