import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  inspectionsList,
  inspectionsForDocument,
  inspectionCreate,
  inspectionRemove,
} from "../shared/functions/inspections";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = authorizedQuery("inspections:list", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => inspectionsList(await toPortableQueryCtx(ctx), args),
});

export const forDocument = authorizedQuery("inspections:forDocument", query)({
  args: { documentId: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, args) => inspectionsForDocument(await toPortableQueryCtx(ctx), args),
});

export const create = authorizedMutation("inspections:create", mutation)({
  args: {
    societyId: v.id("societies"),
    documentId: v.optional(v.id("documents")),
    inspectorName: v.string(),
    isMember: v.boolean(),
    recordsRequested: v.string(),
    inspectedAtISO: v.string(),
    feeCents: v.optional(v.number()),
    copyPages: v.optional(v.number()),
    copyFeeCents: v.optional(v.number()),
    deliveryMethod: v.string(),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => inspectionCreate(await toPortableMutationCtx(ctx), args),
});

export const remove = authorizedMutation("inspections:remove", mutation)({
  args: { id: v.id("inspections") },
  returns: v.any(),
  handler: async (ctx, args) => inspectionRemove(await toPortableMutationCtx(ctx), args),
});
