import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

const subjectTable = v.union(
  v.literal("activity"),
  v.literal("notes"),
  v.literal("signatures"),
  v.literal("customFieldValues"),
);

/**
 * Backfill one bounded page of an H0 semantic-subject table.
 *
 * Run once per table and pass the returned continueCursor back until isDone:
 *   npx convex run subjectIdBackfill:backfillPage '{"table":"activity","pageSize":100}'
 */
export const backfillPage = internalMutation({
  args: {
    table: subjectTable,
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
  },
  returns: v.object({
    table: subjectTable,
    scanned: v.number(),
    patched: v.number(),
    isDone: v.boolean(),
    continueCursor: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const pageSize = Math.max(1, Math.min(200, Math.floor(args.pageSize ?? 100)));
    const result = await ctx.db.query(args.table).paginate({
      cursor: args.cursor ?? null,
      numItems: pageSize,
    });
    let patched = 0;
    for (const row of result.page) {
      if (row.subjectId || typeof row.entityId !== "string" || !row.entityId) continue;
      await ctx.db.patch(row._id, { subjectId: row.entityId });
      patched += 1;
    }
    return {
      table: args.table,
      scanned: result.page.length,
      patched,
      isDone: result.isDone,
      continueCursor: result.isDone ? undefined : result.continueCursor,
    };
  },
});
