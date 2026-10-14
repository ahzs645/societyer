/**
 * Deep links from the Financials overview into a filtered Transactions table:
 * `/app/financials?tab=transactions&txnField=category&txnValue=Facilities&txnFlow=out&txnFrom=…&txnTo=…`.
 * <TransactionLinkFilters> (inside the table's scope) turns the parameters
 * into ordinary table filters, then drops them from the URL so the filter
 * chips stay the single source of truth.
 */
import type { FlowDirection } from "./topFlows";

export const TXN_LINK_PARAMS = {
  field: "txnField",
  value: "txnValue",
  flow: "txnFlow",
  from: "txnFrom",
  to: "txnTo",
} as const;

export type TransactionLinkField = "counterparty" | "description" | "category";

export type TransactionLinkSpec = {
  field?: TransactionLinkField;
  /** null/omitted with a field means "is empty" (e.g. uncategorised). */
  value?: string | null;
  flow?: FlowDirection;
  from?: string;
  to?: string;
};

const FIELDS = new Set<TransactionLinkField>(["counterparty", "description", "category"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function transactionFilterHref(spec: TransactionLinkSpec): string {
  const params = new URLSearchParams({ tab: "transactions" });
  if (spec.field) {
    params.set(TXN_LINK_PARAMS.field, spec.field);
    if (spec.value) params.set(TXN_LINK_PARAMS.value, spec.value);
  }
  if (spec.flow) params.set(TXN_LINK_PARAMS.flow, spec.flow);
  if (spec.from && DATE.test(spec.from)) params.set(TXN_LINK_PARAMS.from, spec.from);
  if (spec.to && DATE.test(spec.to)) params.set(TXN_LINK_PARAMS.to, spec.to);
  return `/app/financials?${params.toString()}`;
}

/** The link spec in `params`, or null when none of the link parameters are present. */
export function readTransactionLink(params: URLSearchParams): TransactionLinkSpec | null {
  if (!Object.values(TXN_LINK_PARAMS).some((name) => params.has(name))) return null;
  const field = params.get(TXN_LINK_PARAMS.field) as TransactionLinkField | null;
  const flow = params.get(TXN_LINK_PARAMS.flow);
  const from = params.get(TXN_LINK_PARAMS.from) ?? "";
  const to = params.get(TXN_LINK_PARAMS.to) ?? "";
  return {
    field: field && FIELDS.has(field) ? field : undefined,
    value: params.get(TXN_LINK_PARAMS.value) || null,
    flow: flow === "in" || flow === "out" ? flow : undefined,
    from: DATE.test(from) ? from : undefined,
    to: DATE.test(to) ? to : undefined,
  };
}

export function withoutTransactionLink(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const name of Object.values(TXN_LINK_PARAMS)) next.delete(name);
  return next;
}
