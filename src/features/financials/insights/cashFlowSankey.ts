/**
 * Pure selector behind the cash-flow Sankey: bank and card transactions in a
 * date range, grouped by category and fund, netted so a refund reduces the
 * category it reverses instead of showing up as income.
 *
 * Every number comes from imported transactions. Transfers between the
 * organization's own accounts are left out (both legs would otherwise read as
 * money in and money out). The two sides balance through a "net increase" or
 * "from cash on hand" node so each column adds up to the same total.
 */
import { isInternalTransfer } from "../../../../shared/transferCategories";
import type { DateRange } from "../../../components/charts";
import type { SankeyLinkInput, SankeyNodeInput } from "../../../components/charts/SankeyChart";
import type { FinanceTxn } from "./series";

export type SankeyTxn = FinanceTxn & { counterparty?: string; description?: string };

export type FundKey = "unrestricted" | "restricted" | "all";

export const UNCATEGORIZED = "Uncategorized";
export const OTHER_IN_ID = "in:__other";
export const OTHER_OUT_ID = "out:__other";
const FROM_CASH_ID = "in:__cash";
const NET_INCREASE_ID = "out:__net";

/** Categories below this share of their side fold into "Other". */
const MIN_SHARE = 0.04;
/** At most this many named categories per side before the tail folds. */
const MAX_PER_SIDE = 6;

export type CategoryFlow = {
  /** Node id ("in:Donations", "out:Facilities", or an "Other" bucket id). */
  id: string;
  direction: "in" | "out";
  category: string;
  /** Net amount for the range, as a positive magnitude. */
  cents: number;
  /** Gross amount moving the other way inside this category (refunds, reversals). */
  offsetCents: number;
  count: number;
  byFund: Partial<Record<FundKey, number>>;
  /** Folded categories, for the "Other" buckets. */
  members?: CategoryFlow[];
};

export type CashFlowSankeyModel = {
  inflows: CategoryFlow[];
  outflows: CategoryFlow[];
  /** Every category before folding, for the table view. */
  allInflows: CategoryFlow[];
  allOutflows: CategoryFlow[];
  totalIn: number;
  totalOut: number;
  net: number;
  funds: FundKey[];
  fundTotals: Partial<Record<FundKey, { in: number; out: number }>>;
  excludedTransfers: number;
  transactionCount: number;
  nodes: SankeyNodeInput[];
  links: SankeyLinkInput[];
};

export const FUND_LABELS: Record<FundKey, string> = {
  unrestricted: "Unrestricted",
  restricted: "Restricted",
  all: "Your accounts",
};

type Bucket = { in: number; out: number; count: number };

function categoryOf(txn: SankeyTxn) {
  const raw = String(txn.category ?? "").trim();
  return raw || UNCATEGORIZED;
}

/** Transactions in range, minus internal transfers. */
export function sankeyTransactions(txns: SankeyTxn[], range: DateRange) {
  let excludedTransfers = 0;
  const kept: SankeyTxn[] = [];
  for (const txn of txns) {
    if (txn.date < range.start || txn.date > range.end || !txn.amountCents) continue;
    if (isInternalTransfer(txn)) {
      excludedTransfers += 1;
      continue;
    }
    kept.push(txn);
  }
  return { kept, excludedTransfers };
}

function foldTail(flows: CategoryFlow[], total: number, direction: "in" | "out"): CategoryFlow[] {
  const sorted = [...flows].sort((a, b) => b.cents - a.cents || a.category.localeCompare(b.category));
  const keep: CategoryFlow[] = [];
  const tail: CategoryFlow[] = [];
  for (const flow of sorted) {
    if (keep.length < MAX_PER_SIDE && (total <= 0 || flow.cents / total >= MIN_SHARE)) keep.push(flow);
    else tail.push(flow);
  }
  // A single small category reads better under its own name than as "Other".
  if (tail.length === 1) return [...keep, tail[0]];
  if (tail.length === 0) return keep;
  const byFund: Partial<Record<FundKey, number>> = {};
  for (const flow of tail) {
    for (const [fund, cents] of Object.entries(flow.byFund) as Array<[FundKey, number]>) byFund[fund] = (byFund[fund] ?? 0) + cents;
  }
  return [
    ...keep,
    {
      id: direction === "in" ? OTHER_IN_ID : OTHER_OUT_ID,
      direction,
      category: direction === "in" ? "Other money in" : "Other money out",
      cents: tail.reduce((sum, flow) => sum + flow.cents, 0),
      offsetCents: tail.reduce((sum, flow) => sum + flow.offsetCents, 0),
      count: tail.reduce((sum, flow) => sum + flow.count, 0),
      byFund,
      members: tail,
    },
  ];
}

/**
 * Build the Sankey model. `restrictedAccountIds` splits the middle column
 * into unrestricted and restricted funds; pass an empty set (or
 * `splitFunds: false`) for a single "Your accounts" node.
 */
export function buildCashFlowSankey(
  txns: SankeyTxn[],
  range: DateRange,
  options: { restrictedAccountIds?: ReadonlySet<string>; splitFunds?: boolean } = {},
): CashFlowSankeyModel {
  const restricted = options.restrictedAccountIds ?? new Set<string>();
  const split = options.splitFunds !== false && restricted.size > 0;
  const { kept, excludedTransfers } = sankeyTransactions(txns, range);
  const fundOf = (txn: SankeyTxn): FundKey => (!split ? "all" : txn.accountId && restricted.has(String(txn.accountId)) ? "restricted" : "unrestricted");

  // category → fund → gross in / out
  const grid = new Map<string, Map<FundKey, Bucket>>();
  for (const txn of kept) {
    const category = categoryOf(txn);
    const fund = fundOf(txn);
    const funds = grid.get(category) ?? new Map<FundKey, Bucket>();
    const bucket = funds.get(fund) ?? { in: 0, out: 0, count: 0 };
    if (txn.amountCents > 0) bucket.in += txn.amountCents;
    else bucket.out += -txn.amountCents;
    bucket.count += 1;
    funds.set(fund, bucket);
    grid.set(category, funds);
  }

  // Net each (category, fund) pair. A pair lands on the side its net falls
  // on, so a category is money in or money out — not both — in normal data.
  const sides = { in: new Map<string, CategoryFlow>(), out: new Map<string, CategoryFlow>() };
  const fundTotals: Partial<Record<FundKey, { in: number; out: number }>> = {};
  for (const [category, funds] of grid) {
    for (const [fund, bucket] of funds) {
      const net = bucket.in - bucket.out;
      if (net === 0) continue;
      const direction = net > 0 ? "in" : "out";
      const id = `${direction}:${category}`;
      const flow = sides[direction].get(id) ?? { id, direction, category, cents: 0, offsetCents: 0, count: 0, byFund: {} };
      flow.cents += Math.abs(net);
      flow.offsetCents += Math.min(bucket.in, bucket.out);
      flow.count += bucket.count;
      flow.byFund[fund] = (flow.byFund[fund] ?? 0) + Math.abs(net);
      sides[direction].set(id, flow);
      const totals = fundTotals[fund] ?? { in: 0, out: 0 };
      totals[direction] += Math.abs(net);
      fundTotals[fund] = totals;
    }
  }

  const allInflows = [...sides.in.values()].sort((a, b) => b.cents - a.cents);
  const allOutflows = [...sides.out.values()].sort((a, b) => b.cents - a.cents);
  const totalIn = allInflows.reduce((sum, flow) => sum + flow.cents, 0);
  const totalOut = allOutflows.reduce((sum, flow) => sum + flow.cents, 0);
  const inflows = foldTail(allInflows, totalIn, "in");
  const outflows = foldTail(allOutflows, totalOut, "out");
  const fundOrder: FundKey[] = split ? ["unrestricted", "restricted"] : ["all"];
  const funds = fundOrder.filter((fund) => fundTotals[fund]);

  const nodes: SankeyNodeInput[] = [];
  const links: SankeyLinkInput[] = [];
  let fromCash = 0;
  let netIncrease = 0;
  for (const fund of funds) {
    const totals = fundTotals[fund]!;
    if (totals.out > totals.in) fromCash += totals.out - totals.in;
    else netIncrease += totals.in - totals.out;
  }
  for (const flow of inflows) nodes.push({ id: flow.id, label: flow.category, column: 0, tone: "in", selectable: true });
  if (fromCash > 0) nodes.push({ id: FROM_CASH_ID, label: "From cash on hand", column: 0, tone: "muted" });
  for (const fund of funds) nodes.push({ id: `fund:${fund}`, label: FUND_LABELS[fund], column: 1, tone: "neutral" });
  for (const flow of outflows) nodes.push({ id: flow.id, label: flow.category, column: 2, tone: "out", selectable: true });
  if (netIncrease > 0) nodes.push({ id: NET_INCREASE_ID, label: "Net increase", column: 2, tone: "muted" });

  for (const flow of inflows) {
    for (const fund of funds) {
      const cents = flow.byFund[fund];
      if (cents) links.push({ source: flow.id, target: `fund:${fund}`, value: cents });
    }
  }
  for (const fund of funds) {
    const totals = fundTotals[fund]!;
    if (totals.out > totals.in) links.push({ source: FROM_CASH_ID, target: `fund:${fund}`, value: totals.out - totals.in });
  }
  for (const fund of funds) {
    for (const flow of outflows) {
      const cents = flow.byFund[fund];
      if (cents) links.push({ source: `fund:${fund}`, target: flow.id, value: cents });
    }
    const totals = fundTotals[fund]!;
    if (totals.in > totals.out) links.push({ source: `fund:${fund}`, target: NET_INCREASE_ID, value: totals.in - totals.out });
  }

  return {
    inflows,
    outflows,
    allInflows,
    allOutflows,
    totalIn,
    totalOut,
    net: totalIn - totalOut,
    funds,
    fundTotals,
    excludedTransfers,
    transactionCount: kept.length,
    nodes,
    links,
  };
}

/** The flows (folded or not) behind a node id, for the selection summary. */
export function flowForNode(model: CashFlowSankeyModel, id: string): CategoryFlow | null {
  return [...model.inflows, ...model.outflows].find((flow) => flow.id === id) ?? null;
}

/** Transactions behind a selected category (or every folded category of "Other"). */
export function transactionsForFlow(txns: SankeyTxn[], range: DateRange, flow: CategoryFlow): SankeyTxn[] {
  const categories = new Set((flow.members ?? [flow]).map((member) => member.category));
  return sankeyTransactions(txns, range).kept.filter((txn) => categories.has(categoryOf(txn)));
}

/** Largest counterparties in a set of transactions, by absolute amount. */
export function topCounterparties(txns: SankeyTxn[], limit = 3) {
  const totals = new Map<string, number>();
  for (const txn of txns) {
    const name = String(txn.counterparty ?? txn.description ?? "").trim() || "Unnamed";
    totals.set(name, (totals.get(name) ?? 0) + Math.abs(txn.amountCents));
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, cents]) => ({ name, cents }));
}
