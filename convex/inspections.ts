import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  inspectionsList,
  inspectionsForDocument,
  inspectionCreate,
  inspectionRemove,
} from "../shared/functions/inspections";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => inspectionsList(toPortableQueryCtx(ctx), args),
});

export const forDocument = query({
  args: { documentId: v.id("documents") },
  returns: v.any(),
  handler: (ctx, args) => inspectionsForDocument(toPortableQueryCtx(ctx), args),
});

export const create = mutation({
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
  handler: (ctx, args) => inspectionCreate(toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("inspections") },
  returns: v.any(),
  handler: (ctx, args) => inspectionRemove(toPortableMutationCtx(ctx), args),
});
