/**
 * PORTABLE FUNCTIONS: the director-attestations domain
 * (list / forDirector / sign / remove / missingForYear).
 *
 * Straight reads/writes over `ctx.db`. Each handler runs unchanged on hosted
 * Convex, the local Dexie runtime, and the convex-test oracle. `sign` upserts an
 * attestation by (director, year).
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireSocietyMembership } from "./access";

export interface AttestationSignArgs {
  societyId: string;
  directorId: string;
  year: number;
  isAtLeast18: boolean;
  notBankrupt: boolean;
  notDisqualified: boolean;
  stillResidentOrEligible: boolean;
  notes?: string;
}

export async function attestationsListPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("directorAttestations")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function attestationsForDirectorPortable(ctx: PortableQueryCtx, { directorId }: { directorId: string }) {
  const candidate = await ctx.db.get(directorId, "directors");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("directors not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  await getOwned(ctx, "directors", directorId, candidate.societyId);
  return ctx.db
    .query("directorAttestations")
    .withIndex("by_director", (q) => q.eq("directorId", directorId))
    .collect();
}

export async function attestationSignPortable(ctx: PortableMutationCtx, args: AttestationSignArgs) {
  await requireSocietyMembership(ctx, args.societyId);
  await getOwned(ctx, "directors", args.directorId, args.societyId);
  // Upsert by (director, year)
  const existing = await ctx.db
    .query("directorAttestations")
    .withIndex("by_director_year", (q) =>
      q.eq("directorId", args.directorId).eq("year", args.year),
    )
    .collect();
  const payload = { ...args, signedAtISO: new Date().toISOString() };
  if (existing[0]) {
    await ctx.db.patch(existing[0]._id, payload);
    return existing[0]._id;
  }
  return ctx.db.insert("directorAttestations", payload);
}

export async function attestationRemovePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const candidate = await ctx.db.get(id, "directorAttestations");
  if (!candidate || typeof candidate.societyId !== "string") {
    throw new Error("directorAttestations not found.");
  }
  await requireSocietyMembership(ctx, candidate.societyId);
  await getOwned(ctx, "directorAttestations", id, candidate.societyId);
  await ctx.db.delete(id);
}

/** Returns directors who haven't attested for the current year. */
export async function attestationsMissingForYearPortable(ctx: PortableQueryCtx, { societyId, year }: { societyId: string; year: number }) {
  await requireSocietyMembership(ctx, societyId);
  const [directors, atts] = await Promise.all([
    ctx.db
      .query("directors")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
    ctx.db
      .query("directorAttestations")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
  ]);
  const signed = new Set(
    atts.filter((a) => a.year === year).map((a) => a.directorId as string),
  );
  return directors
    .filter((d) => d.status === "Active" && !signed.has(d._id as any))
    .map((d) => ({ _id: d._id, name: `${d.firstName} ${d.lastName}`, position: d.position }));
}
