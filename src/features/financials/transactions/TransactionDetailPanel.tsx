import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, CheckCheck, ChevronDown, ChevronUp, CircleCheck, CircleDashed, Link2, Maximize2, MessageSquare, Minimize2, PenLine, RotateCcw, Zap } from "lucide-react";
import { Drawer } from "../../../components/ui";
import { Tabs } from "../../../components/primitives";
import { NotesPanel } from "../../../components/NotesPanel";
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
import { isTypingTarget } from "../../../lib/shortcutsRegistry";
import { splitLabel, type TransactionLine } from "../../../../shared/transactionLines";
import { TransactionLinesEditor } from "./TransactionLinesEditor";
import { TransactionJournalView } from "./TransactionJournalView";
import type { FinanceTagsApi } from "./useFinanceTags";
import type { ReviewSegment } from "./transactionFilters";

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
  accountingAccountId?: string;
  tagIds?: string[];
  lines?: TransactionLine[];
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

/** `/app/financials?tab=transactions&transactionId=<id>` on the current origin (keeps the /demo prefix). */
export function transactionDeepLink(id: string): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("tab", "transactions");
  url.searchParams.set("transactionId", id);
  return url.toString();
}

type PanelTab = "transaction" | "journal";

/**
 * The transaction side panel on Financials → Transactions. "Transaction"
 * shows the amount, details, line items (category, or a split with ledger
 * accounts, funds, memos and tags), notes, receipt, comments, how it was
 * categorised, its reconciliation match and the payee's other transactions;
 * "Journal entry" shows the debit and credit lines it posts. ↑/↓ step
 * through the table (the record table's panel bridge); R and U mark it
 * reviewed or not (moving on when it leaves the current queue).
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
  onSetReviewed,
  tags,
  reviewSegment,
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
  onSetReviewed: (reviewed: boolean) => Promise<void>;
  tags: FinanceTagsApi;
  /** The queue the table shows; marking a row out of it moves to the next row. */
  reviewSegment: ReviewSegment;
}) {
  const toast = useToast();
  const drawer = useRuleDrawer();
  const [memo, setMemo] = useState(record.memo ?? "");
  const [renameTarget, setRenameTarget] = useState<PayeeRenameTarget | null>(null);
  const [tab, setTab] = useState<PanelTab>("transaction");
  const [expanded, setExpanded] = useState(false);
  const commentsRef = useRef<HTMLElement>(null);

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

  // Marking the row out of the queue the table shows (reviewed while in "To
  // review", or back while in "Reviewed") moves on to the next row first, so
  // the panel never shows a row that has left the table.
  const setReviewed = async (reviewed: boolean) => {
    if (Boolean(record.reviewedAtISO) === reviewed) return;
    const leavesQueue = reviewed ? reviewSegment === "to_review" : reviewSegment === "reviewed";
    if (leavesQueue && position >= 0) {
      const next = tableOrder[position + 1] ?? tableOrder[position - 1];
      tableHandle.get().setRangeAnchor(null);
      tableHandle.get().setFocusedCell(null);
      if (next) onNavigate(next as PanelTransaction);
      else onClose();
    }
    await onSetReviewed(reviewed);
  };
  const setReviewedRef = useRef(setReviewed);
  setReviewedRef.current = setReviewed;

  // R / U: reviewed / not reviewed, unless rows are selected (the table's
  // shortcut then marks the selection). Capture phase, so a focused grid
  // cell does not start editing with the letter.
  useEffect(() => {
    if (!canWrite) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key !== "r" && key !== "u") return;
      if (isTypingTarget(event.target) || tableHandle.get().selectedRecordIds.size > 0) return;
      if (event.target instanceof Element && event.target.closest('[role="dialog"]:not(.record-side-panel):not(.inspector-panel)')) return;
      event.preventDefault();
      event.stopPropagation();
      void setReviewedRef.current(key === "r");
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [canWrite, tableHandle]);

  const showComments = () => {
    setTab("transaction");
    window.requestAnimationFrame(() => {
      commentsRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      commentsRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    });
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
      size={expanded ? "wide" : "default"}
      className={`record-side-panel transaction-panel${expanded ? " transaction-panel--expanded" : ""}`}
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
          <button type="button" className="btn btn--sm btn--icon" aria-label="Comment" title="Comment" onClick={showComments}>
            <MessageSquare size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn btn--sm btn--icon"
            aria-label={expanded ? "Narrow the panel" : "Widen the panel"}
            title={expanded ? "Narrow the panel" : "Widen the panel"}
            aria-pressed={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
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

      <div className="transaction-panel__tabs">
        <Tabs<PanelTab>
          value={tab}
          onChange={setTab}
          tabRoles
          ariaLabel="Transaction views"
          items={[
            { id: "transaction", label: "Transaction" },
            { id: "journal", label: "Journal entry" },
          ]}
        />
      </div>

      {tab === "journal" ? (
        <section className="transaction-panel__section" aria-label="Journal entry">
          <TransactionJournalView
            transactionId={record._id}
            tags={tags}
            fundName={(id) => drawer?.workspace?.fundRestrictions.find((fund) => fund._id === id)?.name ?? drawer?.workspace?.archivedFunds?.find((fund) => fund._id === id)?.name}
          />
        </section>
      ) : (
        <>
          <section className="transaction-panel__section" aria-labelledby="txn-panel-details">
            <h3 className="transaction-panel__heading" id="txn-panel-details">Details</h3>
            <dl className="transaction-panel__facts">
              <div><dt>Date</dt><dd>{formatDate(record.date)}</dd></div>
              <div><dt>Account</dt><dd>{record.account || "—"}</dd></div>
              <div><dt>Method</dt><dd>{record.method || "—"}</dd></div>
              <div><dt>Status</dt><dd>{record.status === "pending" ? <span className="transaction-panel__status is-pending">Pending</span> : "Posted"}</dd></div>
              {fundName && !splitLabel(record) && <div><dt>Fund</dt><dd>{fundName}</dd></div>}
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
            <h3 className="transaction-panel__heading" id="txn-panel-category">
              {splitLabel(record) ? `Line items · ${record.lines!.length}` : "Category"}
              <CategorizationProvenance txn={record} />
            </h3>
            <TransactionLinesEditor
              record={record}
              canWrite={canWrite}
              categories={drawer?.workspace?.categories ?? []}
              accounts={drawer?.workspace?.accounts ?? []}
              funds={drawer?.workspace?.fundRestrictions ?? []}
              tags={tags}
              societyId={societyId}
              onCommitCategory={(next) => void onUpdate("category", next)}
            />
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
                {record.reviewedAtISO ? (
                  <button type="button" className="btn btn--ghost btn--sm" aria-keyshortcuts="U" onClick={() => void setReviewed(false)}>
                    <RotateCcw size={12} aria-hidden="true" /> Mark unreviewed <ShortcutHint keys={["U"]} />
                  </button>
                ) : (
                  <button type="button" className="btn btn--sm" aria-keyshortcuts="R" onClick={() => void setReviewed(true)}>
                    <CheckCheck size={12} aria-hidden="true" /> Mark reviewed <ShortcutHint keys={["R"]} />
                  </button>
                )}
                {drawer && !splitLabel(record) && (
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

          <section className="transaction-panel__section" aria-labelledby="txn-panel-comments" ref={commentsRef}>
            <h3 className="transaction-panel__heading" id="txn-panel-comments">Comments</h3>
            <NotesPanel
              entityType="financialTransaction"
              entityId={record._id}
              noun="comment"
              emptyDescription="Ask about this transaction or leave context for the treasurer. Use @ to mention someone."
            />
          </section>

          <ReconciliationSection record={record} />
          <OtherTransactionsSection payee={displayPayee} others={others} onNavigate={onNavigate} />
        </>
      )}

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
                  <span className="transaction-panel__other-category">{splitLabel(row) ?? (row.category || "Uncategorised")}</span>
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
