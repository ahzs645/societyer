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
    const [sourceDocs, itemDocs, minutesRows, meetingRows] = await Promise.all([
      docsByCategory(ctx, societyId, SOURCE_CATEGORY),
      docsByCategory(ctx, societyId, ITEM_CATEGORY),
      ctx.db
        .query("minutes")
        .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
        .collect(),
      ctx.db
        .query("meetings")
        .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
        .collect(),
    ]);
    const docs = [...sourceDocs, ...itemDocs];

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
      motions: mergeMotionRecords(motions, minutesRows, meetingRows, sources),
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

    const docs = await docsByCategory(ctx, source.societyId, ITEM_CATEGORY);

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

export const bulkSetItemReviewStatus = mutation({
  args: {
    updates: v.array(
      v.object({
        id: v.id("documents"),
        kind: v.string(),
        status: v.string(),
        confidence: v.optional(v.string()),
        notes: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { updates }) => {
    const results: any[] = [];

    for (const update of updates) {
      if (!isItemKind(update.kind)) {
        results.push({ id: String(update.id), updated: false, reason: "invalid-kind" });
        continue;
      }

      const existing = await ctx.db.get(update.id);
      if (!isHistoryItem(existing)) {
        results.push({ id: String(update.id), updated: false, reason: "not-history-item" });
        continue;
      }

      const current = hydrateItem(existing);
      if (current.kind !== update.kind) {
        results.push({ id: String(update.id), updated: false, reason: "kind-mismatch" });
        continue;
      }

      const next = stripRuntimeFields({
        ...current,
        kind: update.kind,
        status: update.status,
        confidence: update.confidence ?? current.confidence,
        notes: update.notes ? appendUniqueNote(current.notes, update.notes) : current.notes,
      });

      await ctx.db.patch(update.id, {
        title: itemTitle(update.kind, next),
        content: JSON.stringify(next),
        tags: itemTags(update.kind),
      });

      results.push({
        id: String(update.id),
        updated: true,
        previousStatus: optionalText(current.status),
        status: update.status,
      });
    }

    return results;
  },
});

export const extractBudgetSourceDetails = mutation({
  args: {
    societyId: v.id("societies"),
    budgetId: v.id("documents"),
  },
  handler: async (ctx, { societyId, budgetId }) => {
    const budgetDoc = await ctx.db.get(budgetId);
    if (!isHistoryItem(budgetDoc) || budgetDoc.societyId !== societyId) return null;

    const budget = hydrateItem(budgetDoc);
    if (budget.kind !== "budget") return null;

    const sourceIds = Array.isArray(budget.sourceIds) ? budget.sourceIds : [];
    const sourceDocs = (await Promise.all(sourceIds.map((id: any) => ctx.db.get(id)))).filter(isHistorySource);
    const sources = sourceDocs.map((doc: any) => hydrateSource(doc, true));
    const extracted = sources.map(extractBudgetDetailsFromSource);
    const budgetLines = uniqueBy(
      extracted.flatMap((item) => item.budgetLines),
      (line) => [line.section, line.category, line.label, line.amountCents].join("|").toLowerCase(),
    );
    const registerTransactions = uniqueBy(
      extracted.flatMap((item) => item.registerTransactions),
      (row) => [row.transactionDate, row.description, row.amountCents, row.balanceCents].join("|").toLowerCase(),
    );
    const sourceObservations = uniqueBy(
      extracted.flatMap((item) => item.sourceObservations),
      (row) => [row.label, row.amountCents, row.notes].join("|").toLowerCase(),
    );

    const totalExpenseCents = categoryTotal(budgetLines, "expense-total");
    const externalIds = unique(sources.map((source) => source.externalId).filter(Boolean));
    const now = new Date().toISOString();
    const sourceSummary = {
      extractedAtISO: now,
      sourceCount: sources.length,
      sourceDocumentIds: sourceDocs.map((doc: any) => doc._id),
      sourceExternalIds: externalIds,
      pageCount: sources.reduce((sum, source) => sum + Number(source.paperlessMetadata?.page_count ?? 0), 0) || undefined,
      budgetLineCount: budgetLines.length,
      registerTransactionCount: registerTransactions.length,
      openingBalanceCents: registerTransactions[0]?.openingBalanceCents,
      closingBalanceCents: lastDefined(registerTransactions.map((row) => row.balanceCents)),
      preparedBy: firstDefined(extracted.map((item) => item.preparedBy)),
      lastModified: firstDefined(extracted.map((item) => item.lastModified)),
      notes: "Extracted from linked source OCR. Register transactions are restricted review candidates until reconciled.",
    };

    const nextBudget = stripRuntimeFields({
      ...budget,
      lines: budgetLines.length ? budgetLines : budget.lines,
      totalExpenseCents: totalExpenseCents ?? budget.totalExpenseCents,
      registerTransactions,
      sourceObservations,
      sourceSummary,
      notes: appendUniqueNote(budget.notes, "Detailed budget lines and register rows extracted from linked source OCR."),
    });

    await ctx.db.patch(budgetId, {
      title: nextBudget.title,
      content: JSON.stringify({ kind: "budget", ...nextBudget }),
    });

    const snapshotId = await ensureBudgetSnapshot(ctx, {
      societyId,
      budget,
      budgetLines,
      sourceDocs,
      externalIds,
      totalExpenseCents: totalExpenseCents ?? budget.totalExpenseCents,
      sourceSummary,
      now,
    });

    const insertedTransactions = await ensureTransactionCandidates(ctx, {
      societyId,
      rows: registerTransactions,
      sourceDocs,
      externalIds,
      now,
    });

    const sourceEvidenceId = await ensureSourceEvidence(ctx, {
      societyId,
      sourceDoc: sourceDocs[0],
      externalId: externalIds[0],
      sourceTitle: sources[0]?.title ?? budget.title ?? "Budget source",
      sourceDate: sources[0]?.sourceDate ?? budget.sourceDate,
      targetId: String(budgetId),
      summary: `Extracted ${budgetLines.length} budget lines and ${registerTransactions.length} register rows from ${sources[0]?.title ?? "linked source"}.`,
      now,
    });

    return {
      budgetId,
      budgetLineCount: budgetLines.length,
      registerTransactionCount: registerTransactions.length,
      insertedTransactions,
      snapshotId,
      sourceEvidenceId,
    };
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
    const docs = await docsByCategory(ctx, args.societyId, SOURCE_CATEGORY);
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

async function docsByCategory(ctx: any, societyId: string, category: string) {
  return await ctx.db
    .query("documents")
    .withIndex("by_society_category", (q: any) => q.eq("societyId", societyId).eq("category", category))
    .collect();
}

function hydrateSource(doc: any, includeRestrictedContent = false) {
  const payload = parseContent(doc.content);
  const safePayload = { ...payload };
  if (!includeRestrictedContent && safePayload.paperlessMetadata) {
    safePayload.paperlessMetadata = { ...safePayload.paperlessMetadata };
    delete safePayload.paperlessMetadata.content;
  }
  return {
    ...safePayload,
    _id: doc._id,
    _creationTime: doc._creationTime,
    title: safePayload.title ?? doc.title,
    url: safePayload.url ?? safePayload.paperlessDocumentUrl ?? doc.url,
    storageId: doc.storageId,
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    fileSizeBytes: doc.fileSizeBytes,
    tags: doc.tags ?? [],
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
  if (kind === "motion") return String(payload?.motionText ?? payload?.meetingTitle ?? "Motion").trim();
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

function numberOrUndefined(value: unknown) {
  if (value === "" || value === undefined || value === null) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function mergeMotionRecords(historyMotions: any[], minutesRows: any[], meetingRows: any[], sources: any[]) {
  const sourceById = new Map(sources.map((source) => [source._id, source]));
  const sourceIdByExternalId = new Map(
    sources
      .map((source) => [String(source.externalId ?? ""), source._id])
      .filter(([externalId]) => externalId),
  );
  const meetingById = new Map(meetingRows.map((meeting) => [meeting._id, meeting]));
  const rows = historyMotions.map((motion) => {
    const sourceIds = uniqueStrings(motion.sourceIds);
    const sourceExternalIds = uniqueStrings([
      ...arrayOfStrings(motion.sourceExternalIds),
      ...sourceIds
        .map((id) => sourceById.get(id)?.externalId)
        .filter(Boolean),
    ]);

    return {
      ...motion,
      sourceIds,
      sourceExternalIds,
      motionRecordSource: "orgHistory",
      matchedPaperlessMinutes: false,
    };
  });

  for (const minutesRow of minutesRows) {
    const meeting = meetingById.get(minutesRow.meetingId);
    const meetingDate = dateOnly(minutesRow.heldAt) || dateOnly(meeting?.scheduledAt);
    const meetingTitle = optionalText(meeting?.title) ?? "Imported meeting minutes";
    const sourceExternalIds = uniqueStrings(minutesRow.sourceExternalIds);
    const sourceIds = uniqueStrings([
      ...arrayOfStrings(minutesRow.sourceDocumentIds).filter((id) => sourceById.has(id)),
      ...sourceExternalIds.map((externalId) => sourceIdByExternalId.get(externalId)).filter(Boolean),
    ]);

    for (const [index, motion] of arrayOf(minutesRow.motions).entries()) {
      const motionText = optionalText(motion?.text);
      if (!motionText) continue;

      const candidate = {
        _id: `minutes:${minutesRow._id}:${index}`,
        kind: "motion",
        meetingDate,
        meetingTitle,
        motionText,
        outcome: optionalText(motion?.outcome) ?? "NeedsReview",
        movedByName: optionalText(motion?.movedBy),
        secondedByName: optionalText(motion?.secondedBy),
        votesFor: numberOrUndefined(motion?.votesFor),
        votesAgainst: numberOrUndefined(motion?.votesAgainst),
        abstentions: numberOrUndefined(motion?.abstentions),
        resolutionType: optionalText(motion?.resolutionType),
        category: "Governance",
        sourceIds,
        sourceExternalIds,
        motionRecordSource: "paperlessMinutes",
        matchedPaperlessMinutes: true,
        meetingId: minutesRow.meetingId,
        minutesId: minutesRow._id,
        minutesMotionIndex: index,
        motionSortIndex: index,
        createdAtISO: minutesRow._creationTime ? new Date(minutesRow._creationTime).toISOString() : undefined,
      };

      const duplicate = rows.find((row) => isSameMotionRecord(row, candidate));
      if (duplicate) {
        duplicate.sourceIds = uniqueStrings([...(duplicate.sourceIds ?? []), ...sourceIds]);
        duplicate.sourceExternalIds = uniqueStrings([...(duplicate.sourceExternalIds ?? []), ...sourceExternalIds]);
        duplicate.matchedPaperlessMinutes = true;
        duplicate.paperlessMinutesId = duplicate.paperlessMinutesId ?? minutesRow._id;
        duplicate.paperlessMeetingId = duplicate.paperlessMeetingId ?? minutesRow.meetingId;
        duplicate.motionSortIndex = duplicate.motionSortIndex ?? index;
        duplicate.meetingTitle = duplicate.meetingTitle ?? meetingTitle;
        duplicate.meetingDate = duplicate.meetingDate ?? meetingDate;
        duplicate.movedByName = duplicate.movedByName ?? candidate.movedByName;
        duplicate.secondedByName = duplicate.secondedByName ?? candidate.secondedByName;
        duplicate.votesFor = duplicate.votesFor ?? candidate.votesFor;
        duplicate.votesAgainst = duplicate.votesAgainst ?? candidate.votesAgainst;
        duplicate.abstentions = duplicate.abstentions ?? candidate.abstentions;
        duplicate.resolutionType = duplicate.resolutionType ?? candidate.resolutionType;
      } else {
        rows.push(candidate);
      }
    }
  }

  return rows.sort(compareMotionRecords);
}

function compareMotionRecords(a: any, b: any) {
  const date = String(a.meetingDate ?? "").localeCompare(String(b.meetingDate ?? ""));
  if (date !== 0) return date;
  const meeting = String(a.meetingTitle ?? "").localeCompare(String(b.meetingTitle ?? ""));
  if (meeting !== 0) return meeting;
  const sortIndex = motionSortIndex(a) - motionSortIndex(b);
  if (sortIndex !== 0) return sortIndex;
  const creation = Number(a._creationTime ?? 0) - Number(b._creationTime ?? 0);
  if (creation !== 0) return creation;
  return String(a.motionText ?? "").localeCompare(String(b.motionText ?? ""));
}

function motionSortIndex(motion: any) {
  const index = Number(motion.motionSortIndex ?? motion.minutesMotionIndex);
  return Number.isFinite(index) ? index : Number.MAX_SAFE_INTEGER;
}

function isSameMotionRecord(a: any, b: any) {
  const aText = comparableMotionText(a.motionText);
  const bText = comparableMotionText(b.motionText);
  if (!aText || !bText) return false;

  const sameDate = dateOnly(a.meetingDate) === dateOnly(b.meetingDate);
  const sharedSource = hasOverlap(a.sourceIds, b.sourceIds) || hasOverlap(a.sourceExternalIds, b.sourceExternalIds);
  if (!sameDate && !sharedSource) return false;

  if (aText === bText) return true;
  if (containsComparableMotion(aText, bText)) return true;
  if (sameDate && sharedSource && sameMotionIntent(aText, bText)) return true;

  const score = tokenOverlapScore(aText, bText);
  const lengthRatio = Math.max(aText.length, bText.length) / Math.max(1, Math.min(aText.length, bText.length));
  if (sameDate && sharedSource) return score >= 0.74 && lengthRatio >= 1.25;
  if (sharedSource) return score >= 0.68;
  return score >= 0.78;
}

function sameMotionIntent(a: string, b: string) {
  return [
    ["board", "directors", "approve", "positions"],
    ["editor", "chief", "salary", "summer"],
    ["editor", "chief", "honorarium", "$800"],
  ].some((tokens) => tokens.every((token) => a.includes(token) && b.includes(token)));
}

function comparableMotionText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\b(be it resolved that|resolved that|upon motion|it was moved|motion\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)|motion to|motion|birt|bifrt)\b[:\s-]*/gi, " ")
    .replace(/\b(this motion has been|this motion is|motion has been)\s+(passed|carried|approved|tabled|defeated)\b/gi, " ")
    .replace(/\b(vote|yes|no|abstain(?:ed|ing)?|for|against)\b[:\s-]*\d*/gi, " ")
    .replace(/[^a-z0-9$]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsComparableMotion(a: string, b: string) {
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  return shorter.length >= 36 && longer.includes(shorter);
}

function tokenOverlapScore(a: string, b: string) {
  const aTokens = new Set(a.split(" ").filter((token) => token.length > 2));
  const bTokens = new Set(b.split(" ").filter((token) => token.length > 2));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let shared = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) shared += 1;
  }
  return shared / Math.min(aTokens.size, bTokens.size);
}

function hasOverlap(a: unknown, b: unknown) {
  const left = new Set(arrayOfStrings(a));
  if (left.size === 0) return false;
  return arrayOfStrings(b).some((value) => left.has(value));
}

function arrayOf(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function uniqueStrings(value: unknown) {
  return Array.from(new Set(arrayOfStrings(value)));
}

function dateOnly(value: unknown) {
  return optionalText(value)?.slice(0, 10);
}

function extractBudgetDetailsFromSource(source: any) {
  const content = String(source?.paperlessMetadata?.content ?? source?.content ?? "");
  const lines = content
    .split(/\r?\n/)
    .map(normalizeOcrLine)
    .filter(Boolean);

  return {
    budgetLines: extractBudgetLines(lines, source),
    registerTransactions: extractRegisterTransactions(lines, source),
    sourceObservations: extractSourceObservations(lines),
    preparedBy: firstMatch(content, /Prepared by\s+([^\n]+)/i) ?? firstMatch(content, /Created by:\s*([^\n]+)/i),
    lastModified: firstMatch(content, /Last modified:\s*([^\n]+)/i) ?? firstMatch(content, /Last Updated:\s*([^\n]+)/i),
  };
}

function extractBudgetLines(lines: string[], source: any) {
  const out: any[] = [];
  let section = "";

  for (const line of lines) {
    if (/^Prepared by\b|^Created by:/i.test(line)) break;
    const sectionMatch = line.match(/^(?:>{1,2}|!|>>|[»])\s*(Printing|Tech Upgrades|Conferences)\b/i);
    if (sectionMatch) {
      section = canonicalBudgetSection(sectionMatch[1]);
      continue;
    }

    if (/^Seite\b|^Created by:|^Last Updated:|^Prepared by|^INCOMING BALANCE|^Budget:/i.test(line)) continue;
    if (/^(?:Fall|Winter|Spring|Summer)\s+(?:19|20)\d{2}$|^ITEM\b|^PROJECTED\b/i.test(line) || isDocumentHeaderLine(line)) continue;

    const directMatch = line.match(/^(?:>{1,2}|[»])?\s*(Bookkeeper|(?:[A-Z][A-Za-z&'.-]+(?:\s+[A-Z][A-Za-z&'.-]+){0,3}\s+)?Finance)\s+(.+)$/i);
    if (directMatch) {
      const amount = firstMoneyCents(directMatch[2]);
      if (amount != null) {
        const directLabel = directMatch[1].replace(/\s+/g, " ").trim();
        out.push({
          section: "expense",
          category: "Administration",
          lineType: "expense-direct",
          label: /^bookkeeper$/i.test(directLabel) ? "Bookkeeper" : directLabel,
          amountCents: amount,
          rawLabel: directMatch[1],
          rawAmountText: firstMoneyText(directMatch[2]),
          confidence: "High",
          notes: sourceNoteText(source, line),
        });
      }
      continue;
    }

    if (!section) continue;
    const amount = firstMoneyCents(line);
    if (amount == null) continue;

    const label = cleanBudgetLabel(line.replace(firstMoneyText(line) ?? "", ""));
    if (!label || /^March\b|^April\b/i.test(label) || label.startsWith("-")) continue;

    let lineType = "expense-detail";
    let displayLabel = label;
    if (/^tax\b/i.test(label)) lineType = "expense-tax";
    if (/^total$/i.test(label)) {
      lineType = "expense-subtotal";
      displayLabel = `${section} subtotal`;
    }
    if (/^total\s+/i.test(label) || /^!total\s+/i.test(label)) {
      lineType = "expense-total";
      displayLabel = label.replace(/^!/, "");
    }

    out.push({
      section: "expense",
      category: section,
      lineType,
      label: displayLabel,
      amountCents: amount,
      rawLabel: label,
      rawAmountText: firstMoneyText(line),
      confidence: "High",
      notes: sourceNoteText(source, line),
    });
  }

  return uniqueBy(out, (line) => [line.category, line.lineType, line.label, line.amountCents].join("|").toLowerCase());
}

function extractSourceObservations(lines: string[]) {
  const out: any[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^March\s+April$/i.test(lines[i])) continue;
    const nearby = lines.slice(i + 1, i + 8).map((line) => firstMoneyCents(line)).filter((value) => value != null);
    nearby.forEach((amountCents, index) => {
      out.push({
        label: `Unlabelled March/April source figure ${index + 1}`,
        amountCents,
        confidence: "Review",
        notes: "OCR places this amount on a March/April continuation page without a clear row label.",
      });
    });
  }
  return out;
}

function extractRegisterTransactions(lines: string[], source: any) {
  const out: any[] = [];
  let currentMonth = "";
  let inRegister = false;
  let refundMode = false;
  let openingBalanceCents: number | undefined;
  let runningBalanceCents: number | undefined;
  let rowOrder = 0;

  for (const line of lines) {
    const monthMatch = line.match(/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})$/i);
    if (monthMatch) {
      currentMonth = `${titleCase(monthMatch[1])} ${monthMatch[2]}`;
      inRegister = false;
      refundMode = false;
      continue;
    }

    const incoming = line.match(/INCOMING\s+BALANCE:\s*(.+)$/i);
    if (incoming && currentMonth) {
      openingBalanceCents = firstMoneyCents(incoming[1]);
      runningBalanceCents = openingBalanceCents;
      inRegister = true;
      refundMode = false;
      rowOrder = 0;
      continue;
    }

    if (!inRegister || !currentMonth) continue;
    if (/^(?:!|l|U)?Item\b|^Seite\b|^Created by:|^Last Updated:|^Balance\b|^Comments$/i.test(line) || isDocumentHeaderLine(line)) continue;
    if (/\bfee refunds?:\s*$/i.test(line)) {
      refundMode = true;
      continue;
    }
    if (/^Total refunds:/i.test(line)) continue;

    const row = parseRegisterRow(line, {
      currentMonth,
      source,
      openingBalanceCents,
      previousBalanceCents: runningBalanceCents,
      refundMode,
    });
    if (!row) continue;
    row.rowOrder = rowOrder + 1;
    rowOrder += 1;
    if (row.balanceCents != null) runningBalanceCents = row.balanceCents;
    out.push(row);
  }

  return uniqueBy(out, (row) => [row.transactionDate, row.description, row.amountCents, row.checkNumber].join("|").toLowerCase());
}

function parseRegisterRow(line: string, context: any) {
  const matches = moneyLikeMatches(line);
  if (matches.length === 0) return null;

  const first = matches[0];
  const label = cleanRegisterLabel(line.slice(0, first.index));
  if (!label || label.length < 2) return null;

  const amountCents = first.cents;
  const last = matches[matches.length - 1];
  const balanceCents = matches.length > 1 ? last.cents : undefined;
  const afterAmount = line.slice(first.index + first.raw.length, matches.length > 1 ? last.index : line.length);
  const checkNumber = cleanCheckNumber(afterAmount);
  const debitCredit = inferDebitCredit({
    description: label,
    amountCents,
    balanceCents,
    previousBalanceCents: context.previousBalanceCents,
    refundMode: context.refundMode,
  });

  return {
    transactionDate: monthStartDate(context.currentMonth),
    monthLabel: context.currentMonth,
    description: label,
    counterparty: label,
    amountCents,
    debitCredit,
    balanceCents,
    openingBalanceCents: context.openingBalanceCents,
    checkNumber,
    rawText: line,
    accountName: "Operating account",
    category: inferTransactionCategory(label, debitCredit),
    status: "NeedsReview",
    sensitivity: "restricted",
    confidence: balanceCents != null ? "Medium" : "Review",
    sourceExternalIds: [context.source?.externalId].filter(Boolean),
    notes: sourceNoteText(context.source, line),
  };
}

async function ensureBudgetSnapshot(ctx: any, args: any) {
  if (!args.budgetLines.length) return null;
  const fiscalYear = String(args.budget.fiscalYear ?? "").trim() || "2005-01";
  const existing = await ctx.db
    .query("budgetSnapshots")
    .withIndex("by_society_fy", (q: any) => q.eq("societyId", args.societyId).eq("fiscalYear", fiscalYear))
    .collect();
  const match = existing.find((row: any) => (row.sourceExternalIds ?? []).some((id: string) => args.externalIds.includes(id)));
  if (match) {
    await ctx.db.patch(match._id, {
      title: args.budget.title ?? match.title,
      periodLabel: args.budget.fiscalYear,
      sourceDate: optionalText(args.budget.sourceDate),
      totalIncomeCents: args.budget.totalIncomeCents,
      totalExpenseCents: args.totalExpenseCents,
      netCents: args.budget.netCents,
      endingBalanceCents: args.budget.endingBalanceCents,
      preparedByName: optionalText(args.sourceSummary?.preparedBy),
      lastModifiedDate: optionalText(args.sourceSummary?.lastModified),
      sourcePageCount: Number(args.sourceSummary?.pageCount) || undefined,
      importGroupKey: args.externalIds[0],
      notes: "Extracted from org-history budget source OCR. Review before treating as official.",
    });
    const existingLines = await ctx.db
      .query("budgetSnapshotLines")
      .withIndex("by_snapshot", (q: any) => q.eq("snapshotId", match._id))
      .collect();
    for (const line of existingLines) await ctx.db.delete(line._id);
    await insertBudgetSnapshotLines(ctx, args.societyId, match._id, args.budgetLines);
    return match._id;
  }

  const snapshotId = await ctx.db.insert("budgetSnapshots", {
    societyId: args.societyId,
    title: args.budget.title ?? "Imported budget snapshot",
    fiscalYear,
    periodLabel: args.budget.fiscalYear,
    sourceDate: optionalText(args.budget.sourceDate),
    currency: args.budget.currency ?? "CAD",
    totalIncomeCents: args.budget.totalIncomeCents,
    totalExpenseCents: args.totalExpenseCents,
    netCents: args.budget.netCents,
    endingBalanceCents: args.budget.endingBalanceCents,
    preparedByName: optionalText(args.sourceSummary?.preparedBy),
    lastModifiedDate: optionalText(args.sourceSummary?.lastModified),
    sourcePageCount: Number(args.sourceSummary?.pageCount) || undefined,
    importGroupKey: args.externalIds[0],
    status: "NeedsReview",
    confidence: "Review",
    sourceDocumentIds: args.sourceDocs.map((doc: any) => doc._id),
    sourceExternalIds: args.externalIds,
    notes: "Extracted from org-history budget source OCR. Review before treating as official.",
    createdAtISO: args.now,
  });

  await insertBudgetSnapshotLines(ctx, args.societyId, snapshotId, args.budgetLines);

  return snapshotId;
}

async function insertBudgetSnapshotLines(ctx: any, societyId: string, snapshotId: string, lines: any[]) {
  for (const [index, line] of lines.entries()) {
    await ctx.db.insert("budgetSnapshotLines", {
      societyId,
      snapshotId,
        lineType: line.lineType ?? line.section ?? "note",
        category: line.category ?? line.section ?? "Unclassified",
        parentCategory: line.category,
        rowKind: line.lineType,
        sortOrder: index + 1,
        description: line.label,
        amountCents: line.amountCents,
        projectedCents: line.lineType === "expense-detail" || line.lineType === "expense-direct" ? line.amountCents : undefined,
        sourcePage: line.sourcePage,
        rawLabel: line.rawLabel ?? line.label,
        rawAmountText: line.rawAmountText,
        confidence: line.confidence ?? "Review",
      notes: line.notes,
    });
  }
}

async function ensureTransactionCandidates(ctx: any, args: any) {
  if (!args.rows.length) return 0;
  const existing = await ctx.db
    .query("transactionCandidates")
    .withIndex("by_society", (q: any) => q.eq("societyId", args.societyId))
    .collect();
  const existingKeys = new Set(existing.map(transactionKey));
  let inserted = 0;

  for (const row of args.rows) {
    const key = transactionKey(row);
    if (existingKeys.has(key)) continue;
    await ctx.db.insert("transactionCandidates", {
      societyId: args.societyId,
      transactionDate: row.transactionDate,
      importGroupKey: args.externalIds[0],
      periodLabel: row.monthLabel,
      sourcePage: row.sourcePage,
      rowOrder: row.rowOrder,
      description: row.description,
      amountCents: row.amountCents,
      debitCents: row.debitCredit === "debit" ? row.amountCents : undefined,
      creditCents: row.debitCredit === "credit" ? row.amountCents : undefined,
      balanceCents: row.balanceCents,
      chequeNumber: row.checkNumber,
      comment: row.comment,
      rawText: row.rawText,
      accountName: row.accountName,
      counterparty: row.counterparty,
      category: row.category,
      debitCredit: row.debitCredit,
      status: "NeedsReview",
      sensitivity: "restricted",
      confidence: row.confidence ?? "Review",
      sourceDocumentIds: args.sourceDocs.map((doc: any) => doc._id),
      sourceExternalIds: args.externalIds,
      notes: [
        row.checkNumber ? `Cheque/reference: ${row.checkNumber}` : "",
        row.balanceCents != null ? `Running balance: ${formatCentsForNote(row.balanceCents)}` : "",
        row.notes,
      ].filter(Boolean).join(" · "),
      createdAtISO: args.now,
    });
    existingKeys.add(key);
    inserted += 1;
  }

  return inserted;
}

async function ensureSourceEvidence(ctx: any, args: any) {
  if (!args.sourceDoc?._id) return null;
  const existing = await ctx.db
    .query("sourceEvidence")
    .withIndex("by_source", (q: any) => q.eq("sourceDocumentId", args.sourceDoc._id))
    .collect();
  const match = existing.find(
    (row: any) => row.targetTable === "documents" && row.targetId === args.targetId && row.evidenceKind === "import_support",
  );
  if (match) return match._id;

  return await ctx.db.insert("sourceEvidence", {
    societyId: args.societyId,
    sourceDocumentId: args.sourceDoc._id,
    externalSystem: "paperless",
    externalId: args.externalId,
    sourceTitle: args.sourceTitle,
    sourceDate: optionalText(args.sourceDate),
    evidenceKind: "import_support",
    targetTable: "documents",
    targetId: args.targetId,
    sensitivity: "restricted",
    accessLevel: "restricted",
    summary: args.summary,
    status: "Linked",
    notes: "Detailed OCR source retained as restricted evidence; use the linked source PDF for verification.",
    createdAtISO: args.now,
  });
}

function transactionKey(row: any) {
  return [row.transactionDate, row.description, row.amountCents, row.debitCredit, (row.sourceExternalIds ?? []).join(",")]
    .join("|")
    .toLowerCase();
}

function inferDebitCredit(args: any) {
  if (args.balanceCents != null && args.previousBalanceCents != null) {
    if (Math.abs(args.previousBalanceCents - args.amountCents - args.balanceCents) <= 2) return "debit";
    if (Math.abs(args.previousBalanceCents + args.amountCents - args.balanceCents) <= 2) return "credit";
  }
  const description = String(args.description ?? "");
  if (args.refundMode || /reimbursement|refund|printing|finance|press|travel|conference/i.test(description)) {
    return "debit";
  }
  if (/student fees?|member fees?|levy|dues|grant|sponsor|donation|advertis(?:ing|ement)|ad sales|gst return|tax return/i.test(description)) {
    return "credit";
  }
  return "needs_review";
}

function inferTransactionCategory(description: string, debitCredit: string) {
  if (/printing|press/i.test(description)) return "Printing";
  if (/conference|travel/i.test(description)) return "Conference travel";
  if (/finance|admin|bookkeep/i.test(description)) return "Finance/admin";
  if (/refund/i.test(description) || debitCredit === "debit" && /\b[A-Z][a-z]+ [A-Z][a-z]+\b/.test(description)) return "Fee refunds";
  if (/advertis(?:ing|ement)|ad sales|sponsor|donation/i.test(description)) return "Advertising/revenue";
  if (/student fees?|member fees?|levy|dues/i.test(description)) return "Student fees";
  return debitCredit === "credit" ? "Revenue" : debitCredit === "debit" ? "Expense" : "Needs review";
}

function monthStartDate(label: string) {
  const match = label.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!match) return "";
  const month = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ].indexOf(match[1].toLowerCase()) + 1;
  return `${match[2]}-${String(month).padStart(2, "0")}-01`;
}

function sourceNoteText(source: any, line: string) {
  return [`Source ${source?.externalId ?? "unknown"}`, line].filter(Boolean).join(": ");
}

function categoryTotal(lines: any[], lineType: string) {
  const total = lines
    .filter((line) => line.lineType === lineType || line.lineType === "expense-direct")
    .reduce((sum, line) => sum + (Number(line.amountCents) || 0), 0);
  return total || undefined;
}

function firstDefined(values: any[]) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function lastDefined(values: any[]) {
  return [...values].reverse().find((value) => value !== undefined && value !== null && value !== "");
}

function firstMatch(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  return optionalText(match?.[1]);
}

function appendUniqueNote(existing: unknown, note: string) {
  const current = optionalText(existing);
  if (!current) return note;
  if (current.includes(note)) return current;
  return `${current}\n${note}`;
}

function stripRuntimeFields(value: any) {
  const copy = { ...(value ?? {}) };
  delete copy._id;
  delete copy._creationTime;
  delete copy.createdAtISO;
  return copy;
}

function unique(values: unknown[]) {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

function uniqueBy<T>(values: T[], key: (value: T) => string) {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const value of values) {
    const computed = key(value);
    if (seen.has(computed)) continue;
    seen.add(computed);
    out.push(value);
  }
  return out;
}

function normalizeOcrLine(line: string) {
  return line
    .replace(/[»]/g, ">>")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalBudgetSection(value: string) {
  if (/tech/i.test(value)) return "Tech upgrades";
  return titleCase(value);
}

function isDocumentHeaderLine(line: string) {
  if (firstMoneyCents(line) != null) return false;
  return /\b(?:Newspaper|Society|Association|Organization|Club|Union|Collective)\b/i.test(line) && line.length <= 120;
}

function titleCase(value: string) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function cleanBudgetLabel(label: string) {
  const text = label.replace(/[!>]+/g, "").replace(/\s+/g, " ").trim();
  return text
    .replace(/^Total Printin$/i, "Total Printing")
    .replace(/^Total Conferences\s+\d+$/i, "Total Conferences")
    .replace(/^Total Tech\s+\d+$/i, "Total Tech")
    .replace(/^Tax.*GST.*PST.*$/i, "Tax (GST + PST)")
    .replace(/^Tax.*GST.*PS.*$/i, "Tax (GST + PST)");
}

function cleanRegisterLabel(label: string) {
  return label.replace(/[!>]+/g, "").replace(/^Utem\b/i, "").replace(/^ll?tem\b/i, "").replace(/\s+/g, " ").trim();
}

function cleanCheckNumber(value: string) {
  const text = value.replace(/\$/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  const match = text.match(/\b(?:cash|mo|[0-9]{1,8}(?:-[0-9]{1,12})*)\b/i);
  return optionalText(match?.[0]);
}

function firstMoneyText(line: string) {
  return moneyLikeMatches(line)[0]?.raw;
}

function firstMoneyCents(line: string) {
  return moneyLikeMatches(line)[0]?.cents;
}

function moneyLikeMatches(line: string) {
  const matches: Array<{ raw: string; cents: number; index: number }> = [];
  const pattern = /\$?\s*([0-9][0-9,\s]*(?:[.,][0-9OoSsIl]{1,2}))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    const cents = parseMoneyCents(match[1]);
    if (cents == null) continue;
    matches.push({ raw: match[0], cents, index: match.index });
  }
  return matches;
}

function parseMoneyCents(value: string) {
  let normalized = String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/[Oo]/g, "0")
    .replace(/[Ss]/g, "5")
    .replace(/[Il]/g, "1");
  if (!normalized.includes(".") && /,\d{1,2}$/.test(normalized)) {
    normalized = normalized.replace(/,/g, (match, offset) => (offset === normalized.lastIndexOf(",") ? "." : ""));
  } else {
    normalized = normalized.replace(/,/g, "");
  }
  const number = Number(normalized);
  if (!Number.isFinite(number)) return undefined;
  return Math.round(number * 100);
}

function formatCentsForNote(value: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(value / 100);
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
