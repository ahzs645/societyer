import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  normalizeSearchName,
  matchByPrefix,
  findDuplicates,
  type DirectoryPerson,
} from "../shared/peopleDirectory";

export const list = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const rows = await ctx.db.query("peopleDirectory").collect();
    rows.sort((a, b) => {
      if (a.searchName < b.searchName) return -1;
      if (a.searchName > b.searchName) return 1;
      return 0;
    });
    return rows;
  },
});

export const searchByPrefix = query({
  args: { prefix: v.string(), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, args) => {
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
  },
});

export const upsert = mutation({
  args: {
    id: v.optional(v.id("peopleDirectory")),
    fullName: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    dob: v.optional(v.string()),
    isIndividual: v.optional(v.boolean()),
    defaultAddress: v.optional(v.string()),
    gender: v.optional(v.string()),
    pronouns: v.optional(v.string()),
    isServiceProvider: v.optional(v.boolean()),
    atAgeOfMajority: v.optional(v.boolean()),
    corpSign: v.optional(v.string()),
    nowISO: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
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
  },
});

// Materialize a directory person onto a society as a role holder (YCN
// Name_Add_From_GLOB_PEOPLE_DIRECTORY): copies identity fields and links back to
// the directory record via roleHolders.directoryPersonId.
export const addToSociety = mutation({
  args: {
    directoryPersonId: v.id("peopleDirectory"),
    societyId: v.id("societies"),
    roleType: v.string(),
    startDate: v.optional(v.string()),
    nowISO: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
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
  },
});

export const duplicates = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
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
  },
});
