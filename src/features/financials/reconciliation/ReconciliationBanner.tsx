import { useMutation } from "convex/react";
import { Link } from "react-router-dom";
import { ArrowLeft, CheckCircle2, FileText, MoreHorizontal, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Banner } from "../../../components/ui";
import { Money } from "../../../components/Money";
import { Menu } from "../../../components/Menu";
import { useConfirm, usePrompt } from "../../../components/Modal";
import { useToast } from "../../../components/Toast";
import { formatDate, pluralize } from "../../../lib/format";
import { formatMoney, parseMoneyInput } from "../../../lib/money";
import { PeriodStatusPill, formatPeriodRange } from "./PeriodStatusPill";
import type { ReconAccount, ReconPeriod } from "./types";

/**
 * Header for one statement reconciliation: beginning balance, cleared
 * deposits and payments, the computed cleared balance against the statement
 * ending balance, and the difference that must reach $0.00 to complete.
 */
export function ReconciliationBanner({
  period,
  account,
  canWrite,
  onBack,
  onDiscarded,
}: {
  period: ReconPeriod;
  account?: ReconAccount;
  canWrite: boolean;
  onBack: () => void;
  onDiscarded: () => void;
}) {
  const updatePeriod = useMutation(api.reconciliation.updatePeriod);
  const completePeriod = useMutation(api.reconciliation.completePeriod);
  const reopenPeriod = useMutation(api.reconciliation.reopenPeriod);
  const removePeriod = useMutation(api.reconciliation.removePeriod);
  const prompt = usePrompt();
  const confirm = useConfirm();
  const toast = useToast();
  const status = period.effectiveStatus;
  const open = period.status === "in_progress";
  const balanced = period.differenceCents === 0;
  const isLatest = account?.latestEndDate === period.endDate;

  const editEnding = async () => {
    const value = await prompt({
      title: "Edit ending balance",
      message: `The closing balance printed on the ${formatPeriodRange(period.startDate, period.endDate)} statement.`,
      defaultValue: (period.endingBalanceCents / 100).toFixed(2),
      confirmLabel: "Save",
      required: true,
    });
    if (value == null) return;
    const cents = parseMoneyInput(value);
    if (cents === undefined) {
      toast.error("Enter an amount, for example 12,345.67");
      return;
    }
    try {
      await updatePeriod({ id: period._id as any, endingBalanceCents: cents });
      toast.success("Ending balance updated", formatMoney(cents));
    } catch (error: any) {
      toast.error("Could not update the ending balance", error?.message);
    }
  };

  const complete = async () => {
    try {
      await completePeriod({ id: period._id as any });
      toast.success("Reconciliation completed", `${period.accountName} is reconciled through ${formatDate(period.endDate)}.`);
    } catch (error: any) {
      toast.error("Could not complete the reconciliation", error?.message);
    }
  };

  const reopen = async () => {
    const ok = await confirm({
      title: "Reopen this reconciliation?",
      message: "You can then change its ending balance and matches. Complete it again once the difference is $0.00.",
      confirmLabel: "Reopen",
      tone: "warn",
    });
    if (!ok) return;
    try {
      await reopenPeriod({ id: period._id as any });
      toast.info("Reconciliation reopened");
    } catch (error: any) {
      toast.error("Could not reopen", error?.message);
    }
  };

  const discard = async () => {
    const ok = await confirm({
      title: "Discard this reconciliation?",
      message: "The statement period is removed. Matches on its transactions are kept.",
      confirmLabel: "Discard",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await removePeriod({ id: period._id as any });
      toast.success("Reconciliation discarded");
      onDiscarded();
    } catch (error: any) {
      toast.error("Could not discard", error?.message);
    }
  };

  const completeBlockedReason = !balanced
    ? `The difference must be ${formatMoney(0)} to complete.${period.unclearedCount ? ` Match or mark the ${pluralize(period.unclearedCount, "uncleared transaction")} below, or check the ending balance.` : " Check the ending balance against the statement."}`
    : undefined;

  return (
    <section className={`recon-banner recon-banner--${status.replace(/_/g, "-")}`} aria-labelledby="recon-banner-title">
      <div className="recon-banner__head">
        <button type="button" className="btn btn--ghost btn--sm recon-banner__back" onClick={onBack}>
          <ArrowLeft size={14} aria-hidden="true" /> All statements
        </button>
        <div className="recon-banner__identity">
          <div className="recon-banner__eyebrow">{period.accountName}{account?.code ? ` · ${account.code}` : ""}</div>
          <h2 className="recon-banner__title" id="recon-banner-title">{formatPeriodRange(period.startDate, period.endDate)}</h2>
        </div>
        <PeriodStatusPill status={status} />
        <div className="recon-banner__actions">
          {open ? (
            <>
              <button type="button" className="btn btn--sm" disabled={!canWrite} onClick={() => void editEnding()}>
                <Pencil size={12} aria-hidden="true" /> Edit ending balance
              </button>
              <button
                type="button"
                className="btn btn--sm btn--accent"
                disabled={!canWrite || !balanced}
                aria-describedby={completeBlockedReason ? "recon-complete-reason" : undefined}
                onClick={() => void complete()}
              >
                <CheckCircle2 size={12} aria-hidden="true" /> Complete reconciliation
              </button>
            </>
          ) : (
            <button type="button" className="btn btn--sm" disabled={!canWrite} onClick={() => void reopen()}>
              <RotateCcw size={12} aria-hidden="true" /> Reopen
            </button>
          )}
          {open && isLatest && (
            <Menu
              align="right"
              trigger={
                <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label="Reconciliation actions">
                  <MoreHorizontal size={14} />
                </button>
              }
              sections={[{ id: "period", items: [{ id: "discard", label: "Discard reconciliation", icon: <Trash2 size={14} />, destructive: true, disabled: !canWrite, onSelect: () => void discard() }] }]}
            />
          )}
        </div>
      </div>

      {status === "out_of_balance" && (
        <Banner tone="danger" title="Balances no longer match">
          A transaction dated in this statement period was added, changed or unmatched after the reconciliation was
          completed{period.outOfBalanceAtISO ? ` (noticed ${formatDate(period.outOfBalanceAtISO)})` : ""}. Reopen it to review
          the lines below and complete it again.
        </Banner>
      )}

      <dl className="recon-banner__figures">
        <div className="recon-figure">
          <dt>Beginning balance</dt>
          <dd><Money cents={period.beginningBalanceCents} /></dd>
        </div>
        <div className="recon-figure">
          <dt>Cleared deposits</dt>
          <dd><Money cents={period.clearedDepositsCents} tone="in" signDisplay="always" /></dd>
        </div>
        <div className="recon-figure">
          <dt>Cleared payments</dt>
          <dd><Money cents={-period.clearedPaymentsCents} tone="out" signDisplay="exceptZero" /></dd>
        </div>
        <div className="recon-figure recon-figure--computed">
          <dt>Cleared balance</dt>
          <dd><Money cents={period.clearedBalanceCents} /></dd>
        </div>
        <div className="recon-figure">
          <dt>Statement ending balance</dt>
          <dd><Money cents={period.endingBalanceCents} /></dd>
        </div>
        <div className={`recon-figure recon-figure--difference${balanced ? " is-zero" : " is-off"}`}>
          <dt>Difference</dt>
          <dd><Money cents={period.differenceCents} signDisplay="exceptZero" /></dd>
        </div>
      </dl>

      <div className="recon-banner__foot">
        <span>
          {period.clearedCount} of {pluralize(period.transactionCount, "transaction")} cleared
          {period.completedAtISO && !open ? ` · completed ${formatDate(period.completedAtISO)}${period.completedByName ? ` by ${period.completedByName}` : ""}` : ""}
        </span>
        {period.statementDocumentId && (
          <Link to={`/app/documents/${period.statementDocumentId}`} className="recon-banner__doc">
            <FileText size={12} aria-hidden="true" /> Statement
          </Link>
        )}
        {open && completeBlockedReason && (
          <span id="recon-complete-reason" className="recon-banner__reason">{completeBlockedReason}</span>
        )}
      </div>
    </section>
  );
}
