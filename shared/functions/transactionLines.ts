/**
 * PORTABLE FUNCTIONS: line items, tags and the journal entry of one bank
 * transaction (save / journal / assignTag).
 *
 * A transaction's lines are stored on the `financialTransactions` row
 * (`lines`, plus `tagIds` for a single line; see shared/transactionLines.ts).
 * Saving lines stamps manual categorisation provenance, so rules never undo a
 * split, and keeps an already posted journal entry in step without posting
 * twice (`createTransactionJournalSync`). Every write returns the previous
 * values in the shape `financialHub.restoreTransactions` puts back, so the
 * client can offer Undo. A transaction whose journal entry is dated on or
 * before the books close date can't change: saving lines refuses, and
 * assigning a tag skips it and counts it in `skippedLocked`.
 */

import type { PortableDoc, PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireRolePortable, requireSocietyMembership } from "./access";
import {
  isSplitTransaction,
  storedLineFields,
  transactionLines,
  validateTransactionLines,
  withTagAssigned,
  withoutTagGroup,
  type TransactionLine,
} from "../transactionLines";
import { tagGroupLookup } from "../financeTags";
import { paymentLinkRefusal } from "../reconciliationPeriods";
import {
  assertTransactionBooksOpen,
  createTransactionBooksLock,
  createTransactionJournalSync,
  PENDING_SUSPENSE_ACCOUNT,
  postedJournalForTransaction,
  previewTransactionJournal,
} from "./accounting";
import { BULK_TRANSACTION_LIMIT, snapshotBulkFields } from "./financialHub";

async function loadTagLookup(ctx: PortableQueryCtx, societyId: string) {
  const tags = await ctx.db.query("financeTags").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  return tagGroupLookup(tags.map((tag) => ({ _id: String(tag._id), groupId: String(tag.groupId) })));
}

function lineTransactionOf(row: PortableDoc) {
  return {
    amountCents: Number(row.amountCents) || 0,
    category: row.category,
    accountingAccountId: row.accountingAccountId ? String(row.accountingAccountId) : undefined,
    fundRestrictionId: row.fundRestrictionId ? String(row.fundRestrictionId) : undefined,
    tagIds: Array.isArray(row.tagIds) ? row.tagIds.map(String) : undefined,
    lines: Array.isArray(row.lines) ? (row.lines as TransactionLine[]) : undefined,
  };
}

/** Category or account coding of each line, to tell a recode from a tag or memo edit. */
function codingKey(lines: readonly TransactionLine[]): string {
  return JSON.stringify(lines.map((line) => [line.amountCents, String(line.category ?? "").trim(), line.accountingAccountId ?? ""]));
}

/**
 * Replace a transaction's lines. One line folds back into the plain
 * category; two or more are a split and must add up to the amount. A change
 * of categories, accounts or amounts is a manual categorisation (rule
 * provenance is cleared, so rules leave it alone from then on).
 */
export async function savePortable(
  ctx: PortableMutationCtx,
  { id, lines, actingUserId }: { id: string; lines: TransactionLine[]; actingUserId?: string },
) {
  const row = await ctx.db.get(id, "financialTransactions");
  if (!row) throw new Error("Transaction not found.");
  const societyId = String(row.societyId);
  await requireSocietyMembership(ctx, societyId);
  await requireRolePortable(ctx, { actingUserId, societyId, required: "Director" });
  await getOwned(ctx, "financialTransactions", id, societyId);
  const groupOf = await loadTagLookup(ctx, societyId);
  const cleaned: TransactionLine[] = lines.map((line) => ({
    id: String(line.id ?? "").trim(),
    amountCents: Number(line.amountCents),
    category: line.category,
    accountingAccountId: line.accountingAccountId || undefined,
    fundRestrictionId: line.fundRestrictionId || undefined,
    memo: line.memo,
    tagIds: line.tagIds,
  }));
  const errors = validateTransactionLines(Number(row.amountCents) || 0, cleaned, { groupOf });
  if (errors.length) throw new Error(errors[0]);
  await assertTransactionBooksOpen(ctx, societyId, id);
  for (const line of cleaned) {
    if (line.accountingAccountId) await getOwned(ctx, "financialAccounts", line.accountingAccountId, societyId);
    if (line.fundRestrictionId) await getOwned(ctx, "fundRestrictions", line.fundRestrictionId, societyId);
  }
  const before = transactionLines(lineTransactionOf(row));
  const stored = storedLineFields(cleaned);
  const recoded = codingKey(before) !== codingKey(transactionLines({ amountCents: Number(row.amountCents) || 0, ...stored }));
  // A payment holds this line as one amount in Accounts payable or receivable; tags and memos may still change.
  const refusal = stored.lines ? paymentLinkRefusal(row.matchedKind, "split it") : recoded ? paymentLinkRefusal(row.matchedKind, "change its category") : null;
  if (refusal) throw new Error(refusal);
  const previous = [{ id: String(row._id), values: snapshotBulkFields(row) }];
  await ctx.db.patch(id, {
    lines: stored.lines,
    category: stored.category,
    accountingAccountId: stored.accountingAccountId,
    fundRestrictionId: stored.fundRestrictionId,
    tagIds: stored.tagIds,
    ...(recoded ? { categorizedBy: "manual", ruleId: undefined, ruleApplication: undefined } : {}),
  });
  const journal = await createTransactionJournalSync(ctx, societyId)(id);
  return { id, split: Boolean(stored.lines), journal, previous };
}

/**
 * The transaction's journal entry: what is posted (if anything), and what
 * posting it now would write. Account names are resolved here so the panel
 * shows "5200 Facilities and utilities" rather than ids.
 */
export async function journalPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  const row = await ctx.db.get(id, "financialTransactions");
  if (!row) throw new Error("Transaction not found.");
  const societyId = String(row.societyId);
  await requireSocietyMembership(ctx, societyId);
  await getOwned(ctx, "financialTransactions", id, societyId);
  const [accounts, posted, preview] = await Promise.all([
    ctx.db.query("financialAccounts").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    postedJournalForTransaction(ctx, id),
    previewTransactionJournal(ctx, row),
  ]);
  const accountLabel = (accountId: string) => {
    if (accountId === PENDING_SUSPENSE_ACCOUNT) return "2999 Suspense - unmapped imports (created on first post)";
    const account = accounts.find((candidate) => String(candidate._id) === String(accountId));
    return account ? `${account.code ? `${account.code} ` : ""}${account.name}` : "Removed account";
  };
  const describe = (line: PortableDoc | { accountId: string; side: string; amountCents: number; description?: string; fundRestrictionId?: string; tagIds?: string[]; lineOrder: number }) => ({
    accountId: String(line.accountId),
    accountLabel: accountLabel(String(line.accountId)),
    side: line.side === "debit" ? ("debit" as const) : ("credit" as const),
    amountCents: Number(line.amountCents) || 0,
    description: line.description ? String(line.description) : undefined,
    fundRestrictionId: line.fundRestrictionId ? String(line.fundRestrictionId) : undefined,
    tagIds: Array.isArray(line.tagIds) ? line.tagIds.map(String) : [],
    lineOrder: Number(line.lineOrder) || 0,
  });
  const entry = posted.entries[0];
  return {
    posted: entry
      ? {
          entryId: String(entry._id),
          entryNumber: entry.entryNumber ? String(entry.entryNumber) : undefined,
          date: String(entry.date),
          status: String(entry.status),
          source: String(entry.source),
          lines: posted.lines
            .filter((line) => String(line.journalEntryId) === String(entry._id))
            .map(describe)
            .sort((a, b) => a.lineOrder - b.lineOrder),
        }
      : null,
    preview: { status: preview.status, lines: preview.lines.map(describe) },
  };
}

/**
 * Assign a tag to every line of the given transactions (replacing any other
 * tag from its group), or with `tagId: null` remove the group's tag. Lines
 * from another organization are only counted as skipped.
 */
export async function assignTagPortable(
  ctx: PortableMutationCtx,
  { societyId, ids, tagId, groupId, actingUserId }: { societyId: string; ids: string[]; tagId: string | null; groupId?: string; actingUserId?: string },
) {
  await requireSocietyMembership(ctx, societyId);
  await requireRolePortable(ctx, { actingUserId, societyId, required: "Director" });
  const unique = [...new Set(ids.map(String))];
  if (unique.length === 0) throw new Error("Select at least one transaction.");
  if (unique.length > BULK_TRANSACTION_LIMIT) throw new Error(`Tag at most ${BULK_TRANSACTION_LIMIT} transactions at once.`);
  let removeGroup: string | undefined;
  if (tagId) {
    const tag = await getOwned(ctx, "financeTags", tagId, societyId);
    if (tag.archivedAtISO) throw new Error("This tag is archived. Restore it on the Tags page to use it again.");
  } else {
    if (!groupId) throw new Error("Choose a tag, or the group to clear.");
    await getOwned(ctx, "financeTagGroups", groupId, societyId);
    removeGroup = groupId;
  }
  const groupOf = await loadTagLookup(ctx, societyId);
  const next = (tagIds: readonly string[] | undefined) => (tagId ? withTagAssigned(tagIds, tagId, groupOf) : withoutTagGroup(tagIds, removeGroup!, groupOf));
  const sameTags = (a: readonly string[] | undefined, b: readonly string[]) => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...b].sort());
  const sync = createTransactionJournalSync(ctx, societyId);
  const lockedByBooks = createTransactionBooksLock(ctx, societyId);
  const previous: Array<{ id: string; values: Record<string, unknown> }> = [];
  let skipped = 0;
  let skippedLocked = 0;
  for (const id of unique) {
    const row = await ctx.db.get(id, "financialTransactions");
    if (!row || String(row.societyId) !== String(societyId)) {
      skipped += 1;
      continue;
    }
    const txn = lineTransactionOf(row);
    let patch: Record<string, unknown> | null = null;
    if (isSplitTransaction(txn)) {
      const lines = txn.lines!.map((line) => ({ ...line, tagIds: next(line.tagIds) }));
      if (lines.some((line, index) => !sameTags(txn.lines![index].tagIds, line.tagIds))) {
        patch = { lines: lines.map((line) => ({ ...line, tagIds: line.tagIds.length ? line.tagIds : undefined })) };
      }
    } else {
      const tagIds = next(txn.tagIds);
      if (!sameTags(txn.tagIds, tagIds)) patch = { tagIds: tagIds.length ? tagIds : undefined };
    }
    if (!patch) continue;
    if (await lockedByBooks(id)) {
      skippedLocked += 1;
      continue;
    }
    previous.push({ id: String(row._id), values: snapshotBulkFields(row) });
    await ctx.db.patch(id, patch);
    await sync(id, { onLocked: "skip" });
  }
  return { updated: previous.length, skipped, skippedLocked, previous };
}
