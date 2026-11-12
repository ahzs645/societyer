import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, FileSpreadsheet } from "lucide-react";
import { FIELD_TYPES, RecordListTable, RecordTableEmpty, RecordTablePhoneCard, staticRecordTable } from "@/platform/record-engine";
import { api } from "@/lib/convexApi";
import { Badge, Drawer, Field } from "../../../components/ui";
import { Select } from "../../../components/Select";
import { useToast } from "../../../components/Toast";
import { formatDate } from "../../../lib/format";
import { formatMoney } from "../../../lib/money";
import { Money } from "../../../components/Money";

const SUSPENSE_CHOICE = "";

const STATUS_LABEL: Record<string, { label: string; tone: "success" | "warn" | "danger" | "info" | "neutral" }> = {
  post: { label: "Will post", tone: "success" },
  already_posted: { label: "Already posted", tone: "neutral" },
  before_opening: { label: "Before opening balances", tone: "warn" },
  no_cash_account: { label: "No bank account", tone: "danger" },
  needs_mapping: { label: "Needs mapping", tone: "danger" },
  zero_amount: { label: "Zero amount", tone: "neutral" },
};

const BACKFILL_ROWS_TABLE = staticRecordTable({
  id: "backfill-review:transactions",
  nameSingular: "backfillTransaction",
  namePlural: "backfillTransactions",
  labelSingular: "Transaction",
  labelPlural: "Transactions",
  labelIdentifierFieldName: "description",
  viewName: "Posting plan",
  fields: [
    { name: "date", label: "Date", fieldType: FIELD_TYPES.DATE, size: 110 },
    { name: "description", label: "Description", fieldType: FIELD_TYPES.TEXT, size: 240, config: { groupable: false } },
    { name: "category", label: "Category", fieldType: FIELD_TYPES.TEXT, size: 160 },
    { name: "amountCents", label: "Amount", fieldType: FIELD_TYPES.CURRENCY, size: 120, config: { isCents: true } },
    { name: "postTo", label: "Post to", fieldType: FIELD_TYPES.TEXT, size: 200 },
    {
      name: "status",
      label: "Status",
      fieldType: FIELD_TYPES.SELECT,
      size: 200,
      config: {
        options: [
          { value: "post", label: "Will post", color: "green" },
          { value: "already_posted", label: "Already posted", color: "gray" },
          { value: "before_opening", label: "Before opening balances", color: "amber" },
          { value: "no_cash_account", label: "No bank account", color: "red" },
          { value: "needs_mapping", label: "Needs mapping", color: "red" },
          { value: "zero_amount", label: "Zero amount", color: "gray" },
        ],
      },
    },
  ],
});

/** A row of `accounting.backfillPreview` (the fields the review reads). */
type BackfillPreviewRow = {
  transactionId: string;
  date: string;
  description?: string;
  category?: string;
  amountCents: number;
  offsetAccountLabel?: string;
  status: string;
  beforeOpening?: boolean;
};

type BackfillRecord = {
  _id: string;
  date: string;
  description: string;
  category: string;
  amountCents: number;
  /** The ledger account it posts to; empty when it won't post. */
  postTo: string;
  status: string;
  /** Posts although it's dated before the opening balances. */
  flagged: boolean;
};

function backfillRecord(row: BackfillPreviewRow): BackfillRecord {
  return {
    _id: row.transactionId,
    date: row.date,
    description: row.description ?? "",
    category: row.category ?? "",
    amountCents: row.amountCents,
    postTo: row.status === "post" ? row.offsetAccountLabel ?? "" : "",
    status: row.status,
    flagged: row.status === "post" && Boolean(row.beforeOpening),
  };
}

/** Where Financials opens a transaction in its side panel. */
function transactionHref(transactionId: string) {
  return `/app/financials?tab=transactions&transactionId=${encodeURIComponent(transactionId)}`;
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Review step for posting imported bank transactions into the journal.
 * Shows, per category, which ledger account each transaction will be posted
 * to, sends anything unmapped to an explicit suspense account, and holds back
 * transactions dated on or before the opening balances unless the person
 * explicitly includes them (they are then flagged on the journal entry).
 */
export function BackfillReviewDrawer({
  open,
  onClose,
  societyId,
  accounts,
  fiscalYear,
  canWrite,
}: {
  open: boolean;
  onClose: () => void;
  societyId: string;
  accounts: any[];
  fiscalYear: string;
  canWrite: boolean;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [includeBeforeOpening, setIncludeBeforeOpening] = useState(false);
  const [rememberMappings, setRememberMappings] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) {
      setChoices({});
      setIncludeBeforeOpening(false);
    }
  }, [open]);

  const categoryChoices = useMemo(
    () => Object.entries(choices).filter(([, accountId]) => accountId).map(([category, accountId]) => ({ category, accountId })),
    [choices],
  );
  const preview = useQuery(
    api.accounting.backfillPreview,
    open ? { societyId, includeBeforeOpening, categoryChoices } : "skip",
  );
  const backfill = useMutation(api.accounting.backfillFinancialTransactionsToJournal);

  const offsetOptions = (direction: string) => {
    const types = direction === "income" ? ["Income", "Liability", "Equity"] : ["Expense", "Asset", "Liability"];
    return accounts
      .filter((account) => types.includes(account.accountType) && account.subtype !== "suspense")
      .map((account) => ({ value: String(account._id), label: `${account.code ? `${account.code} · ` : ""}${account.name}` }));
  };

  const summary = preview?.summary;
  const post = async () => {
    if (!preview || busy) return;
    setBusy(true);
    try {
      const result: any = await backfill({
        societyId,
        fiscalYear,
        includeBeforeOpening,
        categoryChoices,
        rememberMappings: rememberMappings && categoryChoices.length > 0,
      });
      const parts = [
        result.postedToSuspense ? `${result.postedToSuspense} to suspense for review` : null,
        result.flaggedBeforeOpening ? `${result.flaggedBeforeOpening} flagged as before opening balances` : null,
        result.skippedBeforeOpening ? `${result.skippedBeforeOpening} before opening balances skipped` : null,
        result.skippedLocked ? `${result.skippedLocked} skipped: dated on or before the books close date (${formatDate(result.closeDate)})` : null,
        result.mappingsSaved ? `${plural(result.mappingsSaved, "category mapping")} saved` : null,
      ].filter(Boolean);
      toast.success(`Posted ${plural(result.posted, "transaction")}`, parts.join(" · ") || undefined);
      onClose();
    } catch (error: any) {
      toast.error("Could not post imports", error?.data?.message ?? error?.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Review imports before posting"
      size="wide"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn--accent" onClick={() => void post()} disabled={!canWrite || busy || !summary || summary.toPost === 0}>
            <FileSpreadsheet size={12} /> {summary ? `Post ${plural(summary.toPost, "transaction")}` : "Post"}
          </button>
        </>
      }
    >
      {!preview ? (
        <p className="muted">Building the posting plan…</p>
      ) : (
        <div className="backfill-review" data-testid="backfill-review">
          <div className="backfill-review__summary" aria-live="polite">
            <Badge tone="success">{summary.toPost} to post</Badge>
            {summary.toSuspense > 0 && <Badge tone="warn">{summary.toSuspense} to suspense</Badge>}
            {summary.beforeOpening > 0 && (
              <Badge tone="warn">
                {summary.beforeOpening} before opening balances{includeBeforeOpening ? " (included, flagged)" : " (skipped)"}
              </Badge>
            )}
            {summary.alreadyPosted > 0 && <Badge tone="neutral">{summary.alreadyPosted} already posted</Badge>}
            {summary.noCashAccount + summary.needsMapping > 0 && <Badge tone="danger">{summary.noCashAccount + summary.needsMapping} cannot post</Badge>}
            <Badge tone="info">Net {formatMoney(summary.netCents)}</Badge>
          </div>

          {summary.toSuspense > 0 && (
            <p className="muted" style={{ marginTop: 0 }}>
              <AlertTriangle size={12} style={{ verticalAlign: -2 }} /> Categories without a mapping post to{" "}
              <strong>{preview.suspenseAccountLabel}</strong>. Choose an account below to post them directly, or reclassify the
              suspense entries later.
            </p>
          )}

          <h3 className="card__title" style={{ margin: "12px 0 6px" }}>Category mapping</h3>
          <div className="backfill-review__categories">
            <table className="table table--report">
              <thead>
                <tr><th>Category</th><th className="num">Total</th><th>Post to</th></tr>
              </thead>
              <tbody>
                {preview.categories.map((category: any) => {
                  const key = category.category === "(uncategorized)" ? "" : category.category;
                  const value = choices[key] || (category.offsetSource === "mapping" ? String(category.offsetAccountId) : SUSPENSE_CHOICE);
                  return (
                    <tr key={`${category.direction}-${category.category}`}>
                      <td>
                        <strong>{category.category}</strong>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {category.direction === "income" ? "Money in" : "Money out"} · {plural(category.count, "row")}
                        </div>
                      </td>
                      <td className="num"><Money cents={category.totalCents} /></td>
                      <td className="backfill-review__account">
                        <Select
                          aria-label={`Account for ${category.category}`}
                          value={value}
                          onChange={(next) => setChoices((current) => ({ ...current, [key]: next }))}
                          disabled={!canWrite}
                          options={[
                            { value: SUSPENSE_CHOICE, label: "Suspense (review later)" },
                            ...offsetOptions(category.direction),
                          ]}
                        />
                        {category.offsetSource === "mapping" && !choices[key] && <div className="muted" style={{ fontSize: 12 }}>Saved mapping</div>}
                      </td>
                    </tr>
                  );
                })}
                {preview.categories.length === 0 && (
                  <tr><td colSpan={3} className="muted">No imported transactions are waiting to be posted.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {preview.openingBalanceDate && summary.beforeOpening > 0 && (
            <Field
              label="Transactions before the opening balances"
              hint={`Opening balances were posted on ${formatDate(preview.openingBalanceDate)}. They normally already include earlier activity, so posting it again double-counts it.`}
            >
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={includeBeforeOpening}
                  onChange={(event) => setIncludeBeforeOpening(event.target.checked)}
                  disabled={!canWrite}
                />{" "}
                Also post {plural(summary.beforeOpening, "transaction")} dated on or before {formatDate(preview.openingBalanceDate)} and flag them for review
              </label>
            </Field>
          )}
          {categoryChoices.length > 0 && (
            <label className="checkbox" style={{ display: "block", margin: "8px 0" }}>
              <input type="checkbox" checked={rememberMappings} onChange={(event) => setRememberMappings(event.target.checked)} /> Remember these category choices for future imports
            </label>
          )}

          <details style={{ marginTop: 12 }}>
            <summary>Transactions ({preview.rows.length})</summary>
            <div className="backfill-review__table">
              <RecordListTable<BackfillRecord>
                variant="card"
                table={BACKFILL_ROWS_TABLE}
                tableId="backfill-review-transactions"
                label="Transactions"
                icon={<FileSpreadsheet size={14} />}
                records={(preview.rows as BackfillPreviewRow[]).map(backfillRecord)}
                onOpen={(record) => navigate(transactionHref(record._id))}
                renderCell={({ record, field }) => {
                  if (field.name === "amountCents") return <Money cents={record.amountCents} tone={record.amountCents > 0 ? "in" : "auto"} />;
                  if (field.name === "postTo" && !record.postTo) return <span className="muted">—</span>;
                  if (field.name === "status") {
                    const status = STATUS_LABEL[record.status] ?? { label: record.status, tone: "neutral" as const };
                    return (
                      <>
                        <Badge tone={status.tone}>{status.label}</Badge>
                        {record.flagged ? <> <Badge tone="warn">Flagged</Badge></> : null}
                      </>
                    );
                  }
                  return undefined;
                }}
                renderPhoneCard={(record, { open, field, selecting }) => (
                  <RecordTablePhoneCard
                    title={record.description || "Bank transaction"}
                    badge={field("status")}
                    meta={[<Money key="amount" cents={record.amountCents} tone={record.amountCents > 0 ? "in" : "auto"} />, formatDate(record.date)]}
                    detail={[record.category, record.postTo ? `Posts to ${record.postTo}` : ""]}
                    onOpen={open}
                    selecting={selecting}
                  />
                )}
                emptyState={<RecordTableEmpty title="No imported transactions are waiting to be posted" />}
              />
            </div>
          </details>
        </div>
      )}
    </Drawer>
  );
}
