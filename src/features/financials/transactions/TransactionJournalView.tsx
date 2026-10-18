import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { BookCheck, BookDashed } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Money } from "../../../components/Money";
import { formatDate } from "../../../lib/format";
import { TagChips } from "./TagPicker";
import type { FinanceTagsApi } from "./useFinanceTags";

type JournalLineView = {
  accountId: string;
  accountLabel: string;
  side: "debit" | "credit";
  amountCents: number;
  description?: string;
  fundRestrictionId?: string;
  tagIds: string[];
  lineOrder: number;
};

type TransactionJournal = {
  posted: { entryId: string; entryNumber?: string; date: string; status: string; source: string; lines: JournalLineView[] } | null;
  preview: { status: string; lines: JournalLineView[] };
};

const PREVIEW_HOLD_REASONS: Record<string, string> = {
  zero_amount: "A zero-amount transaction posts nothing.",
  no_cash_account: "Its bank account is not in the chart of accounts yet.",
  needs_mapping: "A line has no account to post to yet.",
};

/**
 * The "Journal entry" view of a bank transaction: the debit and credit lines
 * it posts, the bank account against each line item's account. Shows the
 * posted entry when there is one, otherwise what posting would write.
 */
export function TransactionJournalView({
  transactionId,
  tags,
  fundName,
}: {
  transactionId: string;
  tags: FinanceTagsApi;
  fundName: (fundId: string) => string | undefined;
}) {
  const journal = useQuery(api.transactionLines.journal, { id: transactionId }) as TransactionJournal | undefined;
  if (journal === undefined) return <p className="transaction-panel__meta">Loading the journal entry…</p>;
  const lines = journal.posted?.lines ?? journal.preview.lines;
  const debits = lines.filter((line) => line.side === "debit").reduce((sum, line) => sum + line.amountCents, 0);
  const credits = lines.filter((line) => line.side === "credit").reduce((sum, line) => sum + line.amountCents, 0);
  return (
    <div className="txn-journal">
      {journal.posted ? (
        <p className="txn-journal__status is-posted">
          <BookCheck size={14} aria-hidden="true" />
          <span>
            Posted{journal.posted.entryNumber ? ` as ${journal.posted.entryNumber}` : ""} on {formatDate(journal.posted.date)}.
            {journal.posted.source === "financialTransactionBackfill"
              ? " Edits to the lines here update it."
              : <> This entry came from another source; change it in <Link to="/app/financials/accounting">Accounting</Link>.</>}
          </span>
        </p>
      ) : (
        <p className="txn-journal__status">
          <BookDashed size={14} aria-hidden="true" />
          <span>
            Not posted yet. This is what <Link to="/app/financials/accounting">Backfill imports</Link> will post.
          </span>
        </p>
      )}
      {lines.length === 0 ? (
        <p className="transaction-panel__meta">{PREVIEW_HOLD_REASONS[journal.preview.status] ?? "Nothing to post."}</p>
      ) : (
        <table className="table txn-journal__table">
          <thead>
            <tr>
              <th scope="col">Account</th>
              <th scope="col" className="num">Debit</th>
              <th scope="col" className="num">Credit</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={`${line.lineOrder}-${line.accountId}`}>
                <td>
                  <div className="txn-journal__account">{line.accountLabel}</div>
                  {(line.description || line.fundRestrictionId || line.tagIds.length > 0) && (
                    <div className="txn-journal__meta">
                      {line.description && <span>{line.description}</span>}
                      {line.fundRestrictionId && <span>{fundName(line.fundRestrictionId) ?? "Restricted fund"}</span>}
                      <TagChips tagIds={line.tagIds} tags={tags} />
                    </div>
                  )}
                </td>
                <td className="num">{line.side === "debit" ? <Money cents={line.amountCents} /> : null}</td>
                <td className="num">{line.side === "credit" ? <Money cents={line.amountCents} /> : null}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td className="num"><Money cents={debits} /></td>
              <td className="num"><Money cents={credits} /></td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}
