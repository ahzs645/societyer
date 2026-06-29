import { v } from "convex/values";
import { BUILT_IN_GRANT_SOURCE_PROFILES, BUILT_IN_GRANT_SOURCES } from "../shared/grantSourceLibrary";
import { action, internalMutation, mutation, query } from "./lib/untypedServer";
import { api, internal } from "./_generated/api";
import { requireRole } from "./users";
import {
  parseRssOpportunities,
  parseJsonFeedOpportunities,
  type DiscoveredOpportunity,
} from "../shared/grantFeedParsers";
import {
  libraryPortable,
  listPortable,
  listWithLibraryPortable,
  getSourcePortable,
  candidatesPortable,
  createCandidatePortable,
  setCandidateStatusPortable,
  addFromLibraryPortable,
} from "../shared/functions/grantSources";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

function isoNow() {
  return new Date().toISOString();
}

const BUILT_IN_SOURCES = BUILT_IN_GRANT_SOURCES;
const BUILT_IN_PROFILES = BUILT_IN_GRANT_SOURCE_PROFILES;

const sourcePatchValidator = v.object({
  name: v.optional(v.string()),
  url: v.optional(v.string()),
  sourceType: v.optional(v.string()),
  jurisdiction: v.optional(v.string()),
  funderType: v.optional(v.string()),
  eligibilityTags: v.optional(v.array(v.string())),
  topicTags: v.optional(v.array(v.string())),
  scrapeCadence: v.optional(v.string()),
  trustLevel: v.optional(v.string()),
  status: v.optional(v.string()),
  notes: v.optional(v.string()),
});

export const library = query({
  args: {},
  returns: v.any(),
  handler: (ctx, args) => libraryPortable(toPortableQueryCtx(ctx), args),
});

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => listPortable(toPortableQueryCtx(ctx), args),
});

export const listWithLibrary = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => listWithLibraryPortable(toPortableQueryCtx(ctx), args),
});

export const upsert = mutation({
  args: {
    id: v.optional(v.id("grantSources")),
    societyId: v.id("societies"),
    patch: sourcePatchValidator,
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, { id, societyId, patch, actingUserId }) => {
    await requireRole(ctx, { actingUserId, societyId, required: "Director" });
    const now = isoNow();
    const payload = {
      name: cleanText(patch.name) || "Custom grant source",
      url: cleanText(patch.url) || "",
      sourceType: cleanText(patch.sourceType) || "custom",
      jurisdiction: cleanText(patch.jurisdiction),
      funderType: cleanText(patch.funderType),
      eligibilityTags: cleanList(patch.eligibilityTags),
      topicTags: cleanList(patch.topicTags),
      scrapeCadence: cleanText(patch.scrapeCadence) || "manual",
      trustLevel: cleanText(patch.trustLevel) || "unknown",
      status: cleanText(patch.status) || "active",
      notes: cleanText(patch.notes),
      updatedAtISO: now,
    };
    if (id) {
      const existing = await ctx.db.get(id);
      if (!existing || existing.societyId !== societyId) throw new Error("Grant source not found.");
      await ctx.db.patch(id, payload);
      return id;
    }
    return await ctx.db.insert("grantSources", {
      societyId,
      ...payload,
      createdByUserId: actingUserId,
      createdAtISO: now,
    });
  },
});

export const addFromLibrary = mutation({
  args: {
    societyId: v.id("societies"),
    libraryKey: v.string(),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: (ctx, args) => addFromLibraryPortable(toPortableMutationCtx(ctx), args),
});

export const getSource = query({
  args: { sourceId: v.id("grantSources") },
  returns: v.any(),
  handler: (ctx, args) => getSourcePortable(toPortableQueryCtx(ctx), args),
});

export const candidates = query({
  args: { societyId: v.id("societies"), sourceId: v.optional(v.id("grantSources")) },
  returns: v.any(),
  handler: (ctx, args) => candidatesPortable(toPortableQueryCtx(ctx), args),
});

// Manually add a grant opportunity to the review queue. The automated scraping
// engine (grantSourceProfiles) is a separate, larger effort; this lets a user
// populate and triage candidates by hand so the queue is functional today.
export const createCandidate = mutation({
  args: {
    societyId: v.id("societies"),
    sourceId: v.optional(v.id("grantSources")),
    title: v.string(),
    funder: v.optional(v.string()),
    program: v.optional(v.string()),
    opportunityUrl: v.optional(v.string()),
    applicationDueDate: v.optional(v.string()),
    amountText: v.optional(v.string()),
    eligibilityText: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => createCandidatePortable(toPortableMutationCtx(ctx), args),
});

export const setCandidateStatus = mutation({
  args: { candidateId: v.id("grantOpportunityCandidates"), status: v.string() },
  returns: v.any(),
  handler: (ctx, args) => setCandidateStatusPortable(toPortableMutationCtx(ctx), args),
});

// Persist discovered opportunities into the queue, deduping by sourceExternalId
// within the source, and stamp the source's lastScrapedAtISO.
export const _recordDiscoveredCandidates = internalMutation({
  args: {
    societyId: v.id("societies"),
    sourceId: v.optional(v.id("grantSources")),
    items: v.array(v.any()),
  },
  returns: v.any(),
  handler: async (ctx, { societyId, sourceId, items }) => {
    const existing = sourceId
      ? await ctx.db.query("grantOpportunityCandidates").withIndex("by_source", (q: any) => q.eq("sourceId", sourceId)).collect()
      : await ctx.db.query("grantOpportunityCandidates").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const seen = new Set<string>();
    for (const row of existing) for (const id of row.sourceExternalIds ?? []) seen.add(id);

    const now = new Date().toISOString();
    let inserted = 0;
    for (const item of items as DiscoveredOpportunity[]) {
      if (seen.has(item.externalId)) continue;
      seen.add(item.externalId);
      await ctx.db.insert("grantOpportunityCandidates", {
        societyId,
        sourceId,
        title: item.title,
        funder: item.funder,
        program: item.program,
        opportunityUrl: item.opportunityUrl,
        applicationDueDate: item.applicationDueDate,
        amountText: item.amountText,
        eligibilityText: item.eligibilityText,
        description: item.description,
        confidence: "medium",
        status: "New",
        sourceExternalIds: [item.externalId],
        createdAtISO: now,
        updatedAtISO: now,
      });
      inserted += 1;
    }
    if (sourceId) await ctx.db.patch(sourceId, { lastScrapedAtISO: now, updatedAtISO: now });
    return { inserted, found: items.length };
  },
});

// Discover opportunities from a saved source's RSS or JSON feed and queue new
// ones. HTML-selector scraping needs a DOM engine that isn't available
// server-side — those sources report clearly and should use a feed or manual
// entry instead.
export const discoverFromSource = action({
  args: { societyId: v.id("societies"), sourceId: v.id("grantSources"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx: any, { societyId, sourceId }: any) => {
    const source = await ctx.runQuery(api.grantSources.getSource, { sourceId });
    if (!source || source.societyId !== societyId) throw new Error("Grant source not found.");
    const profile = source.profile;
    const kind = profile?.profileKind ?? (source.sourceType === "rss" ? "rss" : undefined);

    let res: Response;
    try {
      res = await fetch(source.url, { headers: { "user-agent": "societyer-grant-discovery/1.0" } });
    } catch (err: any) {
      throw new Error(`Could not fetch ${source.url}: ${String(err?.message ?? err)}`);
    }
    if (!res.ok) throw new Error(`Fetching ${source.url} returned ${res.status}.`);
    const body = await res.text();

    let items: DiscoveredOpportunity[];
    if (kind === "json_feed") {
      let json: any;
      try {
        json = JSON.parse(body);
      } catch {
        throw new Error("Source is configured as a JSON feed but did not return valid JSON.");
      }
      items = parseJsonFeedOpportunities(json, profile?.fieldMappings, profile?.listSelector);
    } else if (kind === "rss" || /<rss\b|<feed\b/i.test(body)) {
      items = parseRssOpportunities(body);
    } else {
      throw new Error(
        "This source needs HTML/CSS-selector scraping, which isn't supported server-side. " +
          "Point it at an RSS or JSON feed, or add opportunities manually.",
      );
    }

    const result = await ctx.runMutation(internal.grantSources._recordDiscoveredCandidates, {
      societyId,
      sourceId,
      items,
    });
    return result;
  },
});

function cleanText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

function cleanList(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const text = String(item ?? "").trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}
