import { v } from "convex/values";
import { mutation, query } from "./lib/untypedServer";

const assetPatch = v.object({
  assetTag: v.optional(v.string()),
  preferredLabelType: v.optional(v.string()),
  name: v.optional(v.string()),
  category: v.optional(v.string()),
  serialNumber: v.optional(v.string()),
  supplier: v.optional(v.string()),
  purchaseDate: v.optional(v.string()),
  purchaseValueCents: v.optional(v.number()),
  currency: v.optional(v.string()),
  fundingSource: v.optional(v.string()),
  grantId: v.optional(v.id("grants")),
  grantRestrictions: v.optional(v.string()),
  retentionUntil: v.optional(v.string()),
  disposalRules: v.optional(v.string()),
  location: v.optional(v.string()),
  condition: v.optional(v.string()),
  status: v.optional(v.string()),
  custodianType: v.optional(v.string()),
  custodianId: v.optional(v.string()),
  custodianName: v.optional(v.string()),
  responsiblePersonName: v.optional(v.string()),
  expectedReturnDate: v.optional(v.string()),
  insurancePolicyId: v.optional(v.id("insurancePolicies")),
  insuranceNotes: v.optional(v.string()),
  capitalized: v.optional(v.boolean()),
  depreciationMethod: v.optional(v.string()),
  usefulLifeMonths: v.optional(v.number()),
  bookValueCents: v.optional(v.number()),
  purchaseTransactionId: v.optional(v.id("financialTransactions")),
  receiptDocumentId: v.optional(v.id("documents")),
  sourceDocumentIds: v.optional(v.array(v.id("documents"))),
  warrantyExpiresAt: v.optional(v.string()),
  nextMaintenanceDate: v.optional(v.string()),
  nextVerificationDate: v.optional(v.string()),
  disposedAt: v.optional(v.string()),
  disposalMethod: v.optional(v.string()),
  disposalReason: v.optional(v.string()),
  disposalValueCents: v.optional(v.number()),
  disposalApprovedMeetingId: v.optional(v.id("meetings")),
  disposalDocumentIds: v.optional(v.array(v.id("documents"))),
  notes: v.optional(v.string()),
});

const eventInput = v.object({
  eventType: v.string(),
  actorName: v.optional(v.string()),
  toCustodianType: v.optional(v.string()),
  toCustodianId: v.optional(v.string()),
  toCustodianName: v.optional(v.string()),
  responsiblePersonName: v.optional(v.string()),
  location: v.optional(v.string()),
  condition: v.optional(v.string()),
  expectedReturnDate: v.optional(v.string()),
  acceptanceSignature: v.optional(v.string()),
  documentIds: v.optional(v.array(v.id("documents"))),
  notes: v.optional(v.string()),
});

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("assets")
      .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
      .collect(),
});

export const get = query({
  args: { id: v.id("assets") },
  returns: v.any(),
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const bundle = query({
  args: { id: v.id("assets") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    const asset = await ctx.db.get(id);
    if (!asset) return null;
    const [events, maintenance] = await Promise.all([
      ctx.db
        .query("assetEvents")
        .withIndex("by_asset_happened", (q: any) => q.eq("assetId", id))
        .order("desc")
        .collect(),
      ctx.db
        .query("assetMaintenance")
        .withIndex("by_asset", (q: any) => q.eq("assetId", id))
        .collect(),
    ]);
    return { asset, events, maintenance };
  },
});

export const events = query({
  args: { assetId: v.id("assets") },
  returns: v.any(),
  handler: async (ctx, { assetId }) =>
    ctx.db
      .query("assetEvents")
      .withIndex("by_asset_happened", (q: any) => q.eq("assetId", assetId))
      .order("desc")
      .collect(),
});

export const maintenance = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("assetMaintenance")
      .withIndex("by_society_due", (q: any) => q.eq("societyId", societyId))
      .collect(),
});

export const verificationRuns = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("assetVerificationRuns")
      .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
      .collect(),
});

export const verificationItems = query({
  args: { runId: v.id("assetVerificationRuns") },
  returns: v.any(),
  handler: async (ctx, { runId }) =>
    ctx.db
      .query("assetVerificationItems")
      .withIndex("by_run", (q: any) => q.eq("runId", runId))
      .collect(),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    assetTag: v.string(),
    preferredLabelType: v.optional(v.string()),
    name: v.string(),
    category: v.string(),
    serialNumber: v.optional(v.string()),
    supplier: v.optional(v.string()),
    purchaseDate: v.optional(v.string()),
    purchaseValueCents: v.optional(v.number()),
    currency: v.optional(v.string()),
    fundingSource: v.optional(v.string()),
    grantId: v.optional(v.id("grants")),
    grantRestrictions: v.optional(v.string()),
    retentionUntil: v.optional(v.string()),
    disposalRules: v.optional(v.string()),
    location: v.optional(v.string()),
    condition: v.string(),
    status: v.string(),
    custodianType: v.optional(v.string()),
    custodianId: v.optional(v.string()),
    custodianName: v.optional(v.string()),
    responsiblePersonName: v.optional(v.string()),
    expectedReturnDate: v.optional(v.string()),
    insurancePolicyId: v.optional(v.id("insurancePolicies")),
    insuranceNotes: v.optional(v.string()),
    capitalized: v.boolean(),
    depreciationMethod: v.optional(v.string()),
    usefulLifeMonths: v.optional(v.number()),
    bookValueCents: v.optional(v.number()),
    purchaseTransactionId: v.optional(v.id("financialTransactions")),
    receiptDocumentId: v.optional(v.id("documents")),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    warrantyExpiresAt: v.optional(v.string()),
    nextMaintenanceDate: v.optional(v.string()),
    nextVerificationDate: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    const id = await ctx.db.insert("assets", {
      ...args,
      currency: args.currency ?? "CAD",
      sourceDocumentIds: args.sourceDocumentIds ?? [],
      disposalDocumentIds: [],
      createdAtISO: now,
      updatedAtISO: now,
    });
    await ctx.db.insert("assetEvents", {
      societyId: args.societyId,
      assetId: id,
      eventType: "intake",
      happenedAtISO: now,
      toCustodianType: args.custodianType,
      toCustodianId: args.custodianId,
      toCustodianName: args.custodianName,
      responsiblePersonName: args.responsiblePersonName,
      location: args.location,
      condition: args.condition,
      documentIds: args.sourceDocumentIds ?? [],
      notes: args.notes,
      createdAtISO: now,
    });
    await ctx.db.insert("activity", {
      societyId: args.societyId,
      actor: "You",
      entityType: "asset",
      entityId: id,
      action: "created",
      summary: `Created asset ${args.assetTag} — ${args.name}`,
      createdAtISO: now,
    });
    return id;
  },
});

export const update = mutation({
  args: { id: v.id("assets"), patch: assetPatch },
  returns: v.any(),
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, { ...patch, updatedAtISO: new Date().toISOString() });
    return id;
  },
});

export const recordEvent = mutation({
  args: { assetId: v.id("assets"), event: eventInput },
  returns: v.any(),
  handler: async (ctx, { assetId, event }) => {
    const asset = await ctx.db.get(assetId);
    if (!asset) return null;
    const now = new Date().toISOString();
    const eventId = await ctx.db.insert("assetEvents", {
      societyId: asset.societyId,
      assetId,
      eventType: event.eventType,
      happenedAtISO: now,
      actorName: event.actorName,
      fromCustodianName: asset.custodianName,
      toCustodianType: event.toCustodianType,
      toCustodianId: event.toCustodianId,
      toCustodianName: event.toCustodianName,
      responsiblePersonName: event.responsiblePersonName,
      location: event.location,
      condition: event.condition,
      expectedReturnDate: event.expectedReturnDate,
      acceptanceSignature: event.acceptanceSignature,
      documentIds: event.documentIds ?? [],
      notes: event.notes,
      createdAtISO: now,
    });

    const patch: any = { updatedAtISO: now };
    if (event.eventType === "checkout" || event.eventType === "transfer") {
      patch.status = "Checked out";
      patch.custodianType = event.toCustodianType;
      patch.custodianId = event.toCustodianId;
      patch.custodianName = event.toCustodianName;
      patch.responsiblePersonName = event.responsiblePersonName || event.toCustodianName;
      patch.expectedReturnDate = event.expectedReturnDate;
    }
    if (event.eventType === "checkin") {
      patch.status = "Available";
      patch.custodianType = "location";
      patch.custodianId = undefined;
      patch.custodianName = event.location;
      patch.responsiblePersonName = event.responsiblePersonName;
      patch.expectedReturnDate = undefined;
    }
    if (event.location !== undefined) patch.location = event.location;
    if (event.condition !== undefined) patch.condition = event.condition;
    await ctx.db.patch(assetId, patch);
    await ctx.db.insert("activity", {
      societyId: asset.societyId,
      actor: "You",
      entityType: "asset",
      entityId: assetId,
      action: event.eventType,
      summary: `${event.eventType} for asset ${asset.assetTag}`,
      createdAtISO: now,
    });
    return eventId;
  },
});

export const scheduleMaintenance = mutation({
  args: {
    assetId: v.id("assets"),
    title: v.string(),
    kind: v.string(),
    dueDate: v.string(),
    notes: v.optional(v.string()),
    createTask: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset) return null;
    const now = new Date().toISOString();
    let taskId;
    if (args.createTask) {
      taskId = await ctx.db.insert("tasks", {
        societyId: asset.societyId,
        title: `${args.title}: ${asset.assetTag}`,
        description: args.notes,
        status: "Todo",
        priority: "Medium",
        assignee: asset.responsiblePersonName,
        dueDate: args.dueDate,
        tags: ["asset", args.kind],
        createdAtISO: now,
      });
    }
    const id = await ctx.db.insert("assetMaintenance", {
      societyId: asset.societyId,
      assetId: args.assetId,
      title: args.title,
      kind: args.kind,
      dueDate: args.dueDate,
      status: "Scheduled",
      taskId,
      notes: args.notes,
      createdAtISO: now,
      updatedAtISO: now,
    });
    await ctx.db.patch(args.assetId, {
      nextMaintenanceDate: args.dueDate,
      updatedAtISO: now,
    });
    return id;
  },
});

export const completeMaintenance = mutation({
  args: {
    id: v.id("assetMaintenance"),
    completedAtISO: v.optional(v.string()),
    condition: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return null;
    const now = new Date().toISOString();
    await ctx.db.patch(args.id, {
      status: "Completed",
      completedAtISO: args.completedAtISO ?? now,
      notes: args.notes ?? row.notes,
      updatedAtISO: now,
    });
    await ctx.db.insert("assetEvents", {
      societyId: row.societyId,
      assetId: row.assetId,
      eventType: "maintenance",
      happenedAtISO: args.completedAtISO ?? now,
      condition: args.condition,
      documentIds: [],
      notes: args.notes ?? row.notes,
      createdAtISO: now,
    });
    if (row.taskId) await ctx.db.patch(row.taskId, { status: "Done", completedAt: now });
    if (args.condition) {
      await ctx.db.patch(row.assetId, { condition: args.condition, updatedAtISO: now });
    }
    return args.id;
  },
});

export const startVerificationRun = mutation({
  args: {
    societyId: v.id("societies"),
    title: v.string(),
    reviewerName: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    const assets = await ctx.db
      .query("assets")
      .withIndex("by_society", (q: any) => q.eq("societyId", args.societyId))
      .collect();
    const runId = await ctx.db.insert("assetVerificationRuns", {
      societyId: args.societyId,
      title: args.title,
      status: "Open",
      startedAtISO: now,
      reviewerName: args.reviewerName,
      notes: args.notes,
      createdAtISO: now,
      updatedAtISO: now,
    });
    await Promise.all(
      assets.map((asset: any) =>
        ctx.db.insert("assetVerificationItems", {
          societyId: args.societyId,
          runId,
          assetId: asset._id,
          status: "pending",
          createdAtISO: now,
          updatedAtISO: now,
        }),
      ),
    );
    return runId;
  },
});

export const verifyAsset = mutation({
  args: {
    itemId: v.id("assetVerificationItems"),
    status: v.string(),
    verifiedByName: v.optional(v.string()),
    observedLocation: v.optional(v.string()),
    observedCondition: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) return null;
    const now = new Date().toISOString();
    await ctx.db.patch(args.itemId, {
      status: args.status,
      verifiedAtISO: now,
      verifiedByName: args.verifiedByName,
      observedLocation: args.observedLocation,
      observedCondition: args.observedCondition,
      notes: args.notes,
      updatedAtISO: now,
    });
    await ctx.db.insert("assetEvents", {
      societyId: item.societyId,
      assetId: item.assetId,
      eventType: "verification",
      happenedAtISO: now,
      actorName: args.verifiedByName,
      location: args.observedLocation,
      condition: args.observedCondition,
      documentIds: [],
      notes: `${args.status}${args.notes ? ` — ${args.notes}` : ""}`,
      createdAtISO: now,
    });
    await ctx.db.patch(item.assetId, {
      nextVerificationDate: undefined,
      ...(args.observedLocation ? { location: args.observedLocation } : {}),
      ...(args.observedCondition ? { condition: args.observedCondition } : {}),
      updatedAtISO: now,
    });
    return args.itemId;
  },
});

export const completeVerificationRun = mutation({
  args: { id: v.id("assetVerificationRuns") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    const now = new Date().toISOString();
    await ctx.db.patch(id, { status: "Completed", completedAtISO: now, updatedAtISO: now });
    return id;
  },
});

export const dispose = mutation({
  args: {
    assetId: v.id("assets"),
    disposedAt: v.string(),
    disposalMethod: v.string(),
    disposalReason: v.string(),
    disposalValueCents: v.optional(v.number()),
    disposalApprovedMeetingId: v.optional(v.id("meetings")),
    disposalDocumentIds: v.optional(v.array(v.id("documents"))),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset) return null;
    const now = new Date().toISOString();
    await ctx.db.patch(args.assetId, {
      status: "Disposed",
      disposedAt: args.disposedAt,
      disposalMethod: args.disposalMethod,
      disposalReason: args.disposalReason,
      disposalValueCents: args.disposalValueCents,
      disposalApprovedMeetingId: args.disposalApprovedMeetingId,
      disposalDocumentIds: args.disposalDocumentIds ?? [],
      notes: args.notes ?? asset.notes,
      updatedAtISO: now,
    });
    await ctx.db.insert("assetEvents", {
      societyId: asset.societyId,
      assetId: args.assetId,
      eventType: "disposal",
      happenedAtISO: args.disposedAt,
      actorName: "You",
      documentIds: args.disposalDocumentIds ?? [],
      notes: `${args.disposalMethod}: ${args.disposalReason}`,
      createdAtISO: now,
    });
    return args.assetId;
  },
});

export const remove = mutation({
  args: { id: v.id("assets") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
    return null;
  },
});
