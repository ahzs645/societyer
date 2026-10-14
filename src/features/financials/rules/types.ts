import type { RuleActions, RuleCondition, RuleCoverage, StarterRuleSuggestion } from "../../../../shared/transactionRules";

export type RuleTransactionRow = {
  _id: string;
  date: string;
  description: string;
  counterparty?: string;
  amountCents: number;
  accountId?: string;
  category?: string;
  categorizedBy?: string;
  ruleId?: string;
};

export type RuleRow = {
  _id: string;
  /** Always set: the typed name, or the generated one when `autoNamed`. */
  name: string;
  /** Nobody typed a name; the editor leaves the name field blank. */
  autoNamed?: boolean;
  priority: number;
  enabled: boolean;
  conditions: RuleCondition[];
  actions: RuleActions;
  matchCount: number;
  pendingCount: number;
  appliedCount: number;
  lastAppliedAtISO?: string;
  /** Overlap with higher rules (see `ruleCoverage`). */
  coverage?: RuleCoverage;
  /** Why the rule can't run, e.g. "the account was removed"; empty when fine. */
  problems?: string[];
};

/** Result of `transactionRules:applyToUncategorized`. */
export type ApplyRulesResult = {
  batchId: string;
  applied: number;
  byRule: { ruleId: string; name: string; count: number }[];
  /** Rules passed over because they need attention. */
  skippedRules?: { name: string; problem: string }[];
};

/** Shape returned by `transactionRules:workspace`. */
export type RulesWorkspace = {
  rules: RuleRow[];
  transactions: RuleTransactionRow[];
  uncategorizedCount: number;
  pendingMatches: number;
  invalidRuleCount?: number;
  categories: string[];
  accounts: { _id: string; name: string; code?: string; accountType?: string; isRestricted?: boolean }[];
  fundRestrictions: { _id: string; name: string; purpose?: string }[];
  archivedFunds?: { _id: string; name: string }[];
  suggestions: StarterRuleSuggestion[];
};
