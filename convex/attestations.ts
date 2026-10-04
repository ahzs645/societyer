import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  attestationsListPortable,
  attestationsForDirectorPortable,
  attestationSignPortable,
  attestationRemovePortable,
  attestationsMissingForYearPortable,
} from "../shared/functions/attestations";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = authorizedQuery("attestations:list", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => attestationsListPortable(await toPortableQueryCtx(ctx), args),
});

export const forDirector = authorizedQuery("attestations:forDirector", query)({
  args: { directorId: v.id("directors") },
  returns: v.any(),
  handler: async (ctx, args) => attestationsForDirectorPortable(await toPortableQueryCtx(ctx), args),
});

export const sign = authorizedMutation("attestations:sign", mutation)({
  args: {
    societyId: v.id("societies"),
    directorId: v.id("directors"),
    year: v.number(),
    isAtLeast18: v.boolean(),
    notBankrupt: v.boolean(),
    notDisqualified: v.boolean(),
    stillResidentOrEligible: v.boolean(),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => attestationSignPortable(await toPortableMutationCtx(ctx), args),
});

export const remove = authorizedMutation("attestations:remove", mutation)({
  args: { id: v.id("directorAttestations") },
  returns: v.any(),
  handler: async (ctx, args) => attestationRemovePortable(await toPortableMutationCtx(ctx), args),
});

/** Returns directors who haven't attested for the current year. */
export const missingForYear = authorizedQuery("attestations:missingForYear", query)({
  args: { societyId: v.id("societies"), year: v.number() },
  returns: v.any(),
  handler: async (ctx, args) => attestationsMissingForYearPortable(await toPortableQueryCtx(ctx), args),
});
