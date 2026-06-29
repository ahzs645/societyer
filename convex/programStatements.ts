import { v } from "convex/values";
import { mutation, query } from "./lib/untypedServer";

function isoNow() {
  return new Date().toISOString();
}

const statementLine = v.object({
  key: v.string(),
  label: v.string(),
  actualCents: v.number(),
  budgetCents: v.number(),
  notes: v.optional(v.string()),
});

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("programStatements")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const get = query({
  args: { id: v.id("programStatements") },
  returns: v.any(),
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    grantId: v.optional(v.id("grants")),
    programName: v.string(),
    funderName: v.optional(v.string()),
    priorFiscalYearLabel: v.string(),
    currentFiscalYearLabel: v.string(),
    revenues: v.array(statementLine),
    expenses: v.array(statementLine),
    narrative: v.optional(v.string()),
    status: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const now = isoNow();
    return ctx.db.insert("programStatements", {
      ...args,
      status: args.status ?? "Draft",
      createdAtISO: now,
      updatedAtISO: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("programStatements"),
    patch: v.object({
      grantId: v.optional(v.id("grants")),
      programName: v.optional(v.string()),
      funderName: v.optional(v.string()),
      priorFiscalYearLabel: v.optional(v.string()),
      currentFiscalYearLabel: v.optional(v.string()),
      revenues: v.optional(v.array(statementLine)),
      expenses: v.optional(v.array(statementLine)),
      narrative: v.optional(v.string()),
      status: v.optional(v.string()),
    }),
  },
  returns: v.any(),
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, { ...patch, updatedAtISO: isoNow() });
  },
});

export const remove = mutation({
  args: { id: v.id("programStatements") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
