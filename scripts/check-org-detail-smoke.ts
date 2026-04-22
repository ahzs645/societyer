import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const checks: Array<{ file: string; patterns: Array<string | RegExp> }> = [
  {
    file: "convex/schema.ts",
    patterns: [
      "organizationAddresses: defineTable",
      "organizationRegistrations: defineTable",
      "organizationIdentifiers: defineTable",
      "policies: defineTable",
      "workflowPackages: defineTable",
      "minuteBookItems: defineTable",
      "roleHolders: defineTable",
      "rightsClasses: defineTable",
      "rightsholdingTransfers: defineTable",
      "legalTemplates: defineTable",
      "legalPrecedents: defineTable",
      "generatedLegalDocuments: defineTable",
      "formationRecords: defineTable",
      "annualMaintenanceRecords: defineTable",
      "jurisdictionMetadata: defineTable",
      "supportLogs: defineTable",
      "filingId: v.optional(v.id(\"filings\"))",
      "completionNote: v.optional(v.string())",
    ],
  },
  {
    file: "convex/importSessions.ts",
    patterns: [
      "\"organizationAddress\"",
      "\"organizationRegistration\"",
      "\"organizationIdentifier\"",
      "\"policy\"",
      "\"workflowPackage\"",
      "\"minuteBookItem\"",
      "\"roleHolder\"",
      "\"rightsClass\"",
      "\"legalTemplate\"",
      "\"generatedLegalDocument\"",
      "\"formationRecord\"",
      "\"annualMaintenanceRecord\"",
      "\"jurisdictionMetadata\"",
      "\"supportLog\"",
      "importPromotionIssues",
      "patchRecordPromotionBlocked",
      "Promotion blocked:",
      "invalidOptionIssue",
      "invalidOptionListIssues",
    ],
  },
  {
    file: "convex/lib/orgHubOptions.ts",
    patterns: [
      "SOURCE_OPTION_VALUES",
      "assertAllowedOption",
      "invalidOptionIssue",
      "invalidOptionListIssues",
      "entityJurisdictions",
      "actsFormedUnder",
      "documentTags",
      "requiredSigners",
      "companyKeyTypes",
      "officerTitles",
      "rightsClassTypes",
      "templateTypes",
      "formationStatuses",
      "annualFinancialStatementOptions",
      "logTypes",
    ],
  },
  {
    file: "convex/legalOperations.ts",
    patterns: [
      "listRoleHolders",
      "rightsLedger",
      "templateEngine",
      "formationMaintenance",
      "upsertRoleHolder",
      "upsertRightsClass",
      "upsertLegalTemplate",
      "upsertGeneratedLegalDocument",
      "upsertFormationRecord",
      "upsertAnnualMaintenanceRecord",
      "upsertJurisdictionMetadata",
      "upsertSupportLog",
      "seedStarterPolicyTemplates",
      "STARTER_POLICY_TEMPLATES",
    ],
  },
  {
    file: "convex/starterPolicyTemplates.ts",
    patterns: [
      "STARTER_POLICY_TEMPLATES",
      "Authorization Policy",
      "Donation Recording and Receipting Policy",
      "Meeting Minutes Examples and Drafting Guide",
      "starterTemplateExactText",
      "starterTemplateStructuredHtml",
      "starterTemplateHtml",
      "starterTemplateMarker",
    ],
  },
  {
    file: "convex/starterPolicyTemplateSourceTexts.ts",
    patterns: [
      "STARTER_POLICY_TEMPLATE_SOURCE_TEXTS",
      "authorization-policy",
      "Policy Name:",
    ],
  },
  {
    file: "scripts/generate-starter-template-json.ts",
    patterns: [
      "STARTER_POLICY_TEMPLATES",
      "pdftotext",
      "utf8-normalized-ascii",
      "starterPolicyTemplateSourceTexts.ts",
      "exactTemplate",
      "exact_text_from_source_pdf_extraction",
      "sampleData",
      "renderedSample",
      "compareExactTemplateText",
      "convex/data/starterPolicyTemplates",
    ],
  },
  {
    file: "scripts/render-starter-template-documents.ts",
    patterns: [
      "exactSourceTextToHtml",
      "sourceTextToBlocks",
      "writeDocx",
      "writePdf",
      "comparison-report.md",
      "data/starter-template-exports",
    ],
  },
  {
    file: "scripts/starter-template-rendering.ts",
    patterns: [
      "starterSampleData",
      "exactSourceTextToHtml",
      "renderExactSourceSampleText",
      "renderStarterTemplateSampleHtml",
      "compareExactTemplateText",
      "compareTemplateText",
      "Dummy data for export preview",
    ],
  },
  {
    file: "convex/organizationDetails.ts",
    patterns: [
      "backfillFromExistingRecords",
      "minuteBookRecordTypeForDocument",
      "Backfilled from existing document category/tags.",
      "assertAllowedOption(\"addressTypes\"",
      "assertAllowedOption(\"taxNumberTypes\"",
    ],
  },
  {
    file: "convex/minuteBook.ts",
    patterns: [
      "minuteBookChecks",
      "missing_core_documents",
      "missing_signatures",
      "open_filings",
      "unresolved_resolutions",
      "paper_archive_gap",
      "assertAllowedOption(\"minuteBookRecordTypes\"",
    ],
  },
  {
    file: "convex/policies.ts",
    patterns: [
      "policyLifecycle",
      "createReviewTask",
      "createRequiredSignerTask",
      "createTransparencyDraft",
      "pipaTrainings",
      "documentVersions",
      "invalidOptionListIssues(\"requiredSigners\"",
      "assertAllowedOption(\"policyStatuses\"",
    ],
  },
  {
    file: "convex/workflowPackages.ts",
    patterns: [
      "packageLifecycle",
      "createFollowUpTask",
      "markFiled",
      "signerState",
      "paymentState",
      "openTaskCount",
      "assertAllowedOption(\"eventTypes\"",
    ],
  },
  {
    file: "src/lib/orgHubOptions.ts",
    patterns: [
      "ORG_HUB_OPTION_SETS",
      "entityJurisdictions",
      "actsFormedUnder",
      "documentTags",
      "requiredSigners",
      "optionLabel",
      "rightsClassTypes",
      "templateTypes",
      "formationStatuses",
      "logTypes",
    ],
  },
  {
    file: "src/components/OptionSelect.tsx",
    patterns: ["OptionSelect", "OptionMultiSelect", "optionChoices"],
  },
  {
    file: "src/pages/OrganizationDetails.tsx",
    patterns: ["backfillFromExistingRecords", "Backfill records", "OptionSelect", "optionLabel(\"addressTypes\""],
  },
  {
    file: "src/pages/MinuteBook.tsx",
    patterns: ["Completeness checks", "openCheckCount", "OptionSelect", "optionLabel(\"minuteBookRecordTypes\""],
  },
  {
    file: "src/pages/Policies.tsx",
    patterns: ["LifecycleBadges", "Review task", "Signer task", "Publish draft", "OptionMultiSelect", "optionLabel(\"requiredSigners\""],
  },
  {
    file: "src/pages/WorkflowPackages.tsx",
    patterns: ["PackageLifecycle", "Package task", "Package marked filed", "OptionSelect", "optionLabel(\"eventTypes\""],
  },
  {
    file: "src/pages/LegalOperations.tsx",
    patterns: [
      "RoleHoldersPage",
      "RightsLedgerPage",
      "TemplateEnginePage",
      "FormationMaintenancePage",
      "OptionMultiSelect",
      "Starter templates",
      "jurisdictionByCode",
      "optionLabel(\"logTypes\"",
    ],
  },
  {
    file: "src/pages/Tasks.tsx",
    patterns: ["openEdit", "completionNote", "filingId", "workflowId", "documentId", "eventId"],
  },
  {
    file: "src/main.tsx",
    patterns: ["minute-book", "policies", "workflow-packages", "organization-details", "role-holders", "rights-ledger", "template-engine", "formation-maintenance"],
  },
];

const failures: string[] = [];

for (const check of checks) {
  const path = join(root, check.file);
  if (!existsSync(path)) {
    failures.push(`${check.file}: missing file`);
    continue;
  }
  const contents = readFileSync(path, "utf8");
  for (const pattern of check.patterns) {
    const ok = typeof pattern === "string" ? contents.includes(pattern) : pattern.test(contents);
    if (!ok) failures.push(`${check.file}: missing ${String(pattern)}`);
  }
}

const starterJsonDir = join(root, "convex/data/starterPolicyTemplates");
if (!existsSync(starterJsonDir)) {
  failures.push("convex/data/starterPolicyTemplates: missing directory");
} else {
  const jsonFiles = readdirSync(starterJsonDir).filter((file) => file.endsWith(".json")).sort();
  if (jsonFiles.length !== 18) failures.push(`convex/data/starterPolicyTemplates: expected 18 json files, found ${jsonFiles.length}`);
  for (const file of jsonFiles) {
    const path = join(starterJsonDir, file);
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      if (!parsed.key) failures.push(`${file}: missing key`);
      if (!parsed.source?.sha256) failures.push(`${file}: missing source.sha256`);
      if (!parsed.extraction?.text) failures.push(`${file}: missing extraction.text`);
      if (!parsed.sampleData?.values?.CorporationName) failures.push(`${file}: missing sampleData.values.CorporationName`);
      if (!parsed.exactTemplate?.text) failures.push(`${file}: missing exactTemplate.text`);
      if (parsed.exactTemplate?.text !== parsed.extraction?.text) failures.push(`${file}: exactTemplate.text does not match extraction.text`);
      if (!parsed.renderedSample?.text) failures.push(`${file}: missing renderedSample.text`);
      if (!parsed.comparison?.status) failures.push(`${file}: missing comparison.status`);
      if (parsed.comparison?.status !== "exact_text_match") failures.push(`${file}: expected exact_text_match, found ${parsed.comparison?.status}`);
      if (!parsed.remadeTemplate?.html) failures.push(`${file}: missing remadeTemplate.html`);
      if (!parsed.remadeTemplate?.text) failures.push(`${file}: missing remadeTemplate.text`);
      if (!parsed.structuredSummaryTemplate?.html) failures.push(`${file}: missing structuredSummaryTemplate.html`);
    } catch (error) {
      failures.push(`${file}: invalid JSON`);
    }
  }
}

if (failures.length) {
  console.error("Org detail smoke checks failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Org detail smoke checks passed.");
