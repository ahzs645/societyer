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
import { getOwned, requireOwnedRow, principalUserId, requireSocietyMembership } from "./access";

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const reports = await ctx.db
    .query("expenseReports")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const rows = await Promise.all(
    reports.map(async (report) => ({
      ...report,
      receiptDocument: report.receiptDocumentId
        ? await getOwned(ctx, "documents", report.receiptDocumentId, societyId)
        : null,
      claimantUser: report.claimantUserId
        ? await getOwned(ctx, "users", report.claimantUserId, societyId)
        : null,
      approverUser: report.approverUserId
        ? await getOwned(ctx, "users", report.approverUserId, societyId)
        : null,
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
  await requireSocietyMembership(ctx, args.societyId);
  const principalId = await principalUserId(ctx, args.societyId);
  if (args.actingUserId && args.actingUserId !== principalId) {
    throw new Error("Authenticated actor does not match the current principal.");
  }
  await Promise.all([
    args.id ? getOwned(ctx, "expenseReports", args.id, args.societyId) : Promise.resolve(),
    args.claimantUserId ? getOwned(ctx, "users", args.claimantUserId, args.societyId) : Promise.resolve(),
    args.receiptDocumentId ? getOwned(ctx, "documents", args.receiptDocumentId, args.societyId) : Promise.resolve(),
  ]);
  if (!args.title.trim()) throw new Error("Expense title is required.");
  if (!args.claimantName.trim()) throw new Error("Claimant name is required.");
  if (args.amountCents < 0) throw new Error("Amount cannot be negative.");
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
  const report = await requireOwnedRow(ctx, "expenseReports", id);
  const societyId = String(report.societyId);
  const principalId = await principalUserId(ctx, societyId);
  if (actingUserId && actingUserId !== principalId) {
    throw new Error("Authenticated actor does not match the current principal.");
  }
  await Promise.all([
    expenseAccountId
      ? getOwned(ctx, "financialAccounts", expenseAccountId, societyId)
      : Promise.resolve(),
    bankAccountId
      ? getOwned(ctx, "financialAccounts", bankAccountId, societyId)
      : Promise.resolve(),
  ]);
  const nowISO = new Date().toISOString();
  const patch: any = {
    status,
    updatedAtISO: nowISO,
  };
  if (status === "Submitted" && !report.submittedAtISO) patch.submittedAtISO = nowISO;
  if (status === "Approved") {
    patch.approverUserId = await principalUserId(ctx, societyId);
    patch.approvedAtISO = nowISO;
  }
  if (status === "Paid") {
    patch.paidAtISO = nowISO;
    patch.paymentReference = paymentReference ?? report.paymentReference;

    // Post to the ledger once, only when both accounts are explicitly chosen
    // (never guess accounts for a money posting).
    if (expenseAccountId && bankAccountId && !report.journalEntryId) {
      const [expenseAccount, bankAccount] = await Promise.all([
        getOwned(ctx, "financialAccounts", expenseAccountId, societyId),
        getOwned(ctx, "financialAccounts", bankAccountId, societyId),
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
            createdByUserId: await principalUserId(ctx, societyId),
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
  await requireOwnedRow(ctx, "expenseReports", id);
  await ctx.db.delete(id);
}
