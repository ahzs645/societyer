/** One operator maintenance lane per workspace; not a lock on normal reads or imports. */
import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { internalMutation } from "./_generated/server";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const LEASE_MS = 5 * 60_000;
const scope = { societyId: v.id("societies"), owner: v.string() };

export const acquire = internalMutation({
  args: { ...scope, purpose: v.string() }, returns: v.null(),
  handler: async (ctx, a) => {
    const prior = await ctx.db.query("procurementMaintenanceLeases").withIndex("by_society", q => q.eq("societyId", a.societyId)).unique();
    if (prior && prior.owner !== a.owner && prior.expiresAt > Date.now())
      throw new Error(`Procurement maintenance already running (${prior.purpose}). Wait for it to finish, then resume the same checkpoint.`);
    const data = { ...a, expiresAt: Date.now() + LEASE_MS };
    if (prior) await ctx.db.replace(prior._id, data);
    else await ctx.db.insert("procurementMaintenanceLeases", data);
    return null;
  },
});

export const release = internalMutation({
  args: scope, returns: v.null(),
  handler: async (ctx, a) => {
    const prior = await ctx.db.query("procurementMaintenanceLeases").withIndex("by_society", q => q.eq("societyId", a.societyId)).unique();
    if (prior?.owner === a.owner) await ctx.db.delete(prior._id);
    return null;
  },
});

/** Direct legacy page calls must also respect an action's reservation. */
export async function requireMaintenanceLease(ctx: MutationCtx, societyId: Id<"societies">, owner?: string) {
  const lease = await ctx.db.query("procurementMaintenanceLeases").withIndex("by_society", q => q.eq("societyId", societyId)).unique();
  if (owner ? lease?.owner !== owner || lease.expiresAt <= Date.now() : lease && lease.expiresAt > Date.now())
    throw new Error("Procurement maintenance reservation unavailable; resume through the maintenance action.");
}

export async function withMaintenanceLease<T>(ctx: ActionCtx, societyId: Id<"societies">, purpose: string, run: (owner: string, renew: () => Promise<unknown>) => Promise<T>): Promise<T> {
  const owner = crypto.randomUUID();
  const renew = () => ctx.runMutation(makeFunctionReference<"mutation">("procurementMaintenance:acquire"), { societyId, owner, purpose });
  await renew();
  try { return await run(owner, renew); }
  finally { await ctx.runMutation(makeFunctionReference<"mutation">("procurementMaintenance:release"), { societyId, owner }); }
}
