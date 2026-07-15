// @ts-nocheck — Convex type generation hits TS recursion limit on schemas with 50+ tables.
// The code is correct; the schema is just too large for TS inference. Track upstream:
// https://github.com/get-convex/convex-backend/issues
import { query } from "./_generated/server";
import { v } from "convex/values";
import {
  getSocietyBySlugPortable,
  volunteerIntakeContextPortable,
  grantIntakeContextPortable,
} from "../shared/functions/publicPortal";
import { toPortableQueryCtx } from "./lib/portable";

export const getSocietyBySlug = query({
  args: { slug: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => getSocietyBySlugPortable(await toPortableQueryCtx(ctx), args),
});

export const volunteerIntakeContext = query({
  args: { slug: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => volunteerIntakeContextPortable(await toPortableQueryCtx(ctx), args),
});

export const grantIntakeContext = query({
  args: { slug: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => grantIntakeContextPortable(await toPortableQueryCtx(ctx), args),
});
