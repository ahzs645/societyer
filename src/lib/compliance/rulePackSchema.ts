import { z } from "zod";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const nonEmptyStringSchema = z.string().trim().min(1);

export const complianceRulePackStatusSchema = z.enum(["draft", "reviewed", "accepted", "deprecated"]);
export const complianceObligationScheduleKindSchema = z.enum(["annual", "offset", "window"]);

export const complianceRuleAuthoritySchema = z
  .object({
    guidePackId: nonEmptyStringSchema,
    guideRuleIds: z.array(nonEmptyStringSchema).min(1),
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
    title: nonEmptyStringSchema,
    summary: nonEmptyStringSchema,
    obligationKey: nonEmptyStringSchema,
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
