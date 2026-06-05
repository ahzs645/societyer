import { z } from "zod";

export const legalGuideTopicSchema = z.enum([
  "bylaw_requirements",
  "bylaw_effective_date",
  "general_meeting_notice",
  "agm_timing",
  "annual_report",
  "member_proposals",
  "requisitioned_meetings",
  "quorum",
  "electronic_participation",
  "proxy_voting",
  "special_resolution",
  "records",
  "model_bylaws_quorum",
  "model_bylaws_proxy",
  "directors_quorum",
]);

export const legalGuideRuleKindSchema = z.enum([
  "statutory_minimum",
  "default_rule",
  "model_bylaw",
  "historical_caveat",
  "registry_requirement",
  "policy_guidance",
  "procedural_rule",
  "definition",
  "transitional_rule",
]);

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const httpUrlSchema = z.string().url().regex(/^https?:\/\//, "Expected HTTP(S) URL");
const nonEmptyStringSchema = z.string().trim().min(1);

export const jurisdictionGuideSourceSchema = z
  .object({
    sourceId: nonEmptyStringSchema,
    type: z.enum(["statute", "regulation", "policy", "registry_guidance", "model_bylaw", "archive", "other"]),
    title: nonEmptyStringSchema,
    citation: nonEmptyStringSchema.optional(),
    publisher: nonEmptyStringSchema,
    canonicalUrl: httpUrlSchema,
    pointInTimeUrl: httpUrlSchema.optional(),
    retrievedAt: dateSchema,
    currentTo: dateSchema.optional(),
    language: nonEmptyStringSchema.default("en-CA"),
  })
  .strict();

const authoritySectionSchema = z
  .object({
    label: nonEmptyStringSchema,
    locator: nonEmptyStringSchema.optional(),
    citation: nonEmptyStringSchema,
    url: httpUrlSchema,
    pointInTimeUrl: httpUrlSchema.optional(),
  })
  .strict();

const ruleParameterSchema = z
  .object({
    key: nonEmptyStringSchema,
    type: z.enum(["integer", "number", "boolean", "string", "date", "duration"]),
    value: z.union([z.string(), z.number(), z.boolean()]),
    unit: nonEmptyStringSchema.optional(),
    operator: z.enum([">", ">=", "<", "<=", "=", "!="]).optional(),
  })
  .strict();

export const jurisdictionGuideRuleSchema = z
  .object({
    ruleId: nonEmptyStringSchema,
    stableKey: nonEmptyStringSchema,
    status: z.enum(["draft", "reviewed", "accepted", "deprecated", "historical"]),
    ruleType: legalGuideRuleKindSchema,
    topics: z.array(legalGuideTopicSchema).min(1),
    applicability: z
      .object({
        jurisdictionCode: nonEmptyStringSchema,
        entityTypes: z.array(nonEmptyStringSchema).min(1),
        conditions: z.array(nonEmptyStringSchema).default([]),
      })
      .strict(),
    validity: z
      .object({
        effectiveFrom: dateSchema,
        effectiveTo: dateSchema.nullable().optional(),
      })
      .strict()
      .refine(
        (validity) =>
          !validity.effectiveTo ||
          Date.parse(validity.effectiveTo) > Date.parse(validity.effectiveFrom),
        "effectiveTo must be after effectiveFrom",
      ),
    authority: z
      .object({
        sourceId: nonEmptyStringSchema,
        instrument: nonEmptyStringSchema,
        sections: z.array(authoritySectionSchema).min(1),
      })
      .strict(),
    provenance: z
      .object({
        sourceCurrentTo: dateSchema.optional(),
        retrievedAt: dateSchema.optional(),
        verifiedAt: dateSchema,
        verificationMethod: z.enum(["manual_review", "official_source_review", "automated_source_check"]),
        confidence: z.enum(["low", "medium", "high"]).optional(),
        changeNote: nonEmptyStringSchema.optional(),
        sourceChecksum: nonEmptyStringSchema.optional(),
        sourceSnapshotId: nonEmptyStringSchema.optional(),
      })
      .strict(),
    content: z
      .object({
        summary: nonEmptyStringSchema,
        tooltip: nonEmptyStringSchema,
        caveat: nonEmptyStringSchema.optional(),
        displayCitation: nonEmptyStringSchema,
      })
      .strict(),
    parameters: z.array(ruleParameterSchema).optional(),
    supersedes: z.array(nonEmptyStringSchema).optional(),
    supersededBy: z.array(nonEmptyStringSchema).optional(),
    priority: z.number().optional(),
  })
  .strict();

export const jurisdictionGuidePackSchema = z
  .object({
    schemaVersion: z.literal("2.0.0"),
    packId: nonEmptyStringSchema,
    status: z.enum(["draft", "reviewed", "accepted", "deprecated"]),
    version: nonEmptyStringSchema,
    reviewedAt: dateSchema,
    maintainers: z
      .array(
        z
          .object({
            name: nonEmptyStringSchema,
            role: nonEmptyStringSchema,
            contact: nonEmptyStringSchema.optional(),
          })
          .strict(),
      )
      .min(1),
    legalDisclaimer: nonEmptyStringSchema,
    jurisdiction: z
      .object({
        code: nonEmptyStringSchema,
        countryCode: nonEmptyStringSchema,
        subdivisionCode: nonEmptyStringSchema.optional(),
        name: nonEmptyStringSchema,
      })
      .strict(),
    entityTypes: z.array(nonEmptyStringSchema).min(1),
    title: nonEmptyStringSchema,
    description: nonEmptyStringSchema,
    defaultForJurisdiction: z.boolean().default(false),
    sources: z.array(jurisdictionGuideSourceSchema).min(1),
    rules: z.array(jurisdictionGuideRuleSchema),
  })
  .strict()
  .superRefine((pack, ctx) => {
    const sourceIds = new Set(pack.sources.map((source) => source.sourceId));
    const ruleIds = new Set<string>();
    for (const rule of pack.rules) {
      if (rule.applicability.jurisdictionCode !== pack.jurisdiction.code) {
        ctx.addIssue({
          code: "custom",
          path: ["rules", rule.ruleId, "applicability", "jurisdictionCode"],
          message: "Rule jurisdiction must match pack jurisdiction",
        });
      }
      if (!sourceIds.has(rule.authority.sourceId)) {
        ctx.addIssue({
          code: "custom",
          path: ["rules", rule.ruleId, "authority", "sourceId"],
          message: "Rule authority sourceId must refer to a pack source",
        });
      }
      if (ruleIds.has(rule.ruleId)) {
        ctx.addIssue({
          code: "custom",
          path: ["rules", rule.ruleId],
          message: "Duplicate ruleId in pack",
        });
      }
      ruleIds.add(rule.ruleId);
    }
  });

export const jurisdictionGuidePacksSchema = z
  .array(jurisdictionGuidePackSchema)
  .superRefine((packs, ctx) => {
    const packIds = new Set<string>();
    const jurisdictionCodes = new Set<string>();
    const ruleIds = new Set<string>();
    let defaultCount = 0;
    for (const pack of packs) {
      if (pack.defaultForJurisdiction) defaultCount += 1;
      if (packIds.has(pack.packId)) {
        ctx.addIssue({ code: "custom", path: [pack.packId], message: "Duplicate packId" });
      }
      packIds.add(pack.packId);
      if (jurisdictionCodes.has(pack.jurisdiction.code)) {
        ctx.addIssue({
          code: "custom",
          path: [pack.jurisdiction.code],
          message: "Duplicate jurisdiction code",
        });
      }
      jurisdictionCodes.add(pack.jurisdiction.code);
      for (const rule of pack.rules) {
        if (ruleIds.has(rule.ruleId)) {
          ctx.addIssue({
            code: "custom",
            path: [pack.packId, rule.ruleId],
            message: "Duplicate ruleId across packs",
          });
        }
        ruleIds.add(rule.ruleId);
      }
    }
    if (defaultCount > 1) {
      ctx.addIssue({ code: "custom", message: "At most one jurisdiction guide pack can be default" });
    }
  });

export type JurisdictionGuidePackV2 = z.infer<typeof jurisdictionGuidePackSchema>;
export type JurisdictionGuideRuleV2 = z.infer<typeof jurisdictionGuideRuleSchema>;
