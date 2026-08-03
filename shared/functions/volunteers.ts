/**
 * PORTABLE FUNCTIONS: the volunteers domain (the pure `ctx.db` handlers).
 *
 * Read handlers and the role-/module-gated mutation surface both live here. Role
 * gating goes through `requireRolePortable` and module enablement through the
 * dep-free `normalizeModuleSettings` helper, so each handler below runs unchanged
 * on hosted Convex, the local Dexie runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import {
  getOwned,
  principalUserId,
  requireRolePortable,
  requireSocietyMembership,
} from "./access";
import { MODULES_BY_KEY, normalizeModuleSettings, type ModuleKey } from "../../src/lib/modules";

function isoNow() {
  return new Date().toISOString();
}

async function requireEnabledModulePortable(ctx: PortableMutationCtx, societyId: string, key: ModuleKey) {
  await requireSocietyMembership(ctx, societyId);
  const society = await ctx.db.get(societyId, "societies");
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
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("volunteers")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function applicationsPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("volunteerApplications")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function screeningsPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("volunteerScreenings")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function summaryPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
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
  const candidate = await ctx.db.get(volunteerId, "volunteers");
  if (!candidate) return null;
  await requireSocietyMembership(ctx, String(candidate.societyId));
  const volunteer = await getOwned(ctx, "volunteers", volunteerId, String(candidate.societyId));
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
  if (args.memberId) await getOwned(ctx, "members", args.memberId, args.societyId);
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
  const candidate = await ctx.db.get(id, "volunteerApplications");
  if (!candidate) throw new Error("volunteerApplications not found.");
  await requireSocietyMembership(ctx, String(candidate.societyId));
  const application = await getOwned(
    ctx,
    "volunteerApplications",
    id,
    String(candidate.societyId),
  );
  if (!application) throw new Error("Application not found.");
  await requireRolePortable(ctx, {
    actingUserId,
    societyId: String(application.societyId),
    required: "Director",
  });
  const reviewedByUserId = await principalUserId(ctx, String(application.societyId));
  await ctx.db.patch(id, {
    status,
    reviewedAtISO: isoNow(),
    reviewedByUserId,
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
  const candidate = await ctx.db.get(id, "volunteerApplications");
  if (!candidate) throw new Error("volunteerApplications not found.");
  await requireSocietyMembership(ctx, String(candidate.societyId));
  const application = await getOwned(
    ctx,
    "volunteerApplications",
    id,
    String(candidate.societyId),
  );
  await requireRolePortable(ctx, {
    actingUserId,
    societyId: String(application.societyId),
    required: "Director",
  });
  const reviewedByUserId = await principalUserId(ctx, String(application.societyId));
  if (committeeId) {
    await getOwned(ctx, "committees", committeeId, String(application.societyId));
  }

  const existingVolunteer = application.linkedVolunteerId
    ? await getOwned(
        ctx,
        "volunteers",
        application.linkedVolunteerId,
        String(application.societyId),
      )
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
    reviewedByUserId,
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
  await requireSocietyMembership(ctx, args.societyId);
  await requireRolePortable(ctx, {
    actingUserId: args.actingUserId,
    societyId: args.societyId,
    required: "Director",
  });
  if (args.id) await getOwned(ctx, "volunteers", args.id, args.societyId);
  if (args.memberId) await getOwned(ctx, "members", args.memberId, args.societyId);
  if (args.committeeId) await getOwned(ctx, "committees", args.committeeId, args.societyId);
  if (args.publicApplicationId) {
    await getOwned(ctx, "volunteerApplications", args.publicApplicationId, args.societyId);
  }
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
  const volunteer = await ctx.db.get(id, "volunteers");
  if (!volunteer) return;
  await requireSocietyMembership(ctx, String(volunteer.societyId));
  await requireRolePortable(ctx, {
    actingUserId,
    societyId: String(volunteer.societyId),
    required: "Director",
  });
  await getOwned(ctx, "volunteers", id, String(volunteer.societyId));
  const screenings = await ctx.db
    .query("volunteerScreenings")
    .withIndex("by_volunteer", (q) => q.eq("volunteerId", id))
    .collect();
  for (const screening of screenings) {
    await ctx.db.delete(screening._id);
  }
  if (volunteer.publicApplicationId) {
    await getOwned(
      ctx,
      "volunteerApplications",
      volunteer.publicApplicationId,
      String(volunteer.societyId),
    );
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
  await requireSocietyMembership(ctx, args.societyId);
  await requireRolePortable(ctx, {
    actingUserId: args.actingUserId,
    societyId: args.societyId,
    required: "Director",
  });
  if (args.id) await getOwned(ctx, "volunteerScreenings", args.id, args.societyId);
  await getOwned(ctx, "volunteers", args.volunteerId, args.societyId);
  if (args.consentDocumentId) {
    await getOwned(ctx, "documents", args.consentDocumentId, args.societyId);
  }
  if (args.resultDocumentId) {
    await getOwned(ctx, "documents", args.resultDocumentId, args.societyId);
  }
  if (args.verifiedByUserId) {
    await getOwned(ctx, "users", args.verifiedByUserId, args.societyId);
  }
  const verifiedByUserId = args.verifiedByUserId
    ? await principalUserId(ctx, args.societyId)
    : undefined;
  const { id, actingUserId, ...rest } = args;
  const payload = { ...rest, verifiedByUserId };
  if (id) {
    await ctx.db.patch(id, payload);
    return id;
  }
  return await ctx.db.insert("volunteerScreenings", payload);
}

export async function removeScreeningPortable(
  ctx: PortableMutationCtx,
  { id, actingUserId }: { id: string; actingUserId?: string },
) {
  const screening = await ctx.db.get(id, "volunteerScreenings");
  if (!screening) return;
  await requireSocietyMembership(ctx, String(screening.societyId));
  await requireRolePortable(ctx, {
    actingUserId,
    societyId: String(screening.societyId),
    required: "Director",
  });
  await getOwned(ctx, "volunteerScreenings", id, String(screening.societyId));
  await ctx.db.delete(id);
}
