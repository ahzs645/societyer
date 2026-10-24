import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { X } from "lucide-react";
import { api } from "@/lib/convexApi";
import { ChartCard, formatRange, type DateRange } from "../../../components/charts";
import { SankeyChart, type SankeyNodeInput } from "../../../components/charts/SankeyChart";
import { formatMoney as baseFormatMoney, type MoneyFormatOptions } from "../../../lib/money";
import { pluralize } from "../../../lib/format";
import {
  FUND_LABELS,
  buildCashFlowSankey,
  flowForNode,
  topCounterparties,
  transactionsForFlow,
  type CashFlowSankeyModel,
  type CategoryFlow,
  type SankeyTxn,
} from "./cashFlowSankey";
import { useFinanceInsightsData } from "./useFinanceInsightsData";
import { useFinancePermissions } from "../../../hooks/useFinancePermissions";
import { ReportPdfDownload } from "../reports/ReportPdfDownload";
import { sankeyReportDocument } from "./sankeyReportDocument";

type AccountRow = { _id: string; accountType?: string; isRestricted?: boolean };

const BANK_TYPES = new Set(["Bank", "Credit"]);
const FUND_TITLES = ["Money in", "Funds", "Money out"];
const ACCOUNT_TITLES = ["Money in", "Accounts", "Money out"];

/**
 * "Where the money went": money in by category, through the organization's
 * funds (unrestricted and restricted when a restricted bank account exists),
 * to money out by category, for the range chosen in the finance range bar.
 * Clicking a category focuses the diagram on it and lists what is behind it.
 */
export function CashFlowSankeyCard({ societyId, range, currency }: { societyId: string; range: DateRange; currency?: string }) {
  const data = useFinanceInsightsData(societyId, true, currency);
  const { canExport } = useFinancePermissions();
  const accounts = useQuery(api.financialHub.accounts, { societyId: societyId as any }) as AccountRow[] | undefined;
  const restrictedIds = useMemo(
    () => new Set((accounts ?? []).filter((a) => a.isRestricted && BANK_TYPES.has(String(a.accountType))).map((a) => String(a._id))),
    [accounts],
  );
  const [splitFunds, setSplitFunds] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const txns = data.txns as SankeyTxn[];
  const model = useMemo(() => buildCashFlowSankey(txns, range, { restrictedAccountIds: restrictedIds, splitFunds }), [range, restrictedIds, splitFunds, txns]);
  const selectedFlow = selected ? flowForNode(model, selected) : null;
  const report = useMemo(() => sankeyReportDocument(model, range, { currency: data.currency, sourceCurrencies: data.sourceCurrencies, truncated: data.truncated, selectedFlow }), [model, range, data.currency, data.sourceCurrencies, data.truncated, selectedFlow]);

  // A selection that no longer exists in this range (or fold) is dropped.
  useEffect(() => {
    if (selected && !flowForNode(model, selected)) setSelected(null);
  }, [model, selected]);

  if (!data.loading && !data.hasAnyFinance) return null;
  const loading = data.loading || accounts === undefined;
  const nodes = withDetails(model, data.currency);
  const empty = !loading && model.transactionCount === 0;
  const canSplit = restrictedIds.size > 0;

  return (
    <ChartCard
      className="cash-flow-sankey"
      title="Where the money came from and went"
      subtitle={`${formatRange(range.start, range.end)} · refunds are netted against their category${model.excludedTransfers ? `; ${pluralize(model.excludedTransfers, "transfer")} between your own accounts left out` : ""}.`}
      loading={loading}
      empty={empty}
      emptyMessage="No money in or out in this range."
      height={300}
      actions={
        <>
        <ReportPdfDownload societyId={societyId} report={report} filename={`cash-flow-diagram-${range.start}-${range.end}`} disabled={loading || !canExport} label="Diagram PDF" />
        {canSplit && !loading && !empty ? (
          <div className="segmented segmented--compact" role="group" aria-label="Funds">
            {[
              { id: true, label: "By fund" },
              { id: false, label: "Combined" },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                className={`segmented__btn${splitFunds === option.id ? " is-active" : ""}`}
                aria-pressed={splitFunds === option.id}
                onClick={() => setSplitFunds(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : undefined}
        </>
      }
      table={sankeyTable(model, data.currency)}
    >
      <SankeyChart
        nodes={nodes}
        links={model.links}
        ariaLabel={summary(model, data.currency)}
        formatValue={(value) => baseFormatMoney(value, { currency: data.currency })}
        columnTitles={model.funds.length > 1 ? FUND_TITLES : ACCOUNT_TITLES}
        selectedId={selected}
        onSelect={setSelected}
      />
      {selectedFlow ? (
        <SelectedFlow currency={data.currency} flow={selectedFlow} txns={txns} range={range} model={model} onClear={() => setSelected(null)} />
      ) : (
        <p className="cash-flow-sankey__hint">Select a category to see what is behind it.</p>
      )}
    </ChartCard>
  );
}

function withDetails(model: CashFlowSankeyModel, currency = "CAD"): SankeyNodeInput[] {
  const formatMoney = (value: number, options?: MoneyFormatOptions) => baseFormatMoney(value, { ...options, currency });
  const flows = new Map([...model.inflows, ...model.outflows].map((flow) => [flow.id, flow]));
  return model.nodes.map((node) => {
    const flow = flows.get(node.id);
    if (flow) {
      const details = [{ label: "Transactions", value: String(flow.count) }];
      if (flow.offsetCents > 0) details.push({ label: flow.direction === "out" ? "Refunds netted" : "Reversals netted", value: formatMoney(flow.offsetCents) });
      if (flow.members) details.push({ label: "Categories", value: String(flow.members.length) });
      return { ...node, details };
    }
    if (node.id.startsWith("fund:")) {
      const totals = model.fundTotals[node.id.slice(5) as keyof typeof model.fundTotals];
      if (totals) {
        return {
          ...node,
          details: [
            { label: "Money in", value: formatMoney(totals.in) },
            { label: "Money out", value: formatMoney(totals.out) },
            { label: "Net change", value: formatMoney(totals.in - totals.out, { signDisplay: "exceptZero" }) },
          ],
        };
      }
    }
    return node;
  });
}

function summary(model: CashFlowSankeyModel, currency = "CAD") {
  const formatMoney = (value: number, options?: MoneyFormatOptions) => baseFormatMoney(value, { ...options, currency });
  const top = (flows: CategoryFlow[]) => flows.slice(0, 3).map((flow) => `${flow.category} ${formatMoney(flow.cents, { trimWholeCents: true })}`).join(", ");
  return `Cash flow: ${formatMoney(model.totalIn, { trimWholeCents: true })} in, mostly ${top(model.inflows) || "none"}; ${formatMoney(model.totalOut, { trimWholeCents: true })} out, mostly ${top(model.outflows) || "none"}; net change ${formatMoney(model.net, { trimWholeCents: true, signDisplay: "exceptZero" })}.`;
}

function sankeyTable(model: CashFlowSankeyModel, currency = "CAD") {
  const formatMoney = (value: number, options?: MoneyFormatOptions) => baseFormatMoney(value, { ...options, currency });
  const fundColumns = model.funds.length > 1;
  const share = (cents: number, base: number) => (base ? `${((cents / base) * 100).toFixed(1)}%` : "—");
  const row = (flow: CategoryFlow, base: number) => ({
    category: flow.category,
    direction: flow.direction === "in" ? "Money in" : "Money out",
    ...(fundColumns ? Object.fromEntries(model.funds.map((fund) => [fund, flow.byFund[fund] ? formatMoney(flow.byFund[fund]!) : "—"])) : {}),
    amount: formatMoney(flow.cents),
    share: share(flow.cents, base),
    refunds: flow.offsetCents ? formatMoney(flow.offsetCents) : "—",
  });
  return {
    caption: "Money in and out by category",
    columns: [
      { key: "category", label: "Category" },
      { key: "direction", label: "Direction" },
      ...(fundColumns ? model.funds.map((fund) => ({ key: fund, label: FUND_LABELS[fund], numeric: true })) : []),
      { key: "amount", label: "Net amount", numeric: true },
      { key: "share", label: "Share of side", numeric: true },
      { key: "refunds", label: "Refunds netted", numeric: true },
    ],
    // The table lists every category, including those folded into "Other".
    rows: [...model.allInflows.map((flow) => row(flow, model.totalIn)), ...model.allOutflows.map((flow) => row(flow, model.totalOut))],
  };
}

function SelectedFlow({ flow, txns, range, model, onClear, currency = "CAD" }: { currency?: string; flow: CategoryFlow; txns: SankeyTxn[]; range: DateRange; model: CashFlowSankeyModel; onClear: () => void }) {
  const rows = useMemo(() => transactionsForFlow(txns, range, flow), [flow, range, txns]);
  const payees = useMemo(() => topCounterparties(rows), [rows]);
  const base = flow.direction === "in" ? model.totalIn : model.totalOut;
  const formatMoney = (value: number, options?: MoneyFormatOptions) => baseFormatMoney(value, { ...options, currency });
  const pct = base ? Math.round((flow.cents / base) * 100) : 0;
  return (
    <div className="cash-flow-sankey__focus" role="status">
      <div className="cash-flow-sankey__focus-head">
        <strong>{flow.category}</strong>
        <span>
          {formatMoney(flow.cents)} {flow.direction === "in" ? "in" : "out"} · {pct}% of money {flow.direction} · {pluralize(flow.count, "transaction")}
        </span>
        <button type="button" className="insights__chip" onClick={onClear} aria-label={`Clear ${flow.category} filter`}>
          Clear
          <X size={12} aria-hidden="true" />
        </button>
      </div>
      {flow.members ? (
        <p className="cash-flow-sankey__focus-line">
          Includes {flow.members.map((member) => `${member.category} ${formatMoney(member.cents, { trimWholeCents: true })}`).join(", ")}.
        </p>
      ) : null}
      {payees.length > 0 && (
        <p className="cash-flow-sankey__focus-line">
          Largest {flow.direction === "in" ? "sources" : "payees"}: {payees.map((payee) => `${payee.name} ${formatMoney(payee.cents, { trimWholeCents: true })}`).join(", ")}.
        </p>
      )}
      {flow.offsetCents > 0 && (
        <p className="cash-flow-sankey__focus-line cash-flow-sankey__focus-line--muted">
          {formatMoney(flow.offsetCents)} moving the other way (refunds or reversals) is netted into this amount.
        </p>
      )}
    </div>
  );
}
