/**
 * Token buckets for the Convex-hosted sign-in routes (AUTH_MODE=convex).
 *
 * Better Auth's own limiter keys only on client IP, which Convex HTTP actions
 * don't pass to it, so the broker throttles here instead: per account email,
 * which holds even when an IP can't be trusted, and per client IP from Convex
 * request metadata. Mutations are serializable, so concurrent attempts can't
 * both spend the last token.
 */
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

const bucketValidator = v.object({ key: v.string(), capacity: v.number(), perHour: v.number() });
const HOUR_MS = 3_600_000;

/** Spend one token from every bucket, or none if any is empty. */
export const take = internalMutation({
  args: { buckets: v.array(bucketValidator) },
  returns: v.object({ ok: v.boolean(), retryAfterMs: v.number() }),
  handler: async (ctx, { buckets }) => {
    const now = Date.now();
    const states = await Promise.all(buckets.map(async (bucket) => {
      const row = await ctx.db.query("authRateLimits").withIndex("by_key", (q) => q.eq("key", bucket.key)).unique();
      const refillPerMs = bucket.perHour / HOUR_MS;
      const tokens = row ? Math.min(bucket.capacity, row.tokens + (now - row.updatedAtMs) * refillPerMs) : bucket.capacity;
      return { bucket, row, tokens, refillPerMs };
    }));
    const empty = states.filter((state) => state.tokens < 1);
    // A refused attempt spends nothing, so hammering doesn't extend the wait.
    if (empty.length) {
      return { ok: false, retryAfterMs: Math.max(...empty.map((state) => Math.ceil((1 - state.tokens) / state.refillPerMs))) };
    }
    for (const { bucket, row, tokens } of states) {
      if (row) await ctx.db.patch(row._id, { tokens: tokens - 1, updatedAtMs: now });
      else await ctx.db.insert("authRateLimits", { key: bucket.key, tokens: tokens - 1, updatedAtMs: now });
    }
    return { ok: true, retryAfterMs: 0 };
  },
});

/** Refill a bucket completely, e.g. an account's after a successful sign-in. */
export const reset = internalMutation({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, { key }) => {
    const row = await ctx.db.query("authRateLimits").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (row) await ctx.db.delete(row._id);
    return null;
  },
});

/** Every bucket refills within an hour; rows idle for a day hold no state worth keeping. */
export const purgeIdle = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const idle = await ctx.db.query("authRateLimits")
      .withIndex("by_updated", (q) => q.lt("updatedAtMs", Date.now() - 24 * HOUR_MS)).take(500);
    for (const row of idle) await ctx.db.delete(row._id);
    return idle.length;
  },
});
