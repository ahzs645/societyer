// Internal, admin-key-only fixtures. Never part of the production function tree.
import { internalMutationGeneric, internalQueryGeneric } from "convex/server";
import { v } from "convex/values";

function guard() {
  if (process.env.OFFLINE_LOCAL_PILOT !== "1") throw new Error("Local pilot fixtures are disabled.");
}
export const seed = internalMutationGeneric({ args: { issuer: v.string(), run: v.string() }, handler: async (ctx, { issuer, run }) => {
  guard();
  const societyA = await ctx.db.insert("societies", { name: `Local pilot A ${run}`, isCharity: false, isMemberFunded: false, updatedAt: Date.now() });
  const societyB = await ctx.db.insert("societies", { name: `Local pilot B ${run}`, isCharity: false, isMemberFunded: false, updatedAt: Date.now() });
  const users: Record<string, string> = {};
  for (const [actor, societyId, role] of [["owner-a", societyA, "Owner"], ["viewer-a", societyA, "Viewer"], ["owner-b", societyB, "Owner"]] as const) {
    users[actor] = await ctx.db.insert("users", { societyId, role, status: "Active", email: `${actor}@example.test`, displayName: actor,
      authSubject: `${actor}-${run}`, authProvider: "better-auth", authIssuer: issuer, createdAtISO: new Date().toISOString() });
  }
  return { societyA, societyB, users };
} });
export const inspect = internalQueryGeneric({ args: { societyId: v.id("societies") }, handler: async (ctx, { societyId }) => {
  guard();
  return {
    meetings: await ctx.db.query("meetings").withIndex("by_society", q => q.eq("societyId", societyId)).collect(),
    aggregates: await ctx.db.query("offlineMeetingAggregates").withIndex("by_society_uuid", q => q.eq("societyId", societyId)).collect(),
    downloads: await ctx.db.query("offlineMeetingDownloads").withIndex("by_society", q => q.eq("society_id", societyId)).collect(),
    users: await ctx.db.query("users").withIndex("by_society", q => q.eq("societyId", societyId)).collect(),
  };
} });
