/**
 * Loads the registers a minute-book report needs through the portable `ctx.db`
 * contract and builds the report (shared/minuteBookReports.ts). Runs unchanged
 * on hosted Convex, the local runtime and the convex-test oracle.
 *
 * Access: a restricted report (BC transparency register, LOTA worksheet) is
 * generated only for someone who may see the register: a workspace Director,
 * Admin or Owner. Anyone else gets an error and no document, so restricted
 * personal information is never printed for them.
 */

import type { PortableQueryCtx } from "./portable/ctx";
import { canActAs, requireSocietyMembership, type Role } from "./functions/access";
import { buildMinuteBookReport, RESTRICTED_REPORT_KINDS, type MinuteBookReport, type MinuteBookReportInput } from "./minuteBookReports";
import { reportKindForPacket } from "./corporationReportPackets";

/** Workspace roles that may generate a restricted register. */
export function roleMayViewRestrictedRegisters(role: string | null | undefined): boolean {
  return canActAs((role ?? null) as Role | null, "Director");
}

const RESTRICTED_ACCESS_MESSAGE = "This register has restricted access. Only a director or a workspace administrator can generate it.";

/** Throw before anything is written when the caller may not generate a restricted report. */
export async function assertMinuteBookReportAccess(ctx: PortableQueryCtx, societyId: string, packetKey: string): Promise<void> {
  const kind = reportKindForPacket(packetKey);
  if (!kind || !RESTRICTED_REPORT_KINDS.has(kind)) return;
  const actor = await requireSocietyMembership(ctx, societyId);
  if (!roleMayViewRestrictedRegisters(String(actor.role ?? ""))) throw new Error(RESTRICTED_ACCESS_MESSAGE);
}

async function rows(ctx: PortableQueryCtx, table: string, societyId: string): Promise<any[]> {
  return ctx.db.query(table as any).withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
}

export async function loadMinuteBookReport(
  ctx: PortableQueryCtx,
  args: { societyId: string; packetKey: string; society: Record<string, any>; asOf: string },
): Promise<MinuteBookReport | undefined> {
  const kind = reportKindForPacket(args.packetKey);
  if (!kind) return undefined;
  const actor = await requireSocietyMembership(ctx, args.societyId);
  const canViewRestricted = roleMayViewRestrictedRegisters(String(actor.role ?? ""));
  if (RESTRICTED_REPORT_KINDS.has(kind) && !canViewRestricted) {
    throw new Error(RESTRICTED_ACCESS_MESSAGE);
  }
  const needs = (...kinds: MinuteBookReportInput["kind"][]) => kinds.includes(kind);
  const [roleHolders, directors, rightsClasses, transfers, certificates, addresses, nameHistory, assets, transparencySteps, generatedDocuments] = await Promise.all([
    rows(ctx, "roleHolders", args.societyId),
    needs("director-consent", "directors-register", "corporate-summary") ? rows(ctx, "directors", args.societyId) : Promise.resolve([]),
    needs("securities-register", "corporate-summary", "lota-report") ? rows(ctx, "rightsClasses", args.societyId) : Promise.resolve([]),
    needs("securities-register", "corporate-summary", "lota-report") ? rows(ctx, "rightsholdingTransfers", args.societyId) : Promise.resolve([]),
    needs("securities-register") ? rows(ctx, "shareCertificates", args.societyId) : Promise.resolve([]),
    needs("corporate-summary") ? rows(ctx, "organizationAddresses", args.societyId) : Promise.resolve([]),
    rows(ctx, "societyNameHistory", args.societyId),
    needs("lota-report") ? rows(ctx, "assets", args.societyId) : Promise.resolve([]),
    needs("bc-transparency-register") ? rows(ctx, "significantIndividualSteps", args.societyId) : Promise.resolve([]),
    needs("cover-letter") ? rows(ctx, "generatedLegalDocuments", args.societyId) : Promise.resolve([]),
  ]);
  return buildMinuteBookReport({
    kind,
    organization: args.society,
    asOf: args.asOf,
    roleHolders: roleHolders.map((row) => ({ ...row, _id: String(row._id) })),
    directors,
    rightsClasses: rightsClasses.map((row) => ({ ...row, _id: String(row._id) })),
    transfers: transfers.map((row) => ({
      ...row,
      _id: String(row._id),
      rightsClassId: row.rightsClassId ? String(row.rightsClassId) : undefined,
      sourceRoleHolderId: row.sourceRoleHolderId ? String(row.sourceRoleHolderId) : undefined,
      destinationRoleHolderId: row.destinationRoleHolderId ? String(row.destinationRoleHolderId) : undefined,
    })),
    certificates,
    addresses,
    nameHistory,
    assets,
    transparencySteps,
    generatedDocuments,
    canViewRestricted,
  });
}
