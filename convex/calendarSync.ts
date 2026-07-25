import { v } from "convex/values";
import { mutation } from "./lib/untypedServer";
import { toPortableMutationCtx } from "./lib/portable";
import {
  upsertExternalCalendarEventMappingPortable,
  recordCalendarWebhookPortable,
  recordCalendarIncrementalCursorPortable,
  stageCalendarEventsPortable,
} from "../shared/functions/calendarSync";

export const stageCalendarEvents = mutation({
  args: {
    societyId: v.id("societies"),
    provider: v.string(),
    calendarId: v.optional(v.string()),
    events: v.array(v.any()),
    name: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => stageCalendarEventsPortable(await toPortableMutationCtx(ctx), args),
});

export const upsertExternalCalendarEventMapping = mutation({
  args: {
    societyId: v.id("societies"),
    provider: v.string(),
    calendarId: v.optional(v.string()),
    localResourceType: v.string(),
    localResourceId: v.string(),
    externalEventId: v.string(),
    iCalUID: v.optional(v.string()),
    etag: v.optional(v.string()),
    syncDirection: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  returns: v.id("integrationSyncStates"),
  handler: async (ctx, args) => upsertExternalCalendarEventMappingPortable(await toPortableMutationCtx(ctx), args),
});

export const recordCalendarWebhook = mutation({
  args: {
    societyId: v.id("societies"),
    provider: v.string(),
    channelId: v.optional(v.string()),
    subscriptionId: v.optional(v.string()),
    resourceId: v.optional(v.string()),
    expiresAtISO: v.optional(v.string()),
    eventType: v.optional(v.string()),
    payload: v.optional(v.any()),
  },
  returns: v.id("integrationSyncStates"),
  handler: async (ctx, args) => recordCalendarWebhookPortable(await toPortableMutationCtx(ctx), args),
});

export const recordCalendarIncrementalCursor = mutation({
  args: {
    societyId: v.id("societies"),
    provider: v.string(),
    calendarId: v.optional(v.string()),
    syncToken: v.optional(v.string()),
    deltaLink: v.optional(v.string()),
    cursorType: v.optional(v.string()),
    status: v.optional(v.string()),
    lastError: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  returns: v.id("integrationSyncStates"),
  handler: async (ctx, args) => recordCalendarIncrementalCursorPortable(await toPortableMutationCtx(ctx), args),
});
