import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  activeCertificates,
  certificateChain,
  validateCertificate,
  sharesOutstandingByClass,
  type CertificateEvent,
} from "../shared/shareCertificates";

/**
 * Physical share-certificate register (YCN SHR_CERT / SHR_CERT_REPL /
 * CANCEL_DT_TM).
 *
 * Thin load-and-delegate wrappers over the pure, unit-tested
 * shared/shareCertificates.ts. Rows are mapped into plain CertificateEvent
 * objects before being passed to the shared reconstruction functions.
 */

/** Map a stored row onto the plain CertificateEvent shape the shared fns expect. */
function toEvent(row: {
  certificateNumber: string;
  holderName: string;
  shareClass: string;
  shares: number;
  issuedOn: string;
  replacesCertificateNumber?: string | null;
  cancelledOn?: string | null;
}): CertificateEvent {
  return {
    certificateNumber: row.certificateNumber,
    holderName: row.holderName,
    shareClass: row.shareClass,
    shares: row.shares,
    issuedOn: row.issuedOn,
    replacesCertificateNumber: row.replacesCertificateNumber ?? null,
    cancelledOn: row.cancelledOn ?? null,
  };
}

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("shareCertificates")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

/** Active certificates and shares-outstanding-by-class as of an ISO date. */
export const register = query({
  args: { societyId: v.id("societies"), asOf: v.string() },
  returns: v.any(),
  handler: async (ctx, { societyId, asOf }) => {
    const rows = await ctx.db
      .query("shareCertificates")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const events = rows.map(toEvent);
    return {
      active: activeCertificates(events, asOf),
      outstandingByClass: sharesOutstandingByClass(events, asOf),
    };
  },
});

/** The lineage of a certificate, original → latest. */
export const chain = query({
  args: { societyId: v.id("societies"), certificateNumber: v.string() },
  returns: v.any(),
  handler: async (ctx, { societyId, certificateNumber }) => {
    const rows = await ctx.db
      .query("shareCertificates")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const events = rows.map(toEvent);
    return certificateChain(events, certificateNumber);
  },
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
  handler: async (ctx, args) => {
    const event: CertificateEvent = {
      certificateNumber: args.certificateNumber,
      holderName: args.holderName,
      shareClass: args.shareClass,
      shares: args.shares,
      issuedOn: args.issuedOn,
      replacesCertificateNumber: args.replacesCertificateNumber ?? null,
      cancelledOn: null,
    };
    const result = validateCertificate(event);
    if (!result.ok) {
      throw new Error(`Invalid certificate: ${result.errors.join("; ")}`);
    }
    return ctx.db.insert("shareCertificates", {
      societyId: args.societyId,
      certificateNumber: args.certificateNumber,
      holderName: args.holderName,
      shareClass: args.shareClass,
      shares: args.shares,
      issuedOn: args.issuedOn,
      replacesCertificateNumber: args.replacesCertificateNumber,
      createdAtISO: args.nowISO,
    });
  },
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
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, patch);
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("shareCertificates") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
