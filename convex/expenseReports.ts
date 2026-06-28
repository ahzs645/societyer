import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
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
    return rows.sort((a, b) => String(b.incurredAtISO).localeCompare(String(a.incurredAtISO)));
  },
});

export const upsert = mutation({
  args: {
    id: v.optional(v.id("expenseReports")),
    societyId: v.id("societies"),
    claimantName: v.string(),
    claimantUserId: v.optional(v.id("users")),
    title: v.string(),
    category: v.string(),
    amountCents: v.number(),
    currency: v.string(),
    incurredAtISO: v.string(),
    submittedAtISO: v.optional(v.string()),
    status: v.string(),
    receiptDocumentId: v.optional(v.id("documents")),
    paymentReference: v.optional(v.string()),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
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
  },
});

export const setStatus = mutation({
  args: {
    id: v.id("expenseReports"),
    status: v.string(),
    actingUserId: v.optional(v.id("users")),
    paymentReference: v.optional(v.string()),
    // When marking Paid, supplying both accounts posts the reimbursement to the
    // double-entry ledger (debit expense, credit the bank/cash account it was
    // paid from). Omit them to just record the payment without a journal entry.
    expenseAccountId: v.optional(v.id("financialAccounts")),
    bankAccountId: v.optional(v.id("financialAccounts")),
  },
  returns: v.any(),
  handler: async (ctx, { id, status, actingUserId, paymentReference, expenseAccountId, bankAccountId }) => {
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
  },
});

export const remove = mutation({
  args: { id: v.id("expenseReports") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
