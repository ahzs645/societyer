/**
 * PORTABLE FUNCTIONS: the share-certificates domain
 * (list / register / chain / create / update / remove).
 *
 * Physical share-certificate register (YCN SHR_CERT / SHR_CERT_REPL /
 * CANCEL_DT_TM).
 *
 * Thin load-and-delegate wrappers over the pure, unit-tested
 * shared/shareCertificates.ts. Rows are mapped into plain CertificateEvent
 * objects before being passed to the shared reconstruction functions. Each
 * handler runs unchanged on hosted Convex, the local Dexie runtime, and the
 * convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import {
  activeCertificates,
  certificateChain,
  validateCertificate,
  sharesOutstandingByClass,
  type CertificateEvent,
} from "../shareCertificates";

/** Map a stored row onto the plain CertificateEvent shape the shared fns expect. */
function toEvent(row: Record<string, any>): CertificateEvent {
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

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("shareCertificates")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

/** Active certificates and shares-outstanding-by-class as of an ISO date. */
export async function registerPortable(
  ctx: PortableQueryCtx,
  { societyId, asOf }: { societyId: string; asOf: string },
) {
  const rows = await ctx.db
    .query("shareCertificates")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const events = rows.map(toEvent);
  return {
    active: activeCertificates(events, asOf),
    outstandingByClass: sharesOutstandingByClass(events, asOf),
  };
}

/** The lineage of a certificate, original → latest. */
export async function chainPortable(
  ctx: PortableQueryCtx,
  { societyId, certificateNumber }: { societyId: string; certificateNumber: string },
) {
  const rows = await ctx.db
    .query("shareCertificates")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const events = rows.map(toEvent);
  return certificateChain(events, certificateNumber);
}

export async function createPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    certificateNumber: string;
    holderName: string;
    shareClass: string;
    shares: number;
    issuedOn: string;
    replacesCertificateNumber?: string;
    nowISO: string;
  },
) {
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
}

export async function updatePortable(
  ctx: PortableMutationCtx,
  { id, patch }: {
    id: string;
    patch: {
      certificateNumber?: string;
      holderName?: string;
      shareClass?: string;
      shares?: number;
      issuedOn?: string;
      replacesCertificateNumber?: string;
      cancelledOn?: string;
    };
  },
) {
  await ctx.db.patch(id, patch);
  return null;
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  await ctx.db.delete(id);
}
