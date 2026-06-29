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

export const list = query({
  args: {},
  returns: v.any(),
  handler: (ctx) => listPortable(toPortableQueryCtx(ctx)),
});

export const searchByPrefix = query({
  args: { prefix: v.string(), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: (ctx, args) => searchByPrefixPortable(toPortableQueryCtx(ctx), args),
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
  handler: (ctx, args) => upsertPortable(toPortableMutationCtx(ctx), args),
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
  handler: (ctx, args) => addToSocietyPortable(toPortableMutationCtx(ctx), args),
});

export const duplicates = query({
  args: {},
  returns: v.any(),
  handler: (ctx) => duplicatesPortable(toPortableQueryCtx(ctx)),
});
