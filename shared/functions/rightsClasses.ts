/**
 * PORTABLE FUNCTION: legalOperations:upsertRightsClass.
 *
 * The first MUTATION ported to the portable `ctx.db` contract — proves the write
 * path (insert/patch inside an atomic transaction) runs unchanged across hosted
 * Convex, the local Dexie runtime, and the convex-test oracle. Pairs with the
 * votingPower query slice.
 *
 * Option validation (`assertAllowedOption`) is enforced identically on every
 * runtime via the dependency-free domain allowlist in `shared/orgHubOptions`
 * (re-exported from `convex/lib/orgHubOptions` for existing Convex importers).
 */

import { assertAllowedOption } from "../orgHubOptions";
import {
  issuedSharesByClass,
  shareClassRightsIssues,
  type DividendEntitlement,
  type RedemptionTerms,
  type StructuredShareRights,
} from "../equityLedger";
import { cleanText, cleanList } from "./text";
import type { PortableMutationCtx } from "../portable/ctx";
import { getOwned, requireSocietyMembership } from "./access";

export interface UpsertRightsClassArgs {
  id?: string;
  societyId: string;
  className: string;
  classType: string;
  status?: string;
  idPrefix?: string;
  highestAssignedNumber?: number;
  votingRights?: string;
  votesPerShare?: number;
  startDate?: string;
  endDate?: string;
  conditionsToHold?: string;
  conditionsToTransfer?: string;
  conditionsForRemoval?: string;
  otherProvisions?: string;
  // Structured summary of the articles (the free-text fields stay authoritative).
  parValueCents?: number;
  maxAuthorized?: number;
  dividendEntitlement?: DividendEntitlement;
  dividendRateBps?: number;
  redemption?: RedemptionTerms;
  liquidationRank?: number;
  preEmptiveRights?: boolean;
  articlesPart?: string;
  singularDescription?: string;
  pluralDescription?: string;
  sourceDocumentIds?: string[];
  sourceExternalIds?: string[];
  notes?: string;
}

/** The structured-rights part of the args, trimmed; validation errors throw. */
export function structuredShareRightsPayload(args: StructuredShareRights): StructuredShareRights {
  const redemption = args.redemption
    ? {
        byCompany: args.redemption.byCompany === true,
        byHolder: args.redemption.byHolder === true,
        ...(args.redemption.priceCents !== undefined ? { priceCents: args.redemption.priceCents } : {}),
        ...(args.redemption.includesDeclaredUnpaid !== undefined ? { includesDeclaredUnpaid: args.redemption.includesDeclaredUnpaid } : {}),
        ...(args.redemption.minNoticeDays !== undefined ? { minNoticeDays: args.redemption.minNoticeDays } : {}),
        ...(args.redemption.nonProRataPermitted !== undefined ? { nonProRataPermitted: args.redemption.nonProRataPermitted } : {}),
      }
    : undefined;
  const rights: StructuredShareRights = {
    parValueCents: args.parValueCents,
    maxAuthorized: args.maxAuthorized,
    dividendEntitlement: (cleanText(args.dividendEntitlement) as DividendEntitlement | undefined) || undefined,
    dividendRateBps: args.dividendRateBps,
    redemption,
    liquidationRank: args.liquidationRank,
    preEmptiveRights: args.preEmptiveRights,
    articlesPart: cleanText(args.articlesPart),
    singularDescription: cleanText(args.singularDescription),
    pluralDescription: cleanText(args.pluralDescription),
  };
  const issues = shareClassRightsIssues(rights);
  if (issues.length) throw new Error(issues.join(" "));
  return rights;
}

/** Insert or patch a rights class. Returns the row id. */
export async function upsertRightsClassPortable(
  ctx: PortableMutationCtx,
  { id, ...args }: UpsertRightsClassArgs,
): Promise<string> {
  await requireSocietyMembership(ctx, args.societyId);
  if (id) await getOwned(ctx, "rightsClasses", id, args.societyId);
  for (const documentId of args.sourceDocumentIds ?? []) {
    await getOwned(ctx, "documents", documentId, args.societyId);
  }
  assertAllowedOption("rightsClassTypes", args.classType, "Rights class type", false);
  assertAllowedOption("rightsClassStatuses", args.status, "Rights class status");
  const rights = structuredShareRightsPayload(args);
  if (id && rights.maxAuthorized !== undefined) {
    const transfers = await ctx.db
      .query("rightsholdingTransfers")
      .withIndex("by_society_class", (q) => q.eq("societyId", args.societyId).eq("rightsClassId", id))
      .collect();
    const issued = issuedSharesByClass(transfers as any).get(String(id)) ?? 0;
    if (issued > rights.maxAuthorized) {
      throw new Error(`${issued} shares of this class are already issued, more than the proposed authorized maximum of ${rights.maxAuthorized}.`);
    }
  }
  const now = new Date().toISOString();
  const payload = {
    societyId: args.societyId,
    className: cleanText(args.className) || "Unnamed class",
    classType: cleanText(args.classType) || "membership",
    status: cleanText(args.status) || "active",
    idPrefix: cleanText(args.idPrefix),
    highestAssignedNumber: args.highestAssignedNumber,
    votingRights: cleanText(args.votingRights),
    votesPerShare: args.votesPerShare,
    startDate: cleanText(args.startDate),
    endDate: cleanText(args.endDate),
    conditionsToHold: cleanText(args.conditionsToHold),
    conditionsToTransfer: cleanText(args.conditionsToTransfer),
    conditionsForRemoval: cleanText(args.conditionsForRemoval),
    otherProvisions: cleanText(args.otherProvisions),
    ...rights,
    sourceDocumentIds: args.sourceDocumentIds ?? [],
    sourceExternalIds: cleanList(args.sourceExternalIds),
    notes: cleanText(args.notes),
    updatedAtISO: now,
  };
  if (id) {
    await ctx.db.patch(id, payload);
    return id;
  }
  return ctx.db.insert("rightsClasses", { ...payload, createdAtISO: now });
}
