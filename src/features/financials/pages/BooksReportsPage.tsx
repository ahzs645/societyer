import { useMemo } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useFinancePermissions } from "@/hooks/useFinancePermissions";
import { useSociety } from "../../../hooks/useSociety";
import { Tabs } from "../../../components/primitives";
import { SkeletonRows } from "../../../components/ui";
import { PageHeader, PageLoading, SeedPrompt } from "../../../pages/_helpers";
import type { Id } from "../../../../convex/_generated/dataModel";
import { BooksNav } from "../components/BooksNav";
import { FinanceCreateMenu } from "../components/FinanceCreateMenu";
import { GeneralLedgerReport } from "../reports/GeneralLedgerReport";
import { MultiPeriodReport } from "../reports/MultiPeriodReport";
import { REPORT_SLUGS, REPORT_TITLES, isReportSlug, type ReportSlug } from "../reports/reportFilters";
import { useReportState } from "../reports/useReportState";
import { useFinanceTags } from "../transactions/useFinanceTags";
import type { BooksSettingsView, ChartAccountOption, FundOption, ReportContext } from "../reports/types";

const REPORT_TABS = REPORT_SLUGS.map((id) => ({ id, label: REPORT_TITLES[id] }));
const FALLBACK_SETTINGS: BooksSettingsView = { accountingBasis: "accrual", fiscalStartMonth: 1, firstEntryDate: null };

/**
 * Financial reports (/app/financials/reports/:report): the balance sheet,
 * statement of operations and cash flow with a column per period, and the
 * general ledger. Every figure comes from posted journal entries.
 */
export function BooksReportsPage() {
  const society = useSociety();
  const { report } = useParams();
  if (!isReportSlug(report)) return <Navigate to="/app/financials/reports/balance-sheet" replace />;
  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;
  return <BooksReportsView societyId={society._id} societyName={society.name} slug={report} />;
}

function BooksReportsView({ societyId, societyName, slug }: { societyId: Id<"societies">; societyName: string; slug: ReportSlug }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { canExport } = useFinancePermissions();
  const settings = useQuery(api.accounting.booksSettings, { societyId }) as BooksSettingsView | undefined;
  const funds = useQuery(api.accounting.fundRestrictions, { societyId }) as FundOption[] | undefined;
  const accounts = useQuery(api.accounting.chartAccounts, slug === "general-ledger" ? { societyId } : "skip") as ChartAccountOption[] | undefined;
  const tags = useFinanceTags(societyId);
  const loadedSettings = settings ?? FALLBACK_SETTINGS;
  const [state, actions] = useReportState(slug === "general-ledger" ? "ledger" : "statement", loadedSettings.fiscalStartMonth, loadedSettings.accountingBasis);

  const context = useMemo<ReportContext>(
    () => ({
      societyId,
      societyName,
      funds: funds ?? [],
      fundNames: new Map((funds ?? []).map((fund) => [String(fund._id), fund.name])),
      tags,
      canExport,
    }),
    [canExport, funds, societyId, societyName, tags],
  );

  const switchReport = (next: ReportSlug) => navigate({ pathname: `/app/financials/reports/${next}`, search: location.search });

  return (
    <div className="page page--wide books-reports">
      <PageHeader
        title="Financial reports"
        subtitle="Balance sheet, statement of operations, cash flow and general ledger by period."
        actions={<FinanceCreateMenu />}
        info={
          <>
            <p>
              Every figure comes from posted journal entries, on the books' accounting basis unless you switch it here.
              Drafts and voided entries are left out.
            </p>
            <p>
              With a program, fund or tag filter, the cash flow shows only the filtered activity. Bank and cash lines carry no
              program, fund or tag, so cash at the start is the whole cash balance and cash at the end is that plus the
              filtered net change.
            </p>
            <p>Click any amount to see the journal lines behind it. Downloads include the organization name, basis, range and filters.</p>
          </>
        }
      />
      <BooksNav />
      <div className="books-reports__switcher">
        <Tabs<ReportSlug> value={slug} onChange={switchReport} items={REPORT_TABS} ariaLabel="Report" />
      </div>
      {settings === undefined ? (
        <SkeletonRows rows={8} columns={5} />
      ) : slug === "general-ledger" ? (
        accounts === undefined ? <SkeletonRows rows={8} columns={7} /> : <GeneralLedgerReport context={context} accounts={accounts} state={state} actions={actions} />
      ) : (
        <MultiPeriodReport key={slug} slug={slug} context={context} settings={settings} state={state} actions={actions} />
      )}
    </div>
  );
}
