import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const HISTORY_TAG = "org-history";
const SOURCE_TAG = "org-history-source";
const ITEM_TAG = "org-history-item";
const SOURCE_CATEGORY = "Org History Source";
const ITEM_CATEGORY = "Org History Item";

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();

    const sources: any[] = [];
    const facts: any[] = [];
    const events: any[] = [];
    const boardTerms: any[] = [];
    const motions: any[] = [];
    const budgets: any[] = [];

    for (const doc of docs) {
      if (!doc.tags.includes(HISTORY_TAG)) continue;

      if (doc.tags.includes(SOURCE_TAG)) {
        sources.push(hydrateSource(doc));
        continue;
      }

      if (!doc.tags.includes(ITEM_TAG)) continue;
      const record = hydrateItem(doc);
      if (record.kind === "fact") facts.push(record);
      if (record.kind === "event") events.push(record);
      if (record.kind === "boardTerm") boardTerms.push(record);
      if (record.kind === "motion") motions.push(record);
      if (record.kind === "budget") budgets.push(record);
    }

    return {
      sources: sources.sort((a, b) => (a.sourceDate ?? "").localeCompare(b.sourceDate ?? "")),
      facts: facts.sort((a, b) => String(a.label ?? "").localeCompare(String(b.label ?? ""))),
      events: events.sort((a, b) => String(a.eventDate ?? "").localeCompare(String(b.eventDate ?? ""))),
      boardTerms: boardTerms.sort((a, b) => String(a.startDate ?? "").localeCompare(String(b.startDate ?? ""))),
      motions: motions.sort((a, b) => String(a.meetingDate ?? "").localeCompare(String(b.meetingDate ?? ""))),
      budgets: budgets.sort((a, b) => String(a.fiscalYear ?? "").localeCompare(String(b.fiscalYear ?? ""))),
    };
  },
});

export const saveSource = mutation({
  args: {
    societyId: v.id("societies"),
    id: v.optional(v.id("documents")),
    payload: v.any(),
  },
  handler: async (ctx, { societyId, id, payload }) => {
    const source = normalizeSource(payload);
    if (!source.title) return null;

    if (id) {
      const existing = await ctx.db.get(id);
      if (!isHistorySource(existing)) return null;
      await ctx.db.patch(id, {
        title: source.title,
        content: JSON.stringify(source),
        url: source.url,
        tags: sourceTags(source),
      });
      return id;
    }

    return await ctx.db.insert("documents", {
      societyId,
      title: source.title,
      category: SOURCE_CATEGORY,
      content: JSON.stringify(source),
      url: source.url,
      createdAtISO: new Date().toISOString(),
      flaggedForDeletion: false,
      tags: sourceTags(source),
    });
  },
});

export const removeSource = mutation({
  args: { id: v.id("documents") },
  handler: async (ctx, { id }) => {
    const source = await ctx.db.get(id);
    if (!isHistorySource(source)) return;

    const docs = await ctx.db
      .query("documents")
      .withIndex("by_society", (q) => q.eq("societyId", source.societyId))
      .collect();

    await Promise.all([
      ...docs.filter(isHistoryItem).map((doc) => {
        const item = hydrateItem(doc);
        const sourceIds = Array.isArray(item.sourceIds)
          ? item.sourceIds.filter((sourceId: string) => sourceId !== id)
          : [];
        return ctx.db.patch(doc._id, {
          content: JSON.stringify({ ...item, sourceIds, kind: item.kind }),
        });
      }),
      ctx.db.delete(id),
    ]);
  },
});

export const saveItem = mutation({
  args: {
    societyId: v.id("societies"),
    id: v.optional(v.id("documents")),
    kind: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, { societyId, id, kind, payload }) => {
    if (!isItemKind(kind)) return null;
    const item = normalizeItem(kind, payload);

    if (id) {
      const existing = await ctx.db.get(id);
      if (!isHistoryItem(existing)) return null;
      const current = hydrateItem(existing);
      if (current.kind !== kind) return null;

      await ctx.db.patch(id, {
        title: item.title,
        content: JSON.stringify({ kind, ...item.data }),
        tags: itemTags(kind),
      });
      return id;
    }

    return await ctx.db.insert("documents", {
      societyId,
      title: item.title,
      category: ITEM_CATEGORY,
      content: JSON.stringify({ kind, ...item.data }),
      createdAtISO: new Date().toISOString(),
      flaggedForDeletion: false,
      tags: itemTags(kind),
    });
  },
});

export const removeItem = mutation({
  args: { id: v.id("documents"), kind: v.string() },
  handler: async (ctx, { id, kind }) => {
    if (!isItemKind(kind)) return;
    const existing = await ctx.db.get(id);
    if (!isHistoryItem(existing)) return;
    const current = hydrateItem(existing);
    if (current.kind !== kind) return;
    await ctx.db.delete(id);
  },
});

export const bulkImport = mutation({
  args: {
    societyId: v.id("societies"),
    sources: v.array(v.any()),
    facts: v.array(v.any()),
    events: v.array(v.any()),
    boardTerms: v.optional(v.array(v.any())),
    motions: v.optional(v.array(v.any())),
    budgets: v.optional(v.array(v.any())),
  },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .collect();
    const existingSources = docs.filter(isHistorySource).map(hydrateSource);
    const sourceIdByExternalId = new Map<string, any>();
    let sourceCount = 0;

    for (const rawSource of args.sources) {
      const source = normalizeSource(rawSource);
      if (!source.title) continue;

      let sourceId = null;
      if (source.externalId) {
        const existing = existingSources.find(
          (candidate) =>
            candidate.externalId === source.externalId &&
            (candidate.externalSystem ?? "paperless") === (source.externalSystem ?? "paperless"),
        );
        sourceId = existing?._id ?? null;
      }

      if (sourceId) {
        await ctx.db.patch(sourceId, {
          title: source.title,
          content: JSON.stringify(source),
          url: source.url,
          tags: sourceTags(source),
        });
      } else {
        sourceId = await ctx.db.insert("documents", {
          societyId: args.societyId,
          title: source.title,
          category: SOURCE_CATEGORY,
          content: JSON.stringify(source),
          url: source.url,
          createdAtISO: new Date().toISOString(),
          flaggedForDeletion: false,
          tags: sourceTags(source),
        });
        sourceCount += 1;
      }

      if (source.externalId) sourceIdByExternalId.set(source.externalId, sourceId);
    }

    const resolveSources = (externalIds: unknown) => {
      if (!Array.isArray(externalIds)) return [];
      return externalIds
        .map((externalId) => sourceIdByExternalId.get(String(externalId)))
        .filter(Boolean);
    };

    const counts = {
      sources: sourceCount,
      facts: 0,
      events: 0,
      boardTerms: 0,
      motions: 0,
      budgets: 0,
    };

    for (const fact of args.facts) {
      await insertHistoryItem(ctx, args.societyId, "fact", {
        ...fact,
        sourceIds: resolveSources(fact?.sourceExternalIds),
      });
      counts.facts += 1;
    }

    for (const event of args.events) {
      await insertHistoryItem(ctx, args.societyId, "event", {
        ...event,
        sourceIds: resolveSources(event?.sourceExternalIds),
      });
      counts.events += 1;
    }

    for (const term of args.boardTerms ?? []) {
      await insertHistoryItem(ctx, args.societyId, "boardTerm", {
        ...term,
        sourceIds: resolveSources(term?.sourceExternalIds),
      });
      counts.boardTerms += 1;
    }

    for (const motion of args.motions ?? []) {
      await insertHistoryItem(ctx, args.societyId, "motion", {
        ...motion,
        sourceIds: resolveSources(motion?.sourceExternalIds),
      });
      counts.motions += 1;
    }

    for (const budget of args.budgets ?? []) {
      await insertHistoryItem(ctx, args.societyId, "budget", {
        ...budget,
        sourceIds: resolveSources(budget?.sourceExternalIds),
      });
      counts.budgets += 1;
    }

    return counts;
  },
});

async function insertHistoryItem(ctx: any, societyId: string, kind: string, payload: any) {
  const item = normalizeItem(kind, payload);
  return await ctx.db.insert("documents", {
    societyId,
    title: item.title,
    category: ITEM_CATEGORY,
    content: JSON.stringify({ kind, ...item.data }),
    createdAtISO: new Date().toISOString(),
    flaggedForDeletion: false,
    tags: itemTags(kind),
  });
}

function hydrateSource(doc: any) {
  const payload = parseContent(doc.content);
  return {
    ...payload,
    _id: doc._id,
    _creationTime: doc._creationTime,
    title: payload.title ?? doc.title,
    url: payload.url ?? doc.url,
  };
}

function hydrateItem(doc: any) {
  const payload = parseContent(doc.content);
  return {
    ...payload,
    _id: doc._id,
    _creationTime: doc._creationTime,
    sourceIds: Array.isArray(payload.sourceIds) ? payload.sourceIds : [],
    createdAtISO: doc.createdAtISO,
  };
}

function parseContent(content: unknown) {
  if (typeof content !== "string") return {};
  try {
    return JSON.parse(content);
  } catch {
    return {};
  }
}

function normalizeSource(source: any) {
  return {
    externalSystem: optionalText(source?.externalSystem),
    externalId: optionalText(source?.externalId),
    title: String(source?.title ?? "").trim(),
    sourceDate: optionalText(source?.sourceDate),
    category: String(source?.category ?? "Other"),
    confidence: source?.confidence === "High" || source?.confidence === "Medium" ? source.confidence : "Review",
    notes: optionalText(source?.notes),
    url: optionalText(source?.url),
  };
}

function normalizeItem(kind: string, payload: any) {
  const data = { ...(payload ?? {}) };
  delete data.sourceExternalIds;

  return {
    title: itemTitle(kind, data),
    data,
  };
}

function itemTitle(kind: string, payload: any) {
  if (kind === "fact") return String(payload?.label ?? "Profile fact").trim();
  if (kind === "event") return String(payload?.title ?? "History event").trim();
  if (kind === "boardTerm") return String(payload?.personName ?? "Board term").trim();
  if (kind === "motion") return String(payload?.meetingTitle ?? payload?.motionText ?? "Motion").trim();
  if (kind === "budget") return String(payload?.title ?? payload?.fiscalYear ?? "Budget").trim();
  return "History item";
}

function sourceTags(source: any) {
  return [HISTORY_TAG, SOURCE_TAG, tagValue(source.category), tagValue(source.externalSystem)].filter(Boolean);
}

function itemTags(kind: string) {
  return [HISTORY_TAG, ITEM_TAG, tagValue(kind)].filter(Boolean);
}

function tagValue(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, "-");
}

function optionalText(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? text : undefined;
}

function isItemKind(kind: string) {
  return ["fact", "event", "boardTerm", "motion", "budget"].includes(kind);
}

function isHistorySource(doc: any) {
  return Boolean(doc?.tags?.includes(HISTORY_TAG) && doc?.tags?.includes(SOURCE_TAG));
}

function isHistoryItem(doc: any) {
  return Boolean(doc?.tags?.includes(HISTORY_TAG) && doc?.tags?.includes(ITEM_TAG));
}
