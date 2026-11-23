/**
 * Server-side catalog publishing (Zoer's backend) without a Convex CLI login.
 * An administrator creates one bearer key per workspace; the browser generates
 * it and only its SHA-256 is stored. The key reaches exactly three existing
 * operator functions for its own workspace, plus a connection test. Catalog
 * rows never come through here: they go to the catalog service directly.
 */
import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { authorizedQuery, authorizedMutation } from "./lib/authorizedServer";
import { toPortableQueryCtx } from "./lib/portable";
import { hostedPrincipal } from "./lib/authIdentity";
import { requireEnabledModule } from "./lib/moduleSettings";
import { requirePermissionPortable, hasPermission } from "../shared/functions/permissions";
import { PUBLISHER_KEY_PATTERN } from "../shared/procurementReview/publisherConnection";

const PUBLISHER_OPERATIONS = ["status", "reportSource", "publicationPolicy", "recordPublication"] as const;
type Operation = typeof PUBLISHER_OPERATIONS[number];
const isOperation = (value: string): value is Operation => (PUBLISHER_OPERATIONS as readonly string[]).includes(value);

async function administrator(ctx: QueryCtx | MutationCtx, societyId: Id<"societies">) {
  if (hostedPrincipal(await ctx.auth.getUserIdentity()).kind !== "user") throw new Error("Sign in to manage the catalog publisher.");
  await requireEnabledModule(ctx, societyId, "procurementReview");
  return requirePermissionPortable(await toPortableQueryCtx(ctx), societyId, "settings:write");
}
const connectionFor = (ctx: QueryCtx | MutationCtx, societyId: Id<"societies">) =>
  ctx.db.query("procurementPublisherConnections").withIndex("by_society", q => q.eq("societyId", societyId)).unique();

export const settings = authorizedQuery("procurementPublisher:settings", query)({
  args: { societyId: v.id("societies") },
  returns: v.union(v.null(), v.object({ enabled: v.boolean(), createdAt: v.number(), lastUsedAt: v.union(v.number(), v.null()), lastOperation: v.union(v.string(), v.null()), lastError: v.union(v.string(), v.null()) })),
  handler: async (ctx, { societyId }) => {
    await requireEnabledModule(ctx, societyId, "procurementReview");
    const connection = await connectionFor(ctx, societyId);
    return connection ? { enabled: connection.enabled, createdAt: connection.createdAt, lastUsedAt: connection.lastUsedAt ?? null, lastOperation: connection.lastOperation ?? null, lastError: connection.lastError ?? null } : null;
  },
});

/** A new key hash replaces the old one, which stops working at once. */
export const configure = authorizedMutation("procurementPublisher:configure", mutation)({
  args: { societyId: v.id("societies"), keyHash: v.optional(v.string()), enabled: v.optional(v.boolean()) }, returns: v.null(),
  handler: async (ctx, { societyId, keyHash, enabled }) => {
    const actor = await administrator(ctx, societyId);
    if (keyHash !== undefined && !PUBLISHER_KEY_PATTERN.test(keyHash)) throw new Error("Invalid publisher key hash.");
    const prior = await connectionFor(ctx, societyId), now = Date.now();
    if (keyHash) {
      const taken = await ctx.db.query("procurementPublisherConnections").withIndex("by_keyHash", q => q.eq("keyHash", keyHash)).first();
      if (taken) throw new Error("Create a different key.");
      const fresh = { keyHash, createdBy: actor._id as Id<"users">, createdAt: now, updatedAt: now, enabled: enabled ?? true, lastUsedAt: undefined, lastOperation: undefined, lastError: undefined };
      if (prior) await ctx.db.patch(prior._id, fresh); else await ctx.db.insert("procurementPublisherConnections", { societyId, ...fresh });
      return null;
    }
    if (!prior) throw new Error("Create a connection key first.");
    if (enabled !== undefined) await ctx.db.patch(prior._id, { enabled, updatedAt: now });
    return null;
  },
});

export const revoke = authorizedMutation("procurementPublisher:revoke", mutation)({
  args: { societyId: v.id("societies") }, returns: v.null(),
  handler: async (ctx, { societyId }) => {
    await administrator(ctx, societyId);
    const prior = await connectionFor(ctx, societyId);
    if (prior) await ctx.db.delete(prior._id);
    return null;
  },
});

async function activeConnection(ctx: MutationCtx, keyHash: string) {
  if (!PUBLISHER_KEY_PATTERN.test(keyHash)) return null;
  const connection = await ctx.db.query("procurementPublisherConnections").withIndex("by_keyHash", q => q.eq("keyHash", keyHash)).unique();
  if (!connection?.enabled) return null;
  // The key stops working when the administrator who created it loses settings access.
  const owner = await ctx.db.get(connection.createdBy);
  if (!owner || owner.societyId !== connection.societyId || owner.status && owner.status !== "Active" || !hasPermission(String(owner.role), "settings:write")) return null;
  return connection;
}

function onlyKeys(input: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new Error("Unexpected publisher request fields.");
}

async function run(ctx: MutationCtx, connection: Doc<"procurementPublisherConnections">, operation: Operation, data: unknown): Promise<unknown> {
  if (data !== undefined && (!data || typeof data !== "object" || Array.isArray(data))) throw new Error("Publisher request data must be an object.");
  const input = (data ?? {}) as Record<string, unknown>, societyId = connection.societyId;
  // Every operation acts only on the key's own workspace, whatever the request names.
  if (input.societyId !== undefined && input.societyId !== societyId) throw new Error("This key belongs to another workspace.");
  if (operation === "status") {
    onlyKeys(input, ["societyId"]);
    const society = await ctx.db.get(societyId);
    let serviceOnlyAllowed = false;
    try { serviceOnlyAllowed = (await ctx.runQuery(internal.procurementCatalogOperator.publicationPolicy, { societyId })).serviceOnlyAllowed === true; }
    catch { /* This workspace has no catalog service provisioned. */ }
    return { societyId, folder: society?.integrationSettings?.procurementReviewFolder ?? null, catalogSource: society?.integrationSettings?.procurementCatalogSource ?? "convex", serviceOnlyAllowed };
  }
  // The existing operator functions keep all their own validation; their
  // argument validators also reject unexpected receipt fields.
  if (operation === "reportSource") return ctx.runMutation(internal.procurementStatus.reportSource, input);
  if (operation === "publicationPolicy") {
    onlyKeys(input, ["societyId"]);
    return ctx.runQuery(internal.procurementCatalogOperator.publicationPolicy, { societyId });
  }
  onlyKeys(input, ["societyId", "receiptJson"]);
  if (typeof input.receiptJson !== "string") throw new Error("A serving receipt is required.");
  await ctx.runMutation(internal.procurementCatalog.recordPublication, { societyId, receiptJson: input.receiptJson });
  return null;
}

/** Used only by the /procurement-publisher HTTP route. Unknown, disabled or orphaned keys are denied before anything else. */
export const dispatch = internalMutation({
  args: { keyHash: v.string(), operation: v.string(), data: v.optional(v.any()) },
  returns: v.union(v.object({ status: v.literal("denied") }), v.object({ status: v.literal("rejected") }), v.object({ status: v.literal("ok"), result: v.any() })),
  handler: async (ctx, { keyHash, operation, data }) => {
    const connection = await activeConnection(ctx, keyHash);
    if (!connection) return { status: "denied" as const };
    const usage = { lastUsedAt: Date.now(), ...(isOperation(operation) ? { lastOperation: operation } : {}) };
    try {
      if (!isOperation(operation)) throw new Error("Unknown publisher operation.");
      // A failing operation runs in its own sub-transaction, so its writes roll
      // back while this usage record still commits.
      const result = await run(ctx, connection, operation, data);
      await ctx.db.patch(connection._id, { ...usage, lastError: undefined });
      return { status: "ok" as const, result };
    } catch (error) {
      const message = error instanceof Error ? error.message.split("\n")[0].slice(0, 300) : "Request rejected.";
      await ctx.db.patch(connection._id, { ...usage, lastError: message });
      return { status: "rejected" as const };
    }
  },
});
