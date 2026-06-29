/**
 * PORTABLE FUNCTIONS: the people-directory domain
 * (list / searchByPrefix / upsert / addToSociety / duplicates).
 *
 * Cross-tenant people directory (YCN DB_GLOB_PEOPLE_DIRECTORY): store a person
 * once and reuse across societies. Reads/writes the `peopleDirectory` and
 * `roleHolders` tables over the portable `ctx.db` contract; delegates name
 * normalization, typeahead, and dedupe to the pure shared module
 * (shared/peopleDirectory.ts). Each handler runs unchanged on hosted Convex, the
 * local Dexie runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import {
  normalizeSearchName,
  matchByPrefix,
  findDuplicates,
  type DirectoryPerson,
} from "../peopleDirectory";

export async function listPortable(ctx: PortableQueryCtx) {
  const rows = await ctx.db.query("peopleDirectory").collect();
  rows.sort((a, b) => {
    if (a.searchName < b.searchName) return -1;
    if (a.searchName > b.searchName) return 1;
    return 0;
  });
  return rows;
}

export async function searchByPrefixPortable(
  ctx: PortableQueryCtx,
  args: { prefix: string; limit?: number },
) {
  const rows = await ctx.db.query("peopleDirectory").collect();
  const people: DirectoryPerson[] = rows.map((row) => ({
    id: String(row._id),
    fullName: row.fullName,
    firstName: row.firstName,
    lastName: row.lastName,
    dob: row.dob,
    isIndividual: row.isIndividual,
  }));
  return matchByPrefix(people, args.prefix, args.limit ?? 10);
}

export async function upsertPortable(
  ctx: PortableMutationCtx,
  args: {
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
    // Patch only the fields actually supplied, so an edit from a partial form
    // (e.g. the directory search row, which has no gender/pronouns) never
    // clears stored fields it didn't include.
    const patch: Record<string, any> = { searchName, updatedAtISO: args.nowISO };
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) patch[key] = value;
    }
    await ctx.db.patch(args.id, patch);
    return args.id;
  }
  return await ctx.db.insert("peopleDirectory", {
    ...fields,
    createdAtISO: args.nowISO,
    updatedAtISO: args.nowISO,
  });
}

// Materialize a directory person onto a society as a role holder (YCN
// Name_Add_From_GLOB_PEOPLE_DIRECTORY): copies identity fields and links back to
// the directory record via roleHolders.directoryPersonId.
export async function addToSocietyPortable(
  ctx: PortableMutationCtx,
  args: {
    directoryPersonId: string;
    societyId: string;
    roleType: string;
    startDate?: string;
    nowISO: string;
  },
) {
  const person = await ctx.db.get(args.directoryPersonId);
  if (!person) throw new Error("Directory person not found");
  return await ctx.db.insert("roleHolders", {
    societyId: args.societyId,
    roleType: args.roleType,
    status: "current",
    fullName: person.fullName,
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
    createdAtISO: args.nowISO,
    updatedAtISO: args.nowISO,
  });
}

export async function duplicatesPortable(ctx: PortableQueryCtx) {
  const rows = await ctx.db.query("peopleDirectory").collect();
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
