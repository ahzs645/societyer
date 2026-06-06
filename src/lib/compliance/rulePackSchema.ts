import { z } from "zod";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const nonEmptyStringSchema = z.string().trim().min(1);

export const complianceRulePackStatusSchema = z.enum(["draft", "reviewed", "accepted", "deprecated"]);
export const complianceObligationScheduleKindSchema = z.enum(["annual", "offset", "window"]);
export const complianceContextKindSchema = z.enum(["home", "extra_provincial", "branch", "business_name"]);
export const complianceSourceKindSchema = z.enum([
  "statute",
  "regulation",
  "government_guidance",
  "form",
  "policy",
  "archive",
]);

export const complianceSourceSchema = z
  .object({
    sourceId: nonEmptyStringSchema,
    title: nonEmptyStringSchema,
    url: nonEmptyStringSchema,
    sourceKind: complianceSourceKindSchema,
    citation: nonEmptyStringSchema.optional(),
    retrievedAt: dateSchema,
    effectiveFrom: dateSchema.optional(),
    effectiveTo: dateSchema.optional(),
  })
  .strict();

export const complianceRuleAppliesToSchema = z
  .object({
    entityTypes: z.array(nonEmptyStringSchema).optional(),
    entitySubtypes: z.array(nonEmptyStringSchema).optional(),
    contextKinds: z.array(complianceContextKindSchema).optional(),
    homeJurisdictionCodes: z.array(nonEmptyStringSchema).optional(),
    registrationTypes: z.array(nonEmptyStringSchema).optional(),
    corporationClasses: z.array(nonEmptyStringSchema).optional(),
  })
  .strict();

export const complianceRuleAuthoritySchema = z
  .object({
    guidePackId: nonEmptyStringSchema,
    guideRuleIds: z.array(nonEmptyStringSchema).min(1),
    sourceIds: z.array(nonEmptyStringSchema).optional(),
    displayCitation: nonEmptyStringSchema,
  })
  .strict();

export const complianceRuleCreatesSchema = z
  .object({
    filingKind: nonEmptyStringSchema.optional(),
    requiredEvidence: z.array(nonEmptyStringSchema).default([]),
    checklist: z.array(nonEmptyStringSchema).default([]),
  })
  .strict();

const dateOffsetSchema = z
  .object({
    days: z.number().int().optional(),
    months: z.number().int().optional(),
    years: z.number().int().optional(),
  })
  .strict()
  .refine(
    (offset) => offset.days !== undefined || offset.months !== undefined || offset.years !== undefined,
    "At least one offset field is required",
  );

const annualScheduleSchema = z
  .object({
    kind: z.literal("annual"),
    anchorFact: nonEmptyStringSchema,
    dueOffset: dateOffsetSchema.default({ days: 0 }),
  })
  .strict();

const offsetScheduleSchema = z
  .object({
    kind: z.literal("offset"),
    anchorFact: nonEmptyStringSchema,
    dueOffset: dateOffsetSchema,
  })
  .strict();

const windowEndpointSchema = z
  .object({
    anchorFact: nonEmptyStringSchema,
    offset: dateOffsetSchema.default({ days: 0 }),
  })
  .strict();

const windowScheduleSchema = z
  .object({
    kind: z.literal("window"),
    recurrence: z.enum(["once", "annual"]).default("once"),
    opens: windowEndpointSchema,
    closes: windowEndpointSchema,
  })
  .strict();

export const complianceObligationScheduleSchema = z.discriminatedUnion("kind", [
  annualScheduleSchema,
  offsetScheduleSchema,
  windowScheduleSchema,
]);

export const complianceRuleSchema = z
  .object({
    ruleId: nonEmptyStringSchema,
    status: complianceRulePackStatusSchema,
    reviewedBy: nonEmptyStringSchema.optional(),
    reviewedAt: dateSchema.optional(),
    reviewNotes: nonEmptyStringSchema.optional(),
    acceptedBy: nonEmptyStringSchema.optional(),
    acceptedAt: dateSchema.optional(),
    approvalReference: nonEmptyStringSchema.optional(),
    title: nonEmptyStringSchema,
    summary: nonEmptyStringSchema,
    obligationKey: nonEmptyStringSchema,
    appliesTo: complianceRuleAppliesToSchema.optional(),
    schedule: complianceObligationScheduleSchema,
    authority: complianceRuleAuthoritySchema,
    creates: complianceRuleCreatesSchema.optional(),
    caveat: nonEmptyStringSchema.optional(),
  })
  .strict();

export const complianceRulePackSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    packId: nonEmptyStringSchema,
    status: complianceRulePackStatusSchema,
    version: nonEmptyStringSchema,
    reviewedAt: dateSchema,
    jurisdictionCode: nonEmptyStringSchema,
    entityTypes: z.array(nonEmptyStringSchema).min(1),
    title: nonEmptyStringSchema,
    description: nonEmptyStringSchema,
    sourceGuidePackId: nonEmptyStringSchema,
    sources: z.array(complianceSourceSchema).default([]),
    rules: z.array(complianceRuleSchema).min(1),
  })
  .strict()
  .superRefine((pack, ctx) => {
    const ruleIds = new Set<string>();
    for (const rule of pack.rules) {
      if (ruleIds.has(rule.ruleId)) {
        ctx.addIssue({
          code: "custom",
          path: ["rules", rule.ruleId],
          message: "Duplicate ruleId in pack",
        });
      }
      ruleIds.add(rule.ruleId);
      if (rule.authority.guidePackId !== pack.sourceGuidePackId) {
        ctx.addIssue({
          code: "custom",
          path: ["rules", rule.ruleId, "authority", "guidePackId"],
          message: "Rule authority guidePackId must match sourceGuidePackId",
        });
      }
      const packSourceIds = new Set(pack.sources.map((source) => source.sourceId));
      if (rule.status !== "deprecated" && !rule.appliesTo) {
        ctx.addIssue({
          code: "custom",
          path: ["rules", rule.ruleId, "appliesTo"],
          message: "Non-deprecated rules must declare appliesTo",
        });
      }
      if (rule.status !== "deprecated" && !(rule.authority.sourceIds ?? []).length) {
        ctx.addIssue({
          code: "custom",
          path: ["rules", rule.ruleId, "authority", "sourceIds"],
          message: "Non-deprecated rules must cite at least one sourceId",
        });
      }
      if ((rule.status === "reviewed" || rule.status === "accepted") && (!rule.reviewedBy || !rule.reviewedAt)) {
        ctx.addIssue({
          code: "custom",
          path: ["rules", rule.ruleId],
          message: "Reviewed and accepted rules must include reviewedBy and reviewedAt",
        });
      }
      if (rule.status === "accepted" && (!rule.acceptedBy || !rule.acceptedAt || !rule.approvalReference)) {
        ctx.addIssue({
          code: "custom",
          path: ["rules", rule.ruleId],
          message: "Accepted rules must include acceptedBy, acceptedAt, and approvalReference",
        });
      }
      for (const sourceId of rule.authority.sourceIds ?? []) {
        if (!packSourceIds.has(sourceId)) {
          ctx.addIssue({
            code: "custom",
            path: ["rules", rule.ruleId, "authority", "sourceIds"],
            message: `Rule authority sourceId ${sourceId} must exist in pack sources`,
          });
        }
      }
    }
  });

export const complianceRulePacksSchema = z.array(complianceRulePackSchema).superRefine((packs, ctx) => {
  const packIds = new Set<string>();
  const ruleIds = new Set<string>();
  for (const pack of packs) {
    if (packIds.has(pack.packId)) {
      ctx.addIssue({ code: "custom", path: [pack.packId], message: "Duplicate packId" });
    }
    packIds.add(pack.packId);
    for (const rule of pack.rules) {
      if (ruleIds.has(rule.ruleId)) {
        ctx.addIssue({
          code: "custom",
          path: [pack.packId, rule.ruleId],
          message: "Duplicate ruleId across compliance packs",
        });
      }
      ruleIds.add(rule.ruleId);
    }
  }
});

export type ComplianceRulePack = z.infer<typeof complianceRulePackSchema>;
export type ComplianceRule = z.infer<typeof complianceRuleSchema>;
export type ComplianceRuleCreates = z.infer<typeof complianceRuleCreatesSchema>;
export type ComplianceObligationSchedule = z.infer<typeof complianceObligationScheduleSchema>;
export type ComplianceDateOffset = z.infer<typeof dateOffsetSchema>;
export type ComplianceContextKind = z.infer<typeof complianceContextKindSchema>;
export type ComplianceSource = z.infer<typeof complianceSourceSchema>;
