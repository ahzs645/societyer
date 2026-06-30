import { v } from "convex/values";
import { mutation, query } from "./lib/untypedServer";
import { listPortable, createPortable, revokePortable, centerPortable } from "../shared/functions/partyPortals";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";
import { buildConvexCapabilities } from "./providers/capabilities";

/**
 * External stakeholder portals (Corporify's auditor portal): a society shares a
 * token-scoped, read-only room with an outside party. The token in the URL is
 * the only credential (Convex has no ctx.auth), so it must be unguessable and
 * revocable. `scopes` gates which sections are visible; `allowDownload` gates
 * whether files can be pulled (vs. read-only metadata).
 */

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => listPortable(toPortableQueryCtx(ctx), args),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    token: v.string(),
    label: v.string(),
    partyEmail: v.optional(v.string()),
    scopes: v.array(v.string()),
    allowDownload: v.boolean(),
    expiresAtISO: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => createPortable(toPortableMutationCtx(ctx), args),
});

export const revoke = mutation({
  args: { id: v.id("partyPortals") },
  returns: v.any(),
  handler: (ctx, args) => revokePortable(toPortableMutationCtx(ctx), args),
});

/** Public, token-gated view. Returns null for an unknown/revoked/expired token,
 *  otherwise only the sections the token's scopes allow. */
export const center = query({
  args: { token: v.string() },
  returns: v.any(),
  handler: (ctx, args) => centerPortable(toPortableQueryCtx(ctx, buildConvexCapabilities(ctx)), args),
});
