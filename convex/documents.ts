import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

const VISIBLE_DOCUMENT_CATEGORIES = [
  "Constitution",
  "Bylaws",
  "Minutes",
  "FinancialStatement",
  "Policy",
  "Filing",
  "Agreement",
  "Other",
  "Insurance",
  "Grant",
  "Receipt",
  "CourtOrder",
  "WorkflowGenerated",
  "Library",
];

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const groups = await Promise.all(
      VISIBLE_DOCUMENT_CATEGORIES.map((category) =>
        ctx.db
          .query("documents")
          .withIndex("by_society_category", (q) => q.eq("societyId", societyId).eq("category", category))
          .collect(),
      ),
    );
    return groups.flat().sort((a, b) => String(b.createdAtISO ?? "").localeCompare(String(a.createdAtISO ?? "")));
  },
});

export const get = query({
  args: { id: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const getMany = query({
  args: { ids: v.array(v.id("documents")) },
  returns: v.any(),
  handler: async (ctx, { ids }) => {
    const rows = await Promise.all(ids.map((id) => ctx.db.get(id)));
    return rows.filter(Boolean);
  },
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    committeeId: v.optional(v.id("committees")),
    meetingId: v.optional(v.id("meetings")),
    agendaItemId: v.optional(v.id("agendaItems")),
    title: v.string(),
    category: v.string(),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    content: v.optional(v.string()),
    url: v.optional(v.string()),
    retentionYears: v.optional(v.number()),
    reviewStatus: v.optional(v.string()),
    librarySection: v.optional(v.string()),
    tags: v.array(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) =>
    ctx.db.insert("documents", {
      ...args,
      createdAtISO: new Date().toISOString(),
      flaggedForDeletion: false,
    }),
});

export const markOpened = mutation({
  args: {
    id: v.id("documents"),
    userId: v.optional(v.id("users")),
    actorName: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, { id, userId, actorName }) => {
    const document = await ctx.db.get(id);
    if (!document) throw new Error("Document not found.");
    const nowISO = new Date().toISOString();
    const patch: any = { lastOpenedAtISO: nowISO };
    if (userId) patch.lastOpenedByUserId = userId;
    await ctx.db.patch(id, patch);
    await ctx.db.insert("activity", {
      societyId: document.societyId,
      actor: actorName ?? "You",
      entityType: "document",
      entityId: id,
      action: "opened",
      summary: `Opened ${document.title}`,
      createdAtISO: nowISO,
    });
    return { openedAtISO: nowISO };
  },
});

export const updateReviewStatus = mutation({
  args: {
    id: v.id("documents"),
    reviewStatus: v.optional(v.string()),
    actorName: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, { id, reviewStatus, actorName }) => {
    const document = await ctx.db.get(id);
    if (!document) throw new Error("Document not found.");
    await ctx.db.patch(id, { reviewStatus });
    await ctx.db.insert("activity", {
      societyId: document.societyId,
      actor: actorName ?? "You",
      entityType: "document",
      entityId: id,
      action: "review-status",
      summary: `Marked ${document.title} ${reviewStatus ? reviewStatus.replace(/_/g, " ") : "not reviewed"}`,
      createdAtISO: new Date().toISOString(),
    });
  },
});

export const reviewQueues = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const [documents, tasks, comments, signatures, materials] = await Promise.all([
      ctx.db.query("documents").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("tasks").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("documentComments").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("signatures").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("meetingMaterials").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ]);

    const docs = documents.filter((doc) => !isInternalDocumentRecord(doc));
    const taskCounts = countByDocument(tasks.filter((task) => task.status !== "Done"));
    const openCommentCounts = countByDocument(comments.filter((comment) => comment.status !== "resolved"));
    const signatureCounts = new Map<string, number>();
    for (const signature of signatures) {
      if (signature.entityType !== "document") continue;
      signatureCounts.set(signature.entityId, (signatureCounts.get(signature.entityId) ?? 0) + 1);
    }
    const materialDocIds = new Set(materials.map((row) => String(row.documentId)));
    const annotate = (doc: any) => ({
      ...doc,
      openTaskCount: taskCounts.get(String(doc._id)) ?? 0,
      openCommentCount: openCommentCounts.get(String(doc._id)) ?? 0,
      signatureCount: signatureCounts.get(String(doc._id)) ?? 0,
      linkedToMeetingPackage: materialDocIds.has(String(doc._id)) || !!doc.meetingId,
    });

    const annotated = docs.map(annotate);
    const recent = annotated
      .filter((doc) => doc.lastOpenedAtISO || doc.createdAtISO)
      .sort((a, b) => String(b.lastOpenedAtISO ?? b.createdAtISO).localeCompare(String(a.lastOpenedAtISO ?? a.createdAtISO)))
      .slice(0, 8);
    const actionRequired = annotated
      .filter((doc) =>
        doc.reviewStatus === "needs_signature" ||
        doc.reviewStatus === "blocked" ||
        doc.openTaskCount > 0 ||
        doc.openCommentCount > 0 ||
        (doc.tags ?? []).includes("needs-signature") ||
        (doc.tags ?? []).includes("action-required"),
      )
      .sort((a, b) => Number(b.openTaskCount + b.openCommentCount) - Number(a.openTaskCount + a.openCommentCount))
      .slice(0, 8);
    const workInProgress = annotated
      .filter((doc) =>
        doc.reviewStatus === "in_review" ||
        doc.reviewStatus === "needs_signature" ||
        doc.linkedToMeetingPackage ||
        doc.openCommentCount > 0,
      )
      .sort((a, b) => String(b.createdAtISO).localeCompare(String(a.createdAtISO)))
      .slice(0, 8);

    return {
      recent,
      actionRequired,
      workInProgress,
      counts: {
        documents: annotated.length,
        recent: recent.length,
        actionRequired: actionRequired.length,
        workInProgress: workInProgress.length,
      },
    };
  },
});

export const createPipaPolicyDraft = mutation({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const society = await ctx.db.get(societyId);
    if (!society) throw new Error("Society not found.");

    const existing = await findExistingPrivacyDraft(ctx, societyId, "privacy-policy");
    if (existing) {
      const refreshed = await refreshGenericPipaPolicyDraft(ctx, existing, society);
      return { document: refreshed ?? existing, reused: true, refreshed: !!refreshed };
    }

    const nowISO = new Date().toISOString();
    const documentId = await ctx.db.insert("documents", {
      societyId,
      title: `Draft PIPA privacy policy - ${society.name}`,
      category: "Policy",
      fileName: "pipa-privacy-policy-draft.md",
      mimeType: "text/markdown",
      content: buildPipaPolicyDraft(society),
      retentionYears: 10,
      createdAtISO: nowISO,
      flaggedForDeletion: false,
      tags: ["privacy", "privacy-policy", "pipa", "draft", "societyer-template"],
    });

    await ctx.db.insert("activity", {
      societyId,
      actor: "Societyer",
      entityType: "document",
      entityId: documentId,
      action: "document-created",
      summary: "Created a draft PIPA privacy policy from the Societyer starter template.",
      createdAtISO: nowISO,
    });

    const document = await ctx.db.get(documentId);
    return { document, reused: false };
  },
});

export const rebuildPipaPolicyDraftFromSociety = mutation({
  args: { id: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    const document = await ctx.db.get(id);
    if (!document) throw new Error("Document not found.");
    const society = await ctx.db.get(document.societyId);
    if (!society) throw new Error("Society not found.");

    const title = `Draft PIPA privacy policy - ${society.name}`;
    await ctx.db.patch(id, {
      title,
      content: buildPipaPolicyDraft(society),
      tags: withTags(document.tags, [
        "privacy",
        "privacy-policy",
        "pipa",
        "draft",
        "societyer-template",
        "society-filled",
      ]),
    });
    await ctx.db.insert("activity", {
      societyId: document.societyId,
      actor: "Societyer",
      entityType: "document",
      entityId: id,
      action: "document-updated",
      summary: `Rebuilt ${title} from the current society details.`,
      createdAtISO: new Date().toISOString(),
    });
    return await ctx.db.get(id);
  },
});

export const createMemberDataGapMemoDraft = mutation({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const society = await ctx.db.get(societyId);
    if (!society) throw new Error("Society not found.");

    const existing = await findExistingPrivacyDraft(ctx, societyId, "member-data-gap");
    if (existing) return { document: existing, reused: true };

    const nowISO = new Date().toISOString();
    const documentId = await ctx.db.insert("documents", {
      societyId,
      title: `Draft member-data access gap memo - ${society.name}`,
      category: "Policy",
      fileName: "member-data-access-gap-memo-draft.md",
      mimeType: "text/markdown",
      content: buildMemberDataGapMemoDraft(society),
      retentionYears: 10,
      createdAtISO: nowISO,
      flaggedForDeletion: false,
      tags: ["privacy", "member-data-gap", "pipa", "draft", "societyer-template"],
    });

    await ctx.db.insert("activity", {
      societyId,
      actor: "Societyer",
      entityType: "document",
      entityId: documentId,
      action: "document-created",
      summary: "Created a draft member-data access gap memo from the Societyer starter template.",
      createdAtISO: nowISO,
    });

    const document = await ctx.db.get(documentId);
    return { document, reused: false };
  },
});

export const updateDraftContent = mutation({
  args: {
    id: v.id("documents"),
    title: v.string(),
    content: v.string(),
    tags: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.id);
    if (!document) throw new Error("Document not found.");
    const tags = args.tags ? Array.from(new Set(args.tags)) : document.tags;
    await ctx.db.patch(args.id, {
      title: args.title.trim() || document.title,
      content: args.content,
      tags,
    });
    await ctx.db.insert("activity", {
      societyId: document.societyId,
      actor: "Societyer",
      entityType: "document",
      entityId: args.id,
      action: "document-updated",
      summary: `Updated ${args.title.trim() || document.title}.`,
      createdAtISO: new Date().toISOString(),
    });
    return await ctx.db.get(args.id);
  },
});

export const linkPrivacyPolicyEvidence = mutation({
  args: {
    societyId: v.id("societies"),
    documentId: v.id("documents"),
  },
  returns: v.any(),
  handler: async (ctx, { societyId, documentId }) => {
    const [society, document] = await Promise.all([
      ctx.db.get(societyId),
      ctx.db.get(documentId),
    ]);
    if (!society) throw new Error("Society not found.");
    if (!document || document.societyId !== societyId) {
      throw new Error("Document not found for this society.");
    }
    await ctx.db.patch(societyId, {
      privacyPolicyDocId: documentId,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("activity", {
      societyId,
      actor: "Societyer",
      entityType: "society",
      entityId: societyId,
      action: "privacy-policy-linked",
      summary: `Linked ${document.title} as PIPA policy evidence.`,
      createdAtISO: new Date().toISOString(),
    });
    return { documentId };
  },
});

export const createGovernanceDocumentFromLocalFile = mutation({
  args: {
    societyId: v.id("societies"),
    documentKind: v.union(
      v.literal("constitution"),
      v.literal("bylaws"),
      v.literal("constitutionAndBylaws"),
      v.literal("privacyPolicy"),
    ),
    title: v.string(),
    category: v.optional(v.string()),
    fileName: v.string(),
    mimeType: v.optional(v.string()),
    fileSizeBytes: v.optional(v.number()),
    storageKey: v.string(),
    sha256: v.optional(v.string()),
    tags: v.array(v.string()),
    sourceUrl: v.optional(v.string()),
    changeNote: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
    replaceExisting: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const society = await ctx.db.get(args.societyId);
    if (!society) throw new Error("Society not found.");

    const nowISO = new Date().toISOString();
    const uploader = args.actingUserId ? await ctx.db.get(args.actingUserId) : null;
    const category =
      args.category ??
      (args.documentKind === "privacyPolicy"
        ? "Policy"
        : args.documentKind === "constitution"
          ? "Constitution"
          : "Bylaws");
    const tags = Array.from(new Set(args.tags));

    const documentId = await ctx.db.insert("documents", {
      societyId: args.societyId,
      title: args.title,
      category,
      fileName: args.fileName,
      mimeType: args.mimeType,
      fileSizeBytes: args.fileSizeBytes,
      url: args.sourceUrl,
      createdAtISO: nowISO,
      flaggedForDeletion: false,
      tags,
    });

    const versionId = await ctx.db.insert("documentVersions", {
      societyId: args.societyId,
      documentId,
      version: 1,
      storageProvider: "local",
      storageKey: args.storageKey,
      fileName: args.fileName,
      mimeType: args.mimeType,
      fileSizeBytes: args.fileSizeBytes,
      sha256: args.sha256,
      uploadedByUserId: args.actingUserId,
      uploadedByName: uploader?.displayName ?? "BC Registry connector",
      uploadedAtISO: nowISO,
      changeNote: args.changeNote ?? "Imported from BC Registry filing history.",
      isCurrent: true,
    });

    const patch: any = { updatedAt: Date.now() };
    if (
      (args.documentKind === "constitution" || args.documentKind === "constitutionAndBylaws") &&
      (args.replaceExisting || !society.constitutionDocId)
    ) {
      patch.constitutionDocId = documentId;
    }
    if (
      (args.documentKind === "bylaws" || args.documentKind === "constitutionAndBylaws") &&
      (args.replaceExisting || !society.bylawsDocId)
    ) {
      patch.bylawsDocId = documentId;
    }
    if (
      args.documentKind === "privacyPolicy" &&
      (args.replaceExisting || !society.privacyPolicyDocId)
    ) {
      patch.privacyPolicyDocId = documentId;
    }
    if (Object.keys(patch).length > 1) {
      await ctx.db.patch(args.societyId, patch);
    }

    await ctx.db.insert("activity", {
      societyId: args.societyId,
      actor: uploader?.displayName ?? "BC Registry connector",
      entityType: "document",
      entityId: documentId,
      action: "document-imported",
      summary: `Imported ${args.title} from BC Registry.`,
      createdAtISO: nowISO,
    });

    return {
      documentId,
      versionId,
      linked: {
        constitution: patch.constitutionDocId === documentId,
        bylaws: patch.bylawsDocId === documentId,
        privacyPolicy: patch.privacyPolicyDocId === documentId,
      },
    };
  },
});

export const createLocalDocumentFromConnector = mutation({
  args: {
    societyId: v.id("societies"),
    title: v.string(),
    category: v.string(),
    fileName: v.string(),
    mimeType: v.optional(v.string()),
    fileSizeBytes: v.optional(v.number()),
    storageKey: v.string(),
    sha256: v.optional(v.string()),
    tags: v.array(v.string()),
    sourceUrl: v.optional(v.string()),
    sourceExternalIds: v.optional(v.array(v.string())),
    sourcePayloadJson: v.optional(v.string()),
    changeNote: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
    skipDuplicateCheck: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const sourceIds = args.sourceExternalIds ?? [];
    if (!args.skipDuplicateCheck) {
      const existing = await ctx.db
        .query("documents")
        .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
        .collect();
      const duplicate = existing.find((document) => {
        if (document.fileName && document.fileName === args.fileName) return true;
        const existingSourceIds = document.sourceExternalIds ?? [];
        return sourceIds.some((sourceId) => existingSourceIds.includes(sourceId));
      });
      if (duplicate) {
        return { documentId: duplicate._id, versionId: null, reused: true };
      }
    }

    const nowISO = new Date().toISOString();
    const uploader = args.actingUserId ? await ctx.db.get(args.actingUserId) : null;
    const tags = Array.from(new Set(args.tags));
    const documentId = await ctx.db.insert("documents", {
      societyId: args.societyId,
      title: args.title,
      category: args.category,
      fileName: args.fileName,
      mimeType: args.mimeType,
      fileSizeBytes: args.fileSizeBytes,
      url: args.sourceUrl,
      sourceExternalIds: sourceIds.length ? sourceIds : undefined,
      sourcePayloadJson: args.sourcePayloadJson,
      createdAtISO: nowISO,
      flaggedForDeletion: false,
      tags,
    });

    const versionId = await ctx.db.insert("documentVersions", {
      societyId: args.societyId,
      documentId,
      version: 1,
      storageProvider: "local",
      storageKey: args.storageKey,
      fileName: args.fileName,
      mimeType: args.mimeType,
      fileSizeBytes: args.fileSizeBytes,
      sha256: args.sha256,
      uploadedByUserId: args.actingUserId,
      uploadedByName: uploader?.displayName ?? "Browser connector",
      uploadedAtISO: nowISO,
      changeNote: args.changeNote ?? "Imported from browser connector export.",
      isCurrent: true,
    });

    await ctx.db.insert("activity", {
      societyId: args.societyId,
      actor: uploader?.displayName ?? "Browser connector",
      entityType: "document",
      entityId: documentId,
      action: "document-imported",
      summary: `Imported ${args.title} from browser connector export.`,
      createdAtISO: nowISO,
    });

    return { documentId, versionId, reused: false };
  },
});

export const mergeConnectorDocumentMetadata = mutation({
  args: {
    documentId: v.id("documents"),
    title: v.optional(v.string()),
    category: v.optional(v.string()),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    fileSizeBytes: v.optional(v.number()),
    sha256: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    sourceUrl: v.optional(v.string()),
    sourceExternalIds: v.optional(v.array(v.string())),
    sourcePayloadJson: v.optional(v.string()),
    changeNote: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (!document) throw new Error("Document not found.");
    const existingTags = document.tags ?? [];
    const existingSourceIds = document.sourceExternalIds ?? [];
    await ctx.db.patch(args.documentId, {
      title: args.title ?? document.title,
      category: args.category ?? document.category,
      fileName: args.fileName ?? document.fileName,
      mimeType: args.mimeType ?? document.mimeType,
      fileSizeBytes: args.fileSizeBytes ?? document.fileSizeBytes,
      url: args.sourceUrl ?? document.url,
      sourceExternalIds: args.sourceExternalIds?.length
        ? Array.from(new Set([...existingSourceIds, ...args.sourceExternalIds]))
        : document.sourceExternalIds,
      sourcePayloadJson: args.sourcePayloadJson ?? document.sourcePayloadJson,
      tags: args.tags?.length ? Array.from(new Set([...existingTags, ...args.tags])) : existingTags,
    });

    const versions = await ctx.db
      .query("documentVersions")
      .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
      .collect();
    const currentVersion = versions.find((version) => version.isCurrent) ?? versions[0];
    if (currentVersion) {
      await ctx.db.patch(currentVersion._id, {
        fileName: args.fileName ?? currentVersion.fileName,
        mimeType: args.mimeType ?? currentVersion.mimeType,
        fileSizeBytes: args.fileSizeBytes ?? currentVersion.fileSizeBytes,
        sha256: args.sha256 ?? currentVersion.sha256,
        changeNote: args.changeNote ?? currentVersion.changeNote,
      });
    }

    return { documentId: args.documentId, versionId: currentVersion?._id ?? null, reused: true };
  },
});

export const flagForDeletion = mutation({
  args: { id: v.id("documents"), flagged: v.boolean() },
  returns: v.any(),
  handler: async (ctx, { id, flagged }) => {
    await ctx.db.patch(id, { flaggedForDeletion: flagged });
  },
});

export const archive = mutation({
  args: { id: v.id("documents"), reason: v.string() },
  returns: v.any(),
  handler: async (ctx, { id, reason }) => {
    await ctx.db.patch(id, {
      archivedAtISO: new Date().toISOString(),
      archivedReason: reason,
      flaggedForDeletion: false,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

async function findExistingPrivacyDraft(ctx: any, societyId: string, tag: string) {
  const docs = await ctx.db
    .query("documents")
    .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
    .collect();
  return docs.find((doc: any) => {
    if (doc.archivedAtISO || doc.flaggedForDeletion) return false;
    const tags = Array.isArray(doc.tags) ? doc.tags : [];
    if (tags.includes(tag) && tags.includes("draft")) return true;
    const title = String(doc.title ?? "").toLowerCase();
    const normalizedTitle = title.replace(/[-_]+/g, " ");
    if (tag === "privacy-policy") return title.includes("draft") && title.includes("privacy policy");
    return normalizedTitle.includes("draft") && normalizedTitle.includes("member data") && normalizedTitle.includes("gap");
  }) ?? null;
}

async function refreshGenericPipaPolicyDraft(ctx: any, document: any, society: any) {
  if (!isGenericPipaPolicyTemplate(document)) return null;
  const title = `Draft PIPA privacy policy - ${society.name}`;
  await ctx.db.patch(document._id, {
    title,
    content: buildPipaPolicyDraft(society),
    tags: withTags(document.tags, [
      "privacy",
      "privacy-policy",
      "pipa",
      "draft",
      "societyer-template",
      "society-filled",
    ]),
  });
  await ctx.db.insert("activity", {
    societyId: document.societyId,
    actor: "Societyer",
    entityType: "document",
    entityId: document._id,
    action: "document-updated",
    summary: `Filled ${title} with current society details.`,
    createdAtISO: new Date().toISOString(),
  });
  return await ctx.db.get(document._id);
}

function isGenericPipaPolicyTemplate(document: any) {
  const title = String(document.title ?? "").toLowerCase();
  const content = String(document.content ?? "");
  const hasGenericName = content.includes("[Legal organization name]") || content.includes("[legal name]");
  if (!hasGenericName) return false;
  return (
    title.includes("draft pipa privacy policy template") ||
    content.includes("This template is not legal advice") ||
    content.includes("PIPA Privacy Policy Template")
  );
}

function withTags(existing: unknown, additions: string[]) {
  const tags = Array.isArray(existing) ? existing.map(String) : [];
  return Array.from(new Set([...tags, ...additions]));
}

function countByDocument(rows: Array<{ documentId?: unknown }>) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.documentId) continue;
    const key = String(row.documentId);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function isInternalDocumentRecord(doc: any) {
  const tags = Array.isArray(doc.tags) ? doc.tags : [];
  return (
    tags.includes("import-session") ||
    tags.includes("org-history") ||
    doc.category === "Import Session" ||
    doc.category === "Import Candidate" ||
    doc.category === "Org History Source" ||
    doc.category === "Org History Item"
  );
}

function buildPipaPolicyDraft(society: any) {
  const today = new Date().toISOString().slice(0, 10);
  const legalName = valueOrPlaceholder(society.name, "Legal organization name");
  const privacyOfficerName = valueOrPlaceholder(society.privacyOfficerName, "Privacy officer role or name");
  const privacyOfficerEmail = valueOrPlaceholder(society.privacyOfficerEmail, "privacy email");
  const mailingAddress = valueOrPlaceholder(society.mailingAddress, "mailing address");
  const generalContactEmail = valueOrPlaceholder(society.officialEmail ?? society.publicContactEmail, "general contact email");
  const memberDataStatus = valueOrPlaceholder(society.memberDataAccessStatus, "Society-controlled / Partially available / Institution-held / Not applicable");

  return `# ${legalName} Privacy Policy

Draft created: ${today}

Status: Draft - not adopted until approved by the authorized board, executive, or officer.

This draft is a Societyer starter template based on BC PIPA guidance. It is not legal advice and it is not an official BC OIPC template. Replace bracketed text and remove options that do not apply before adoption.

## 1. Organization

${legalName} collects, uses, discloses, stores, and disposes of personal information in accordance with British Columbia's Personal Information Protection Act (PIPA) and other applicable laws.

- Legal name: ${legalName}
- Incorporation number: ${valueOrPlaceholder(society.incorporationNumber, "incorporation number, if applicable")}
- Mailing address: ${mailingAddress}
- General contact: ${generalContactEmail}

## 2. Privacy Officer

The privacy officer is responsible for privacy questions, access and correction requests, privacy complaints, and maintaining this policy.

- Privacy officer: ${privacyOfficerName}
- Email: ${privacyOfficerEmail}
- Mailing address: ${mailingAddress}

## 3. Personal Information We Collect

We collect only the personal information that is reasonable for our purposes. Depending on the activity, this may include:

- name and contact information;
- membership or eligibility information;
- director, officer, staff, contractor, and volunteer records;
- event registration and attendance information;
- communication preferences and mailing-list records;
- payment, reimbursement, grant, funding, accounting, or payroll records;
- application, intake, complaint, dispute, access-request, and correction-request records;
- meeting, election, referendum, filing, insurance, governance, and legal-compliance records; and
- technical information generated when people use our websites, forms, email systems, document systems, or other tools.

We do not intentionally collect sensitive personal information unless it is needed for a specific purpose and the collection is reasonable in the circumstances.

## 4. Why We Collect Personal Information

We may collect personal information to:

- administer the organization and its governance;
- maintain required society records;
- manage memberships, eligibility, and voting where applicable;
- communicate with members, directors, staff, volunteers, applicants, funders, partners, and the public;
- run meetings, elections, referenda, events, programs, and services;
- process payments, reimbursements, grants, donations, invoices, payroll, accounting, and tax records;
- recruit, onboard, manage, and support staff, contractors, directors, and volunteers;
- respond to questions, complaints, access requests, and correction requests;
- protect the safety, security, and legal interests of the organization and individuals; and
- meet legal, regulatory, audit, funding, insurance, and reporting obligations.

## 5. Consent and Notice

When we collect personal information directly from an individual, we explain the purpose for collection at or before collection unless the purpose is obvious and the individual voluntarily provides the information for that purpose.

We collect, use, and disclose personal information with consent unless PIPA or another law authorizes collection, use, or disclosure without consent. Consent may be express, implied, deemed, or opt-out depending on the information, the context, and legal requirements.

An individual may withdraw consent by contacting the privacy officer, subject to legal, contractual, funding, governance, audit, or operational limits.

## 6. Use and Disclosure

We use personal information only for the purposes for which it was collected, for purposes reasonably related to those purposes, or for other purposes authorized by law.

Access is limited to people who need the information for their role, such as authorized directors, officers, staff, contractors, volunteers, committee members, or service providers.

We may disclose personal information when the individual consents, when disclosure is needed for an authorized purpose, when a service provider acts for us, when disclosure is required or authorized by law, or when disclosure is needed for safety, legal, audit, insurance, funding, accounting, or governance purposes.

We do not sell personal information.

## 7. Service Providers

We may use service providers for email, cloud storage, accounting, forms, payments, websites, communications, voting, records management, security, document storage, and other operations.

When service providers handle personal information for us, we take reasonable steps to ensure they protect the information and use it only for authorized purposes.

## 8. Member Records and Institution-Held Data

Current member-data access status in Societyer: ${memberDataStatus}.

Choose and adapt one option before adoption.

Option A - society-controlled member records:

The organization maintains its own member register and related member records. Access to member records is restricted to authorized people and handled under applicable statutes, bylaws, and privacy rules.

Option B - institution-held or partially available member records:

Some member or eligibility information may be held by [university / parent institution / other body]. The organization is responsible for personal information it collects or controls. Institution-held records are not treated as organization-controlled unless the organization has access to them, a copy of them, a contractual right to obtain them, a shared system, or the practical or legal ability to direct their use or disclosure.

The organization maintains the member records it can lawfully maintain and keeps a separate member-data access gap memo where the institution does not provide a full member list.

## 9. Safeguards

We protect personal information using safeguards appropriate to the sensitivity and amount of information. These may include:

- role-limited access;
- password protection and multi-factor authentication where practical;
- restricted cloud folders and document permissions;
- locked physical storage for paper records;
- secure deletion or disposal;
- training for staff, directors, and volunteers;
- service-provider controls; and
- access review after role changes.

## 10. Retention and Disposal

We keep personal information only as long as needed for the purpose for which it was collected, or as long as needed for legal, governance, funding, audit, insurance, tax, accounting, dispute-resolution, or business purposes.

If personal information is used to make a decision that directly affects an individual, we retain that information for at least one year after the decision so the individual has a reasonable opportunity to request access.

When retention is no longer needed, we securely destroy records or remove the means by which the information can be associated with an identifiable individual.

## 11. Access and Correction Requests

Individuals may ask for access to their own personal information under the organization's control. They may also ask how their information has been used and disclosed, and may request correction if they believe it is inaccurate.

Requests should be sent to the privacy officer. We may ask for information needed to confirm identity and locate records. We respond within the timelines required by law unless an extension or exception applies.

## 12. Complaints

Privacy complaints should be sent to the privacy officer. The organization will review the complaint, gather relevant information, respond within a reasonable time, and take appropriate corrective steps where needed.

If a complaint is not resolved, the individual may contact the Office of the Information and Privacy Commissioner for British Columbia.

## 13. Electronic Communications

Where electronic messages are subject to Canada's Anti-Spam Legislation (CASL), we send them only with an applicable consent basis, include required sender identification, and provide unsubscribe handling where required.

## 14. Review

This policy will be reviewed at least annually and whenever the organization changes how it collects, uses, stores, or discloses personal information; adopts a new system or service provider; starts a new program; has a privacy complaint or breach; or receives new legal, regulatory, funder, or institutional requirements.

## 15. Adoption

Policy adopted by: [board / executive / authorized officer]

Adoption date: [YYYY-MM-DD]

Last review date: ${today}

Next review date: [YYYY-MM-DD]

`;
}

function buildMemberDataGapMemoDraft(society: any) {
  const today = new Date().toISOString().slice(0, 10);
  const legalName = valueOrPlaceholder(society.name, "Legal organization name");
  const currentStatus = valueOrPlaceholder(society.memberDataAccessStatus, "Institution-held / Partially available / Society-controlled / Unknown");
  return `# ${legalName} Member-Data Access Gap Memo

Draft created: ${today}

Status: Draft - complete this memo before marking the member-data access gap documented.

## 1. Purpose

This memo records whether ${legalName} controls its member list or whether a university, parent body, collection agent, or other institution holds some or all member or eligibility information.

Current Societyer member-data access status: ${currentStatus}.

## 2. Institution or External Holder

- Institution or external holder: [name]
- Contact person or office: [name / office]
- Contact email: [email]
- Relevant agreement, policy, funding rule, or correspondence: [reference]

## 3. What the Society Controls

List the personal information the society actually has, can access, or can direct.

- [example: director/officer contacts]
- [example: volunteer records]
- [example: newsletter consent records]
- [example: event registration records]
- [example: partial member eligibility list]

## 4. What the Institution Holds

List the personal information the institution or external holder keeps and does not share with the society.

- [example: full student membership or levy payer list]
- [example: student number or enrolment status]
- [example: fee assessment or collection records]

## 5. Access Limits

Describe what the society has requested, what was provided, what was refused or unavailable, and why.

- Request made on: [date]
- Response received on: [date]
- Summary of response: [summary]
- Evidence stored at: [document link / email / meeting minutes]

## 6. Privacy Handling

For information the society controls, describe safeguards, access limits, retention, disposal, and request handling.

For institution-held information, describe how individuals are redirected to the institution or how the society handles requests it cannot fulfill directly.

## 7. Societies Act Member-Register Handling

Record the society's working approach to member-register obligations and inspection requests.

- Does the society maintain its own member register? [yes/no/partial]
- If partial, what fields are kept? [fields]
- How will member inspection requests be handled? [process]
- Who reviews uncertain requests? [role]

## 8. Follow-Up Actions

- [ ] Confirm the external holder's current position in writing.
- [ ] Store correspondence or agreement evidence in Documents.
- [ ] Update Societyer member-data access status.
- [ ] Review this memo annually or when the institution's data-sharing process changes.

Prepared by: [name / role]

Reviewed by: [board / executive / privacy officer]

Review date: ${today}
`;
}

function valueOrPlaceholder(value: unknown, placeholder: string) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || `[${placeholder}]`;
}
