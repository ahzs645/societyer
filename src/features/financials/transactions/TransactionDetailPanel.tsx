import { useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, CheckCheck, ChevronDown, ChevronUp, CircleCheck, CircleDashed, Link2, PenLine, Zap } from "lucide-react";
import { Drawer } from "../../../components/ui";
import { Money } from "../../../components/Money";
import { ShortcutHint } from "../../../components/ShortcutHint";
import { useToast } from "../../../components/Toast";
import { formatDate, formatDateTime, pluralize } from "../../../lib/format";
import { normalizeRuleText, transactionPayee } from "../../../../shared/transactionRules";
import { findPayeeAlias } from "../../../../shared/payeeAliases";
import { CategorizationProvenance } from "../rules/CategorizationProvenance";
import { draftFromTransaction } from "../rules/draftFromTransaction";
import { useRuleDrawer } from "./RuleDrawerHost";
import { PayeeRenameDialog, type PayeeRenameTarget } from "./PayeeRenameDialog";
import { TransactionReceipt } from "./TransactionReceipt";
import {
  ATTENTION_LABELS,
  CATEGORIZED_BY_LABELS,
  attentionReasons,
  categorizedByValue,
} from "../../../../shared/transactionAttention";
import type { PayeeAliasRow } from "./usePayeeAliases";
import { useRecordTableRowModel } from "../../../platform/record-engine/record-table/hooks/useRecordTableRowModel";
import { useRecordTableStoreHandle } from "../../../platform/record-engine/record-table/state/recordTableStore";

/** A transactions-table row as the Financials page maps it. */
export type PanelTransaction = {
  _id: string;
  date: string;
  description: string;
  /** The payee as the bank or sync sent it. */
  counterparty?: string;
  /** The payee to show (a rename rule's name, else the raw payee). */
  payeeName?: string;
  amountCents: number;
  account?: string;
  method?: string;
  status?: string;
  category?: string;
  categorizedBy?: string;
  ruleId?: string;
  ruleApplication?: { ruleName?: string; appliedAtISO?: string } | null;
  memo?: string;
  receiptStatus?: string;
  receiptDocumentId?: string;
  reviewedAtISO?: string;
  reconciledAtISO?: string;
  reconciledByName?: string;
  matchedKind?: string;
  reconciliationNote?: string;
  fundRestrictionId?: string;
};

const MATCH_LABELS: Record<string, string> = {
  filing: "a filing",
  receipt: "a receipt",
  payroll: "a payroll run",
  manual: "the bank statement",
  invoice: "an invoice",
  claim: "an expense claim",
  bill: "a bill payment",
};

/** The raw payee a rule or a rename should match. */
function rawPayeeOf(txn: PanelTransaction): string {
  return transactionPayee(txn);
}

/** `/app/financials?tab=transactions&txn=<id>` on the current origin (keeps the /demo prefix). */
export function transactionDeepLink(id: string): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("tab", "transactions");
  url.searchParams.set("txn", id);
  return url.toString();
}

/**
 * The transaction side panel on Financials → Transactions: amount, details,
 * editable category and notes, receipt, how it was categorised, its
 * reconciliation match and the payee's other transactions. ↑/↓ step through
 * the table (handled by the record table's panel bridge).
 */
export function TransactionDetailPanel({
  record,
  records,
  aliases,
  societyId,
  canWrite,
  fundName,
  onClose,
  onNavigate,
  onUpdate,
  onMarkReviewed,
}: {
  record: PanelTransaction;
  /** Every row in the table (for "Other transactions with …"). */
  records: readonly PanelTransaction[];
  aliases: readonly PayeeAliasRow[];
  societyId: string;
  canWrite: boolean;
  fundName?: string;
  onClose: () => void;
  onNavigate: (record: PanelTransaction) => void;
  onUpdate: (fieldName: string, value: unknown) => Promise<void>;
  onMarkReviewed: () => Promise<void>;
}) {
  const toast = useToast();
  const drawer = useRuleDrawer();
  const [category, setCategory] = useState(record.category ?? "");
  const [memo, setMemo] = useState(record.memo ?? "");
  const [renameTarget, setRenameTarget] = useState<PayeeRenameTarget | null>(null);

  useEffect(() => setCategory(record.category ?? ""), [record._id, record.category]);
  useEffect(() => setMemo(record.memo ?? ""), [record._id, record.memo]);

  const rawPayee = rawPayeeOf(record);
  const displayPayee = record.payeeName || rawPayee;
  const payeeNorm = normalizeRuleText(rawPayee);
  const isIn = record.amountCents > 0;
  const method = categorizedByValue(record);
  const reasons = attentionReasons(record);
  const existingAlias = useMemo(() => findPayeeAlias(aliases, rawPayee) ?? undefined, [aliases, rawPayee]);

  const others = useMemo(
    () =>
      records
        .filter((row) => row._id !== record._id && normalizeRuleText(rawPayeeOf(row)) === payeeNorm)
        .sort((a, b) => String(b.date).localeCompare(String(a.date))),
    [payeeNorm, record._id, records],
  );

  const commitCategory = () => {
    const next = category.trim();
    if (next === (record.category ?? "")) return;
    void onUpdate("category", next);
  };
  const commitMemo = () => {
    if (memo.trim() === (record.memo ?? "").trim()) return;
    void onUpdate("memo", memo);
  };

  // Previous / next follow the table's current order (search, filters and
  // sort applied), like ↑ / ↓ — buttons so phones and touch can step too.
  const { records: tableOrder } = useRecordTableRowModel();
  const tableHandle = useRecordTableStoreHandle();
  const position = tableOrder.findIndex((row: any) => String(row._id) === String(record._id));
  const step = (delta: number) => {
    const nextIndex = position + delta;
    const next = position < 0 ? undefined : tableOrder[nextIndex];
    if (!next) return;
    onNavigate(next as PanelTransaction);
    const columnIndex = tableHandle.get().focusedCell?.columnIndex ?? 0;
    tableHandle.get().setRangeAnchor(null);
    tableHandle.get().setFocusedCell({ rowIndex: nextIndex, columnIndex });
  };

  const copyLink = async () => {
    const link = transactionDeepLink(record._id);
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copied", "It opens this transaction for anyone with access.");
    } catch {
      toast.info("Copy this link", link);
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={displayPayee}
      className="record-side-panel transaction-panel"
      bodyClassName="transaction-panel__body"
      footerClassName="transaction-panel__footer"
      header={
        <div className="record-side-panel__identity">
          <span className="record-side-panel__avatar" aria-hidden="true">{displayPayee.trim().charAt(0).toUpperCase() || "T"}</span>
          <span className="record-side-panel__identity-copy">
            <strong>{displayPayee}</strong>
            <small>{formatDate(record.date, "EEEE, MMMM d, yyyy")}</small>
          </span>
        </div>
      }
      footer={
        <>
          <button type="button" className="btn btn--sm" onClick={() => void copyLink()}>
            <Link2 size={14} aria-hidden="true" /> Copy link
          </button>
          <span className="transaction-panel__nav-hint" aria-hidden="true">
            <ShortcutHint keys={["↑"]} /> <ShortcutHint keys={["↓"]} /> next and previous
          </span>
          <span role="group" aria-label="Step through transactions" style={{ display: "inline-flex", gap: 4 }}>
            <button type="button" className="btn btn--sm btn--icon" aria-label="Previous transaction" aria-keyshortcuts="ArrowUp" disabled={position <= 0} onClick={() => step(-1)}>
              <ChevronUp size={14} aria-hidden="true" />
            </button>
            <button type="button" className="btn btn--sm btn--icon" aria-label="Next transaction" aria-keyshortcuts="ArrowDown" disabled={position < 0 || position >= tableOrder.length - 1} onClick={() => step(1)}>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
          </span>
        </>
      }
    >
      <section className="transaction-panel__hero" aria-label="Amount">
        <span className={`transaction-panel__direction transaction-panel__direction--${isIn ? "in" : "out"}`}>
          {isIn ? <ArrowDownLeft size={14} aria-hidden="true" /> : <ArrowUpRight size={14} aria-hidden="true" />}
          {isIn ? "Money in" : "Money out"}
        </span>
        <Money cents={record.amountCents} variant="hero" tone={isIn ? "in" : "out"} signDisplay="exceptZero" />
        {reasons.length > 0 && (
          <ul className="transaction-panel__attention" aria-label="Needs attention">
            {reasons.map((reason) => (
              <li key={reason} className={`transaction-panel__chip transaction-panel__chip--${reason}`}>{ATTENTION_LABELS[reason]}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="transaction-panel__section" aria-labelledby="txn-panel-details">
        <h3 className="transaction-panel__heading" id="txn-panel-details">Details</h3>
        <dl className="transaction-panel__facts">
          <div><dt>Date</dt><dd>{formatDate(record.date)}</dd></div>
          <div><dt>Account</dt><dd>{record.account || "—"}</dd></div>
          <div><dt>Method</dt><dd>{record.method || "—"}</dd></div>
          <div><dt>Status</dt><dd>{record.status === "pending" ? <span className="transaction-panel__status is-pending">Pending</span> : "Posted"}</dd></div>
          {fundName && <div><dt>Fund</dt><dd>{fundName}</dd></div>}
          {normalizeRuleText(record.description) !== normalizeRuleText(displayPayee) && (
            <div><dt>Bank description</dt><dd className="transaction-panel__raw">{record.description}</dd></div>
          )}
        </dl>
        {canWrite && (
          <button
            type="button"
            className="btn btn--ghost btn--sm transaction-panel__rename"
            onClick={() => setRenameTarget(existingAlias ? { rawPayee, alias: existingAlias } : { rawPayee })}
          >
            <PenLine size={12} aria-hidden="true" /> Rename payee for all past and future transactions…
          </button>
        )}
      </section>

      <section className="transaction-panel__section" aria-labelledby="txn-panel-category">
        <h3 className="transaction-panel__heading" id="txn-panel-category">Category</h3>
        <div className="transaction-panel__category">
          <input
            className="input"
            aria-label="Category"
            list="txn-panel-category-options"
            value={category}
            placeholder="Uncategorised"
            disabled={!canWrite}
            onChange={(event) => setCategory(event.target.value)}
            onBlur={commitCategory}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitCategory();
              }
              if (event.key === "Escape") setCategory(record.category ?? "");
            }}
          />
          <datalist id="txn-panel-category-options">
            {(drawer?.workspace?.categories ?? []).map((option) => <option key={option} value={option} />)}
          </datalist>
          <CategorizationProvenance txn={record} />
        </div>
        <p className="transaction-panel__meta">
          {method ? (
            <>
              Categorised by <strong>{CATEGORIZED_BY_LABELS[method].toLowerCase()}</strong>
              {method === "rule" && record.ruleApplication?.ruleName ? <> · {record.ruleApplication.ruleName}</> : null}
            </>
          ) : (
            "Not categorised yet."
          )}
          {record.reviewedAtISO ? <> · Reviewed {formatDate(record.reviewedAtISO)}</> : null}
        </p>
        {canWrite && (
          <div className="transaction-panel__inline-actions">
            {!record.reviewedAtISO && (
              <button type="button" className="btn btn--sm" onClick={() => void onMarkReviewed()}>
                <CheckCheck size={12} aria-hidden="true" /> Mark reviewed
              </button>
            )}
            {drawer && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => drawer.openDraft(draftFromTransaction(record, record.category))}
              >
                <Zap size={12} aria-hidden="true" /> Create a rule for {displayPayee}
              </button>
            )}
          </div>
        )}
      </section>

      <section className="transaction-panel__section" aria-labelledby="txn-panel-notes">
        <h3 className="transaction-panel__heading" id="txn-panel-notes">Notes</h3>
        <textarea
          className="input transaction-panel__notes"
          aria-labelledby="txn-panel-notes"
          rows={3}
          value={memo}
          placeholder={canWrite ? "Add a note, e.g. what this was for" : "No notes"}
          disabled={!canWrite}
          onChange={(event) => setMemo(event.target.value)}
          onBlur={commitMemo}
        />
      </section>

      <section className="transaction-panel__section" aria-labelledby="txn-panel-receipt">
        <h3 className="transaction-panel__heading" id="txn-panel-receipt">
          Receipt
          {record.receiptStatus && (
            <span className={`transaction-panel__status ${record.receiptStatus === "attached" ? "is-ok" : "is-missing"}`}>
              {record.receiptStatus === "attached" ? "Attached" : "Missing"}
            </span>
          )}
        </h3>
        <TransactionReceipt
          societyId={societyId}
          txn={record}
          payee={displayPayee}
          canWrite={canWrite}
          onAttach={(documentId) => onUpdate("receiptDocumentId", documentId)}
        />
      </section>

      <ReconciliationSection record={record} />
      <OtherTransactionsSection payee={displayPayee} others={others} onNavigate={onNavigate} />

      <PayeeRenameDialog
        target={renameTarget}
        societyId={societyId}
        transactions={records}
        canWrite={canWrite}
        onClose={() => setRenameTarget(null)}
      />
    </Drawer>
  );
}

function ReconciliationSection({ record }: { record: PanelTransaction }) {
  return (
    <section className="transaction-panel__section" aria-labelledby="txn-panel-recon">
      <h3 className="transaction-panel__heading" id="txn-panel-recon">Reconciliation</h3>
      {record.reconciledAtISO ? (
        <div className="transaction-panel__recon is-matched">
          <CircleCheck size={16} aria-hidden="true" />
          <div>
            <div>Matched to {MATCH_LABELS[record.matchedKind ?? "manual"] ?? "a record"}</div>
            <div className="transaction-panel__meta">
              {formatDateTime(record.reconciledAtISO)}
              {record.reconciledByName ? ` by ${record.reconciledByName}` : ""}
              {record.reconciliationNote ? ` · ${record.reconciliationNote}` : ""}
            </div>
          </div>
        </div>
      ) : (
        <div className="transaction-panel__recon">
          <CircleDashed size={16} aria-hidden="true" />
          <div>
            <div>Not reconciled yet</div>
            <div className="transaction-panel__meta">It is matched when its statement period is reconciled.</div>
          </div>
        </div>
      )}
    </section>
  );
}

function OtherTransactionsSection({
  payee,
  others,
  onNavigate,
}: {
  payee: string;
  others: readonly PanelTransaction[];
  onNavigate: (record: PanelTransaction) => void;
}) {
  return (
    <section className="transaction-panel__section" aria-labelledby="txn-panel-others">
      <h3 className="transaction-panel__heading" id="txn-panel-others">Other transactions with {payee}</h3>
      {others.length === 0 ? (
        <p className="transaction-panel__meta">No other transactions with this payee.</p>
      ) : (
        <>
          <ul className="transaction-panel__others">
            {others.slice(0, 5).map((row) => (
              <li key={row._id}>
                <button type="button" className="transaction-panel__other" onClick={() => onNavigate(row)}>
                  <span className="transaction-panel__other-date">{formatDate(row.date)}</span>
                  <span className="transaction-panel__other-category">{row.category || "Uncategorised"}</span>
                  <Money cents={row.amountCents} tone={row.amountCents > 0 ? "in" : "out"} signDisplay="exceptZero" />
                </button>
              </li>
            ))}
          </ul>
          {others.length > 5 && <p className="transaction-panel__meta">and {pluralize(others.length - 5, "earlier transaction")}</p>}
        </>
      )}
    </section>
  );
}
