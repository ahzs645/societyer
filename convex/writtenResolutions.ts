import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

const signature = v.object({
  signerName: v.string(),
  signedAtISO: v.string(),
  memberId: v.optional(v.id("members")),
});

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("writtenResolutions")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    title: v.string(),
    text: v.string(),
    kind: v.string(),
    requiredCount: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    ctx.db.insert("writtenResolutions", {
      ...args,
      circulatedAtISO: new Date().toISOString(),
      signatures: [],
      status: "Circulating",
    }),
});

export const sign = mutation({
  args: {
    id: v.id("writtenResolutions"),
    signerName: v.string(),
    memberId: v.optional(v.id("members")),
  },
  handler: async (ctx, { id, signerName, memberId }) => {
    const row = await ctx.db.get(id);
    if (!row) return;
    const signatures = [
      ...row.signatures,
      { signerName, memberId, signedAtISO: new Date().toISOString() },
    ];
    const status =
      signatures.length >= row.requiredCount ? "Carried" : row.status;
    const completedAtISO =
      status === "Carried" ? new Date().toISOString() : row.completedAtISO;
    await ctx.db.patch(id, { signatures, status, completedAtISO });
  },
});

export const markFailed = mutation({
  args: { id: v.id("writtenResolutions"), note: v.optional(v.string()) },
  handler: async (ctx, { id, note }) => {
    await ctx.db.patch(id, { status: "Failed", notes: note });
  },
});

export const remove = mutation({
  args: { id: v.id("writtenResolutions") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
