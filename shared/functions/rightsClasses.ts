/**
 * PORTABLE FUNCTION: legalOperations:upsertRightsClass.
 *
 * The first MUTATION ported to the portable `ctx.db` contract — proves the write
 * path (insert/patch inside an atomic transaction) runs unchanged across hosted
 * Convex, the local Dexie runtime, and the convex-test oracle. Pairs with the
 * votingPower query slice.
 *
 * Option validation (`assertAllowedOption`) is enforced identically on every
 * runtime by importing the dependency-free domain allowlist. (That allowlist
 * lives under convex/lib today; moving it under shared/ is a clean-up noted in
 * docs/portable-functions-architecture.md — it does not pull any Convex runtime.)
 */

import { assertAllowedOption } from "../../convex/lib/orgHubOptions";
import type { PortableMutationCtx } from "../portable/ctx";

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function cleanList(values?: string[]): string[] {
  return Array.from(new Set((values ?? []).map((value) => cleanText(value)).filter(Boolean))) as string[];
}

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
  sourceDocumentIds?: string[];
  sourceExternalIds?: string[];
  notes?: string;
}

/** Insert or patch a rights class. Returns the row id. */
export async function upsertRightsClassPortable(
  ctx: PortableMutationCtx,
  { id, ...args }: UpsertRightsClassArgs,
): Promise<string> {
  assertAllowedOption("rightsClassTypes", args.classType, "Rights class type", false);
  assertAllowedOption("rightsClassStatuses", args.status, "Rights class status");
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
