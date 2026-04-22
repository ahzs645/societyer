import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

function filingDefaults(kind: string) {
  const bcRegistryKinds = [
    "AnnualReport",
    "ChangeOfDirectors",
    "ChangeOfAddress",
    "BylawAmendment",
    "ConstitutionAlteration",
  ];
  const registryUrl = bcRegistryKinds.includes(kind)
    ? "https://www.bcregistry.gov.bc.ca/societies/"
    : "https://www.canada.ca/en/revenue-agency/services/e-services/e-services-businesses/business-account.html";

  const checklist =
    kind === "AnnualReport"
      ? [
          "Confirm AGM date and the directors elected or continuing in office.",
          "Verify registered and records office addresses.",
          "Open the pre-fill packet and confirm the society number and meeting date.",
          "Complete the filing in the portal and capture the confirmation number.",
          "Attach receipt or submission evidence before marking filed.",
        ]
      : kind === "BylawAmendment"
      ? [
          "Confirm the special resolution passed and the text filed matches the approved bylaw wording.",
          "Attach the signed resolution or meeting minutes.",
          "Open the pre-fill packet and verify filing fee details.",
          "Complete the registry filing and capture the confirmation number.",
          "Attach receipt or acknowledgement before marking filed.",
        ]
      : [
          "Review the filing packet and supporting documents.",
          "Open the correct external portal or form.",
          "Submit using the official government workflow.",
          "Capture confirmation number, fee, and evidence.",
        ];

  return { registryUrl, checklist };
}

export const get = query({
  args: { id: v.id("filings") },
  returns: v.any(),
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("filings")
      .withIndex("by_society_due", (q) => q.eq("societyId", societyId))
      .order("asc")
      .collect(),
});

export const guidance = query({
  args: { kind: v.string() },
  returns: v.any(),
  handler: async (_ctx, { kind }) => filingDefaults(kind),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    kind: v.string(),
    periodLabel: v.optional(v.string()),
    dueDate: v.string(),
    status: v.string(),
    submissionMethod: v.optional(v.string()),
    submittedByUserId: v.optional(v.id("users")),
    submissionChecklist: v.optional(v.array(v.string())),
    registryUrl: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const defaults = filingDefaults(args.kind);
    return await ctx.db.insert("filings", {
      ...args,
      registryUrl: args.registryUrl ?? defaults.registryUrl,
      submissionChecklist: args.submissionChecklist ?? defaults.checklist,
    });
  },
});

export const markFiled = mutation({
  args: {
    id: v.id("filings"),
    filedAt: v.string(),
    submissionMethod: v.optional(v.string()),
    submittedByUserId: v.optional(v.id("users")),
    confirmationNumber: v.optional(v.string()),
    feePaidCents: v.optional(v.number()),
    receiptDocumentId: v.optional(v.id("documents")),
    stagedPacketDocumentId: v.optional(v.id("documents")),
    evidenceNotes: v.optional(v.string()),
    attestedByUserId: v.optional(v.id("users")),
    submissionChecklist: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: async (ctx, { id, ...rest }) => {
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Filing not found.");
    if (!rest.filedAt || !rest.submissionMethod) {
      throw new Error("Filed date and submission method are required.");
    }
    const hasEvidence =
      !!rest.confirmationNumber ||
      !!rest.receiptDocumentId ||
      !!rest.stagedPacketDocumentId ||
      !!rest.evidenceNotes?.trim();
    if (!hasEvidence) {
      throw new Error("Add a confirmation number, evidence document, packet, or evidence note before marking filed.");
    }
    await ctx.db.patch(id, {
      ...rest,
      registryUrl: existing.registryUrl ?? filingDefaults(existing.kind).registryUrl,
      submissionChecklist:
        rest.submissionChecklist ??
        existing.submissionChecklist ??
        filingDefaults(existing.kind).checklist,
      attestedAtISO: rest.attestedByUserId ? new Date().toISOString() : existing.attestedAtISO,
      status: "Filed",
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("filings"),
    patch: v.object({
      kind: v.optional(v.string()),
      periodLabel: v.optional(v.string()),
      dueDate: v.optional(v.string()),
      status: v.optional(v.string()),
      submissionMethod: v.optional(v.string()),
      submittedByUserId: v.optional(v.id("users")),
      receiptDocumentId: v.optional(v.id("documents")),
      stagedPacketDocumentId: v.optional(v.id("documents")),
      sourceDocumentIds: v.optional(v.array(v.id("documents"))),
      submissionChecklist: v.optional(v.array(v.string())),
      registryUrl: v.optional(v.string()),
      evidenceNotes: v.optional(v.string()),
      attestedByUserId: v.optional(v.id("users")),
      attestedAtISO: v.optional(v.string()),
      sourceExternalIds: v.optional(v.array(v.string())),
      sourcePayloadJson: v.optional(v.string()),
      notes: v.optional(v.string()),
    }),
  },
  returns: v.any(),
  handler: async (ctx, { id, patch }) => {
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Filing not found.");
    const defaults = filingDefaults(patch.kind ?? existing.kind);
    await ctx.db.patch(id, {
      ...patch,
      registryUrl: patch.registryUrl ?? existing.registryUrl ?? defaults.registryUrl,
      submissionChecklist:
        patch.submissionChecklist ??
        existing.submissionChecklist ??
        defaults.checklist,
    });
  },
});

export const importBcRegistryHistory = mutation({
  args: {
    societyId: v.id("societies"),
    records: v.array(
      v.object({
        kind: v.string(),
        periodLabel: v.optional(v.string()),
        dueDate: v.string(),
        filedAt: v.optional(v.string()),
        submissionMethod: v.optional(v.string()),
        confirmationNumber: v.optional(v.string()),
        feePaidCents: v.optional(v.number()),
        receiptDocumentId: v.optional(v.id("documents")),
        stagedPacketDocumentId: v.optional(v.id("documents")),
        sourceDocumentIds: v.optional(v.array(v.id("documents"))),
        submissionChecklist: v.optional(v.array(v.string())),
        registryUrl: v.optional(v.string()),
        evidenceNotes: v.optional(v.string()),
        sourceExternalIds: v.array(v.string()),
        sourcePayloadJson: v.optional(v.string()),
        status: v.string(),
        notes: v.optional(v.string()),
      }),
    ),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("filings")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .collect();
    let inserted = 0;
    let updated = 0;
    const ids: any[] = [];
    const nowISO = new Date().toISOString();
    const claimed = new Set<string>();

    for (const record of args.records) {
      const defaults = filingDefaults(record.kind);
      const uniqueSourceIds = record.sourceExternalIds.filter(
        (sourceId) => !sourceId.startsWith("bc-registry:corp:"),
      );
      const match = existing.find((row) => {
        if (claimed.has(String(row._id))) return false;
        const rowSourceIds = row.sourceExternalIds ?? [];
        return uniqueSourceIds.some((sourceId) => rowSourceIds.includes(sourceId));
      }) ?? existing.find((row) => {
        if (claimed.has(String(row._id))) return false;
        if (row.sourceExternalIds?.length) return false;
        return row.filedAt === record.filedAt && row.periodLabel === record.periodLabel;
      });
      const payload = {
        societyId: args.societyId,
        ...record,
        registryUrl: record.registryUrl ?? defaults.registryUrl,
        submissionChecklist: record.submissionChecklist ?? defaults.checklist,
      };

      if (match) {
        claimed.add(String(match._id));
        await ctx.db.patch(match._id, {
          ...payload,
          confirmationNumber: record.confirmationNumber ?? match.confirmationNumber,
          feePaidCents: record.feePaidCents ?? match.feePaidCents,
          receiptDocumentId: record.receiptDocumentId ?? match.receiptDocumentId,
          stagedPacketDocumentId: record.stagedPacketDocumentId ?? match.stagedPacketDocumentId,
          attestedByUserId: match.attestedByUserId,
          attestedAtISO: match.attestedAtISO,
        });
        updated += 1;
        ids.push(match._id);
      } else {
        const id = await ctx.db.insert("filings", payload);
        existing.push({ _id: id, ...payload } as any);
        claimed.add(String(id));
        inserted += 1;
        ids.push(id);
      }
    }

    if (inserted || updated) {
      await ctx.db.insert("activity", {
        societyId: args.societyId,
        actor: "BC Registry connector",
        entityType: "filing",
        entityId: args.societyId,
        action: "filings-imported",
        summary: `Imported BC Registry filing history: ${inserted} created, ${updated} updated.`,
        createdAtISO: nowISO,
      });
    }

    return { inserted, updated, total: args.records.length, ids };
  },
});

export const remove = mutation({
  args: { id: v.id("filings") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
