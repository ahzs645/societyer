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

export const listForMeeting = query({
  args: { meetingId: v.id("meetings"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: (ctx, args) => listForMeetingPortable(toPortableQueryCtx(ctx), args),
});

export const packageForMeeting = query({
  args: { meetingId: v.id("meetings"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: (ctx, args) => packageForMeetingPortable(toPortableQueryCtx(ctx, buildConvexCapabilities(ctx)), args),
});

export const listForSociety = query({
  args: { societyId: v.id("societies"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: (ctx, args) => listForSocietyPortable(toPortableQueryCtx(ctx), args),
});

export const attach = mutation({
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
  handler: (ctx, args) => attachPortable(toPortableMutationCtx(ctx), args),
});

export const setAvailability = mutation({
  args: {
    id: v.id("meetingMaterials"),
    availabilityStatus: v.string(),
    syncStatus: v.optional(v.string()),
    expiresAtISO: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => setAvailabilityPortable(toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("meetingMaterials") },
  returns: v.any(),
  handler: (ctx, args) => removePortable(toPortableMutationCtx(ctx), args),
});

