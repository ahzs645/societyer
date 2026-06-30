import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  listPortable,
  registerPortable,
  chainPortable,
  createPortable,
  updatePortable,
  removePortable,
} from "../shared/functions/shareCertificates";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

/**
 * Physical share-certificate register (YCN SHR_CERT / SHR_CERT_REPL /
 * CANCEL_DT_TM).
 *
 * Thin load-and-delegate wrappers over the pure, unit-tested
 * shared/shareCertificates.ts. Rows are mapped into plain CertificateEvent
 * objects before being passed to the shared reconstruction functions.
 */

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => listPortable(toPortableQueryCtx(ctx), args),
});

/** Active certificates and shares-outstanding-by-class as of an ISO date. */
export const register = query({
  args: { societyId: v.id("societies"), asOf: v.string() },
  returns: v.any(),
  handler: (ctx, args) => registerPortable(toPortableQueryCtx(ctx), args),
});

/** The lineage of a certificate, original → latest. */
export const chain = query({
  args: { societyId: v.id("societies"), certificateNumber: v.string() },
  returns: v.any(),
  handler: (ctx, args) => chainPortable(toPortableQueryCtx(ctx), args),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    certificateNumber: v.string(),
    holderName: v.string(),
    shareClass: v.string(),
    shares: v.number(),
    issuedOn: v.string(),
    replacesCertificateNumber: v.optional(v.string()),
    nowISO: v.string(),
  },
  returns: v.any(),
  handler: (ctx, args) => createPortable(toPortableMutationCtx(ctx), args),
});

export const update = mutation({
  args: {
    id: v.id("shareCertificates"),
    patch: v.object({
      certificateNumber: v.optional(v.string()),
      holderName: v.optional(v.string()),
      shareClass: v.optional(v.string()),
      shares: v.optional(v.number()),
      issuedOn: v.optional(v.string()),
      replacesCertificateNumber: v.optional(v.string()),
      cancelledOn: v.optional(v.string()),
    }),
  },
  returns: v.any(),
  handler: (ctx, args) => updatePortable(toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("shareCertificates") },
  returns: v.any(),
  handler: (ctx, args) => removePortable(toPortableMutationCtx(ctx), args),
});
