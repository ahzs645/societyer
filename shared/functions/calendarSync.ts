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

/**
 * Stage external calendar events as an import-session bundle. Orchestrates
 * `importSessions:createFromBundle` through `ctx.runMutation`, which the portable
 * runtime dispatches to the (registered) portable handler — so this runs on
 * hosted Convex and the local runtime alike.
 */
export async function stageCalendarEventsPortable(
  ctx: PortableMutationCtx,
  { societyId, provider, calendarId, events, name }: {
    societyId: string;
    provider: string;
    calendarId?: string;
    events: any[];
    name?: string;
  },
) {
  const bundle = calendarEventsImportBundle({ provider, calendarId, events });
  return await ctx.runMutation("importSessions:createFromBundle", {
    societyId,
    name: name ?? `${providerLabel(provider)} calendar sync`,
    bundle,
  });
}

function calendarEventsImportBundle(input: { provider: string; calendarId?: string; events: any[] }) {
  const provider = input.provider;
  const calendarId = input.calendarId ?? "primary";
  const events = input.events.map((event, index) => normalizeCalendarEvent(event, index, provider, calendarId));
  return {
    metadata: {
      createdFrom: "calendar-sync",
      sourceSystem: provider,
      importedFrom: `${providerLabel(provider)} calendar sync`,
      calendarId,
      stagedAtISO: nowISO(),
    },
    sources: [
      {
        externalSystem: provider,
        externalId: `${provider}:calendar:${calendarId}`,
        title: `${providerLabel(provider)} calendar ${calendarId}`,
        category: "Calendar sync",
        notes: "Calendar events staged from provider webhook or incremental sync.",
        tags: ["calendar-sync", provider],
      },
    ],
    deadlines: events
      .filter((event) => event.deadlineDate)
      .map((event) => ({
        title: event.title,
        dueDate: event.deadlineDate,
        category: event.category,
        sourceExternalIds: event.sourceExternalIds,
        notes: event.notes,
        status: "NeedsReview",
      })),
    sourceEvidence: events.map((event) => ({
      title: event.title,
      sourceSystem: provider,
      sourceDate: event.startDate,
      contentType: "calendar-event",
      summary: event.summary,
      confidence: "calendar-sync",
      sourceExternalIds: event.sourceExternalIds,
      notes: event.notes,
      payload: event.raw,
    })),
  };
}

function normalizeCalendarEvent(event: any, index: number, provider: string, calendarId: string) {
  const externalEventId = stringValue(event.id ?? event.externalEventId ?? event.eventId) ?? `event-${index + 1}`;
  const title = stringValue(event.summary ?? event.subject ?? event.title) ?? "Calendar event";
  const startDate = dateValue(event.start?.date ?? event.start?.dateTime ?? event.startDateTime ?? event.start);
  const category = stringValue(event.category ?? event.kind) ?? "Calendar";
  const sourceExternalIds = [
    `${provider}:calendar:${calendarId}`,
    `${provider}:event:${externalEventId}`,
    event.iCalUID ? `${provider}:ical:${event.iCalUID}` : undefined,
  ].filter(Boolean);
  return {
    title,
    startDate,
    deadlineDate: event.kind === "deadline" || event.isDeadline ? startDate : undefined,
    category,
    summary: stringValue(event.description ?? event.bodyPreview ?? event.location?.displayName) ?? `${title}${startDate ? ` on ${startDate}` : ""}`,
    sourceExternalIds,
    notes: "Review staged calendar event before applying it to governance records.",
    raw: event,
  };
}

function providerLabel(provider: string) {
  if (provider === "google-calendar") return "Google Calendar";
  if (provider === "microsoft-365") return "Microsoft 365";
  return provider
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function dateValue(value: unknown) {
  const text = stringValue(value);
  if (!text) return undefined;
  return text.length >= 10 ? text.slice(0, 10) : text;
}

function stringValue(value: unknown) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function nowISO() {
  return new Date().toISOString();
}
