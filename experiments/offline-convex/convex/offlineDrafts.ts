import { mutationGeneric, queryGeneric, type DataModelFromSchemaDefinition, type MutationBuilder, type QueryBuilder } from "convex/server";
import { ConvexError, v, type GenericId } from "convex/values";
import type schema from "./schema";
import { toPortableQueryCtx } from "../../../convex/lib/portable";
import { requirePermissionPortable } from "../../../shared/functions/permissions";

const operation = v.object({ id: v.string(), baseRevision: v.number(), title: v.string(), content: v.string() });
type DataModel = DataModelFromSchemaDefinition<typeof schema>;
const mutation = mutationGeneric as MutationBuilder<DataModel, "public">;
const query = queryGeneric as QueryBuilder<DataModel, "public">;
export const applyBatch = mutation({
  args: { societyId: v.id("societies"), batchId: v.string(), operations: v.array(operation) },
  handler: async (ctx, args) => {
    // Reuses Societyer's actual verified identity, membership and permission policy.
    const user = await requirePermissionPortable(await toPortableQueryCtx(ctx), args.societyId, "documents:write");
    const userId = user._id as GenericId<"users">;
    if (!args.batchId || args.batchId.length > 200 || !args.operations.length || args.operations.length > 50) {
      throw new ConvexError({ code: "INVALID_BATCH" });
    }
    const payload = JSON.stringify(args.operations);
    if (payload.length > 64_000) throw new ConvexError({ code: "INVALID_BATCH" });
    const receipt = await ctx.db.query("offlineDraftReceipts")
      .withIndex("by_actor_batch", q => q.eq("societyId", args.societyId).eq("userId", userId).eq("batchId", args.batchId)).unique();
    if (receipt) {
      if (receipt.payload !== payload) throw new ConvexError({ code: "REPLAY_MISMATCH" });
      return { accepted: true, replay: true };
    }
    for (const op of args.operations) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(op.id) || !Number.isInteger(op.baseRevision) || op.baseRevision < 0 ||
          !op.title.trim() || op.title.length > 200 || op.content.length > 20_000) {
        throw new ConvexError({ code: "INVALID_DRAFT" });
      }
      const existing = await ctx.db.query("offlineDrafts")
        .withIndex("by_society_uuid", q => q.eq("societyId", args.societyId).eq("uuid", op.id)).unique();
      if ((existing?.revision ?? 0) !== op.baseRevision) throw new ConvexError({ code: "REVISION_CONFLICT" });
      const values = { title: op.title.trim(), content: op.content, revision: op.baseRevision + 1, updatedByUserId: userId };
      if (existing) await ctx.db.patch(existing._id, values);
      else await ctx.db.insert("offlineDrafts", { societyId: args.societyId, uuid: op.id, ...values });
    }
    await ctx.db.insert("offlineDraftReceipts", { societyId: args.societyId, userId, batchId: args.batchId, payload });
    return { accepted: true, replay: false };
  },
});

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, args) => {
    await requirePermissionPortable(await toPortableQueryCtx(ctx), args.societyId, "documents:read");
    return ctx.db.query("offlineDrafts").withIndex("by_society_uuid", q => q.eq("societyId", args.societyId)).collect();
  },
});
