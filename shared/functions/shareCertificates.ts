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
import { getOwned, requireOwnedRow, requireSocietyMembership } from "./access";
import {
  activeCertificates,
  certificateChain,
  duplicateCertificateNumber,
  reconcileCertificatesWithLedger,
  validateCertificate,
  sharesOutstandingByClass,
  type CertificateEvent,
} from "../shareCertificates";
import { holdingsAsOf } from "../equityLedger";
import { filterRoleHolderRegisters } from "./roleHolderReadAccess";

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
    rightsClassId: row.rightsClassId ?? null,
    holderRoleHolderId: row.holderRoleHolderId ?? null,
  };
}

async function societyCertificates(ctx: PortableQueryCtx, societyId: string) {
  return ctx.db
    .query("shareCertificates")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

function assertUniqueNumber(rows: Record<string, any>[], certificateNumber: string, excludeId?: string) {
  const clash = duplicateCertificateNumber(rows as any[], certificateNumber, excludeId);
  if (clash) {
    throw new Error(`Certificate number ${String(certificateNumber).trim()} is already used (${clash.shareClass}, ${clash.holderName}). Certificate numbers must be unique within the organization.`);
  }
}

async function assertLinks(ctx: PortableQueryCtx, societyId: string, links: { rightsClassId?: string; holderRoleHolderId?: string }) {
  if (links.rightsClassId) await getOwned(ctx, "rightsClasses", links.rightsClassId, societyId);
  if (links.holderRoleHolderId) await getOwned(ctx, "roleHolders", links.holderRoleHolderId, societyId);
}

/**
 * Outstanding certificates against the share ledger as of a date: per holder
 * and class, certificate shares must equal ledger holdings, and each cancelled
 * certificate must equal the transferred shares plus the balance certificate.
 */
export async function reconcilePortable(
  ctx: PortableQueryCtx,
  { societyId, asOf }: { societyId: string; asOf: string },
) {
  await requireSocietyMembership(ctx, societyId);
  const [certificates, transfers, classes, roleHolders] = await Promise.all([
    societyCertificates(ctx, societyId),
    ctx.db.query("rightsholdingTransfers").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("rightsClasses").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("roleHolders").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  return reconcileCertificatesWithLedger({
    certificates: certificates.map(toEvent),
    holdings: holdingsAsOf(transfers as any, asOf),
    classes: classes.map((row: any) => ({ _id: String(row._id), className: row.className, idPrefix: row.idPrefix, singularForm: row.singularForm, singularDescription: row.singularDescription, pluralDescription: row.pluralDescription })),
    // Only the id and display name are needed to match certificate holders.
    roleHolders: (await filterRoleHolderRegisters(ctx, societyId, roleHolders as any)).map((row: any) => ({ _id: String(row._id), fullName: row.fullName })),
    asOfISO: asOf,
  });
}

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
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
  await requireSocietyMembership(ctx, societyId);
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
  await requireSocietyMembership(ctx, societyId);
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
    rightsClassId?: string;
    holderRoleHolderId?: string;
    nowISO: string;
  },
) {
  await requireSocietyMembership(ctx, args.societyId);
  await assertLinks(ctx, args.societyId, args);
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
  assertUniqueNumber(await societyCertificates(ctx, args.societyId), args.certificateNumber);
  return ctx.db.insert("shareCertificates", {
    societyId: args.societyId,
    certificateNumber: args.certificateNumber,
    holderName: args.holderName,
    shareClass: args.shareClass,
    shares: args.shares,
    issuedOn: args.issuedOn,
    replacesCertificateNumber: args.replacesCertificateNumber,
    rightsClassId: args.rightsClassId,
    holderRoleHolderId: args.holderRoleHolderId,
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
      rightsClassId?: string;
      holderRoleHolderId?: string;
    };
  },
) {
  const existing = await requireOwnedRow(ctx, "shareCertificates", id);
  const societyId = String(existing.societyId);
  await assertLinks(ctx, societyId, patch);
  const result = validateCertificate(toEvent({ ...existing, ...patch }));
  if (!result.ok) throw new Error(`Invalid certificate: ${result.errors.join("; ")}`);
  if (patch.certificateNumber !== undefined) assertUniqueNumber(await societyCertificates(ctx, societyId), patch.certificateNumber, id);
  await ctx.db.patch(id, patch);
  return null;
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  await requireOwnedRow(ctx, "shareCertificates", id);
  await ctx.db.delete(id);
}
