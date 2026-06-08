import assert from "node:assert/strict";

import { JURISDICTION_WORKSPACE_CONFIGS } from "../shared/jurisdictionWorkspace";
import { loadComplianceRulePacks } from "../src/lib/compliance/registry";
import type {
  ComplianceContextKind,
  ComplianceRule,
  ComplianceRulePack,
} from "../src/lib/compliance/rulePackSchema";

// Validates that each jurisdiction module in JURISDICTION_WORKSPACE_CONFIGS references real
// compliance packs for its own jurisdiction, and that a module which hosts extra-provincial
// registrants actually covers BOTH the `home` and `extra_provincial` paths — the "one
// province module serves both direct incorporation and extra-provincial registration"
// guarantee. See CONTRIBUTING.md → "Adding a jurisdiction or entity type".

const packs = loadComplianceRulePacks();
const packById = new Map<string, ComplianceRulePack>(packs.map((pack) => [pack.packId, pack]));

/** A rule covers a context if (non-deprecated) it lists that context, or lists none (= all). */
function ruleCoversContext(rule: ComplianceRule, context: ComplianceContextKind): boolean {
  if (rule.status === "deprecated") return false;
  const contexts = rule.appliesTo?.contextKinds;
  return !contexts || contexts.length === 0 || contexts.includes(context);
}

function moduleCoversContext(modulePacks: ComplianceRulePack[], context: ComplianceContextKind): boolean {
  return modulePacks.some((pack) => pack.rules.some((rule) => ruleCoversContext(rule, context)));
}

const problems: string[] = [];
const summary: string[] = [];

for (const config of JURISDICTION_WORKSPACE_CONFIGS) {
  const { code, module } = config;
  const modulePacks: ComplianceRulePack[] = [];

  for (const packId of module.compliancePackIds) {
    const pack = packById.get(packId);
    if (!pack) {
      problems.push(`${code}: references unknown compliance pack "${packId}"`);
      continue;
    }
    if (pack.jurisdictionCode !== code) {
      problems.push(
        `${code}: pack "${packId}" declares jurisdictionCode "${pack.jurisdictionCode}", expected "${code}"`,
      );
    }
    modulePacks.push(pack);
  }

  const coversHome = moduleCoversContext(modulePacks, "home");
  const coversExtra = moduleCoversContext(modulePacks, "extra_provincial");

  // Any module that owns packs must cover the home incorporation path.
  if (modulePacks.length > 0 && !coversHome) {
    problems.push(`${code}: has compliance packs but none cover the "home" context`);
  }

  // The both-paths guarantee: extra-provincial host modules must cover both contexts.
  if (module.supportsExtraProvincialRegistration && !coversExtra) {
    problems.push(
      `${code}: supportsExtraProvincialRegistration is true but no pack covers the "extra_provincial" context`,
    );
  }

  summary.push(
    `  ${code}: ${module.compliancePackIds.length} pack(s) · home=${coversHome ? "yes" : "no"} · ` +
      `extra_provincial=${coversExtra ? "yes" : "no"} · supportsExtraProvincial=${module.supportsExtraProvincialRegistration}`,
  );
}

console.log(`Checked ${JURISDICTION_WORKSPACE_CONFIGS.length} jurisdiction modules:`);
for (const line of summary) console.log(line);

if (problems.length > 0) {
  console.error("\nJurisdiction module checks FAILED:");
  for (const problem of problems) console.error(`  ✗ ${problem}`);
}

assert.equal(problems.length, 0, `${problems.length} jurisdiction module problem(s)`);
console.log("\nJurisdiction module checks passed.");
