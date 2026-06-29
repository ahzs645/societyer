/**
 * PORTABLE FUNCTIONS: the expense-reports domain
 * (list / upsert / setStatus / remove).
 *
 * Reads/writes the `expenseReports` table over `ctx.db`, and on payment posts a
 * double-entry journal entry to `journalEntries`/`journalLines`. Each handler
 * runs unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const reports = await ctx.db
    .query("expenseReports")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const rows = await Promise.all(
    reports.map(async (report) => ({
      ...report,
      receiptDocument: report.receiptDocumentId ? await ctx.db.get(report.receiptDocumentId) : null,
      claimantUser: report.claimantUserId ? await ctx.db.get(report.claimantUserId) : null,
      approverUser: report.approverUserId ? await ctx.db.get(report.approverUserId) : null,
    })),
  );
  return rows.sort((a: any, b: any) => String(b.incurredAtISO).localeCompare(String(a.incurredAtISO)));
}

export async function upsertPortable(
  ctx: PortableMutationCtx,
  args: {
    id?: string;
    societyId: string;
    claimantName: string;
    claimantUserId?: string;
    title: string;
    category: string;
    amountCents: number;
    currency: string;
    incurredAtISO: string;
    submittedAtISO?: string;
    status: string;
    receiptDocumentId?: string;
    paymentReference?: string;
    notes?: string;
    actingUserId?: string;
  },
) {
  if (!args.title.trim()) throw new Error("Expense title is required.");
  if (!args.claimantName.trim()) throw new Error("Claimant name is required.");
  if (args.amountCents < 0) throw new Error("Amount cannot be negative.");
  if (args.receiptDocumentId) {
    const receipt = await ctx.db.get(args.receiptDocumentId);
    if (!receipt || receipt.societyId !== args.societyId) {
      throw new Error("Receipt document is not in this society.");
    }
  }
  const nowISO = new Date().toISOString();
  const payload = {
    societyId: args.societyId,
    claimantName: args.claimantName,
    claimantUserId: args.claimantUserId,
    title: args.title,
    category: args.category,
    amountCents: args.amountCents,
    currency: args.currency,
    incurredAtISO: args.incurredAtISO,
    submittedAtISO: args.submittedAtISO,
    status: args.status,
    receiptDocumentId: args.receiptDocumentId,
    paymentReference: args.paymentReference,
    notes: args.notes,
    updatedAtISO: nowISO,
  };
  if (args.id) {
    await ctx.db.patch(args.id, payload);
    return args.id;
  }
  return await ctx.db.insert("expenseReports", {
    ...payload,
    createdAtISO: nowISO,
  });
}

export async function setStatusPortable(
  ctx: PortableMutationCtx,
  {
    id,
    status,
    actingUserId,
    paymentReference,
    expenseAccountId,
    bankAccountId,
  }: {
    id: string;
    status: string;
    actingUserId?: string;
    paymentReference?: string;
    expenseAccountId?: string;
    bankAccountId?: string;
  },
) {
  const report = await ctx.db.get(id);
  if (!report) return;
  const nowISO = new Date().toISOString();
  const patch: any = {
    status,
    updatedAtISO: nowISO,
  };
  if (status === "Submitted" && !report.submittedAtISO) patch.submittedAtISO = nowISO;
  if (status === "Approved") {
    patch.approverUserId = actingUserId;
    patch.approvedAtISO = nowISO;
  }
  if (status === "Paid") {
    patch.paidAtISO = nowISO;
    patch.paymentReference = paymentReference ?? report.paymentReference;

    // Post to the ledger once, only when both accounts are explicitly chosen
    // (never guess accounts for a money posting).
    if (expenseAccountId && bankAccountId && !report.journalEntryId) {
      const [expenseAccount, bankAccount] = await Promise.all([
        ctx.db.get(expenseAccountId),
        ctx.db.get(bankAccountId),
      ]);
      if (
        expenseAccount?.societyId === report.societyId &&
        bankAccount?.societyId === report.societyId
      ) {
        const amount = Math.abs(report.amountCents ?? 0);
        if (amount > 0) {
          const entryId = await ctx.db.insert("journalEntries", {
            societyId: report.societyId,
            date: nowISO.slice(0, 10),
            memo: `Reimbursement: ${report.title} (${report.claimantName})`,
            source: "expenseReport",
            status: "posted",
            createdByUserId: actingUserId,
            postedAtISO: nowISO,
            sourceDocumentIds: report.receiptDocumentId ? [report.receiptDocumentId] : undefined,
            createdAtISO: nowISO,
            updatedAtISO: nowISO,
          });
          const common = { societyId: report.societyId, journalEntryId: entryId, amountCents: amount, createdAtISO: nowISO, updatedAtISO: nowISO };
          await ctx.db.insert("journalLines", { ...common, accountId: expenseAccountId, lineOrder: 0, side: "debit", description: report.title });
          await ctx.db.insert("journalLines", { ...common, accountId: bankAccountId, lineOrder: 1, side: "credit", description: report.paymentReference ?? "Reimbursement payment" });
          patch.journalEntryId = entryId;
        }
      }
    }
  }
  await ctx.db.patch(id, patch);
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  await ctx.db.delete(id);
}
