/**
 * PORTABLE FUNCTIONS: the public-portal domain
 * (getSocietyBySlug / volunteerIntakeContext / grantIntakeContext).
 *
 * Read-only queries that drive the public transparency portal. Each handler runs
 * unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle. `isSocietyModuleEnabled` is a pure helper over the society's module
 * settings (`normalizeModuleSettings` is dep-free).
 */

import type { PortableQueryCtx } from "../portable/ctx";
import { normalizeModuleSettings, type ModuleKey } from "../../src/lib/modules";

function isSocietyModuleEnabled(society: any, key: ModuleKey) {
  return normalizeModuleSettings(society)[key];
}

function publicText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * The registry identity an anonymous intake form needs to word its notice for
 * the right kind of entity (society, corporation, other). These are the same
 * public-registry facts the transparency page already shows alongside the
 * incorporation number; nothing else from the workspace row is exposed.
 */
function publicEntityIdentity(society: Record<string, any>) {
  return {
    entityType: publicText(society.entityType),
    jurisdictionCode: publicText(society.jurisdictionCode),
    actFormedUnder: publicText(society.actFormedUnder),
  };
}

export async function getSocietyBySlugPortable(ctx: PortableQueryCtx, { slug }: { slug: string }) {
  const society = await ctx.db
    .query("societies")
    .withIndex("by_public_slug", (q) => q.eq("publicSlug", slug))
    .first();
  if (!society) return null;
  return {
    _id: society._id,
    name: society.name,
    publicSlug: society.publicSlug,
    publicSummary: society.publicSummary,
    publicContactEmail: society.publicContactEmail ?? society.privacyOfficerEmail,
    publicTransparencyEnabled: society.publicTransparencyEnabled ?? false,
  };
}

export async function volunteerIntakeContextPortable(ctx: PortableQueryCtx, { slug }: { slug: string }) {
  const society = await ctx.db
    .query("societies")
    .withIndex("by_public_slug", (q) => q.eq("publicSlug", slug))
    .first();
  if (
    !society ||
    !society.publicTransparencyEnabled ||
    !society.publicVolunteerIntakeEnabled ||
    !isSocietyModuleEnabled(society, "volunteers")
  ) {
    return null;
  }

  const committees = await ctx.db
    .query("committees")
    .withIndex("by_society", (q) => q.eq("societyId", society._id))
    .collect();

  return {
    society: {
      _id: society._id,
      name: society.name,
      publicSlug: society.publicSlug,
      publicContactEmail: society.publicContactEmail ?? society.privacyOfficerEmail,
      privacyNotice: society.publicIntakePrivacyNotice ?? null,
      privacyOfficerName: society.privacyOfficerName ?? null,
      ...publicEntityIdentity(society),
    },
    committees: committees.map((committee: Record<string, any>) => ({
      _id: committee._id,
      name: committee.name,
      summary: committee.mission ?? committee.description ?? committee.cadenceNotes ?? null,
    })),
  };
}

export async function grantIntakeContextPortable(ctx: PortableQueryCtx, { slug }: { slug: string }) {
  const society = await ctx.db
    .query("societies")
    .withIndex("by_public_slug", (q) => q.eq("publicSlug", slug))
    .first();
  if (
    !society ||
    !society.publicTransparencyEnabled ||
    !society.publicGrantIntakeEnabled ||
    !isSocietyModuleEnabled(society, "grants")
  ) {
    return null;
  }

  const grants = await ctx.db
    .query("grants")
    .withIndex("by_society", (q) => q.eq("societyId", society._id))
    .collect();

  const openGrants = grants.filter((grant: Record<string, any>) => grant.allowPublicApplications);
  if (openGrants.length === 0) return null;

  return {
    society: {
      _id: society._id,
      name: society.name,
      publicSlug: society.publicSlug,
      publicContactEmail: society.publicContactEmail ?? society.privacyOfficerEmail,
      privacyNotice: society.publicIntakePrivacyNotice ?? null,
      privacyOfficerName: society.privacyOfficerName ?? null,
      ...publicEntityIdentity(society),
    },
    grants: openGrants
      .map((grant: Record<string, any>) => ({
        _id: grant._id,
        title: grant.title,
        funder: grant.funder,
        program: grant.program,
        applicationDueDate: grant.applicationDueDate,
        publicDescription: grant.publicDescription ?? grant.notes,
        applicationInstructions: grant.applicationInstructions,
      })),
  };
}
