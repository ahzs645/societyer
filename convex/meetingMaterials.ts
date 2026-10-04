import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  listForMeetingPortable,
  listForSocietyPortable,
  packageForMeetingPortable,
  attachPortable,
  setAvailabilityPortable,
  removePortable,
} from "../shared/functions/meetingMaterials";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";
import { buildConvexCapabilities } from "./providers/capabilities";

const accessGrantValidator = v.object({
  subjectType: v.string(),
  subjectId: v.optional(v.string()),
  subjectLabel: v.string(),
  access: v.string(),
  note: v.optional(v.string()),
});

export const listForMeeting = authorizedQuery("meetingMaterials:listForMeeting", query)({
  args: { meetingId: v.id("meetings"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, args) => listForMeetingPortable(await toPortableQueryCtx(ctx), args),
});

export const packageForMeeting = authorizedQuery("meetingMaterials:packageForMeeting", query)({
  args: { meetingId: v.id("meetings"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, args) => packageForMeetingPortable(await toPortableQueryCtx(ctx, buildConvexCapabilities(ctx)), args),
});

export const listForSociety = authorizedQuery("meetingMaterials:listForSociety", query)({
  args: { societyId: v.id("societies"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, args) => listForSocietyPortable(await toPortableQueryCtx(ctx), args),
});

export const attach = authorizedMutation("meetingMaterials:attach", mutation)({
  args: {
    id: v.optional(v.id("meetingMaterials")),
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    documentId: v.id("documents"),
    agendaLabel: v.optional(v.string()),
    label: v.optional(v.string()),
    order: v.optional(v.number()),
    requiredForMeeting: v.optional(v.boolean()),
    accessLevel: v.optional(v.string()),
    accessGrants: v.optional(v.array(accessGrantValidator)),
    availabilityStatus: v.optional(v.string()),
    syncStatus: v.optional(v.string()),
    expiresAtISO: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => attachPortable(await toPortableMutationCtx(ctx), args),
});

export const setAvailability = authorizedMutation("meetingMaterials:setAvailability", mutation)({
  args: {
    id: v.id("meetingMaterials"),
    availabilityStatus: v.string(),
    syncStatus: v.optional(v.string()),
    expiresAtISO: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => setAvailabilityPortable(await toPortableMutationCtx(ctx), args),
});

export const remove = authorizedMutation("meetingMaterials:remove", mutation)({
  args: { id: v.id("meetingMaterials") },
  returns: v.any(),
  handler: async (ctx, args) => removePortable(await toPortableMutationCtx(ctx), args),
});

