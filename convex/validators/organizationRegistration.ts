import { v } from "convex/values";

/**
 * Registry facts on an `organizationRegistrations` row. The table definition
 * and the mutation arguments share these validators.
 */
export const registrationAttorneyStatusValidator = v.union(
  v.literal("required"),
  v.literal("not_required"),
  v.literal("appointed"),
);

/** One person who holds registry portal access (Online Filing Centre, BC Registry). */
export const registrationPortalAccessValidator = v.object({
  name: v.string(),
  role: v.optional(v.string()),
  updatedAtISO: v.optional(v.string()),
  notes: v.optional(v.string()),
});
