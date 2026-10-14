import type { FieldType, ViewFilter, ViewFilterGroup, ViewFilterOperator } from "../../platform/record-engine/types";

/** What the parser needs to know about one column — never row data. */
export type NlFieldOption = { value: string; label: string };

export type NlField = {
  id: string;
  name: string;
  label: string;
  type: FieldType;
  options?: NlFieldOption[];
  /** Currency stored in cents (so "1.5k" becomes 150000). */
  isCents?: boolean;
  currencyCode?: string;
  trueLabel?: string;
  falseLabel?: string;
  /** Relation target, e.g. "users". */
  relationTarget?: string;
  /** The column that names a record (Description, Task, Full name…). */
  isLabelIdentifier?: boolean;
  isVisible?: boolean;
};

export type NlContext = {
  /** Organisation-local today, `YYYY-MM-DD`. */
  today: string;
  fiscalYearEnd?: string | null;
  /** "Transactions" / "Transaction": dropped from the query as plain nouns. */
  objectLabelPlural?: string;
  objectLabelSingular?: string;
};

export type NlCondition = {
  fieldId: string;
  operator: ViewFilterOperator;
  value: unknown;
  /** Chip text, e.g. "Amount ≥ $1,500" or "Date: this year". */
  text: string;
  /** Secondary chip text, e.g. the exact dates behind "this year". */
  detail?: string;
};

export type NlNode =
  | { kind: "condition"; condition: NlCondition }
  | { kind: "group"; operator: "and" | "or"; children: NlNode[] };

export type NlChip = { text: string; detail?: string };

export type NlParseStatus = "empty" | "ok" | "partial" | "none";

export type NlParseResult = {
  /** ok: every word was used. partial: some words were ignored. none: nothing understood. */
  status: NlParseStatus;
  query: string;
  root: { operator: "and" | "or"; children: NlNode[] } | null;
  /** The RecordTable filter tree (`utils/filterTree.ts` shape). */
  filters: ViewFilter[];
  filterGroups: ViewFilterGroup[];
  /** One chip per top-level condition or group. */
  chips: NlChip[];
  /** Words the parser did not use, in query order. */
  ignored: string[];
  /** Caveats worth showing (ambiguous matches, missing fiscal year end…). */
  notes: string[];
  /** Example queries to try when nothing was understood. */
  suggestions: string[];
  /** Set when the tree came from the optional AI path. */
  source?: "parser" | "ai";
};
