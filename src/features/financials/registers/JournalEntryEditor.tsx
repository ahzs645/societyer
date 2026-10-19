import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Field } from "../../../components/ui";
import { DatePicker } from "../../../components/DatePicker";
import { useConfirm } from "../../../components/Modal";
import { useToast } from "../../../components/Toast";
import { GridDrawer, isBlankRow, newRowKey, useBeforeUnloadGuard } from "../../../components/EditableGrid";
import { todayDateOnly } from "../../../../shared/dateOnly";
import { booksErrorMessage } from "../settings/booksSettings";
import { JournalLinesGrid, blankJournalRow, useJournalLinesGrid, type JournalGridRow } from "../components/JournalLinesGrid";
import type { JournalEntryDetail, JournalLineDetail } from "./JournalEntryDrawer";
import type { JournalLinkOptions } from "./useJournalLinkOptions";

/** The account fields the lines grid reads for its account picker. */
export type GridAccount = { _id: string; code?: string | null; name: string; accountType: string };

type EntryForm = { date: string; fiscalYear: string; memo: string; allowClosed: boolean };

/** Line fields the grid doesn't show, carried through an edit so saving keeps them. */
type LineExtras = Pick<JournalLineDetail, "documentIds" | "financialTransactionId" | "transactionCandidateId">;

function formFor(entry: JournalEntryDetail | null): EntryForm {
  const date = entry?.date ?? todayDateOnly();
  return {
    date,
    fiscalYear: entry?.fiscalYear ?? date.slice(0, 4),
    memo: entry?.memo ?? "",
    allowClosed: entry?.source === "adjustment",
  };
}

function rowFor(line: JournalLineDetail): JournalGridRow {
  // Grid money columns hold cents, the same unit as journal lines.
  return {
    key: newRowKey("line"),
    accountId: String(line.accountId),
    description: line.description ?? "",
    debit: line.side === "debit" ? line.amountCents : null,
    credit: line.side === "credit" ? line.amountCents : null,
    programCode: line.programCode ?? "",
    fundRestrictionId: line.fundRestrictionId ? String(line.fundRestrictionId) : "",
    counterpartyId: line.counterpartyId ? String(line.counterpartyId) : "",
    grantId: line.grantId ? String(line.grantId) : "",
  };
}

function sameForm(a: EntryForm, b: EntryForm) {
  return a.date === b.date && a.fiscalYear === b.fiscalYear && a.memo === b.memo && a.allowClosed === b.allowClosed;
}

/**
 * Post a new journal entry or edit a manual one in the spreadsheet lines
 * grid: date, fiscal year, memo, the closed-period adjustment switch and
 * balanced lines. Stays mounted so the grid keeps one changeset; `open` and
 * `entry` choose what it shows.
 */
export function JournalEntryEditor({ open, entry, societyId, accounts, links, canWrite, onClose }: {
  open: boolean;
  /** The entry being edited, or null for a new one. */
  entry: JournalEntryDetail | null;
  societyId: Id<"societies">;
  accounts: GridAccount[];
  links: JournalLinkOptions;
  canWrite: boolean;
  onClose: () => void;
}) {
  const upsert = useMutation(api.accounting.upsertJournalEntry);
  const confirm = useConfirm();
  const toast = useToast();
  const grid = useJournalLinesGrid({ accounts, fundRestrictions: links.fundRestrictions, counterparties: links.counterparties, grants: links.grants });
  const [form, setForm] = useState<EntryForm>(() => formFor(null));
  const [savedForm, setSavedForm] = useState<EntryForm>(() => formFor(null));
  const [saving, setSaving] = useState(false);
  const extras = useRef(new Map<string, LineExtras>());

  // Load the entry (or a blank one) each time the editor opens. Only a new
  // open (or a different entry) reloads; live updates to the entry don't wipe edits.
  const { rebase } = grid.changeset;
  const entryRef = useRef(entry);
  entryRef.current = entry;
  const openedFor = open ? entry?._id ?? "new" : null;
  useEffect(() => {
    if (openedFor === null) return;
    const current = entryRef.current;
    const initial = formFor(current);
    setForm(initial);
    setSavedForm(initial);
    extras.current = new Map();
    if (current) {
      const rows = current.lines.map((line) => {
        const row = rowFor(line);
        extras.current.set(row.key, { documentIds: line.documentIds, financialTransactionId: line.financialTransactionId, transactionCandidateId: line.transactionCandidateId });
        return row;
      });
      while (rows.length < 2) rows.push(blankJournalRow());
      rebase(rows);
    } else {
      rebase([blankJournalRow(), blankJournalRow()]);
    }
  }, [openedFor, rebase]);

  const dirty = open && (grid.changeset.dirty || !sameForm(form, savedForm));
  useBeforeUnloadGuard(dirty);

  const close = async () => {
    if (dirty) {
      const discard = await confirm({
        title: entry ? "Discard your changes?" : "Discard this entry?",
        message: entry ? "Your changes to this journal entry have not been saved." : "The lines you entered have not been posted. Closing discards them.",
        confirmLabel: entry ? "Discard changes" : "Discard lines",
        tone: "warn",
      });
      if (!discard) return;
    }
    onClose();
  };

  const blockedReason = !form.date ? "Choose the entry date" : grid.blockedReason;

  const save = async () => {
    if (!canWrite || saving) return;
    if (blockedReason) {
      toast.warn(entry ? "Journal entry not saved" : "Journal entry not posted", blockedReason);
      return;
    }
    const filled = grid.changeset.rows.filter((row) => !isBlankRow(row, grid.columns));
    const lines = grid.toLines().map((line, index) => {
      const kept = extras.current.get(filled[index]?.key ?? "") ?? {};
      return {
        accountId: line.accountId as Id<"financialAccounts">,
        side: line.side,
        amountCents: line.amountCents,
        description: line.description,
        programCode: line.programCode,
        counterpartyId: line.counterpartyId as Id<"accountingCounterparties"> | undefined,
        fundRestrictionId: line.fundRestrictionId as Id<"fundRestrictions"> | undefined,
        grantId: line.grantId as Id<"grants"> | undefined,
        ...(kept.documentIds?.length ? { documentIds: kept.documentIds as Id<"documents">[] } : {}),
        ...(kept.financialTransactionId ? { financialTransactionId: kept.financialTransactionId as Id<"financialTransactions"> } : {}),
        ...(kept.transactionCandidateId ? { transactionCandidateId: kept.transactionCandidateId as Id<"transactionCandidates"> } : {}),
      };
    });
    setSaving(true);
    try {
      await upsert({
        ...(entry ? { id: entry._id as Id<"journalEntries"> } : {}),
        societyId,
        date: form.date,
        memo: form.memo.trim() || "Manual journal entry",
        source: form.allowClosed ? "adjustment" : "manual",
        status: entry?.status === "draft" ? "draft" : "posted",
        fiscalYear: form.fiscalYear.trim() || undefined,
        allowClosedPeriodAdjustment: form.allowClosed,
        lines,
      });
      toast.success(entry ? "Journal entry saved" : "Journal entry posted");
      onClose();
    } catch (error) {
      toast.error(entry ? "Journal entry not saved" : "Journal entry not posted", booksErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof EntryForm>(key: K, value: EntryForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const showBlocked = dirty ? blockedReason : null;

  return (
    <GridDrawer
      open={open}
      onClose={() => void close()}
      title={entry ? "Edit journal entry" : "Post journal entry"}
      subtitle={entry?.entryNumber ? `Entry ${entry.entryNumber}` : undefined}
      footer={
        <>
          {showBlocked && <span className="accounting-lines-blocked" role="status">{showBlocked}</span>}
          <button type="button" className="btn" onClick={() => void close()}>Cancel</button>
          <button type="button" className="btn btn--accent" disabled={!canWrite || saving || Boolean(blockedReason) || (Boolean(entry) && !dirty)} title={blockedReason ?? undefined} onClick={() => void save()}>
            {entry ? "Save changes" : "Post"}
          </button>
        </>
      }
    >
      <div className="accounting-form-grid">
        <Field label="Date" required><DatePicker value={form.date} onChange={(value) => set("date", value)} disabled={!canWrite} clearable={false} /></Field>
        <Field label="Fiscal year"><input className="input" value={form.fiscalYear} disabled={!canWrite} onChange={(event) => set("fiscalYear", event.target.value)} /></Field>
        <Field label="Memo"><input className="input" value={form.memo} placeholder="Manual journal entry" disabled={!canWrite} onChange={(event) => set("memo", event.target.value)} /></Field>
        <label className="checkbox" title="Post into a closed fiscal period as an adjustment. The books close date still applies.">
          <input type="checkbox" checked={form.allowClosed} disabled={!canWrite} onChange={(event) => set("allowClosed", event.target.checked)} /> Closed-period adjustment
        </label>
      </div>
      <JournalLinesGrid grid={grid} label="Journal lines" readOnly={!canWrite} onSaveShortcut={() => void save()} />
    </GridDrawer>
  );
}
