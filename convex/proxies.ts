import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  proxiesList,
  proxiesForMeeting,
  proxyCreate,
  proxyUpdate,
  proxyRevoke,
  proxyRemove,
} from "../shared/functions/proxies";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => proxiesList(toPortableQueryCtx(ctx), args),
});

export const forMeeting = query({
  args: { meetingId: v.id("meetings") },
  returns: v.any(),
  handler: (ctx, args) => proxiesForMeeting(toPortableQueryCtx(ctx), args),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    grantorName: v.string(),
    grantorMemberId: v.optional(v.id("members")),
    proxyHolderName: v.string(),
    proxyHolderMemberId: v.optional(v.id("members")),
    instructions: v.optional(v.string()),
    signedAtISO: v.string(),
  },
  returns: v.any(),
  handler: (ctx, args) => proxyCreate(toPortableMutationCtx(ctx), args),
});

export const update = mutation({
  args: {
    id: v.id("proxies"),
    patch: v.object({
      grantorName: v.optional(v.string()),
      proxyHolderName: v.optional(v.string()),
      instructions: v.optional(v.string()),
      signedAtISO: v.optional(v.string()),
    }),
  },
  returns: v.any(),
  handler: (ctx, args) => proxyUpdate(toPortableMutationCtx(ctx), args),
});

export const revoke = mutation({
  args: { id: v.id("proxies") },
  returns: v.any(),
  handler: (ctx, args) => proxyRevoke(toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("proxies") },
  returns: v.any(),
  handler: (ctx, args) => proxyRemove(toPortableMutationCtx(ctx), args),
});
