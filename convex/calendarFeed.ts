import { query, mutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import type { ICalEvent } from "../shared/icalendar";
import {
  getFeedTokenPortable,
  setFeedTokenPortable,
} from "../shared/functions/calendarFeed";
import { toPortableMutationCtx, toPortableQueryCtx } from "./lib/portable";

/**
 * Outbound read-only iCalendar feed (the `export_ics` action in the integration
 * catalog). A per-society bearer token lives in the subscribe URL; the token IS
 * the credential, the same model Google/Outlook/Apple use for `webcal://` feeds.
 * The token is generated client-side (matching apiPlatform's client-hash model)
 * and stored on the society. `feedByToken` is internal — only the public
 * `/calendar/feed` httpAction reads it.
 */

/** Read the current feed token for the Settings/Integrations UI (null = off). */
export const getFeedToken = query({
  args: { societyId: v.id("societies") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => getFeedTokenPortable(await toPortableQueryCtx(ctx), args),
});

/** Enable/rotate (token = string) or disable (token = null) the feed. */
export const setFeedToken = mutation({
  args: { societyId: v.id("societies"), token: v.union(v.string(), v.null()) },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => setFeedTokenPortable(await toPortableMutationCtx(ctx), args),
});

/** Resolve a token to its society's calendar events. Internal: feeds the
 *  `/calendar/feed` httpAction only. Returns null for an unknown token. */
export const feedByToken = internalQuery({
  args: { token: v.string() },
  returns: v.any(),
  handler: async (ctx, { token }) => {
    if (!token) return null;
    const society = await ctx.db
      .query("societies")
      .withIndex("by_calendar_feed_token", (q) => q.eq("calendarFeedToken", token))
      .first();
    if (!society) return null;

    const [deadlines, filings, meetings] = await Promise.all([
      ctx.db.query("deadlines").withIndex("by_society", (q) => q.eq("societyId", society._id)).collect(),
      ctx.db.query("filings").withIndex("by_society", (q) => q.eq("societyId", society._id)).collect(),
      ctx.db.query("meetings").withIndex("by_society", (q) => q.eq("societyId", society._id)).collect(),
    ]);

    const events: ICalEvent[] = [];
    for (const d of deadlines) {
      if (d.done || (d.status && d.status !== "open")) continue;
      events.push({
        uid: `deadline-${d._id}@societyer`,
        start: d.dueDate,
        allDay: true,
        summary: `Deadline: ${d.title}`,
        description: d.category ? `Category: ${d.category}` : undefined,
      });
    }
    for (const f of filings) {
      if (f.status === "Filed") continue;
      events.push({
        uid: `filing-${f._id}@societyer`,
        start: f.dueDate,
        allDay: true,
        summary: `Filing: ${f.kind}${f.periodLabel ? ` — ${f.periodLabel}` : ""}`,
      });
    }
    for (const m of meetings) {
      if (m.status === "Cancelled") continue;
      events.push({
        uid: `meeting-${m._id}@societyer`,
        start: m.scheduledAt,
        allDay: false,
        summary: `${m.type}: ${m.title}`,
        location: m.location ?? m.remoteUrl ?? undefined,
        url: m.remoteUrl ?? undefined,
      });
    }

    return { calendarName: `${society.name} — Societyer`, events };
  },
});
