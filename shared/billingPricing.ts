import { catalogRate, type CatalogPriceSource, type InvoicePriceList } from "./invoiceCommerce";

export type BillingPriceTier = { catalogItemId: string; minimumQuantity: number; unitPriceCents: number };
export type BillingPriceProfile = { _id?: string; priceListId: string; active: boolean; validFrom?: string; validTo?: string; tiers: BillingPriceTier[] };
export type BillingCustomerPricing = { _id?: string; partyKey: string; priceListId: string; active: boolean };
export type BillingPricingWorkspace = { profiles: BillingPriceProfile[]; assignments: BillingCustomerPricing[] };

const validDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
export function cleanBillingPriceProfile(input: BillingPriceProfile): BillingPriceProfile {
  if (!input || typeof input !== "object" || typeof input.priceListId !== "string" || !input.priceListId || typeof input.active !== "boolean") throw new Error("Choose a price list and active state.");
  for (const key of ["validFrom", "validTo"] as const) if (input[key] && !validDate(input[key])) throw new Error("Choose valid effective dates.");
  if (input.validFrom && input.validTo && input.validFrom > input.validTo) throw new Error("The end date must follow the start date.");
  if (!Array.isArray(input.tiers) || input.tiers.length > 1000) throw new Error("A price list supports up to 1,000 quantity tiers.");
  const seen = new Set<string>();
  const tiers = input.tiers.map((tier) => {
    if (!tier.catalogItemId || !Number.isFinite(tier.minimumQuantity) || tier.minimumQuantity <= 0 || !Number.isSafeInteger(tier.unitPriceCents) || tier.unitPriceCents < 0) throw new Error("Each tier needs an item, positive minimum quantity, and a nonnegative rate.");
    const key = `${tier.catalogItemId}:${tier.minimumQuantity}`;
    if (seen.has(key)) throw new Error("Use one rate per item and minimum quantity.");
    seen.add(key);
    return { catalogItemId: tier.catalogItemId, minimumQuantity: tier.minimumQuantity, unitPriceCents: tier.unitPriceCents };
  });
  return { priceListId: input.priceListId, active: input.active, ...(input.validFrom ? { validFrom: input.validFrom } : {}), ...(input.validTo ? { validTo: input.validTo } : {}), tiers: tiers.sort((a, b) => a.catalogItemId.localeCompare(b.catalogItemId) || a.minimumQuantity - b.minimumQuantity) };
}
export function priceListIsEffective(list: InvoicePriceList, profile: BillingPriceProfile | undefined, date: string): boolean {
  return list.active && (!profile || profile.active && (!profile.validFrom || profile.validFrom <= date) && (!profile.validTo || profile.validTo >= date));
}
export function assignedPriceList(lists: InvoicePriceList[], pricing: BillingPricingWorkspace, partyKey: string, currency: string, date: string): InvoicePriceList | null {
  const assignment = pricing.assignments.find((row) => row.active && row.partyKey.replace(/^org:/,"organization:") === partyKey.replace(/^org:/,"organization:"));
  const list = lists.find((row) => row._id === assignment?.priceListId && row.currency === currency);
  return list && priceListIsEffective(list, pricing.profiles.find((row) => row.priceListId === list._id), date) ? list : null;
}
/** Largest applicable threshold wins; currencies are never converted by a pricing rule. */
export function quantityCatalogRate(item: CatalogPriceSource, quantity: number, currency: string, date: string, list: InvoicePriceList | null | undefined, pricing: BillingPricingWorkspace, baseCurrency = "CAD"): number | null {
  if (!Number.isFinite(quantity) || quantity < 0) return null;
  if (!list) return catalogRate(item, currency, null, baseCurrency);
  const profile = pricing.profiles.find((row) => row.priceListId === list._id);
  if (list.currency !== currency || !priceListIsEffective(list, profile, date)) return null;
  const tier = profile?.tiers.filter((row) => row.catalogItemId === item._id && row.minimumQuantity <= quantity).sort((a, b) => b.minimumQuantity - a.minimumQuantity)[0];
  return tier?.unitPriceCents ?? catalogRate(item, currency, list, baseCurrency);
}

export const INVOICE_LIST_COLUMNS = ["number", "customer", "issueDate", "dueDate", "total", "balance", "status", "paid", "currency", "email", "reference"] as const;
export type InvoiceListColumn = (typeof INVOICE_LIST_COLUMNS)[number];
export type InvoiceListView = {
  tab: "all" | "drafts" | "outstanding" | "overdue" | "paid" | "needs_action";
  currency: string; search: string; customerKey: string; seriesId: string; recentOnly: boolean;
  fromDate: string; toDate: string; dueFrom: string; dueTo: string; minimumBalanceCents: number | null; maximumBalanceCents: number | null;
  sortKey: "number" | "customer" | "issueDate" | "dueDate" | "total" | "balance"; sortDirection: "asc" | "desc";
  columns: Array<{ key: InvoiceListColumn; label: string; visible: boolean; width: number }>;
};
export const DEFAULT_INVOICE_LIST_VIEW: InvoiceListView = {
  tab: "all", currency: "", search: "", customerKey: "", seriesId: "", recentOnly: false,
  fromDate: "", toDate: "", dueFrom: "", dueTo: "", minimumBalanceCents: null, maximumBalanceCents: null, sortKey: "issueDate", sortDirection: "desc",
  columns: INVOICE_LIST_COLUMNS.map((key, index) => ({ key, label: ({ number: "Number", customer: "Customer", issueDate: "Issued", dueDate: "Due", total: "Amount", balance: "Balance due", status: "Status", paid: "Paid", currency: "Currency", email: "Email", reference: "Reference" })[key], visible: index < 7, width: key === "customer" ? 220 : 135 })),
};
export function cleanInvoiceListView(input: unknown): InvoiceListView {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Choose a valid saved invoice view.");
  const source = input as Record<string,unknown>;
  const value = Object.fromEntries(Object.entries(DEFAULT_INVOICE_LIST_VIEW).map(([key,fallback]) => [key,Object.hasOwn(source,key) ? source[key] : fallback])) as InvoiceListView;
  if (!["all", "drafts", "outstanding", "overdue", "paid", "needs_action"].includes(value.tab) || !["number", "customer", "issueDate", "dueDate", "total", "balance"].includes(value.sortKey) || !["asc", "desc"].includes(value.sortDirection)) throw new Error("Choose supported invoice filters and sorting.");
  for (const key of ["currency", "search", "customerKey", "seriesId"] as const) if (typeof value[key] !== "string" || value[key].length > 500) throw new Error("Invoice view filters must be text of at most 500 characters.");
  for (const key of ["fromDate", "toDate", "dueFrom", "dueTo"] as const) if (typeof value[key] !== "string" || value[key] && !validDate(value[key])) throw new Error("Choose valid view dates.");
  if (value.fromDate && value.toDate && value.fromDate > value.toDate || value.dueFrom && value.dueTo && value.dueFrom > value.dueTo) throw new Error("The end date must follow the start date.");
  for (const key of ["minimumBalanceCents", "maximumBalanceCents"] as const) if (value[key] !== null && (!Number.isSafeInteger(value[key]))) throw new Error("Balance bounds must be integer amounts in cents.");
  if (value.minimumBalanceCents !== null && value.maximumBalanceCents !== null && value.minimumBalanceCents > value.maximumBalanceCents) throw new Error("The maximum balance must be at least the minimum.");
  if (typeof value.recentOnly !== "boolean" || !Array.isArray(value.columns) || value.columns.length !== INVOICE_LIST_COLUMNS.length || new Set(value.columns.map((column) => column.key)).size !== INVOICE_LIST_COLUMNS.length) throw new Error("Include each invoice column once.");
  for (const column of value.columns) if (!INVOICE_LIST_COLUMNS.includes(column.key) || typeof column.label !== "string" || column.label.length > 80 || typeof column.visible !== "boolean" || !Number.isFinite(column.width) || column.width < 60 || column.width > 600) throw new Error("Choose valid column labels, visibility and widths (60–600 pixels).");
  if (!value.columns.some((column) => column.visible && ["number", "customer"].includes(column.key))) throw new Error("Show the invoice number or customer column.");
  return { ...value, columns: value.columns.map((column) => ({ ...column, label: column.label.trim() })) };
}
