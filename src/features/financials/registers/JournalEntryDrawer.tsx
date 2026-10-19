import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Ban, Lock, Pencil } from "lucide-react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Badge, Drawer, SkeletonRows, type ToneVariant } from "../../../components/ui";
import { Money } from "../../../components/Money";
import { usePrompt } from "../../../components/Modal";
import { useToast } from "../../../components/Toast";
import { formatDate, formatDateTime } from "../../../lib/format";
import { booksErrorMessage } from "../settings/booksSettings";
import { REVIEW_FLAG_HINT, REVIEW_FLAG_LABEL, accountRefLabel, entryLockReason, humanise, sourceLabel } from "./registerModel";
import type { JournalRecord } from "./registerRecords";
import type { JournalLinkOptions } from "./useJournalLinkOptions";

/** One line of `accounting.journalEntry` (the Convex wrapper is typed `any`). */
export type JournalLineDetail = {
  _id: string;
  accountId: string;
  side: "debit" | "credit";
  amountCents: number;
  description?: string;
  programCode?: string;
  fundRestrictionId?: string;
  counterpartyId?: string;
  grantId?: string;
  financialTransactionId?: string;
  transactionCandidateId?: string;
  documentIds?: string[];
};

export type JournalEntryDetail = {
  _id: string;
  date: string;
  memo: string;
  status: string;
  source: string;
  fiscalYear?: string;
  entryNumber?: string;
  reference?: string;
  basis?: string;
  createdAtISO?: string;
  postedAtISO?: string;
  voidedAtISO?: string;
  lines: JournalLineDetail[];
};

export type AccountLookup = ReadonlyMap<string, { code?: string | null; name: string; currency?: string | null }>;

export const STATUS_TONE: Record<string, ToneVariant> = { posted: "success", draft: "warn", void: "neutral" };
const BASIS_LABEL: Record<string, string> = { both: "Cash and accrual", "accrual-only": "Accrual only", "cash-only": "Cash only" };

/**
 * One journal entry: its header facts, lines with fund, program, counterparty
 * and grant tags, and totals. Manual entries and adjustments in open periods
 * can be edited or voided from here; others say why not.
 */
export function JournalEntryDrawer({ record, accounts, links, canWrite, closeDate, onEdit, onClose }: {
  record: JournalRecord;
  accounts: AccountLookup;
  links: JournalLinkOptions;
  canWrite: boolean;
  closeDate: string | null;
  onEdit: (entry: JournalEntryDetail) => void;
  onClose: () => void;
}) {
  const entry = useQuery(api.accounting.journalEntry, { id: record.entryId as Id<"journalEntries"> }) as JournalEntryDetail | null | undefined;
  const voidEntry = useMutation(api.accounting.voidJournalEntry);
  const prompt = usePrompt();
  const toast = useToast();
  const [voiding, setVoiding] = useState(false);

  const lockReason = entryLockReason(record, closeDate ? formatDate(closeDate) : null);
  const blocked = !canWrite ? "You need finance edit access to change journal entries." : lockReason;
  const currency = record.currency ?? undefined;

  const runVoid = async () => {
    const reason = await prompt({
      title: "Void this journal entry?",
      message: "Its lines stop counting in every report. The entry stays in the register, marked void. Add a reason for the audit trail if you like.",
      placeholder: "Reason (optional)",
      confirmLabel: "Void entry",
      required: false,
    });
    if (reason === null) return;
    setVoiding(true);
    try {
      await voidEntry({ id: record.entryId as Id<"journalEntries">, reason: reason.trim() || undefined });
      toast.success("Journal entry voided");
    } catch (error) {
      toast.error("Journal entry not voided", booksErrorMessage(error));
    } finally {
      setVoiding(false);
    }
  };

  const debitTotal = entry ? entry.lines.reduce((sum, line) => sum + (line.side === "debit" ? line.amountCents : 0), 0) : 0;
  const creditTotal = entry ? entry.lines.reduce((sum, line) => sum + (line.side === "credit" ? line.amountCents : 0), 0) : 0;

  return (
    <Drawer
      open
      size="wide"
      onClose={onClose}
      title={record.memo}
      footer={
        <>
          {blocked && canWrite && <span className="books-register__blocked" role="status">{blocked}</span>}
          <button type="button" className="btn" onClick={onClose}>Close</button>
          {canWrite && (
            <>
              <button type="button" className="btn" disabled={Boolean(blocked) || voiding} title={blocked ?? undefined} onClick={() => void runVoid()}>
                <Ban size={12} aria-hidden="true" /> Void
              </button>
              <button type="button" className="btn btn--accent" disabled={Boolean(blocked) || !entry} title={blocked ?? undefined} onClick={() => entry && onEdit(entry)}>
                <Pencil size={12} aria-hidden="true" /> Edit
              </button>
            </>
          )}
        </>
      }
    >
      <div className="books-register__badges">
        <Badge tone={STATUS_TONE[record.status] ?? "neutral"}>{humanise(record.status)}</Badge>
        <Badge>{sourceLabel(record.source)}</Badge>
        {record.locked && <Badge tone="info"><Lock size={10} aria-hidden="true" /> Closed period</Badge>}
        {record.reviewFlags.map((flag) => (
          <span key={flag} title={REVIEW_FLAG_HINT[flag]}><Badge tone="warn">{REVIEW_FLAG_LABEL[flag] ?? humanise(flag)}</Badge></span>
        ))}
      </div>
      <dl className="books-register__facts">
        <div><dt>Date</dt><dd>{formatDate(record.date)}</dd></div>
        <div><dt>Amount</dt><dd><Money cents={record.amountCents} currency={currency} /></dd></div>
        {record.entryNumber && <div><dt>Entry number</dt><dd>{record.entryNumber}</dd></div>}
        {record.reference && <div><dt>Reference</dt><dd>{record.reference}</dd></div>}
        {entry?.fiscalYear && <div><dt>Fiscal year</dt><dd>{entry.fiscalYear}</dd></div>}
        <div><dt>Basis</dt><dd>{BASIS_LABEL[record.basis] ?? humanise(record.basis)}</dd></div>
        {record.createdAtISO && <div><dt>Date created</dt><dd>{formatDateTime(record.createdAtISO)}</dd></div>}
        {entry?.voidedAtISO && <div><dt>Voided</dt><dd>{formatDateTime(entry.voidedAtISO)}</dd></div>}
      </dl>
      {lockReason && !canWrite && <p className="muted books-register__note">{lockReason}</p>}

      <h3 className="books-register__section-title">Lines</h3>
      {entry === undefined ? (
        <SkeletonRows rows={3} columns={4} />
      ) : entry === null ? (
        <p className="muted">This entry is no longer available.</p>
      ) : (
        <div className="books-register__lines">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">Description</th>
                <th scope="col" className="num">Debit</th>
                <th scope="col" className="num">Credit</th>
                <th scope="col">Tags</th>
              </tr>
            </thead>
            <tbody>
              {entry.lines.map((line) => {
                const account = accounts.get(String(line.accountId));
                return (
                  <tr key={line._id}>
                    <td>{account ? accountRefLabel({ code: account.code ?? undefined, name: account.name }) : <span className="muted">Unknown account</span>}</td>
                    <td>{line.description || <span className="muted">—</span>}</td>
                    <td className="num">{line.side === "debit" ? <Money cents={line.amountCents} currency={account?.currency ?? currency} /> : null}</td>
                    <td className="num">{line.side === "credit" ? <Money cents={line.amountCents} currency={account?.currency ?? currency} /> : null}</td>
                    <td><LineTags line={line} links={links} /></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={2}>Total</th>
                <td className="num"><Money cents={debitTotal} currency={currency} /></td>
                <td className="num"><Money cents={creditTotal} currency={currency} /></td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Drawer>
  );
}

function LineTags({ line, links }: { line: JournalLineDetail; links: JournalLinkOptions }) {
  const tags = [
    line.fundRestrictionId ? `Fund: ${links.fundLabel.get(String(line.fundRestrictionId)) ?? "Restricted fund"}` : null,
    line.programCode ? `Program: ${line.programCode}` : null,
    line.counterpartyId ? links.counterpartyLabel.get(String(line.counterpartyId)) ?? "Counterparty" : null,
    line.grantId ? `Grant: ${links.grantLabel.get(String(line.grantId)) ?? "Grant"}` : null,
  ].filter((tag): tag is string => Boolean(tag));
  if (tags.length === 0) return <span className="muted">—</span>;
  return (
    <span className="books-register__tags">
      {tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}
    </span>
  );
}
