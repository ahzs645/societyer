/**
 * PORTABLE FUNCTIONS: the society domain.
 *
 * The `ctx.db`-only handlers plus the read handlers (`get`/`list`/`getById`),
 * which resolve logo/letterhead blob URLs through the injected
 * `ctx.capabilities.storage` (Convex `_storage` on hosted Convex; a
 * passthrough/null resolver on the local runtime). Logo/letterhead WRITES
 * (`setLogo`/`clearLogo` …) still need upload + delete and stay on Convex until
 * the storage capability covers the write side.
 */

import type {
  PortableDoc,
  PortableMutationCtx,
  PortablePrincipal,
  PortableQueryCtx,
} from "../portable/ctx";
import { validateIntegrationSettings, type IntegrationSettings } from "../integrationSettings";
import { isValidFiscalYearEnd } from "../entitySetup";
import { requirePermissionPortable } from "./permissions";
import { matchesVerifiedIdentity, ensureExternalIdentityPortable, assertExternalIdentityActive } from "./identity";
import { claimStorageId, requireAuthenticated, requireRolePortable, requireSocietyMembership, isActiveMembership } from "./access";

export type WorkspaceCreationAccess = { allowed: boolean; reason: string };

/** Creating a fresh tenant never grants authority in an existing tenant.
 * A backup/profile/email is not proof of a hosted identity. */
export async function workspaceCreationAccessPortable(ctx: PortableQueryCtx): Promise<WorkspaceCreationAccess> {
  const principal = ctx.principal;
  if (principal.kind !== "user") return { allowed: false, reason: "Sign in with a user account to create a workspace." };
  if (principal.assurance === "trusted-workspace") return { allowed: true, reason: "Local workspace creation is available." };
  if (principal.assurance !== "verified-jwt" || !principal.issuer || !principal.subject) return { allowed: false, reason: "A verified user identity is required." };
  const identities = await ctx.db.query("externalIdentities").withIndex("by_issuer_subject", q => q.eq("issuer", principal.issuer).eq("subject", principal.subject)).collect();
  if (identities.length > 1 || identities.some(identity => identity.status !== "Active")) return { allowed: false, reason: "Your identity is disabled or has conflicting bindings. Contact an administrator." };
  const users = (await ctx.db.query("users").withIndex("by_auth_subject", q => q.eq("authSubject", principal.subject)).collect()).filter(user => matchesVerifiedIdentity(user, principal));
  if (new Set(users.map(user => user.societyId)).size !== users.length) return { allowed: false, reason: "Your workspace bindings conflict. Contact an administrator." };
  if (users.length && !users.some(isActiveMembership)) return { allowed: false, reason: "Your existing workspace access is inactive. Contact an administrator." };
  for (const user of users.filter(isActiveMembership)) {
    try { await assertExternalIdentityActive(ctx.db, user); }
    catch { return { allowed: false, reason: "Your identity is disabled or its binding is invalid." }; }
  }
  return { allowed: true, reason: "You can create a separate organization workspace." };
}

export async function assertWorkspaceCreator(ctx: PortableQueryCtx, actingUserId?: string) {
  const access = await workspaceCreationAccessPortable(ctx);
  if (!access.allowed) throw new Error(access.reason);
  if (actingUserId && ctx.principal.kind === "user" && ctx.principal.assurance === "verified-jwt") {
    const user = await ctx.db.get(actingUserId, "users");
    if (!user?.societyId || !matchesVerifiedIdentity(user, ctx.principal) || !isActiveMembership(user)) throw new Error("Authenticated actor does not match the current principal.");
    await requireSocietyMembership(ctx, String(user.societyId));
  }
}

export type NewSocietyOwnerInput = {
  societyId: string;
  placeholderEmail: string;
  placeholderDisplayName: string;
  createdAtISO: string;
};

type NewSocietyOwnerFields = {
  societyId: string;
  email: string;
  displayName: string;
  role: "Owner";
  status: "Active";
  createdAtISO: string;
  authProvider?: string;
  authSubject?: string;
  authIssuer?: string;
  emailVerifiedAtISO?: string;
  lastLoginAtISO?: string;
};

/**
 * Build the initial Owner without treating profile fields as identity proof.
 * Only the hosted adapter can supply a verified-JWT principal; local/desktop
 * trusted-workspace principals deliberately retain the placeholder shape.
 */
export function newSocietyOwnerFields(
  principal: PortablePrincipal,
  input: NewSocietyOwnerInput,
): NewSocietyOwnerFields {
  const verifiedCreator =
    principal.kind === "user" &&
    principal.assurance === "verified-jwt" &&
    Boolean(principal.issuer) &&
    Boolean(principal.subject);
  if (!verifiedCreator || principal.kind !== "user") {
    return {
      societyId: input.societyId,
      email: input.placeholderEmail,
      // Setup sends "" when no privacy-officer name was entered.
      displayName: input.placeholderDisplayName.trim() || "Owner",
      role: "Owner",
      status: "Active",
      createdAtISO: input.createdAtISO,
    };
  }

  const principalEmail = principal.email?.trim();
  const principalName = principal.name?.trim();
  return {
    societyId: input.societyId,
    email: principalEmail || input.placeholderEmail,
    displayName: principalName || principalEmail || input.placeholderDisplayName,
    role: "Owner",
    status: "Active",
    createdAtISO: input.createdAtISO,
    authProvider: principal.authProvider || principal.issuer,
    authSubject: principal.subject,
    authIssuer: principal.issuer,
    emailVerifiedAtISO: principal.emailVerified ? input.createdAtISO : undefined,
    lastLoginAtISO: input.createdAtISO,
  };
}

export async function seedNewSocietyOwnerPortable(
  ctx: PortableMutationCtx,
  input: NewSocietyOwnerInput,
): Promise<string> {
  const fields = newSocietyOwnerFields(ctx.principal, input);
  const externalIdentityId = fields.authIssuer && fields.authSubject
    ? await ensureExternalIdentityPortable(ctx, fields.authIssuer, fields.authSubject) : undefined;
  return ctx.db.insert("users", { ...fields, ...(externalIdentityId ? { externalIdentityId } : {}) });
}

/** Resolve a society's logo/letterhead blob ids to URLs via the storage capability. */
async function withLogoUrl(ctx: PortableQueryCtx, society: any) {
  if (!society) return society;
  const resolve = async (storageId: unknown) =>
    storageId ? (await ctx.capabilities.storage.getDownloadUrl({ storageKey: String(storageId) })).url ?? undefined : undefined;
  const [logoUrl, logoDarkUrl, letterheadUrl] = await Promise.all([
    resolve(society.logoStorageId),
    resolve(society.logoDarkStorageId),
    resolve(society.letterheadStorageId),
  ]);
  return { ...society, logoUrl, logoDarkUrl, letterheadUrl };
}

/**
 * Societies the caller may enumerate.
 *
 * A `trusted-workspace` principal's `societyId` names the workspace currently
 * selected in the local app, NOT a membership restriction: the local database
 * file is itself the trust boundary and legitimately holds several societies
 * (see `check-local-snapshot-roundtrip`). Scoping the list to the selected one
 * hides the user's other local workspaces from them.
 */
async function principalMemberships(ctx: PortableQueryCtx): Promise<PortableDoc[]> {
  const principal = requireAuthenticated(ctx);
  if (principal.assurance === "trusted-workspace") {
    // Enumerate the societies themselves rather than user rows: a legacy or
    // freshly-imported local database can hold societies with no user row yet.
    const localSocieties = await ctx.db.query<PortableDoc>("societies").collect();
    return localSocieties.map((society) => ({ ...society, societyId: society._id }));
  }
  if (principal.societyId) {
    return [await requireSocietyMembership(ctx, principal.societyId)];
  }
  if (principal.kind === "service" && principal.actorUserId) {
    const actor = await ctx.db.get(principal.actorUserId, "users");
    if (actor?.societyId) return [await requireSocietyMembership(ctx, String(actor.societyId))];
  }
  if (principal.kind !== "user") throw new Error("Society membership not found.");
  const memberships = await ctx.db
    .query("users")
    .withIndex("by_auth_subject", (q) => q.eq("authSubject", principal.subject))
    .collect();
  const activeMemberships = memberships.filter(
    (membership) => matchesVerifiedIdentity(membership, principal) && (!membership.status || membership.status === "Active"),
  );
  if (!activeMemberships.length) throw new Error("Society membership not found.");
  return Promise.all(activeMemberships.map((membership) => requireSocietyMembership(ctx, String(membership.societyId))));
}

export async function getPortable(ctx: PortableQueryCtx, _args: Record<string, never>) {
  const [membership] = await principalMemberships(ctx);
  return withLogoUrl(ctx, await ctx.db.get(String(membership.societyId), "societies"));
}

/** Current authorized organization rows, without invoking branding storage. */
export async function listAuthorizedSocietyRows(ctx: PortableQueryCtx) {
  const memberships = await principalMemberships(ctx);
  const societies = await Promise.all(
    memberships.map((membership) => ctx.db.get(String(membership.societyId), "societies")),
  );
  return societies.filter((society): society is PortableDoc => society !== null);
}

export async function listPortable(ctx: PortableQueryCtx) {
  return Promise.all((await listAuthorizedSocietyRows(ctx)).map((society) => withLogoUrl(ctx, society)));
}

export async function getByIdPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  await requireSocietyMembership(ctx, id);
  const society = await ctx.db.get(id, "societies");
  if (!society) throw new Error("societies not found.");
  return withLogoUrl(ctx, society);
}

/**
 * Set or clear a society logo/letterhead field. The record write is pure
 * `ctx.db`; the only side effect is deleting the previously-stored blob, which
 * goes through `ctx.capabilities.storage` (Convex `_storage` on hosted Convex; a
 * no-op locally where logos are stored inline as data: URLs). `storageId` is a
 * Convex `_storage` id live, or a data: URL on the local runtime.
 */
async function setStorageField(ctx: PortableMutationCtx, societyId: string, field: string, storageId?: string) {
  await requireSocietyMembership(ctx, societyId);
  const society = await ctx.db.get(societyId, "societies");
  if (!society) throw new Error("Society not found.");
  if (storageId) await claimStorageId(ctx, storageId, societyId);
  const previous = society[field];
  if (previous && previous !== storageId) {
    try {
      await ctx.capabilities.storage.delete({ storageKey: String(previous) });
    } catch {
      // Old blob may have already been removed; not fatal.
    }
  }
  await ctx.db.patch(societyId, { [field]: storageId, updatedAt: Date.now() });
  return societyId;
}

export const setLogoPortable = (ctx: PortableMutationCtx, { societyId, storageId }: { societyId: string; storageId: string }) =>
  setStorageField(ctx, societyId, "logoStorageId", storageId);
export const clearLogoPortable = (ctx: PortableMutationCtx, { societyId }: { societyId: string }) =>
  setStorageField(ctx, societyId, "logoStorageId", undefined);
export const setDarkLogoPortable = (ctx: PortableMutationCtx, { societyId, storageId }: { societyId: string; storageId: string }) =>
  setStorageField(ctx, societyId, "logoDarkStorageId", storageId);
export const clearDarkLogoPortable = (ctx: PortableMutationCtx, { societyId }: { societyId: string }) =>
  setStorageField(ctx, societyId, "logoDarkStorageId", undefined);
export const setLetterheadPortable = (ctx: PortableMutationCtx, { societyId, storageId }: { societyId: string; storageId: string }) =>
  setStorageField(ctx, societyId, "letterheadStorageId", storageId);
export const clearLetterheadPortable = (ctx: PortableMutationCtx, { societyId }: { societyId: string }) =>
  setStorageField(ctx, societyId, "letterheadStorageId", undefined);

export async function setLogoInvertInDarkModePortable(
  ctx: PortableMutationCtx,
  { societyId, invert }: { societyId: string; invert: boolean },
) {
  await requireSocietyMembership(ctx, societyId);
  const society = await ctx.db.get(societyId, "societies");
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
  await requireSocietyMembership(ctx, societyId);
  await requireRolePortable(ctx, { societyId, required: "Admin" });
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
 * remap any value (scalar or array element) that is an Id of a row we cloned,
 * including a "roleHolder:<id>" holder key; cross-tenant Ids we did NOT clone
 * (e.g. directoryPersonId → peopleDirectory, sourceDocumentIds → documents)
 * are absent from the map and pass through.
 */
function remapValue(value: unknown, idMap: Map<string, string>): unknown {
  const one = (item: string) => {
    const direct = idMap.get(item);
    if (direct) return direct;
    const holder = /^roleHolder:(.+)$/.exec(item);
    const mapped = holder ? idMap.get(holder[1]) : undefined;
    return mapped ? `roleHolder:${mapped}` : item;
  };
  if (typeof value === "string") {
    return one(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "string" ? one(item) : item));
  }
  return value;
}

/** Start/effective date fields a template clone may reset (YCN Date_Over_Ride). */
export const CLONE_EFFECTIVE_DATE_FIELDS: Partial<Record<(typeof CLONE_CHILD_TABLES)[number], readonly string[]>> = {
  roleHolders: ["startDate"],
  organizationAddresses: ["effectiveFrom"],
  rightsClasses: ["startDate"],
  rightsholdingTransfers: ["transferDate"],
  serviceProviders: ["appointedOn"],
  societyNameHistory: ["startISO"],
  constatingEvents: ["startISO"],
  shareCertificates: ["issuedOn"],
  entitySigners: ["validFromISO"],
};
const CLONE_END_DATE_FIELDS = ["endDate", "effectiveTo", "removedOn", "endISO", "cancelledOn", "validToISO"];
/** Ownership registers: holdings, the ledger, certificates and dividends. */
const CLONE_HOLDING_TABLES = new Set(["rightsHoldings", "rightsholdingTransfers", "shareCertificates", "dividends"]);
/** Roles that make a role-holder row a significant individual / controller. */
const SIGNIFICANT_ROLE_TYPES = new Set(["controller", "significant_individual"]);
export const MAX_CLONE_COPIES = 20;

export type CloneSocietyOptions = {
  /** YYYY-MM-DD: reset every start/effective date to this date. */
  resetEffectiveDatesTo?: string;
  /** Leave out shareholdings, the share ledger, certificates and dividends. */
  excludeHoldings?: boolean;
  /** Leave out significant individuals and their diligence steps. */
  excludeSignificantIndividuals?: boolean;
  /** Leave out every person (role holders and signers); implies the two above. */
  excludePeople?: boolean;
  /** Create this many clones, named "<name> 1" … "<name> N". */
  copies?: number;
  /** Registry number of the new entity (single clone only). */
  incorporationNumber?: string;
};

function validDateOnly(value: string) {
  const time = /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(`${value}T00:00:00Z`) : NaN;
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export async function cloneSocietyPortable(
  ctx: PortableMutationCtx,
  args: { sourceSocietyId: string; newName: string; nowISO: string } & CloneSocietyOptions,
) {
  await requireSocietyMembership(ctx, args.sourceSocietyId);
  const name = args.newName.trim();
  if (!name) throw new Error("New society name is required.");
  const source = await ctx.db.get(args.sourceSocietyId);
  if (!source) throw new Error("Source society not found.");
  const copies = args.copies ?? 1;
  if (!Number.isInteger(copies) || copies < 1 || copies > MAX_CLONE_COPIES) throw new Error(`Choose between 1 and ${MAX_CLONE_COPIES} copies.`);
  const resetDate = args.resetEffectiveDatesTo?.trim() || undefined;
  if (resetDate && !validDateOnly(resetDate)) throw new Error("Enter the reset date as a valid date (YYYY-MM-DD).");
  const targetNumber = args.incorporationNumber?.trim() || undefined;
  if (targetNumber && copies > 1) throw new Error("A registry number can be set only when creating one clone.");
  const excludePeople = args.excludePeople === true;
  const excludeHoldings = excludePeople || args.excludeHoldings === true;
  const excludeSignificant = excludePeople || args.excludeSignificantIndividuals === true;

  // Warn, without blocking, when the target number is already in use by an
  // organization this user can see (never search other tenants).
  const warnings: string[] = [];
  if (targetNumber) {
    const normalized = targetNumber.replace(/\s+/g, "").toUpperCase();
    const visible = await listAuthorizedSocietyRows(ctx);
    const clash = visible.find((row) => String(row.incorporationNumber ?? "").replace(/\s+/g, "").toUpperCase() === normalized);
    if (clash) warnings.push(`Registry number ${targetNumber} is already recorded for ${clash.name ?? "another organization"}. Check that the clone is a different entity.`);
  }

  // Read the source registers once; each copy is inserted from the same rows.
  const sourceRows: Array<{ table: (typeof CLONE_CHILD_TABLES)[number]; rows: Array<Record<string, unknown>> }> = [];
  for (const table of CLONE_CHILD_TABLES) {
    if (excludeHoldings && CLONE_HOLDING_TABLES.has(table)) continue;
    if (excludeSignificant && table === "significantIndividualSteps") continue;
    if (excludePeople && (table === "roleHolders" || table === "entitySigners")) continue;
    const rows = await ctx.db
      .query(table)
      .withIndex("by_society", (q: any) => q.eq("societyId", args.sourceSocietyId))
      .collect();
    sourceRows.push({ table, rows: rows.filter((row: any) => !(table === "roleHolders" && excludeSignificant && SIGNIFICANT_ROLE_TYPES.has(String(row.roleType)))) });
  }
  // A row that points at a person left out of the clone is left out too, so
  // no clone row references the source workspace's people.
  const keptRoleHolders = new Set((sourceRows.find((entry) => entry.table === "roleHolders")?.rows ?? []).map((row) => String(row._id)));
  const allRoleHolders = await ctx.db.query("roleHolders").withIndex("by_society", (q: any) => q.eq("societyId", args.sourceSocietyId)).collect();
  const excludedRoleHolders = new Set(allRoleHolders.map((row: any) => String(row._id)).filter((id: string) => !keptRoleHolders.has(id)));
  if (excludedRoleHolders.size) {
    for (const entry of sourceRows) {
      if (entry.table === "roleHolders") continue;
      entry.rows = entry.rows.filter((row) => !Object.entries(row).some(([key, value]) => key !== "_id" && key !== "societyId" && typeof value === "string" && (excludedRoleHolders.has(value) || excludedRoleHolders.has(value.replace(/^roleHolder:/, "")))));
    }
  }
  if (resetDate) {
    const ended = sourceRows.reduce((sum, { rows }) => sum + rows.filter((row) => CLONE_END_DATE_FIELDS.some((field) => typeof row[field] === "string" && String(row[field]).slice(0, 10) < resetDate)).length, 0);
    if (ended) warnings.push(`${ended} copied ${ended === 1 ? "row ends" : "rows end"} before ${resetDate}; review or remove ${ended === 1 ? "it" : "them"} in the clone.`);
  }

  const { _id, _creationTime, ...sourceFields } = source as Record<string, unknown>;
  void _id;
  void _creationTime;
  // The signed articles document belongs to the source workspace.
  const operativeArticles = (sourceFields as any).operativeArticles
    ? (({ sourceDocumentId: _doc, ...rest }) => rest)((sourceFields as any).operativeArticles)
    : undefined;
  const societyIds: string[] = [];
  let copiedRows = 0;
  for (let index = 1; index <= copies; index++) {
    const newSocietyId = await ctx.db.insert("societies", {
      ...(sourceFields as any),
      name: copies > 1 ? `${name} ${index}` : name,
      incorporationNumber: targetNumber, // a clone is a distinct legal entity
      operativeArticles,
      // Annual-business evidence belongs to the source entity (and its written
      // resolutions); a clone records its own.
      annualDeadlineCalendarReviews: undefined,
      annualMeetingCompletions: undefined,
      annualMeetingFinancialYearEnd: undefined,
      annualReturnPeriodEnd: undefined,
      updatedAt: Date.now(),
    });
    societyIds.push(newSocietyId as unknown as string);

    // Pass 1: insert every child row under the new society, recording the
    // old→new Id mapping. Cross-references are not yet rewritten.
    const idMap = new Map<string, string>();
    const inserted: Array<{ table: (typeof CLONE_CHILD_TABLES)[number]; newId: string }> = [];
    for (const { table, rows } of sourceRows) {
      for (const row of rows) {
        const { _id: rid, _creationTime: rct, ...fields } = row;
        void rct;
        const reset = resetDate ? Object.fromEntries((CLONE_EFFECTIVE_DATE_FIELDS[table] ?? []).filter((field) => field in fields).map((field) => [field, resetDate])) : {};
        const newId = await ctx.db.insert(table, { ...(fields as any), ...reset, societyId: newSocietyId });
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
        if (JSON.stringify(remapped) !== JSON.stringify(value)) patch[key] = remapped;
      }
      if (Object.keys(patch).length > 0) await ctx.db.patch(newId as any, patch);
    }
    copiedRows += inserted.length;
  }

  return { societyId: societyIds[0], societyIds, copiedRows, warnings };
}

// YCN-style compliance settings (AGM date + financials-prep waiver). Consumed by
// shared/corporationSettings.ts to derive AGM / annual-report deadlines.
export async function updateComplianceSettingsPortable(
  ctx: PortableMutationCtx,
  { societyId, ...settings }: {
    societyId: string;
    agmMonth?: number;
    agmDay?: number;
    fiscalYearEnd?: string;
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
    omitAdoptionClause?: boolean;
  },
) {
  await requireSocietyMembership(ctx, societyId);
  if (settings.fiscalYearEnd !== undefined && !isValidFiscalYearEnd(settings.fiscalYearEnd)) {
    throw new Error("Fiscal year end must be a valid month and day (MM-DD), for example 03-31.");
  }
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
  await requireSocietyMembership(ctx, societyId);
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
  await requireSocietyMembership(ctx, societyId);
  await ctx.db.patch(societyId, {
    notificationRetentionDays: Math.max(0, Math.round(notificationRetentionDays)),
    updatedAt: Date.now(),
  });
  return societyId;
}

/** Storage policy/evidence changes are privileged; neither tokens nor connections are minted here. */
export async function updateIntegrationSettingsPortable(
  ctx: PortableMutationCtx,
  { societyId, integrationSettings }: { societyId: string; integrationSettings: IntegrationSettings },
) {
  await requirePermissionPortable(ctx, societyId, "settings:manage");
  const settings = validateIntegrationSettings(integrationSettings);
  await ctx.db.patch(societyId, { integrationSettings: settings, updatedAt: Date.now() });
  return societyId;
}
