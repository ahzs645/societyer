import { v } from "convex/values";
import { mutation, query } from "./lib/untypedServer";
import {
  listPortable,
  applicationsPortable,
  screeningsPortable,
  summaryPortable,
  buildCrrpDraftPortable,
  submitApplicationPortable,
  reviewApplicationPortable,
  convertApplicationPortable,
  upsertVolunteerPortable,
  removeVolunteerPortable,
  upsertScreeningPortable,
  removeScreeningPortable,
} from "../shared/functions/volunteers";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => listPortable(toPortableQueryCtx(ctx), args),
});

export const applications = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => applicationsPortable(toPortableQueryCtx(ctx), args),
});

export const screenings = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => screeningsPortable(toPortableQueryCtx(ctx), args),
});

export const summary = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => summaryPortable(toPortableQueryCtx(ctx), args),
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
  returns: v.any(),
  handler: (ctx, args) => submitApplicationPortable(toPortableMutationCtx(ctx), args),
});

export const reviewApplication = mutation({
  args: {
    id: v.id("volunteerApplications"),
    status: v.string(),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: (ctx, args) => reviewApplicationPortable(toPortableMutationCtx(ctx), args),
});

export const convertApplication = mutation({
  args: {
    id: v.id("volunteerApplications"),
    committeeId: v.optional(v.id("committees")),
    screeningRequired: v.boolean(),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: (ctx, args) => convertApplicationPortable(toPortableMutationCtx(ctx), args),
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
  returns: v.any(),
  handler: (ctx, args) => upsertVolunteerPortable(toPortableMutationCtx(ctx), args),
});

export const removeVolunteer = mutation({
  args: {
    id: v.id("volunteers"),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: (ctx, args) => removeVolunteerPortable(toPortableMutationCtx(ctx), args),
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
  returns: v.any(),
  handler: (ctx, args) => upsertScreeningPortable(toPortableMutationCtx(ctx), args),
});

export const removeScreening = mutation({
  args: {
    id: v.id("volunteerScreenings"),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: (ctx, args) => removeScreeningPortable(toPortableMutationCtx(ctx), args),
});

export const buildCrrpDraft = query({
  args: { volunteerId: v.id("volunteers") },
  returns: v.any(),
  handler: (ctx, args) => buildCrrpDraftPortable(toPortableQueryCtx(ctx), args),
});
