import { v } from "convex/values";
import { BUILT_IN_GRANT_SOURCE_PROFILES, BUILT_IN_GRANT_SOURCES } from "../shared/grantSourceLibrary";
import { mutation, query } from "./lib/untypedServer";
import { requireRole } from "./users";

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
  handler: async () =>
    BUILT_IN_SOURCES.map((source) => ({
      ...source,
      builtIn: true,
      profile: BUILT_IN_PROFILES.find((profile) => profile.libraryKey === source.libraryKey),
    })),
});

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const [sources, profiles, candidates] = await Promise.all([
      ctx.db
        .query("grantSources")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect(),
      ctx.db
        .query("grantSourceProfiles")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect(),
      ctx.db
        .query("grantOpportunityCandidates")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect(),
    ]);
    const profileBySource = new Map(profiles.map((profile: any) => [String(profile.sourceId), profile]));
    const candidateCountBySource = new Map<string, number>();
    for (const candidate of candidates) {
      if (!candidate.sourceId) continue;
      const key = String(candidate.sourceId);
      candidateCountBySource.set(key, (candidateCountBySource.get(key) ?? 0) + 1);
    }
    return sources
      .map((source: any) => ({
        ...source,
        builtIn: false,
        profile: profileBySource.get(String(source._id)),
        candidateCount: candidateCountBySource.get(String(source._id)) ?? 0,
      }))
      .sort((a, b) => `${a.status}:${a.name}`.localeCompare(`${b.status}:${b.name}`));
  },
});

export const listWithLibrary = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const installed = await ctx.db
      .query("grantSources")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const installedKeys = new Set(installed.map((source: any) => source.libraryKey).filter(Boolean));
    const installedByKey = new Map<string, any>(installed.map((source: any) => [source.libraryKey, source]));
    const libraryRows = BUILT_IN_SOURCES.map((source) => ({
      ...source,
      _id: installedByKey.get(source.libraryKey)?._id,
      builtIn: true,
      installed: installedKeys.has(source.libraryKey),
      profile: BUILT_IN_PROFILES.find((profile) => profile.libraryKey === source.libraryKey),
    }));
    return { library: libraryRows, workspace: installed };
  },
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
  handler: async (ctx, { societyId, libraryKey, actingUserId }) => {
    await requireRole(ctx, { actingUserId, societyId, required: "Director" });
    const source = BUILT_IN_SOURCES.find((item) => item.libraryKey === libraryKey);
    if (!source) throw new Error("Grant source is not in the built-in library.");
    const profile = BUILT_IN_PROFILES.find((item) => item.libraryKey === libraryKey);
    const existing = await ctx.db
      .query("grantSources")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect()
      .then((rows: any[]) => rows.find((row) => row.libraryKey === libraryKey));
    const now = isoNow();
    const sourcePayload = {
      societyId,
      libraryKey: source.libraryKey,
      name: source.name,
      url: source.url,
      sourceType: source.sourceType,
      jurisdiction: source.jurisdiction,
      funderType: source.funderType,
      eligibilityTags: [...source.eligibilityTags],
      topicTags: [...source.topicTags],
      scrapeCadence: source.scrapeCadence,
      trustLevel: source.trustLevel,
      status: source.status,
      notes: source.notes,
      createdByUserId: actingUserId,
      updatedAtISO: now,
    };
    const sourceId = existing
      ? (await ctx.db.patch(existing._id, sourcePayload), existing._id)
      : await ctx.db.insert("grantSources", { ...sourcePayload, createdAtISO: now });

    if (profile) {
      const existingProfiles = await ctx.db
        .query("grantSourceProfiles")
        .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
        .collect();
      const profilePayload = {
        societyId,
        sourceId,
        libraryKey,
        profileKind: profile.profileKind,
        listSelector: profile.listSelector,
        itemSelector: profile.itemSelector,
        detailUrlPattern: profile.detailUrlPattern,
        fieldMappings: profile.fieldMappings,
        detailFieldMappings: profile.detailFieldMappings,
        dateFormat: profile.dateFormat,
        currency: profile.currency,
        pagination: profile.pagination,
        requiresAuth: profile.requiresAuth,
        connectorId: profile.connectorId,
        notes: profile.notes,
        updatedAtISO: now,
      };
      if (existingProfiles[0]) {
        await ctx.db.patch(existingProfiles[0]._id, profilePayload);
      } else {
        await ctx.db.insert("grantSourceProfiles", { ...profilePayload, createdAtISO: now });
      }
    }
    return { sourceId, installed: !existing };
  },
});

export const candidates = query({
  args: { societyId: v.id("societies"), sourceId: v.optional(v.id("grantSources")) },
  returns: v.any(),
  handler: async (ctx, { societyId, sourceId }) => {
    const rows = sourceId
      ? await ctx.db
          .query("grantOpportunityCandidates")
          .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
          .collect()
      : await ctx.db
          .query("grantOpportunityCandidates")
          .withIndex("by_society", (q) => q.eq("societyId", societyId))
          .collect();
    return rows
      .filter((row: any) => row.societyId === societyId)
      .sort((a: any, b: any) => (a.applicationDueDate ?? "").localeCompare(b.applicationDueDate ?? ""));
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
