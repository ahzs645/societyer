/**
 * PORTABLE FUNCTIONS: the receipt inbox.
 *
 * Receipt files are uploaded in bulk as `documents` (category Receipt); each
 * gets a `receiptInboxItems` row with a merchant, amount and date prefilled
 * from its file name where possible (no OCR). The list suggests the bank
 * transactions each receipt may belong to (shared/receiptMatching.ts).
 * Confirming a match attaches the document as the transaction's receipt
 * through the same handler the transaction panel uses
 * (financialHub.updateTransaction), so `receiptDocumentId` and
 * `receiptStatus` stay in step; removing or replacing a receipt there puts a
 * matched inbox item back in the inbox (`releaseInboxMatches`). A document
 * already some transaction's receipt isn't added. Each handler runs unchanged
 * on hosted Convex, the local Dexie runtime, and the convex-test oracle.
 */

import type { PortableDoc, PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireOwnedRow, requireSocietyMembership } from "./access";
import { requirePermissionPortable } from "./permissions";
import { updateTransactionPortable } from "./financialHub";
import { highConfidencePairs, parseReceiptFilename, rankReceiptCandidates, scoreReceiptMatch, type TransactionForMatching } from "../receiptMatching";
import { addDaysToDateOnly, isDateOnly, todayDateOnly } from "../dateOnly";

type InboxRow = PortableDoc & {
  societyId: string;
  documentId: string;
  fileName: string;
  merchant?: string;
  amountCents?: number;
  date?: string;
  status: string;
  matchedTransactionId?: string;
  matchedAtISO?: string;
  matchedByName?: string;
  matchScore?: number;
  uploadedByName?: string;
  createdAtISO: string;
};

type TxnRow = PortableDoc & TransactionForMatching & { societyId: string; accountId: string };

/** How far back unmatched receipts look for transactions. */
const CANDIDATE_LOOKBACK_DAYS = 550;
const MAX_ITEMS_PER_UPLOAD = 50;

async function actorName(ctx: PortableQueryCtx, societyId: string) {
  const user = await requireSocietyMembership(ctx, societyId);
  return { id: String(user._id), name: String(user.displayName ?? user.name ?? "Workspace owner") };
}

async function openTransactions(ctx: PortableQueryCtx, societyId: string): Promise<TxnRow[]> {
  const from = addDaysToDateOnly(todayDateOnly(), -CANDIDATE_LOOKBACK_DAYS) ?? "0000-00-00";
  const rows = await ctx.db.query<TxnRow>("financialTransactions").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  return rows.filter((row) => row.amountCents < 0 && !row.receiptDocumentId && row.date >= from);
}

/**
 * Inbox items (newest first) with the documents behind them and, for each
 * unmatched one, up to three suggested transactions.
 */
export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const [items, allTxns, accounts] = await Promise.all([
    ctx.db.query<InboxRow>("receiptInboxItems").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query<TxnRow>("financialTransactions").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("financialAccounts").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  const accountName = new Map(accounts.map((row) => [String(row._id), String(row.name)]));
  const txnById = new Map(allTxns.map((row) => [String(row._id), row]));
  const open = await openTransactions(ctx, societyId);
  const describeTxn = (txn: TxnRow) => ({
    _id: String(txn._id),
    date: txn.date,
    description: String(txn.description ?? ""),
    counterparty: txn.counterparty ?? undefined,
    amountCents: txn.amountCents,
    accountName: accountName.get(String(txn.accountId)),
  });
  const rows = await Promise.all(
    items.map(async (item) => {
      const document = await ctx.db.get(String(item.documentId), "documents").catch(() => null);
      const matched = item.matchedTransactionId ? txnById.get(String(item.matchedTransactionId)) : undefined;
      const candidates = item.status === "unmatched"
        ? rankReceiptCandidates(item, open).map((candidate) => {
            const txn = txnById.get(candidate.transactionId);
            return { ...candidate, transaction: txn ? describeTxn(txn) : null };
          }).filter((candidate) => candidate.transaction !== null)
        : [];
      return {
        _id: String(item._id),
        documentId: String(item.documentId),
        document: document && String(document.societyId) === String(societyId)
          ? { _id: String(document._id), title: String(document.title ?? item.fileName), fileName: document.fileName as string | undefined, latestVersionId: document.latestVersionId as string | undefined }
          : null,
        fileName: item.fileName,
        merchant: item.merchant,
        amountCents: item.amountCents,
        date: item.date,
        status: item.status,
        uploadedByName: item.uploadedByName,
        createdAtISO: item.createdAtISO,
        matchedAtISO: item.matchedAtISO,
        matchedByName: item.matchedByName,
        matchedTransaction: matched ? describeTxn(matched) : null,
        candidates,
      };
    }),
  );
  rows.sort((a, b) => String(b.createdAtISO).localeCompare(String(a.createdAtISO)) || String(a.fileName).localeCompare(String(b.fileName)));
  const unmatched = rows.filter((row) => row.status === "unmatched");
  return {
    rows,
    counts: {
      unmatched: unmatched.length,
      matched: rows.filter((row) => row.status === "matched").length,
      discarded: rows.filter((row) => row.status === "discarded").length,
    },
    highConfidenceCount: highConfidencePairs(unmatched.map((row) => ({ _id: row._id, merchant: row.merchant, amountCents: row.amountCents, date: row.date })), open).length,
  };
}

function cleanFields(input: { merchant?: string | null; amountCents?: number | null; date?: string | null }) {
  const out: { merchant?: string; amountCents?: number; date?: string } = {};
  if (input.merchant !== undefined && input.merchant !== null) {
    const merchant = String(input.merchant).trim();
    if (merchant.length > 200) throw new Error("Keep the merchant under 200 characters.");
    out.merchant = merchant || undefined;
  }
  if (input.amountCents !== undefined && input.amountCents !== null) {
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new Error("Enter the receipt total as a positive amount.");
    out.amountCents = input.amountCents;
  }
  if (input.date !== undefined && input.date !== null && input.date !== "") {
    if (!isDateOnly(input.date)) throw new Error("Enter the receipt date as YYYY-MM-DD.");
    out.date = input.date;
  }
  return out;
}

/**
 * Add uploaded receipt documents to the inbox. Fields the caller leaves out
 * are prefilled from the file name; a document already in the inbox, or
 * already attached to a transaction as its receipt (counted in
 * `alreadyAttached`), is skipped.
 */
export async function addPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; items: Array<{ documentId: string; fileName: string; merchant?: string; amountCents?: number; date?: string }> },
) {
  await requirePermissionPortable(ctx, args.societyId, "financials:write");
  if (!args.items.length) throw new Error("Choose at least one receipt.");
  if (args.items.length > MAX_ITEMS_PER_UPLOAD) throw new Error(`Add at most ${MAX_ITEMS_PER_UPLOAD} receipts at a time.`);
  const actor = await actorName(ctx, args.societyId);
  const nowISO = new Date().toISOString();
  const ids: string[] = [];
  let skipped = 0;
  let alreadyAttached = 0;
  const transactions = await ctx.db.query<TxnRow>("financialTransactions").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).collect();
  const attachedDocuments = new Set(transactions.map((row) => String(row.receiptDocumentId ?? "")).filter(Boolean));
  for (const input of args.items) {
    await getOwned(ctx, "documents", input.documentId, args.societyId);
    const existing = await ctx.db.query<InboxRow>("receiptInboxItems").withIndex("by_document", (q) => q.eq("documentId", input.documentId)).collect();
    if (existing.length || attachedDocuments.has(String(input.documentId))) {
      skipped += 1;
      if (!existing.length) alreadyAttached += 1;
      continue;
    }
    const fileName = String(input.fileName || "Receipt").slice(0, 240);
    const prefill = parseReceiptFilename(fileName);
    const fields = cleanFields({
      merchant: input.merchant ?? prefill.merchant,
      amountCents: input.amountCents ?? prefill.amountCents,
      date: input.date ?? prefill.date,
    });
    ids.push(await ctx.db.insert("receiptInboxItems", {
      societyId: args.societyId,
      documentId: input.documentId,
      fileName,
      ...fields,
      status: "unmatched",
      uploadedByUserId: actor.id.startsWith("local-workspace-owner:") ? undefined : actor.id,
      uploadedByName: actor.name,
      createdAtISO: nowISO,
      updatedAtISO: nowISO,
    }));
  }
  return { added: ids.length, skipped, alreadyAttached, ids };
}

/** Correct an inbox item's merchant, amount or date (null clears it). */
export async function updatePortable(
  ctx: PortableMutationCtx,
  args: { id: string; merchant?: string | null; amountCents?: number | null; date?: string | null },
) {
  const item = await requireOwnedRow<InboxRow>(ctx, "receiptInboxItems", args.id);
  await requirePermissionPortable(ctx, item.societyId, "financials:write");
  const patch: Record<string, unknown> = { ...cleanFields(args), updatedAtISO: new Date().toISOString() };
  if (args.merchant === null || args.merchant === "") patch.merchant = undefined;
  if (args.amountCents === null) patch.amountCents = undefined;
  if (args.date === null || args.date === "") patch.date = undefined;
  await ctx.db.patch(args.id, patch);
  return args.id;
}

/**
 * Put back in the inbox every receipt matched to this transaction that is no
 * longer its receipt (removed or replaced from the transaction panel, through
 * financialHub.updateTransaction). `currentDocumentId` is the receipt it has now.
 */
export async function releaseInboxMatches(ctx: PortableMutationCtx, transactionId: string, currentDocumentId: string | undefined) {
  const items = await ctx.db.query<InboxRow>("receiptInboxItems").withIndex("by_transaction", (q) => q.eq("matchedTransactionId", transactionId)).collect();
  const at = new Date().toISOString();
  for (const item of items) {
    if (item.status !== "matched" || String(item.documentId) === String(currentDocumentId ?? "")) continue;
    await ctx.db.patch(item._id, { status: "unmatched", matchedTransactionId: undefined, matchedAtISO: undefined, matchedByName: undefined, matchScore: undefined, updatedAtISO: at });
  }
}

async function attach(ctx: PortableMutationCtx, item: InboxRow, transactionId: string, actor: { name: string }) {
  const txn = await getOwned<TxnRow>(ctx, "financialTransactions", transactionId, item.societyId);
  if (txn.receiptDocumentId) throw new Error("That transaction already has a receipt. Remove it from the transaction first.");
  // The same path as attaching a receipt from the transaction panel.
  await updateTransactionPortable(ctx, { id: transactionId, patch: { receiptDocumentId: item.documentId } });
  const score = scoreReceiptMatch(item, txn);
  await ctx.db.patch(item._id, {
    status: "matched",
    matchedTransactionId: transactionId,
    matchedAtISO: new Date().toISOString(),
    matchedByName: actor.name,
    matchScore: score?.score,
    updatedAtISO: new Date().toISOString(),
  });
}

/** Attach the receipt to a transaction. */
export async function confirmMatchPortable(ctx: PortableMutationCtx, { id, transactionId }: { id: string; transactionId: string }) {
  const item = await requireOwnedRow<InboxRow>(ctx, "receiptInboxItems", id);
  await requirePermissionPortable(ctx, item.societyId, "financials:write");
  if (item.status !== "unmatched") throw new Error("Only unmatched receipts can be matched.");
  await attach(ctx, item, transactionId, await actorName(ctx, item.societyId));
  return id;
}

/** Take the receipt off its transaction and put it back in the inbox. */
export async function unmatchPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const item = await requireOwnedRow<InboxRow>(ctx, "receiptInboxItems", id);
  await requirePermissionPortable(ctx, item.societyId, "financials:write");
  if (item.status !== "matched") throw new Error("This receipt isn't matched.");
  if (item.matchedTransactionId) {
    const txn = await ctx.db.get<TxnRow>(String(item.matchedTransactionId), "financialTransactions");
    // Only clear the receipt if it is still this document.
    if (txn && String(txn.societyId) === item.societyId && String(txn.receiptDocumentId ?? "") === String(item.documentId)) {
      await updateTransactionPortable(ctx, { id: String(txn._id), patch: { receiptDocumentId: null } });
    }
  }
  await ctx.db.patch(id, {
    status: "unmatched",
    matchedTransactionId: undefined,
    matchedAtISO: undefined,
    matchedByName: undefined,
    matchScore: undefined,
    updatedAtISO: new Date().toISOString(),
  });
  return id;
}

/** Discard (the document stays in Documents) or restore an unmatched receipt. */
export async function setDiscardedPortable(ctx: PortableMutationCtx, { id, discarded }: { id: string; discarded: boolean }) {
  const item = await requireOwnedRow<InboxRow>(ctx, "receiptInboxItems", id);
  await requirePermissionPortable(ctx, item.societyId, "financials:write");
  if (item.status === "matched") throw new Error("Unmatch the receipt before discarding it.");
  await ctx.db.patch(id, { status: discarded ? "discarded" : "unmatched", updatedAtISO: new Date().toISOString() });
  return id;
}

/** Attach every receipt whose top suggestion is high confidence and not claimed by another receipt. */
export async function matchAllHighConfidencePortable(ctx: PortableMutationCtx, { societyId }: { societyId: string }) {
  await requirePermissionPortable(ctx, societyId, "financials:write");
  const items = await ctx.db.query<InboxRow>("receiptInboxItems").withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", "unmatched")).collect();
  const open = await openTransactions(ctx, societyId);
  const pairs = highConfidencePairs(items.map((item) => ({ _id: String(item._id), merchant: item.merchant, amountCents: item.amountCents, date: item.date })), open);
  const actor = await actorName(ctx, societyId);
  const byId = new Map(items.map((item) => [String(item._id), item]));
  for (const pair of pairs) {
    const item = byId.get(pair.itemId);
    if (item) await attach(ctx, item, pair.transactionId, actor);
  }
  return { matched: pairs.length, remaining: items.length - pairs.length };
}
