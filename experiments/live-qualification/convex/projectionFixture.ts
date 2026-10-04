// Internal helpers included only in the disposable qualification overlay.
import { internalMutationGeneric } from "convex/server";
import { v } from "convex/values";
import { seedRegisterProjection } from "../../../scripts/fixtures/registerProjection";
function guard() {
  if (process.env.OFFLINE_LOCAL_QUALIFICATION !== "1") throw new Error("Local qualification fixtures are disabled.");
}
export const seed = internalMutationGeneric({
  args: { societyId: v.id("societies"), marker: v.string() },
  handler: async (ctx, args) => {
    guard();
    if (!args.marker.startsWith("qualification-") || !(await ctx.db.get(args.societyId))) throw new Error("Invalid qualification fixture.");
    return seedRegisterProjection(ctx, args.societyId, args.marker);
  },
});
export const cleanup = internalMutationGeneric({
  args: { societyId: v.id("societies"), ids: v.array(v.string()) },
  handler: async (ctx, args) => {
    guard();
    for (const id of args.ids) {
      const row = await ctx.db.get(id as any);
      if (row && "societyId" in row && row.societyId === args.societyId) await ctx.db.delete(id as any);
    }
  },
});
