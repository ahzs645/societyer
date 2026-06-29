/**
 * PORTABLE FUNCTIONS: the filings domain
 * (get / list / guidance / create / markFiled / update /
 *  importBcRegistryHistory / remove).
 *
 * Reads/writes the `filings` table (plus an `activity` audit row) over
 * `ctx.db`. Each handler runs unchanged on hosted Convex, the local Dexie
 * runtime, and the convex-test oracle.
 *
 * NOTE: `markFiled` lives in the static PENDING ledger but is pure-ctx.db, so it
 * is ported here alongside the rest of the domain.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { filingKindDefinition } from "../jurisdictionWorkspace";

function filingDefaults(kind: string, jurisdictionCode?: string | null) {
  const definition = filingKindDefinition(kind, jurisdictionCode);
  return { registryUrl: definition.registryUrl, checklist: definition.checklist };
}

async function jurisdictionCodeForSociety(ctx: PortableQueryCtx | PortableMutationCtx, societyId: any) {
  const society = await ctx.db.get(societyId);
  return society?.jurisdictionCode ?? null;
}

export async function getPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  return ctx.db.get(id);
}

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("filings")
    .withIndex("by_society_due", (q) => q.eq("societyId", societyId))
    .order("asc")
    .collect();
}

export async function guidancePortable(
  _ctx: PortableQueryCtx,
  { kind, jurisdictionCode }: { kind: string; jurisdictionCode?: string },
) {
  return filingDefaults(kind, jurisdictionCode);
}

export async function createPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    kind: string;
    jurisdictionCode?: string;
    contextKind?: string;
    sourceRegistrationId?: string;
    periodLabel?: string;
    dueDate: string;
    status: string;
    submissionMethod?: string;
    submittedByUserId?: string;
    submissionChecklist?: string[];
    registryUrl?: string;
    notes?: string;
  },
) {
  const defaults = filingDefaults(
    args.kind,
    args.jurisdictionCode ?? await jurisdictionCodeForSociety(ctx, args.societyId),
  );
  return await ctx.db.insert("filings", {
    ...args,
    registryUrl: args.registryUrl ?? defaults.registryUrl,
    submissionChecklist: args.submissionChecklist ?? defaults.checklist,
  });
}

export async function markFiledPortable(
  ctx: PortableMutationCtx,
  { id, ...rest }: {
    id: string;
    filedAt: string;
    submissionMethod?: string;
    submittedByUserId?: string;
    confirmationNumber?: string;
    feePaidCents?: number;
    receiptDocumentId?: string;
    stagedPacketDocumentId?: string;
    evidenceNotes?: string;
    attestedByUserId?: string;
    submissionChecklist?: string[];
  },
) {
  const existing = await ctx.db.get(id);
  if (!existing) throw new Error("Filing not found.");
  const jurisdictionCode = await jurisdictionCodeForSociety(ctx, existing.societyId);
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
    registryUrl: existing.registryUrl ?? filingDefaults(existing.kind, jurisdictionCode).registryUrl,
    submissionChecklist:
      rest.submissionChecklist ??
      existing.submissionChecklist ??
      filingDefaults(existing.kind, jurisdictionCode).checklist,
    attestedAtISO: rest.attestedByUserId ? new Date().toISOString() : existing.attestedAtISO,
    status: "Filed",
  });
}

export async function updatePortable(
  ctx: PortableMutationCtx,
  { id, patch }: {
    id: string;
    patch: {
      kind?: string;
      jurisdictionCode?: string;
      contextKind?: string;
      sourceRegistrationId?: string;
      periodLabel?: string;
      dueDate?: string;
      status?: string;
      submissionMethod?: string;
      submittedByUserId?: string;
      receiptDocumentId?: string;
      stagedPacketDocumentId?: string;
      sourceDocumentIds?: string[];
      submissionChecklist?: string[];
      registryUrl?: string;
      evidenceNotes?: string;
      attestedByUserId?: string;
      attestedAtISO?: string;
      sourceExternalIds?: string[];
      sourcePayloadJson?: string;
      notes?: string;
    };
  },
) {
  const existing = await ctx.db.get(id);
  if (!existing) throw new Error("Filing not found.");
  const defaults = filingDefaults(
    patch.kind ?? existing.kind,
    patch.jurisdictionCode ?? existing.jurisdictionCode ?? await jurisdictionCodeForSociety(ctx, existing.societyId),
  );
  await ctx.db.patch(id, {
    ...patch,
    registryUrl: patch.registryUrl ?? existing.registryUrl ?? defaults.registryUrl,
    submissionChecklist:
      patch.submissionChecklist ??
      existing.submissionChecklist ??
      defaults.checklist,
  });
}

export async function importBcRegistryHistoryPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    records: Array<{
      kind: string;
      jurisdictionCode?: string;
      contextKind?: string;
      sourceRegistrationId?: string;
      periodLabel?: string;
      dueDate: string;
      filedAt?: string;
      submissionMethod?: string;
      confirmationNumber?: string;
      feePaidCents?: number;
      receiptDocumentId?: string;
      stagedPacketDocumentId?: string;
      sourceDocumentIds?: string[];
      submissionChecklist?: string[];
      registryUrl?: string;
      evidenceNotes?: string;
      sourceExternalIds: string[];
      sourcePayloadJson?: string;
      status: string;
      notes?: string;
    }>;
  },
) {
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
    const defaults = filingDefaults(
      record.kind,
      record.jurisdictionCode ?? await jurisdictionCodeForSociety(ctx, args.societyId),
    );
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
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  await ctx.db.delete(id);
}
