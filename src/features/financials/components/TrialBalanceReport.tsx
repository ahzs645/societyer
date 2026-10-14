import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ReportTable, type ReportColumn, type ReportRow } from "../../../components/ReportTable";
import { EmptyState } from "../../../components/ui";
import { Select } from "../../../components/Select";
import { FinanceDrilldownDrawer, type DrilldownItem } from "./FinanceDrilldownDrawer";
import { CompareToggle, FundFilterChips, ReportControl } from "./FinanceReportControls";
import {
  ACCOUNT_SECTIONS,
  fundsWithActivity,
  hasUnrestrictedLines,
  ledgerFiscalYears,
  matchesFund,
  priorFiscalYearLabel,
  sortByAccountCode,
  trialBalanceFromLines,
  type FundFilter,
  type LedgerAccount,
  type LedgerLine,
} from "../lib/ledgerReports";
import { hasOwnAmounts, rollupAccounts, type RollupNode } from "../lib/accountRollup";
import type { HierarchyAccount } from "../../../../shared/accountHierarchy";

type Meta = { accountId?: string; /** The account and its sub-accounts, for a rolled-up row. */ accountIds?: string[] };
type Drill = { account: LedgerAccount; accountIds: string[]; label: string; columnId: string; fiscalYear: string | null; side?: "debit" | "credit" } | null;

const ALL_YEARS = "__all";

export function ledgerLineToDrilldownItem(line: LedgerLine, fundNames: Map<string, string>): DrilldownItem {
  const tags = [line.fundRestrictionId ? fundNames.get(String(line.fundRestrictionId)) ?? "Restricted fund" : "Unrestricted"];
  if (line.programCode) tags.push(line.programCode);
  return {
    id: String(line._id),
    date: line.entry.date,
    primary: line.entry.memo || line.description || "Journal entry",
    secondary: [line.entry.entryNumber, line.description && line.description !== line.entry.memo ? line.description : null].filter(Boolean).join(" · ") || undefined,
    tags,
    debitCents: line.side === "debit" ? line.amountCents : undefined,
    creditCents: line.side === "credit" ? line.amountCents : undefined,
    ledgerHref: `/app/financials/accounting?entry=${encodeURIComponent(String(line.journalEntryId))}`,
    transactionHref: line.financialTransactionId
      ? `/app/financials?tab=transactions&transaction=${encodeURIComponent(String(line.financialTransactionId))}`
      : undefined,
  };
}

/** Trial balance from posted journal lines, by fiscal year, with prior-year comparison, fund filter and drilldown. */
export function TrialBalanceReport({ societyId }: { societyId: Id<"societies"> }) {
  const ledger = useQuery(api.accounting.generalLedger, { societyId }) as LedgerLine[] | undefined;
  const restrictions = useQuery(api.accounting.fundRestrictions, { societyId }) as Array<{ _id: string; name: string }> | undefined;
  const chart = useQuery(api.accounting.chartAccounts, { societyId }) as HierarchyAccount[] | undefined;
  const [yearChoice, setYearChoice] = useState<string | null>(null);
  const [compare, setCompare] = useState(true);
  const [fund, setFund] = useState<FundFilter>("all");
  const [drill, setDrill] = useState<Drill>(null);

  const lines = useMemo(() => (ledger ?? []).filter((line) => line.entry?.status === "posted" && line.account), [ledger]);
  const years = useMemo(() => ledgerFiscalYears(lines), [lines]);
  const fiscalYear = yearChoice ?? years[0] ?? ALL_YEARS;
  const priorYear = fiscalYear === ALL_YEARS ? null : priorFiscalYearLabel(fiscalYear);
  const comparing = compare && Boolean(priorYear);
  const funds = useMemo(() => fundsWithActivity(lines, restrictions ?? []), [lines, restrictions]);
  const fundNames = useMemo(() => new Map((restrictions ?? []).map((row) => [String(row._id), row.name])), [restrictions]);
  const fundLines = useMemo(() => lines.filter((line) => matchesFund(line, fund)), [lines, fund]);

  const inYear = (line: LedgerLine, year: string | null) => !year || year === ALL_YEARS || line.entry.fiscalYear === year;
  const current = useMemo(() => trialBalanceFromLines(fundLines.filter((line) => inYear(line, fiscalYear))), [fundLines, fiscalYear]);
  const prior = useMemo(() => (comparing ? trialBalanceFromLines(fundLines.filter((line) => inYear(line, priorYear))) : new Map()), [fundLines, comparing, priorYear]);

  const yearLabel = fiscalYear === ALL_YEARS ? "All years" : `FY ${fiscalYear}`;
  const columns: ReportColumn[] = [
    { id: "debit", label: "Debit", title: `Debit ${yearLabel}` },
    { id: "credit", label: "Credit", title: `Credit ${yearLabel}` },
    { id: "balance", label: comparing ? `Balance ${yearLabel}` : "Balance", title: `Balance ${yearLabel}`, emphasis: comparing, help: "Debit minus credit. Credit balances (liabilities, net assets, revenue) show in parentheses." },
    ...(comparing ? [{ id: "prior", label: `Balance FY ${priorYear}`, title: `Balance FY ${priorYear}` }] : []),
  ];

  const rows = useMemo(() => {
    const out: ReportRow<Meta>[] = [];
    const accounts = new Map<string, LedgerAccount>();
    for (const map of [current, prior]) for (const [id, row] of map) accounts.set(id, row.account);
    let debitTotal = 0;
    let creditTotal = 0;
    let balanceTotal = 0;
    let priorTotal = 0;
    for (const section of ACCOUNT_SECTIONS) {
      const sectionAccounts = Array.from(accounts.entries())
        .filter(([, account]) => section.types.includes(account.accountType))
        .sort(([, a], [, b]) => sortByAccountCode(a, b));
      if (sectionAccounts.length === 0) continue;
      const sum = { debit: 0, credit: 0, balance: 0, prior: 0 };
      const leaves = sectionAccounts.map(([id, account]) => {
        const now = current.get(id);
        const before = prior.get(id);
        sum.debit += now?.debitCents ?? 0;
        sum.credit += now?.creditCents ?? 0;
        sum.balance += now?.balanceCents ?? 0;
        sum.prior += before?.balanceCents ?? 0;
        return {
          accountId: id,
          code: account.code,
          name: account.name,
          values: { debit: now?.debitCents ?? 0, credit: now?.creditCents ?? 0, balance: now?.balanceCents ?? 0, prior: before?.balanceCents ?? 0 },
        };
      });
      // Sub-accounts nest under their parent, whose row carries the rolled-up total.
      const currencyOf = (id: string) => accounts.get(id)?.currency ?? (chart ?? []).find((row) => String(row._id) === id)?.currency ?? undefined;
      const toRow = (node: RollupNode): ReportRow<Meta> => {
        const row: ReportRow<Meta> = { id: `account:${node.accountId}`, kind: "row", code: node.code, label: node.name, currency: currencyOf(node.accountId), values: node.total, meta: { accountId: node.accountId, accountIds: node.accountIds } };
        if (!node.children.length) return row;
        const own: ReportRow<Meta>[] = hasOwnAmounts(node)
          ? [{ id: `account:${node.accountId}:own`, kind: "row", label: `${node.name}, other`, title: `${node.name}, posted to the parent account`, currency: row.currency, values: node.own!, meta: { accountId: node.accountId, accountIds: [node.accountId] } }]
          : [];
        return { ...row, title: `${node.name}, including sub-accounts`, children: [...own, ...node.children.map(toRow)] };
      };
      const children: ReportRow<Meta>[] = rollupAccounts(leaves, chart).map(toRow);
      out.push({ id: `section:${section.id}`, kind: "section", label: section.label, children });
      out.push({
        id: `subtotal:${section.id}`,
        kind: "subtotal",
        label: `Total ${section.label.toLowerCase()}`,
        values: { debit: sum.debit, credit: sum.credit, balance: sum.balance, prior: sum.prior },
      });
      debitTotal += sum.debit;
      creditTotal += sum.credit;
      balanceTotal += sum.balance;
      priorTotal += sum.prior;
    }
    if (out.length) {
      out.push({ id: "total", kind: "total", label: "Total", values: { debit: debitTotal, credit: creditTotal, balance: balanceTotal, prior: priorTotal } });
      if (fund === "all") {
        out.push({
          id: "total-note",
          kind: "note",
          label: debitTotal === creditTotal
            ? "Debits equal credits, so the ledger is in balance for this period."
            : "Debits and credits differ for this period. Check for draft or one-sided entries before relying on the statements.",
        });
      } else {
        out.push({
          id: "fund-note",
          kind: "note",
          label: "Filtered to one fund. Only lines tagged to that fund are included, so debits and credits need not balance.",
        });
      }
    }
    return out;
  }, [current, prior, fund, chart]);

  const drillItems = useMemo(() => {
    if (!drill) return [];
    return fundLines
      .filter((line) => drill.accountIds.includes(String(line.accountId)) && inYear(line, drill.fiscalYear) && (!drill.side || line.side === drill.side))
      .sort((a, b) => a.entry.date.localeCompare(b.entry.date))
      .map((line) => ledgerLineToDrilldownItem(line, fundNames));
  }, [drill, fundLines, fundNames]);
  const drillTotal = drillItems.reduce((sum, item) => {
    if (drill?.side === "debit") return sum + (item.debitCents ?? 0);
    if (drill?.side === "credit") return sum + (item.creditCents ?? 0);
    return sum + (item.debitCents ?? 0) - (item.creditCents ?? 0);
  }, 0);

  if (ledger !== undefined && lines.length === 0) {
    return (
      <EmptyState
        size="sm"
        title="No posted journal lines yet"
        description="Set up the chart of accounts, post opening balances, or post bank transactions to the journal to build the trial balance."
        action={<Link className="btn-action" to="/app/financials?tab=transactions">Import a bank CSV</Link>}
      />
    );
  }

  return (
    <>
      <ReportTable<Meta>
        ariaLabel="Trial balance"
        download={{ fileName: `Trial balance ${yearLabel}`, title: ["Trial balance", comparing ? `${yearLabel} compared with FY ${priorYear}` : yearLabel] }}
        loading={ledger === undefined}
        columns={columns}
        rows={rows}
        comparison={comparing ? { current: "balance", prior: "prior", deltaLabel: "Change" } : null}
        drillColumn="balance"
        onDrilldown={(row, column) => {
          const accountId = row.meta?.accountId;
          const account = accountId ? current.get(accountId)?.account ?? prior.get(accountId)?.account ?? (chart ?? []).find((candidate) => String(candidate._id) === accountId) as LedgerAccount | undefined : null;
          if (!account || !accountId) return;
          setDrill({
            account,
            accountIds: row.meta?.accountIds ?? [accountId],
            label: `${row.code ? `${row.code} · ` : ""}${row.title ?? String(row.label)}`,
            columnId: column.id,
            fiscalYear: column.id === "prior" ? priorYear : fiscalYear,
            side: column.id === "debit" ? "debit" : column.id === "credit" ? "credit" : undefined,
          });
        }}
        toolbar={
          <>
            <ReportControl label="Period">
              <Select
                value={fiscalYear}
                onChange={(value) => setYearChoice(value)}
                options={[...years.map((year) => ({ value: year, label: `FY ${year}` })), { value: ALL_YEARS, label: "All years" }]}
              />
            </ReportControl>
            <CompareToggle checked={comparing} disabled={!priorYear} onChange={setCompare} />
            <FundFilterChips funds={funds} value={fund} onChange={setFund} showUnrestricted={hasUnrestrictedLines(lines)} />
          </>
        }
        empty="No posted lines match this period and fund."
      />
      <FinanceDrilldownDrawer
        open={Boolean(drill)}
        onClose={() => setDrill(null)}
        title={drill?.label ?? "Account"}
        subtitle={drill ? `${drill.fiscalYear && drill.fiscalYear !== ALL_YEARS ? `FY ${drill.fiscalYear}` : "All years"}${drill.side ? ` · ${drill.side} lines` : ""}${fund !== "all" ? ` · ${fund === "unrestricted" ? "Unrestricted" : fundNames.get(fund) ?? "Fund"}` : ""}` : undefined}
        totalCents={drill ? drillTotal : null}
        totalLabel={drill?.side ? `Total ${drill.side}s` : "Balance (debit − credit)"}
        currency={drill?.account.currency}
        items={drillItems}
      />
    </>
  );
}
