import type { RuleActions, RuleCondition, StarterRuleSuggestion } from "../../../../shared/transactionRules";

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
  name: string;
  priority: number;
  enabled: boolean;
  conditions: RuleCondition[];
  actions: RuleActions;
  matchCount: number;
  pendingCount: number;
  appliedCount: number;
  lastAppliedAtISO?: string;
};

/** Shape returned by `transactionRules:workspace`. */
export type RulesWorkspace = {
  rules: RuleRow[];
  transactions: RuleTransactionRow[];
  uncategorizedCount: number;
  pendingMatches: number;
  categories: string[];
  accounts: { _id: string; name: string; code?: string; accountType?: string; isRestricted?: boolean }[];
  fundRestrictions: { _id: string; name: string; purpose?: string }[];
  suggestions: StarterRuleSuggestion[];
};
