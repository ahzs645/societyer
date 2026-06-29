import { v } from "convex/values";
import { mutation, query } from "./lib/untypedServer";

function isoNow() {
  return new Date().toISOString();
}

const statementLine = v.object({
  key: v.string(),
  label: v.string(),
  generalCents: v.number(),
  gamingCents: v.number(),
  notes: v.optional(v.string()),
});

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("orgRevenueStatements")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const get = query({
  args: { id: v.id("orgRevenueStatements") },
  returns: v.any(),
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    organizationName: v.string(),
    fiscalYearLabel: v.string(),
    periodLabel: v.optional(v.string()),
    revenues: v.array(statementLine),
    expenses: v.array(statementLine),
    narrative: v.optional(v.string()),
    status: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const now = isoNow();
    return ctx.db.insert("orgRevenueStatements", {
      ...args,
      status: args.status ?? "Draft",
      createdAtISO: now,
      updatedAtISO: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("orgRevenueStatements"),
    patch: v.object({
      organizationName: v.optional(v.string()),
      fiscalYearLabel: v.optional(v.string()),
      periodLabel: v.optional(v.string()),
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
  args: { id: v.id("orgRevenueStatements") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
