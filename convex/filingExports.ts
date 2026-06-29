// @ts-nocheck
import { query } from "./_generated/server";
import { v } from "convex/values";
import {
  societiesOnlinePreFillPortable,
  craPreFillPortable,
} from "../shared/functions/filingExports";
import { toPortableQueryCtx } from "./lib/portable";

/**
 * Returns JSON payloads matching the field shape of Societies Online filing
 * forms, derived from current data. The user copies values into the online
 * form; a future "FilingBot" can submit them directly.
 */
export const societiesOnlinePreFill = query({
  args: { societyId: v.id("societies"), kind: v.string() },
  returns: v.any(),
  handler: (ctx, args) => societiesOnlinePreFillPortable(toPortableQueryCtx(ctx), args),
});

/** CRA form pre-fill summary. We surface the line numbers + totals we can
 * compute; the PDF form itself is filed by the user. */
export const craPreFill = query({
  args: { societyId: v.id("societies"), kind: v.string(), fiscalYear: v.string() },
  returns: v.any(),
  handler: (ctx, args) => craPreFillPortable(toPortableQueryCtx(ctx), args),
});
