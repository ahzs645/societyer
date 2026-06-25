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
    nowISO: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const searchName = normalizeSearchName(args.fullName);
    if (args.id) {
      await ctx.db.patch(args.id, {
        fullName: args.fullName,
        firstName: args.firstName,
        lastName: args.lastName,
        dob: args.dob,
        isIndividual: args.isIndividual,
        defaultAddress: args.defaultAddress,
        searchName,
        updatedAtISO: args.nowISO,
      });
      return args.id;
    }
    return await ctx.db.insert("peopleDirectory", {
      fullName: args.fullName,
      searchName,
      firstName: args.firstName,
      lastName: args.lastName,
      dob: args.dob,
      isIndividual: args.isIndividual,
      defaultAddress: args.defaultAddress,
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
