/**
 * PORTABLE FUNCTIONS: the calendar-sync state domain
 * (upsertExternalCalendarEventMapping / recordCalendarWebhook /
 * recordCalendarIncrementalCursor).
 *
 * These stage `integrationSyncStates` rows over `ctx.db`, so they run unchanged
 * on hosted Convex, the local Dexie runtime, and the convex-test oracle.
 * `stageCalendarEvents` stays on Convex because it fans out to
 * `importSessions.createFromBundle` via `ctx.runMutation`. `upsertSyncState` is a
 * pure (`ctx.db`-only) helper shared by these handlers.
 */

import type { PortableMutationCtx } from "../portable/ctx";

export async function upsertExternalCalendarEventMappingPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    provider: string;
    calendarId?: string;
    localResourceType: string;
    localResourceId: string;
    externalEventId: string;
    iCalUID?: string;
    etag?: string;
    syncDirection?: string;
    metadata?: any;
  },
) {
  return await upsertSyncState(ctx, {
    societyId: args.societyId,
    provider: args.provider,
    resourceType: "calendar_event_mapping",
    resourceId: `${args.localResourceType}:${args.localResourceId}`,
    externalResourceId: args.externalEventId,
    status: "active",
    metadataJson: JSON.stringify({
      calendarId: args.calendarId,
      localResourceType: args.localResourceType,
      localResourceId: args.localResourceId,
      externalEventId: args.externalEventId,
      iCalUID: args.iCalUID,
      etag: args.etag,
      syncDirection: args.syncDirection ?? "bidirectional",
      ...(args.metadata && typeof args.metadata === "object" ? args.metadata : {}),
    }),
  });
}

export async function recordCalendarWebhookPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    provider: string;
    channelId?: string;
    subscriptionId?: string;
    resourceId?: string;
    expiresAtISO?: string;
    eventType?: string;
    payload?: any;
  },
) {
  return await upsertSyncState(ctx, {
    societyId: args.societyId,
    provider: args.provider,
    resourceType: "calendar_webhook",
    resourceId: args.resourceId ?? args.channelId ?? args.subscriptionId,
    webhookChannelId: args.channelId,
    webhookSubscriptionId: args.subscriptionId,
    webhookResourceId: args.resourceId,
    webhookExpiresAtISO: args.expiresAtISO,
    lastWebhookAtISO: nowISO(),
    status: "active",
    metadataJson: JSON.stringify({
      eventType: args.eventType,
      payload: args.payload,
    }),
  });
}

export async function recordCalendarIncrementalCursorPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    provider: string;
    calendarId?: string;
    syncToken?: string;
    deltaLink?: string;
    cursorType?: string;
    status?: string;
    lastError?: string;
    metadata?: any;
  },
) {
  return await upsertSyncState(ctx, {
    societyId: args.societyId,
    provider: args.provider,
    resourceType: "calendar_incremental_cursor",
    resourceId: args.calendarId ?? "primary",
    syncToken: args.syncToken,
    deltaLink: args.deltaLink,
    lastIncrementalSyncAtISO: nowISO(),
    status: args.status ?? (args.lastError ? "error" : "active"),
    lastError: args.lastError,
    metadataJson: JSON.stringify({
      calendarId: args.calendarId,
      cursorType: args.cursorType ?? "events",
      ...(args.metadata && typeof args.metadata === "object" ? args.metadata : {}),
    }),
  });
}

async function upsertSyncState(ctx: PortableMutationCtx, args: any) {
  const now = nowISO();
  const existing = (await ctx.db
    .query("integrationSyncStates")
    .withIndex("by_society_provider_resource", (q: any) =>
      q.eq("societyId", args.societyId).eq("provider", args.provider).eq("resourceType", args.resourceType),
    )
    .collect()).find((row: any) =>
      (row.resourceId ?? "") === (args.resourceId ?? "") &&
      (row.externalResourceId ?? "") === (args.externalResourceId ?? ""),
    );
  const payload = {
    ...args,
    status: args.status ?? "active",
    updatedAtISO: now,
  };
  if (existing) {
    await ctx.db.patch(existing._id, payload);
    return existing._id;
  }
  return await ctx.db.insert("integrationSyncStates", {
    ...payload,
    createdAtISO: now,
  });
}

function nowISO() {
  return new Date().toISOString();
}
