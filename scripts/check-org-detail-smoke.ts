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
    ],
  },
  {
    file: "convex/organizationDetails.ts",
    patterns: [
      "backfillFromExistingRecords",
      "minuteBookRecordTypeForDocument",
      "Backfilled from existing document category/tags.",
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
    ],
  },
  {
    file: "src/pages/OrganizationDetails.tsx",
    patterns: ["backfillFromExistingRecords", "Backfill records"],
  },
  {
    file: "src/pages/MinuteBook.tsx",
    patterns: ["Completeness checks", "openCheckCount"],
  },
  {
    file: "src/pages/Policies.tsx",
    patterns: ["LifecycleBadges", "Review task", "Signer task", "Publish draft"],
  },
  {
    file: "src/pages/WorkflowPackages.tsx",
    patterns: ["PackageLifecycle", "Package task", "Package marked filed"],
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
