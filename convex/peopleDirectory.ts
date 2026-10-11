import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  listPortable,
  searchByPrefixPortable,
  upsertPortable,
  addToSocietyPortable,
  duplicatesPortable,
} from "../shared/functions/peopleDirectory";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = authorizedQuery("peopleDirectory:list", query)({
  args: { societyId: v.optional(v.id("societies")) },
  returns: v.any(),
  handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx), args),
});

export const searchByPrefix = authorizedQuery("peopleDirectory:searchByPrefix", query)({
  args: { societyId: v.optional(v.id("societies")), prefix: v.string(), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, args) => searchByPrefixPortable(await toPortableQueryCtx(ctx), args),
});

export const upsert = authorizedMutation("peopleDirectory:upsert", mutation)({
  args: {
    societyId: v.optional(v.id("societies")),
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
  handler: async (ctx, args) => upsertPortable(await toPortableMutationCtx(ctx), args),
});

// Materialize a directory person onto a society as a role holder (YCN
// Name_Add_From_GLOB_PEOPLE_DIRECTORY): copies identity fields and links back to
// the directory record via roleHolders.directoryPersonId.
export const addToSociety = authorizedMutation("peopleDirectory:addToSociety", mutation)({
  args: {
    directoryPersonId: v.id("peopleDirectory"),
    societyId: v.id("societies"),
    roleType: v.string(),
    startDate: v.optional(v.string()),
    position: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    sourceReference: v.optional(v.string()),
    nowISO: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => addToSocietyPortable(await toPortableMutationCtx(ctx), args),
});

export const duplicates = authorizedQuery("peopleDirectory:duplicates", query)({
  args: { societyId: v.optional(v.id("societies")) },
  returns: v.any(),
  handler: async (ctx, args) => duplicatesPortable(await toPortableQueryCtx(ctx), args),
});
