import { existsSync, readFileSync } from "node:fs";
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
    file: "src/pages/Tasks.tsx",
    patterns: ["openEdit", "completionNote", "filingId", "workflowId", "documentId", "eventId"],
  },
  {
    file: "src/main.tsx",
    patterns: ["minute-book", "policies", "workflow-packages", "organization-details"],
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

if (failures.length) {
  console.error("Org detail smoke checks failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Org detail smoke checks passed.");
