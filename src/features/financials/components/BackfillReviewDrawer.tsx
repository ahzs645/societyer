import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { AlertTriangle, FileSpreadsheet } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Badge, Drawer, Field } from "../../../components/ui";
import { Select } from "../../../components/Select";
import { useToast } from "../../../components/Toast";
import { formatDate, money } from "../../../lib/format";

const SUSPENSE_CHOICE = "";

const STATUS_LABEL: Record<string, { label: string; tone: "success" | "warn" | "danger" | "info" | "neutral" }> = {
  post: { label: "Will post", tone: "success" },
  already_posted: { label: "Already posted", tone: "neutral" },
  before_opening: { label: "Before opening balances", tone: "warn" },
  no_cash_account: { label: "No bank account", tone: "danger" },
  needs_mapping: { label: "Needs mapping", tone: "danger" },
  zero_amount: { label: "Zero amount", tone: "neutral" },
};

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
            <Badge tone="info">Net {money(summary.netCents)}</Badge>
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
            <table className="table">
              <thead>
                <tr><th>Category</th><th style={{ textAlign: "right" }}>Total</th><th>Post to</th></tr>
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
                      <td className="table__cell--mono" style={{ textAlign: "right" }}>{money(category.totalCents)}</td>
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
              <table className="table">
                <thead><tr><th>Date</th><th>Description</th><th>Category</th><th style={{ textAlign: "right" }}>Amount</th><th>Post to</th><th>Status</th></tr></thead>
                <tbody>
                  {preview.rows.map((row: any) => {
                    const status = STATUS_LABEL[row.status] ?? { label: row.status, tone: "neutral" as const };
                    return (
                      <tr key={row.transactionId} className={row.status === "post" ? undefined : "backfill-review__row--excluded"}>
                        <td className="table__cell--mono">{formatDate(row.date)}</td>
                        <td>{row.description}</td>
                        <td>{row.category || "—"}</td>
                        <td className="table__cell--mono" style={{ textAlign: "right" }}>{money(row.amountCents)}</td>
                        <td>{row.status === "post" ? row.offsetAccountLabel ?? "—" : "—"}</td>
                        <td>
                          <Badge tone={status.tone}>{status.label}</Badge>
                          {row.status === "post" && row.beforeOpening ? <> <Badge tone="warn">Flagged</Badge></> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </Drawer>
  );
}
