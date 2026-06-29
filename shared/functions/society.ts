/**
 * PORTABLE FUNCTIONS: the society domain (pure `ctx.db` handlers only).
 *
 * Only the handlers that touch `ctx.db` exclusively live here so they run
 * unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle. Handlers that need `ctx.storage` (logo/letterhead blob lifecycle) or
 * server-only seed helpers (`upsert`, `createWorkspace`) stay on Convex.
 */

import type { PortableMutationCtx } from "../portable/ctx";

export async function setLogoInvertInDarkModePortable(
  ctx: PortableMutationCtx,
  { societyId, invert }: { societyId: string; invert: boolean },
) {
  const society = await ctx.db.get(societyId);
  if (!society) throw new Error("Society not found.");
  await ctx.db.patch(societyId, {
    logoInvertInDarkMode: invert,
    updatedAt: Date.now(),
  });
  return societyId;
}

export async function updateModulesPortable(
  ctx: PortableMutationCtx,
  { societyId, disabledModules }: { societyId: string; disabledModules: any },
) {
  await ctx.db.patch(societyId, {
    disabledModules,
    updatedAt: Date.now(),
  });
  return societyId;
}

// Deep-clone a society's records into a new society (YCN Copy_Entity_*): copies
// the society row + every child register that carries entity-scoped history
// under a fresh societyId. Includes the equity ledger (holdings + transfers),
// dividends, assets (+ events), and the transparency diligence steps — without
// these a clone silently loses the share/dividend/asset/SI history.
const CLONE_CHILD_TABLES = [
  "roleHolders",
  "organizationAddresses",
  "organizationRegistrations",
  "rightsClasses",
  "rightsHoldings",
  "rightsholdingTransfers",
  "dividends",
  "assets",
  "assetEvents",
  "significantIndividualSteps",
  "serviceProviders",
  "societyNameHistory",
  "constatingEvents",
  "shareCertificates",
  "annualFilingLedger",
  "entitySigners",
] as const;

/**
 * Remap a single field value through the old→new Id map. Cloned rows reference
 * each other by Convex Id (e.g. rightsHoldings.rightsClassId → rightsClasses);
 * a flat copy would leave those references pointing at the SOURCE society. We
 * remap any value (scalar or array element) that is an Id of a row we cloned;
 * cross-tenant Ids we did NOT clone (e.g. directoryPersonId → peopleDirectory,
 * sourceDocumentIds → documents) are absent from the map and pass through.
 */
function remapValue(value: unknown, idMap: Map<string, string>): unknown {
  if (typeof value === "string") {
    return idMap.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "string" ? idMap.get(item) ?? item : item));
  }
  return value;
}

export async function cloneSocietyPortable(
  ctx: PortableMutationCtx,
  args: { sourceSocietyId: string; newName: string; nowISO: string },
) {
  const name = args.newName.trim();
  if (!name) throw new Error("New society name is required.");
  const source = await ctx.db.get(args.sourceSocietyId);
  if (!source) throw new Error("Source society not found.");

  const { _id, _creationTime, ...sourceFields } = source as Record<string, unknown>;
  void _id;
  void _creationTime;
  const newSocietyId = await ctx.db.insert("societies", {
    ...(sourceFields as any),
    name,
    incorporationNumber: undefined, // a clone is a distinct legal entity
    updatedAt: Date.now(),
  });

  // Pass 1: insert every child row under the new society, recording the
  // old→new Id mapping. Cross-references are not yet rewritten.
  const idMap = new Map<string, string>();
  const inserted: Array<{ table: (typeof CLONE_CHILD_TABLES)[number]; newId: string }> = [];
  for (const table of CLONE_CHILD_TABLES) {
    const rows = await ctx.db
      .query(table)
      .withIndex("by_society", (q: any) => q.eq("societyId", args.sourceSocietyId))
      .collect();
    for (const row of rows) {
      const { _id: rid, _creationTime: rct, ...fields } = row as Record<string, unknown>;
      void rct;
      const newId = await ctx.db.insert(table, { ...(fields as any), societyId: newSocietyId });
      idMap.set(String(rid), newId as unknown as string);
      inserted.push({ table, newId: newId as unknown as string });
    }
  }

  // Pass 2: rewrite intra-clone Id references now that the full map exists, so
  // cloned holdings/transfers/asset-events point at the cloned rows, not the
  // source society's. Only patch rows that actually carry a remapped value.
  for (const { newId } of inserted) {
    const row = (await ctx.db.get(newId as any)) as Record<string, unknown> | null;
    if (!row) continue;
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (key === "_id" || key === "_creationTime" || key === "societyId") continue;
      const remapped = remapValue(value, idMap);
      if (remapped !== value) patch[key] = remapped;
    }
    if (Object.keys(patch).length > 0) await ctx.db.patch(newId as any, patch);
  }

  return { societyId: newSocietyId, copiedRows: inserted.length };
}

// YCN-style compliance settings (AGM date + financials-prep waiver). Consumed by
// shared/corporationSettings.ts to derive AGM / annual-report deadlines.
export async function updateComplianceSettingsPortable(
  ctx: PortableMutationCtx,
  { societyId, ...settings }: {
    societyId: string;
    agmMonth?: number;
    agmDay?: number;
    waivePrepFinancials?: boolean;
    shortName?: string;
    primaryContactName?: string;
    primaryContactPhone?: string;
    primaryContactEmail?: string;
    altContactName?: string;
    altContactPhone?: string;
    altContactEmail?: string;
    minuteBookLocation?: string;
    sealLocation?: string;
    docPrepLanguage?: string;
    responsibleLawyer?: string;
    restrictPeoplePicker?: boolean;
    includeDocumentIdHeader?: boolean;
  },
) {
  await ctx.db.patch(societyId, { ...settings, updatedAt: Date.now() });
  return societyId;
}

export async function updateInventorySettingsPortable(
  ctx: PortableMutationCtx,
  { societyId, consumableIntakeCountPromptEnabled }: {
    societyId: string;
    consumableIntakeCountPromptEnabled: boolean;
  },
) {
  await ctx.db.patch(societyId, {
    consumableIntakeCountPromptEnabled,
    updatedAt: Date.now(),
  });
  return societyId;
}

export async function updateNotificationSettingsPortable(
  ctx: PortableMutationCtx,
  { societyId, notificationRetentionDays }: {
    societyId: string;
    // Days dismissed notifications are retained before purge. 0 = keep forever.
    notificationRetentionDays: number;
  },
) {
  await ctx.db.patch(societyId, {
    notificationRetentionDays: Math.max(0, Math.round(notificationRetentionDays)),
    updatedAt: Date.now(),
  });
  return societyId;
}
