import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { Lock, NotebookPen, Plus } from "lucide-react";
import { api } from "@/lib/convexApi";
import { ObjectRecordTable, RecordTableEmpty, type RecordTableCellRenderer } from "@/platform/record-engine";
import { useFinancePermissions } from "@/hooks/useFinancePermissions";
import { useCreateIntent } from "@/hooks/useCreateIntent";
import { useSociety } from "../../../hooks/useSociety";
import { PageHeader, SeedPrompt } from "../../../pages/_helpers";
import { Badge } from "../../../components/ui";
import { Money } from "../../../components/Money";
import { formatDate } from "../../../lib/format";
import { BooksNav } from "../components/BooksNav";
import { FinanceCreateMenu } from "../components/FinanceCreateMenu";
import { AccountRefList } from "../registers/AccountRefList";
import { JournalEntryDrawer, STATUS_TONE, type AccountLookup, type JournalEntryDetail } from "../registers/JournalEntryDrawer";
import { JournalEntryEditor, type GridAccount } from "../registers/JournalEntryEditor";
import { SectionTabs } from "../registers/SectionTabs";
import { REVIEW_FLAG_HINT, REVIEW_FLAG_LABEL, humanise, sectionCounts, sourceLabel, type SectionTab } from "../registers/registerModel";
import { toJournalRecords, type JournalRecord, type JournalRegisterView } from "../registers/registerRecords";
import { useJournalLinkOptions } from "../registers/useJournalLinkOptions";

type ChartAccountRow = GridAccount & { currency?: string | null };
type EditorState = { open: boolean; entry: JournalEntryDetail | null };

/** Description cell: the memo, the entry number muted, and a lock for closed periods. */
function MemoCell({ record }: { record: JournalRecord }) {
  return (
    <span className="books-register__memo">
      <span className="books-register__memo-text">{record.memo}</span>
      {record.entryNumber && <span className="muted">#{record.entryNumber}</span>}
      {record.locked && (
        <span className="books-register__lock" title="Dated on or before the books close date">
          <Lock size={12} aria-label="Closed period" />
        </span>
      )}
    </span>
  );
}

const renderJournalCell: RecordTableCellRenderer = ({ record, field }) => {
  const row = record as JournalRecord;
  switch (field.name) {
    case "memo":
      return <MemoCell record={row} />;
    case "debitAccountNames":
      return <AccountRefList accounts={row.debitAccounts} />;
    case "creditAccountNames":
      return <AccountRefList accounts={row.creditAccounts} />;
    case "amountCents":
      return <Money cents={row.amountCents} currency={row.currency ?? undefined} />;
    case "status":
      return <Badge tone={STATUS_TONE[row.status] ?? "neutral"}>{humanise(row.status)}</Badge>;
    case "source":
      return <span>{sourceLabel(row.source)}</span>;
    case "reviewFlags":
      if (row.reviewFlags.length === 0) return <span className="muted">—</span>;
      return (
        <span className="books-register__tags">
          {row.reviewFlags.map((flag) => (
            <span key={flag} title={REVIEW_FLAG_HINT[flag]}><Badge tone="warn">{REVIEW_FLAG_LABEL[flag] ?? humanise(flag)}</Badge></span>
          ))}
        </span>
      );
    default:
      return undefined;
  }
};

/**
 * Journal entries register: every entry with its debit and credit accounts,
 * amount, status and source, tabbed by the statement sections it touches.
 * Opens an entry in a drawer (also from `?entry=<id>`, which the general
 * ledger links to); manual entries are posted, edited and voided here.
 */
export function JournalEntriesPage() {
  const society = useSociety();
  const { canWrite } = useFinancePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const societyArgs = society ? { societyId: society._id } : "skip";
  const register = useQuery(api.accounting.journalEntryRegister, societyArgs) as JournalRegisterView | undefined;
  const chartAccounts = useQuery(api.accounting.chartAccounts, societyArgs) as ChartAccountRow[] | undefined;
  const links = useJournalLinkOptions(society?._id);
  const [tab, setTab] = useState<SectionTab>("all");
  const [editor, setEditor] = useState<EditorState>({ open: false, entry: null });

  const records = useMemo(() => (register ? toJournalRecords(register.rows) : []), [register]);
  const counts = useMemo(() => (register ? sectionCounts(records, (row) => row.sections) : null), [register, records]);
  const visible = useMemo(() => (tab === "all" ? records : records.filter((row) => row.sections.includes(tab))), [records, tab]);
  const accounts = useMemo(() => chartAccounts ?? [], [chartAccounts]);
  const accountLookup = useMemo<AccountLookup>(() => new Map(accounts.map((account) => [String(account._id), account])), [accounts]);
  const closeDate = register?.closeDate ?? null;

  const entryParam = searchParams.get("entry");
  const selected = entryParam ? records.find((row) => row._id === entryParam) ?? null : null;
  const setEntryParam = useCallback((id: string | null) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (id) next.set("entry", id);
      else next.delete("entry");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // A deep link to an entry this register doesn't have (another workspace, deleted) is dropped.
  useEffect(() => {
    if (register && entryParam && !records.some((row) => row._id === entryParam)) setEntryParam(null);
  }, [register, entryParam, records, setEntryParam]);

  const openNew = useCallback(() => setEditor({ open: true, entry: null }), []);
  useCreateIntent("new-journal", "financials:write", openNew);
  const openRecord = useCallback((id: string) => setEntryParam(id), [setEntryParam]);
  const closeRecord = useCallback(() => setEntryParam(null), [setEntryParam]);
  const editEntry = useCallback((entry: JournalEntryDetail) => {
    setEntryParam(null);
    setEditor({ open: true, entry });
  }, [setEntryParam]);
  const closeEditor = useCallback(() => {
    // After editing, return to the entry it came from.
    if (editor.entry) setEntryParam(editor.entry._id);
    setEditor((current) => ({ ...current, open: false }));
  }, [editor.entry, setEntryParam]);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  return (
    <div className="page page--wide books-register-page">
      <PageHeader
        title="Journal entries"
        icon={<NotebookPen size={16} />}
        iconColor="green"
        subtitle="Every entry in the books, with the accounts it debits and credits."
        info={
          <>
            <p>
              Manual entries and closed-period adjustments are posted, edited and voided here. Entries imported or posted from
              another source (bank transactions, expense claims, opening balances) are changed where they came from.
            </p>
            <p>
              Once the books are closed through a date in Books settings, entries dated on or before it can't be posted, edited
              or voided until an admin moves the close date.
            </p>
          </>
        }
        actions={
          <>
            <FinanceCreateMenu />
            <button type="button" className="btn-action btn-action--primary" disabled={!canWrite || chartAccounts === undefined} onClick={openNew}>
              <Plus size={12} aria-hidden="true" /> New journal entry
            </button>
          </>
        }
      />
      <BooksNav />

      {closeDate && (
        <div className="notice notice--info books-register__notice" role="status">
          <Lock size={14} aria-hidden="true" />
          <span>
            Books closed through <strong>{formatDate(closeDate)}</strong>. Entries dated on or before it are locked.{" "}
            <Link to="/app/financials/books-settings">Books settings</Link>
          </span>
        </div>
      )}

      <SectionTabs value={tab} onChange={setTab} counts={counts} ariaLabel="Statement sections" />

      <ObjectRecordTable
        societyId={society._id}
        nameSingular="journalEntryRegister"
        label="Journal entries"
        objectLabel="journal entry"
        icon={<NotebookPen size={14} />}
        records={visible}
        loading={register === undefined}
        onRecordClick={openRecord}
        renderCell={renderJournalCell}
        emptyState={
          records.length === 0 ? (
            <RecordTableEmpty
              title="No journal entries yet"
              description="Entries appear here as bank transactions, expense claims and opening balances are posted, or when you post one by hand."
              action={canWrite ? <button type="button" className="btn btn--accent btn--sm" onClick={openNew}><Plus size={12} aria-hidden="true" /> New journal entry</button> : undefined}
            />
          ) : (
            <RecordTableEmpty variant="filtered" title="No entries touch this section" description="Choose another tab to see more entries." />
          )
        }
      />

      {selected && (
        <JournalEntryDrawer
          key={selected._id}
          record={selected}
          accounts={accountLookup}
          links={links}
          canWrite={canWrite}
          closeDate={closeDate}
          onEdit={editEntry}
          onClose={closeRecord}
        />
      )}

      <JournalEntryEditor
        open={editor.open}
        entry={editor.entry}
        societyId={society._id}
        accounts={accounts}
        links={links}
        canWrite={canWrite}
        onClose={closeEditor}
      />
    </div>
  );
}
