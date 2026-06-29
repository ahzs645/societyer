/**
 * PORTABLE FUNCTIONS: the volunteers domain (the pure `ctx.db` handlers).
 *
 * Read handlers and the role-/module-gated mutation surface both live here. Role
 * gating goes through `requireRolePortable` and module enablement through the
 * dep-free `normalizeModuleSettings` helper, so each handler below runs unchanged
 * on hosted Convex, the local Dexie runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { requireRolePortable } from "./access";
import { MODULES_BY_KEY, normalizeModuleSettings, type ModuleKey } from "../../src/lib/modules";

function isoNow() {
  return new Date().toISOString();
}

async function requireEnabledModulePortable(ctx: PortableMutationCtx, societyId: string, key: ModuleKey) {
  const society = await ctx.db.get(societyId);
  if (!society) throw new Error("Society not found.");
  if (!normalizeModuleSettings(society as any)[key]) {
    throw new Error(`${MODULES_BY_KEY[key].label} is disabled for this workspace.`);
  }
  return society;
}

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

export async function submitApplicationPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    memberId?: string;
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    roleWanted?: string;
    availability?: string;
    interests: string[];
    notes?: string;
    source?: string;
  },
) {
  await requireEnabledModulePortable(ctx, args.societyId, "volunteers");
  return await ctx.db.insert("volunteerApplications", {
    ...args,
    source: args.source ?? "public",
    status: "Submitted",
    submittedAtISO: isoNow(),
  });
}

export async function reviewApplicationPortable(
  ctx: PortableMutationCtx,
  { id, status, actingUserId }: { id: string; status: string; actingUserId?: string },
) {
  const application = await ctx.db.get(id);
  if (!application) throw new Error("Application not found.");
  await requireRolePortable(ctx, {
    actingUserId,
    societyId: String(application.societyId),
    required: "Director",
  });
  await ctx.db.patch(id, {
    status,
    reviewedAtISO: isoNow(),
    reviewedByUserId: actingUserId ?? undefined,
  });
}

export async function convertApplicationPortable(
  ctx: PortableMutationCtx,
  { id, committeeId, screeningRequired, actingUserId }: {
    id: string;
    committeeId?: string;
    screeningRequired: boolean;
    actingUserId?: string;
  },
) {
  const application = await ctx.db.get(id);
  if (!application) throw new Error("Application not found.");
  await requireRolePortable(ctx, {
    actingUserId,
    societyId: String(application.societyId),
    required: "Director",
  });

  const existingVolunteer = application.linkedVolunteerId
    ? await ctx.db.get(application.linkedVolunteerId)
    : null;

  const volunteerId =
    existingVolunteer?._id ??
    (await ctx.db.insert("volunteers", {
      societyId: application.societyId,
      memberId: application.memberId,
      committeeId,
      publicApplicationId: application._id,
      firstName: application.firstName,
      lastName: application.lastName,
      email: application.email,
      phone: application.phone,
      status: "Applied",
      roleWanted: application.roleWanted,
      availability: application.availability,
      interests: application.interests,
      screeningRequired,
      applicationReceivedAtISO: application.submittedAtISO,
      intakeSource: application.source,
      notes: application.notes,
    }));

  await ctx.db.patch(id, {
    linkedVolunteerId: volunteerId,
    status: "Converted",
    reviewedAtISO: isoNow(),
    reviewedByUserId: actingUserId ?? undefined,
  });

  return volunteerId;
}

export async function upsertVolunteerPortable(
  ctx: PortableMutationCtx,
  args: {
    id?: string;
    societyId: string;
    memberId?: string;
    committeeId?: string;
    publicApplicationId?: string;
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    status: string;
    roleWanted?: string;
    availability?: string;
    interests: string[];
    screeningRequired: boolean;
    orientationCompletedAtISO?: string;
    trainingStatus?: string;
    applicationReceivedAtISO?: string;
    approvedAtISO?: string;
    renewalDueAtISO?: string;
    intakeSource?: string;
    notes?: string;
    actingUserId?: string;
  },
) {
  await requireRolePortable(ctx, {
    actingUserId: args.actingUserId,
    societyId: args.societyId,
    required: "Director",
  });
  const { id, actingUserId, ...rest } = args;
  if (id) {
    await ctx.db.patch(id, rest);
    return id;
  }
  return await ctx.db.insert("volunteers", rest);
}

export async function removeVolunteerPortable(
  ctx: PortableMutationCtx,
  { id, actingUserId }: { id: string; actingUserId?: string },
) {
  const volunteer = await ctx.db.get(id);
  if (!volunteer) return;
  await requireRolePortable(ctx, {
    actingUserId,
    societyId: String(volunteer.societyId),
    required: "Director",
  });
  const screenings = await ctx.db
    .query("volunteerScreenings")
    .withIndex("by_volunteer", (q) => q.eq("volunteerId", id))
    .collect();
  for (const screening of screenings) {
    await ctx.db.delete(screening._id);
  }
  if (volunteer.publicApplicationId) {
    await ctx.db.patch(volunteer.publicApplicationId, {
      linkedVolunteerId: undefined,
      status: "Approved",
    });
  }
  await ctx.db.delete(id);
}

export async function upsertScreeningPortable(
  ctx: PortableMutationCtx,
  args: {
    id?: string;
    societyId: string;
    volunteerId: string;
    kind: string;
    status: string;
    provider?: string;
    portalUrl?: string;
    requestedAtISO?: string;
    completedAtISO?: string;
    expiresAtISO?: string;
    referenceNumber?: string;
    consentDocumentId?: string;
    resultDocumentId?: string;
    verifiedByUserId?: string;
    notes?: string;
    actingUserId?: string;
  },
) {
  await requireRolePortable(ctx, {
    actingUserId: args.actingUserId,
    societyId: args.societyId,
    required: "Director",
  });
  const { id, actingUserId, ...rest } = args;
  if (id) {
    await ctx.db.patch(id, rest);
    return id;
  }
  return await ctx.db.insert("volunteerScreenings", rest);
}

export async function removeScreeningPortable(
  ctx: PortableMutationCtx,
  { id, actingUserId }: { id: string; actingUserId?: string },
) {
  const screening = await ctx.db.get(id);
  if (!screening) return;
  await requireRolePortable(ctx, {
    actingUserId,
    societyId: String(screening.societyId),
    required: "Director",
  });
  await ctx.db.delete(id);
}
