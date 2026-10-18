import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ListTree, Plus } from "lucide-react";
import { api } from "@/lib/convexApi";
import { ObjectRecordTable, RecordTableEmpty, type RecordTableCellRenderer } from "@/platform/record-engine";
import { useFinancePermissions } from "@/hooks/useFinancePermissions";
import { useSociety } from "../../../hooks/useSociety";
import { PageHeader, SeedPrompt } from "../../../pages/_helpers";
import { Money } from "../../../components/Money";
import { useToast } from "../../../components/Toast";
import { BooksNav } from "../components/BooksNav";
import { booksErrorMessage } from "../settings/booksSettings";
import { AccountDrawer } from "../registers/AccountDrawer";
import { SectionTabs } from "../registers/SectionTabs";
import { sectionCounts, type SectionTab } from "../registers/registerModel";
import { toChartRecords, type ChartAccountRecord, type ChartRegisterRowView } from "../registers/registerRecords";

/** Name cell: indented by depth, with the parent account muted under a sub-account. */
function AccountNameCell({ record }: { record: ChartAccountRecord }) {
  return (
    <span className="books-register__account" data-depth={Math.min(record.depth, 3)}>
      <span className="books-register__account-name">{record.name}</span>
      {record.parentName && <span className="books-register__account-parent muted">{record.parentName}</span>}
    </span>
  );
}

const renderChartCell: RecordTableCellRenderer = ({ record, field }) => {
  const row = record as ChartAccountRecord;
  if (field.name === "name") return <AccountNameCell record={row} />;
  if (field.name === "code") return row.code ? <span className="num">{row.code}</span> : <span className="muted">—</span>;
  if (field.name === "openingBalanceCents") return <Money cents={row.openingBalanceCents} currency={row.currency ?? undefined} />;
  if (field.name === "balanceCents") return <Money cents={row.balanceCents} currency={row.currency ?? undefined} />;
  if (field.name === "subtypeLabel" && !row.subtypeLabel) return <span className="muted">—</span>;
  return undefined;
};

/**
 * Chart of accounts register: every ledger account with its type, subtype,
 * normal balance, opening balance and posted balance, tabbed by statement
 * section. Sub-accounts sit indented under their parent. Accounts are added
 * and edited in a drawer.
 */
export function ChartOfAccountsPage() {
  const society = useSociety();
  const { canWrite } = useFinancePermissions();
  const toast = useToast();
  const rows = useQuery(api.accounting.chartOfAccountsRegister, society ? { societyId: society._id } : "skip") as ChartRegisterRowView[] | undefined;
  const seedChart = useMutation(api.accounting.seedSocietyChartOfAccounts);
  const [tab, setTab] = useState<SectionTab>("all");
  const [drawer, setDrawer] = useState<{ id: string | null } | null>(null);
  const [seeding, setSeeding] = useState(false);

  const records = useMemo(() => (rows ? toChartRecords(rows) : []), [rows]);
  const counts = useMemo(() => (rows ? sectionCounts(records, (row) => [row.section]) : null), [rows, records]);
  const visible = useMemo(() => (tab === "all" ? records : records.filter((row) => row.section === tab)), [records, tab]);
  const closeDrawer = useCallback(() => setDrawer(null), []);
  const openAccount = useCallback((id: string) => setDrawer({ id }), []);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const seed = async () => {
    setSeeding(true);
    try {
      await seedChart({ societyId: society._id });
      toast.success("Standard chart of accounts set up");
    } catch (error) {
      toast.error("Chart of accounts not set up", booksErrorMessage(error));
    } finally {
      setSeeding(false);
    }
  };

  const active = drawer?.id ? records.find((row) => row._id === drawer.id) ?? null : null;
  const noAccounts = rows !== undefined && rows.length === 0;

  return (
    <div className="page page--wide books-register-page">
      <PageHeader
        title="Chart of accounts"
        icon={<ListTree size={16} />}
        iconColor="green"
        subtitle="Every ledger account, its normal balance and what it holds today."
        info={
          <>
            <p>
              Sub-accounts roll up into their parent on the Balance sheet and Statement of operations, so a parent shows the
              total of everything under it.
            </p>
            <p>
              The normal balance is the side that increases an account: debit for assets and expenses, credit for liabilities,
              net assets and revenue. Balances here are shown in that direction, so a positive number is the usual case.
            </p>
            <p>The opening balance comes from the opening-balance entry posted when the books started.</p>
          </>
        }
        actions={
          <button type="button" className="btn-action btn-action--primary" disabled={!canWrite || rows === undefined} onClick={() => setDrawer({ id: null })}>
            <Plus size={12} aria-hidden="true" /> New account
          </button>
        }
      />
      <BooksNav />

      <SectionTabs value={tab} onChange={setTab} counts={counts} ariaLabel="Account types" />

      <ObjectRecordTable
        societyId={society._id}
        nameSingular="ledgerAccount"
        label="Chart of accounts"
        objectLabel="chart of accounts"
        icon={<ListTree size={14} />}
        records={visible}
        loading={rows === undefined}
        onRecordClick={openAccount}
        renderCell={renderChartCell}
        emptyState={
          noAccounts ? (
            <RecordTableEmpty
              title="No accounts yet"
              description="Start from a standard chart of accounts for a BC society, then rename, add or nest accounts to fit."
              action={canWrite ? (
                <button type="button" className="btn btn--accent btn--sm" disabled={seeding} onClick={() => void seed()}>
                  Set up standard chart of accounts
                </button>
              ) : undefined}
            />
          ) : (
            <RecordTableEmpty variant="filtered" title="No accounts of this type" description="Choose another tab or add an account." />
          )
        }
      />

      {drawer && (drawer.id === null || active) && (
        <AccountDrawer
          key={drawer.id ?? "new"}
          societyId={society._id}
          account={active}
          accounts={records}
          canWrite={canWrite}
          onClose={closeDrawer}
        />
      )}
    </div>
  );
}
