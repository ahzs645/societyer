import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireRole } from "./users";

function isoNow() {
  return new Date().toISOString();
}

function fullName(row: { firstName: string; lastName: string }) {
  return `${row.firstName} ${row.lastName}`.trim();
}

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("volunteers")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const applications = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("volunteerApplications")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const screenings = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("volunteerScreenings")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const summary = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
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
  },
});

export const submitApplication = mutation({
  args: {
    societyId: v.id("societies"),
    memberId: v.optional(v.id("members")),
    firstName: v.string(),
    lastName: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    roleWanted: v.optional(v.string()),
    availability: v.optional(v.string()),
    interests: v.array(v.string()),
    notes: v.optional(v.string()),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("volunteerApplications", {
      ...args,
      source: args.source ?? "public",
      status: "Submitted",
      submittedAtISO: isoNow(),
    });
  },
});

export const reviewApplication = mutation({
  args: {
    id: v.id("volunteerApplications"),
    status: v.string(),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, { id, status, actingUserId }) => {
    const application = await ctx.db.get(id);
    if (!application) throw new Error("Application not found.");
    await requireRole(ctx, {
      actingUserId,
      societyId: application.societyId,
      required: "Director",
    });
    await ctx.db.patch(id, {
      status,
      reviewedAtISO: isoNow(),
      reviewedByUserId: actingUserId ?? undefined,
    });
  },
});

export const convertApplication = mutation({
  args: {
    id: v.id("volunteerApplications"),
    committeeId: v.optional(v.id("committees")),
    screeningRequired: v.boolean(),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, { id, committeeId, screeningRequired, actingUserId }) => {
    const application = await ctx.db.get(id);
    if (!application) throw new Error("Application not found.");
    await requireRole(ctx, {
      actingUserId,
      societyId: application.societyId,
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
  },
});

export const upsertVolunteer = mutation({
  args: {
    id: v.optional(v.id("volunteers")),
    societyId: v.id("societies"),
    memberId: v.optional(v.id("members")),
    committeeId: v.optional(v.id("committees")),
    publicApplicationId: v.optional(v.id("volunteerApplications")),
    firstName: v.string(),
    lastName: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    status: v.string(),
    roleWanted: v.optional(v.string()),
    availability: v.optional(v.string()),
    interests: v.array(v.string()),
    screeningRequired: v.boolean(),
    orientationCompletedAtISO: v.optional(v.string()),
    trainingStatus: v.optional(v.string()),
    applicationReceivedAtISO: v.optional(v.string()),
    approvedAtISO: v.optional(v.string()),
    renewalDueAtISO: v.optional(v.string()),
    intakeSource: v.optional(v.string()),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, {
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
  },
});

export const removeVolunteer = mutation({
  args: {
    id: v.id("volunteers"),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, { id, actingUserId }) => {
    const volunteer = await ctx.db.get(id);
    if (!volunteer) return;
    await requireRole(ctx, {
      actingUserId,
      societyId: volunteer.societyId,
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
  },
});

export const upsertScreening = mutation({
  args: {
    id: v.optional(v.id("volunteerScreenings")),
    societyId: v.id("societies"),
    volunteerId: v.id("volunteers"),
    kind: v.string(),
    status: v.string(),
    provider: v.optional(v.string()),
    portalUrl: v.optional(v.string()),
    requestedAtISO: v.optional(v.string()),
    completedAtISO: v.optional(v.string()),
    expiresAtISO: v.optional(v.string()),
    referenceNumber: v.optional(v.string()),
    consentDocumentId: v.optional(v.id("documents")),
    resultDocumentId: v.optional(v.id("documents")),
    verifiedByUserId: v.optional(v.id("users")),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, {
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
  },
});

export const removeScreening = mutation({
  args: {
    id: v.id("volunteerScreenings"),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, { id, actingUserId }) => {
    const screening = await ctx.db.get(id);
    if (!screening) return;
    await requireRole(ctx, {
      actingUserId,
      societyId: screening.societyId,
      required: "Director",
    });
    await ctx.db.delete(id);
  },
});

export const buildCrrpDraft = query({
  args: { volunteerId: v.id("volunteers") },
  handler: async (ctx, { volunteerId }) => {
    const volunteer = await ctx.db.get(volunteerId);
    if (!volunteer) return null;
    const base =
      (globalThis as any)?.process?.env?.BC_CRRP_ORG_PORTAL_URL ??
      "https://justice.gov.bc.ca/eCRC/";
    return {
      volunteerId,
      volunteerName: fullName(volunteer),
      provider: "BC_CRRP",
      launchUrl: base,
      suggestedNote:
        "Launch the BC Criminal Records Review Program portal, issue the request to the volunteer, then attach consent and result evidence here.",
    };
  },
});
