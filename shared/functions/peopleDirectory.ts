/**
 * PORTABLE FUNCTIONS: the people-directory domain
 * (list / searchByPrefix / upsert / addToSociety / duplicates).
 *
 * Hosted contacts belong to one workspace. Existing unowned YCN contacts are
 * visible through authorized legacy references; trusted local workspaces retain
 * their existing contact reuse. Reads/writes the `peopleDirectory` and
 * `roleHolders` tables over the portable `ctx.db` contract; delegates name
 * normalization, typeahead, and dedupe to the pure shared module
 * (shared/peopleDirectory.ts). Each handler runs unchanged on hosted Convex, the
 * local Dexie runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireSocietyMembership } from "./access";
import { requirePermissionPortable } from "./permissions";
import type { PortableDoc } from "../portable/ctx";
import {
  normalizeSearchName,
  matchByPrefix,
  findDuplicates,
  type DirectoryPerson,
} from "../peopleDirectory";

function trustedLocalDirectory(ctx: PortableQueryCtx) {
  return ctx.principal.kind === "user" && ctx.principal.assurance === "trusted-workspace" && ctx.principal.runtime !== "convex-hosted";
}

async function directoryScope(ctx: PortableQueryCtx, societyId?: string, write = false) {
  const scope = societyId ?? (trustedLocalDirectory(ctx) && ctx.principal.kind === "user" ? ctx.principal.societyId : undefined);
  if (!scope) throw new Error("An authorized workspace is required for the people directory.");
  await requirePermissionPortable(ctx, scope, write ? "members:write" : "members:read");
  return scope;
}

async function linkedRoleIsReadable(ctx: PortableQueryCtx, societyId: string, roleType: string) {
  const permission = roleType === "signer" ? "documents:read" : roleType === "controller" ? "settings:read" : ["director", "officer"].includes(roleType) ? "directors:read" : "members:read";
  try { await requirePermissionPortable(ctx, societyId, permission); return true; }
  catch (error) {
    if (error instanceof Error && /^(Permission|Service scope) .* required\.$/.test(error.message)) return false;
    throw error;
  }
}

async function legacyEditable(ctx: PortableQueryCtx, id: string, societyId: string) {
  const [roles, signers] = await Promise.all([
    ctx.db.query("roleHolders").withIndex("by_directory_person", (q) => q.eq("directoryPersonId", id)).collect(),
    ctx.db.query("entitySigners").withIndex("by_directory_person", (q) => q.eq("directoryPersonId", id)).collect(),
  ]);
  return [...roles, ...signers].some((row) => row.societyId === societyId) && [...roles, ...signers].every((row) => row.societyId === societyId);
}

/** Hosted rows are visible only in their owner workspace. Legacy records need
 * an existing readable role-holder or signer link; knowing a global ID grants no access.
 * The browser/Electron trusted workspace keeps its established local reuse. */
export async function visibleDirectoryRows(ctx: PortableQueryCtx, societyId: string, options: { includeMerged?: boolean } = {}): Promise<PortableDoc[]> {
  await directoryScope(ctx, societyId);
  const live = (row: PortableDoc) => options.includeMerged || !row.mergedIntoId;
  // Trusted local workspaces keep reusing unowned contacts, but a row owned by
  // another workspace never appears here (P12: a restored backup or a test
  // workspace in the same browser must not leak into this directory).
  if (trustedLocalDirectory(ctx)) return (await ctx.db.query("peopleDirectory").collect()).filter((row) => (!row.societyId || row.societyId === societyId) && live(row)).map((row) => ({ ...row, editable: true }));
  const roles = await ctx.db.query("roleHolders").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  const legacyIds = new Set<string>();
  for (const role of roles) {
    if (role.directoryPersonId && await linkedRoleIsReadable(ctx, societyId, role.roleType)) legacyIds.add(String(role.directoryPersonId));
  }
  if (await linkedRoleIsReadable(ctx, societyId, "signer")) {
    const signers = await ctx.db.query("entitySigners").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
    for (const signer of signers) if (signer.directoryPersonId) legacyIds.add(String(signer.directoryPersonId));
  }
  const owned = await ctx.db.query("peopleDirectory").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  const legacy = (await Promise.all(Array.from(legacyIds, (id) => ctx.db.get(id, "peopleDirectory"))))
    .filter((row): row is PortableDoc => !!row && !row.societyId);
  return [...owned.filter(live).map((row) => ({ ...row, editable: true })), ...await Promise.all(legacy.filter(live).map(async (row) => ({ ...row, editable: await legacyEditable(ctx, row._id, societyId) })))];
}

export async function directoryPersonForSociety(ctx: PortableQueryCtx, id: string, societyId: string, options: { includeMerged?: boolean } = {}) {
  const row = (await visibleDirectoryRows(ctx, societyId, options)).find((person) => person._id === id);
  if (!row) throw new Error("Directory person not found.");
  return row;
}

export async function listPortable(ctx: PortableQueryCtx, args: { societyId?: string } = {}) {
  const rows = await visibleDirectoryRows(ctx, await directoryScope(ctx, args.societyId));
  rows.sort((a, b) => {
    if (a.searchName < b.searchName) return -1;
    if (a.searchName > b.searchName) return 1;
    return 0;
  });
  return rows;
}

export async function searchByPrefixPortable(
  ctx: PortableQueryCtx,
  args: { societyId?: string; prefix: string; limit?: number },
) {
  const rows = await visibleDirectoryRows(ctx, await directoryScope(ctx, args.societyId));
  const people: DirectoryPerson[] = rows.map((row) => ({
    id: String(row._id),
    fullName: row.fullName,
    firstName: row.firstName,
    lastName: row.lastName,
    dob: row.dob,
    isIndividual: row.isIndividual,
    editable: row.editable,
    aliases: row.aliases,
  }));
  return matchByPrefix(people, args.prefix, args.limit ?? 10);
}

export async function upsertPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId?: string;
    id?: string;
    fullName: string;
    firstName?: string;
    lastName?: string;
    dob?: string;
    isIndividual?: boolean;
    defaultAddress?: string;
    gender?: string;
    pronouns?: string;
    isServiceProvider?: boolean;
    atAgeOfMajority?: boolean;
    corpSign?: string;
    nowISO: string;
  },
) {
  const societyId = await directoryScope(ctx, args.societyId, true);
  const searchName = normalizeSearchName(args.fullName);
  const fields = {
    fullName: args.fullName,
    firstName: args.firstName,
    lastName: args.lastName,
    dob: args.dob,
    isIndividual: args.isIndividual,
    defaultAddress: args.defaultAddress,
    gender: args.gender,
    pronouns: args.pronouns,
    isServiceProvider: args.isServiceProvider,
    atAgeOfMajority: args.atAgeOfMajority,
    corpSign: args.corpSign,
    searchName,
  };
  if (args.id) {
    const candidate = await directoryPersonForSociety(ctx, args.id, societyId);
    if (typeof candidate.societyId === "string") {
      await requireSocietyMembership(ctx, candidate.societyId);
      await getOwned(ctx, "peopleDirectory", args.id, candidate.societyId);
    }
    // Patch only the fields actually supplied, so an edit from a partial form
    // (e.g. the directory search row, which has no gender/pronouns) never
    // clears stored fields it didn't include.
    if (!trustedLocalDirectory(ctx) && !candidate.societyId && !await legacyEditable(ctx, args.id, societyId)) {
      throw new Error("Shared legacy directory records cannot be overwritten. Create a workspace-owned person instead.");
    }
    const patch: Record<string, any> = { searchName, updatedAtISO: args.nowISO,
      ...(!trustedLocalDirectory(ctx) ? { societyId } : {}) };
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) patch[key] = value;
    }
    await ctx.db.patch(args.id, patch);
    return args.id;
  }
  return await ctx.db.insert("peopleDirectory", {
    ...(!trustedLocalDirectory(ctx) ? { societyId } : {}),
    ...fields,
    createdAtISO: args.nowISO,
    updatedAtISO: args.nowISO,
  });
}

// Materialize a directory person onto a society as a role holder (YCN
// Name_Add_From_GLOB_PEOPLE_DIRECTORY): copies identity fields and links back to
// the directory record via roleHolders.directoryPersonId. As a director the
// person also enters the directors register (P14), never twice.
export async function addToSocietyPortable(
  ctx: PortableMutationCtx,
  args: {
    directoryPersonId: string;
    societyId: string;
    roleType: string;
    startDate?: string;
    position?: string;
    sourceUrl?: string;
    sourceReference?: string;
    nowISO: string;
  },
) {
  await directoryScope(ctx, args.societyId, true);
  const person = await directoryPersonForSociety(ctx, args.directoryPersonId, args.societyId);
  if (typeof person.societyId === "string") {
    await getOwned(ctx, "peopleDirectory", args.directoryPersonId, args.societyId);
  }
  if (args.startDate && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(args.startDate)) throw new Error("Start date must be YYYY, YYYY-MM or YYYY-MM-DD.");
  const roles = await ctx.db.query("roleHolders").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).collect();
  const existing = roles.find((row) => row.directoryPersonId === args.directoryPersonId && row.roleType === args.roleType && row.status === "current");
  if (existing) throw new Error(`${person.fullName} is already a current ${args.roleType} in this society.`);
  if (args.roleType === "director") {
    await requirePermissionPortable(ctx, args.societyId, "directors:write");
    if (!args.startDate) throw new Error("A director needs a term start date.");
  }
  const source = [args.sourceReference?.trim(), args.sourceUrl?.trim()].filter(Boolean).join(" — ");
  const roleHolderId = await ctx.db.insert("roleHolders", {
    societyId: args.societyId,
    roleType: args.roleType,
    status: "current",
    fullName: person.fullName,
    citizenshipCountries: [],
    taxResidenceCountries: [],
    relatedShareholderIds: [],
    controllingIndividualIds: [],
    sourceDocumentIds: [],
    sourceExternalIds: [],
    firstName: person.firstName,
    lastName: person.lastName,
    dateOfBirth: person.dob,
    // Carry the directory's gender/pronouns onto the role holder so the NLG
    // engine renders correct pronouns in generated documents (YCN
    // ENT_PEOPLE.GENDER copy-on-add).
    gender: person.gender,
    pronouns: person.pronouns,
    directoryPersonId: args.directoryPersonId,
    startDate: args.startDate,
    ...(source ? { notes: `Source: ${source}` } : {}),
    createdAtISO: args.nowISO,
    updatedAtISO: args.nowISO,
  });
  if (args.roleType === "director") {
    const directors = await ctx.db.query("directors").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).collect();
    const already = directors.find((row) => row.directoryPersonId === args.directoryPersonId && row.status === "Active");
    if (!already) {
      const [firstName, lastName] = splitDirectoryName(person);
      await ctx.db.insert("directors", {
        societyId: args.societyId,
        directoryPersonId: args.directoryPersonId,
        firstName,
        lastName,
        position: args.position?.trim() || "Director",
        isBCResident: false,
        termStart: args.startDate,
        consentOnFile: false,
        status: "Active",
        notes: `Added from the people directory${source ? `. Source: ${source}` : ". No source recorded yet"}. Consent and residency still need confirmation.`,
      });
    }
  }
  return roleHolderId;
}

export function splitDirectoryName(person: any): [string, string] {
  if (person.firstName || person.lastName) return [String(person.firstName ?? ""), String(person.lastName ?? "")];
  const parts = String(person.fullName ?? "").trim().split(/\s+/);
  if (parts.length < 2) return [parts[0] ?? "", ""];
  return [parts.slice(0, -1).join(" "), parts[parts.length - 1]];
}

export async function duplicatesPortable(ctx: PortableQueryCtx, args: { societyId?: string } = {}) {
  const rows = await visibleDirectoryRows(ctx, await directoryScope(ctx, args.societyId));
  const people: DirectoryPerson[] = rows.map((row) => ({
    id: String(row._id),
    fullName: row.fullName,
    firstName: row.firstName,
    lastName: row.lastName,
    dob: row.dob,
    isIndividual: row.isIndividual,
  }));
  return findDuplicates(people);
}
