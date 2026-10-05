import { internalMutationGeneric, type DataModelFromSchemaDefinition, type MutationBuilder } from "convex/server";
import type schema from "./schema";
const internalMutation = internalMutationGeneric as MutationBuilder<DataModelFromSchemaDefinition<typeof schema>, "internal">;
// Admin-only cursor advance for the experimental upstream connector. Advances an export cursor;
// carries no workspace data and cannot perform a business operation.
export const createCheckpoint = internalMutation({ args: {}, handler: async ctx => {
  const current = await ctx.db.query("powersync_checkpoints").first();
  if (current) await ctx.db.patch(current._id, { last_updated: Date.now() });
  else await ctx.db.insert("powersync_checkpoints", { last_updated: Date.now() });
} });
