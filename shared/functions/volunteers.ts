/**
 * PORTABLE FUNCTIONS: the volunteers domain (the pure `ctx.db` handlers).
 *
 * Only the read handlers that depend solely on `ctx.db` live here; the
 * role-gated and module-gated mutations (which call `requireRole` /
 * `requireEnabledModule`) remain on Convex. Each handler below runs unchanged on
 * hosted Convex, the local Dexie runtime, and the convex-test oracle.
 */

import type { PortableQueryCtx } from "../portable/ctx";

function fullName(row: { firstName?: string; lastName?: string }) {
  return `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim();
}

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("volunteers")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function applicationsPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("volunteerApplications")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function screeningsPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("volunteerScreenings")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function summaryPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const [volunteers, screenings, applications] = await Promise.all([
    ctx.db
      .query("volunteers")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
    ctx.db
      .query("volunteerScreenings")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
    ctx.db
      .query("volunteerApplications")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
  ]);

  const now = Date.now();
  return {
    total: volunteers.length,
    active: volunteers.filter((volunteer) => volunteer.status === "Active").length,
    applied: volunteers.filter((volunteer) => volunteer.status === "Applied").length,
    screeningRequired: volunteers.filter((volunteer) => volunteer.screeningRequired).length,
    pendingApplications: applications.filter((row) =>
      ["Submitted", "Reviewing"].includes(row.status),
    ).length,
    expiringChecks: screenings.filter((screening) => {
      if (!screening.expiresAtISO) return false;
      const due = new Date(screening.expiresAtISO).getTime();
      return due >= now && due <= now + 30 * 24 * 60 * 60 * 1000;
    }).length,
    overdueChecks: screenings.filter((screening) => {
      if (!screening.expiresAtISO) return false;
      return new Date(screening.expiresAtISO).getTime() < now;
    }).length,
  };
}

export async function buildCrrpDraftPortable(
  ctx: PortableQueryCtx,
  { volunteerId }: { volunteerId: string },
) {
  const volunteer = await ctx.db.get(volunteerId);
  if (!volunteer) return null;
  const base =
    (globalThis as any)?.process?.env?.BC_CRRP_ORG_PORTAL_URL ??
    "https://justice.gov.bc.ca/eCRC/";
  return {
    volunteerId,
    volunteerName: fullName(volunteer as any),
    provider: "BC_CRRP",
    launchUrl: base,
    suggestedNote:
      "Launch the BC Criminal Records Review Program portal, issue the request to the volunteer, then attach consent and result evidence here.",
  };
}
