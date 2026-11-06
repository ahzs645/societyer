import { v } from "convex/values";
import { NAICS_CANADA_SECTORS, NAICS_CANADA_VERSION } from "../../shared/naicsCanada2022";

export const naicsSectorValidator = v.optional(v.union(v.null(), v.object({
  code: v.union(...NAICS_CANADA_SECTORS.map((sector) => v.literal(sector.code))),
  version: v.literal(NAICS_CANADA_VERSION),
})));
