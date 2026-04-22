import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

const remItem = v.object({ role: v.string(), amountCents: v.number() });

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("financials")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const detailByFiscalYear = query({
  args: { societyId: v.id("societies"), fiscalYear: v.string() },
  returns: v.any(),
  handler: async (ctx, { societyId, fiscalYear }) => {
    const rows = await ctx.db
      .query("financials")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const financials = rows
      .filter((row) => row.fiscalYear === fiscalYear)
      .sort((a, b) => String(b.periodEnd ?? "").localeCompare(String(a.periodEnd ?? "")));
    const financial = financials[0] ?? null;

    const imports = await ctx.db
      .query("financialStatementImports")
      .withIndex("by_society_fy", (q) => q.eq("societyId", societyId).eq("fiscalYear", fiscalYear))
      .collect();
    const importsWithLines = await Promise.all(
      imports
        .sort((a, b) => String(b.periodEnd ?? "").localeCompare(String(a.periodEnd ?? "")))
        .map(async (row) => {
          const lines = await ctx.db
            .query("financialStatementImportLines")
            .withIndex("by_statement_import", (q) => q.eq("statementImportId", row._id))
            .collect();
          return {
            ...row,
            lines: lines.sort((a, b) => a._creationTime - b._creationTime),
          };
        }),
    );

    const documentIds = new Set<string>();
    if (financial?.statementsDocId) documentIds.add(financial.statementsDocId);
    for (const row of importsWithLines) {
      for (const id of row.sourceDocumentIds ?? []) documentIds.add(id);
    }
    const documents = (await Promise.all(Array.from(documentIds).map((id) => ctx.db.get(id as any))))
      .filter(Boolean);

    const budgets = await ctx.db
      .query("budgets")
      .withIndex("by_society_fy", (q) => q.eq("societyId", societyId).eq("fiscalYear", fiscalYear))
      .collect();
    const presentedAtMeeting = financial?.presentedAtMeetingId
      ? await ctx.db.get(financial.presentedAtMeetingId)
      : null;

    return {
      financial,
      financials,
      imports: importsWithLines,
      documents,
      budgets,
      presentedAtMeeting,
    };
  },
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    fiscalYear: v.string(),
    periodEnd: v.string(),
    revenueCents: v.number(),
    expensesCents: v.number(),
    netAssetsCents: v.number(),
    restrictedFundsCents: v.optional(v.number()),
    auditStatus: v.string(),
    auditorName: v.optional(v.string()),
    remunerationDisclosures: v.array(remItem),
  },
  returns: v.any(),
  handler: async (ctx, args) => ctx.db.insert("financials", args),
});

export const update = mutation({
  args: {
    id: v.id("financials"),
    patch: v.object({
      fiscalYear: v.optional(v.string()),
      periodEnd: v.optional(v.string()),
      revenueCents: v.optional(v.number()),
      expensesCents: v.optional(v.number()),
      netAssetsCents: v.optional(v.number()),
      restrictedFundsCents: v.optional(v.number()),
      auditStatus: v.optional(v.string()),
      auditorName: v.optional(v.string()),
      approvedByBoardAt: v.optional(v.string()),
      presentedAtMeetingId: v.optional(v.id("meetings")),
      remunerationDisclosures: v.optional(v.array(remItem)),
    }),
  },
  returns: v.any(),
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, patch);
  },
});

export const remove = mutation({
  args: { id: v.id("financials") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
