import { useState } from "react";
import { useMutation } from "convex/react";
import { Link } from "react-router-dom";
import { CheckCircle2, Download, FileText, Play, Sparkles, SquareArrowOutUpRight } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Money } from "../../../components/Money";
import { useConfirm } from "../../../components/Modal";
import { useToast } from "../../../components/Toast";
import { formatDate, pluralize } from "../../../lib/format";
import { formatMoney } from "../../../lib/money";
import { useOpenDocumentFile } from "../banking/useOpenDocumentFile";
import { errorMessage } from "../banking/types";
import { PeriodStatusPill, formatPeriodRange } from "./PeriodStatusPill";
import type { MonthDetail, MonthStatusRow } from "./types";

const monthTitle = (month: string) =>
  new Intl.DateTimeFormat("en-CA", { month: "long", year: "numeric" }).format(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1));

/**
 * One month's reconciliation header: reconciled balance, statement ending
 * balance and difference from the statement covering it, with "Mark
 * reconciled" (difference $0.00), one-click auto-reconcile when every line is
 * matched or categorised, the statement document, or "Start reconciliation".
 */
export function MonthSummary({
  detail,
  status,
  accountName,
  canWrite,
  onStart,
  onOpenPeriod,
}: {
  detail: MonthDetail;
  status?: MonthStatusRow;
  accountName: string;
  canWrite: boolean;
  onStart: (endDate: string, suggestedEndingCents: number) => void;
  onOpenPeriod: (periodId: string) => void;
}) {
  const completePeriod = useMutation(api.reconciliation.completePeriod);
  const autoReconcile = useMutation(api.reconciliation.autoReconcilePeriod);
  const openFile = useOpenDocumentFile();
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const period = detail.period;
  const open = period?.status === "in_progress";
  const balanced = period?.differenceCents === 0;
  const auto = detail.autoReconcile;
  const exactMonth = period && period.startDate === detail.start && period.endDate === detail.end;

  const run = async (label: string, action: () => Promise<unknown>, success: string, description?: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(success, description);
    } catch (error: unknown) {
      toast.error(`Could not ${label}`, errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const markReconciled = () => {
    if (!period) return;
    void run("mark it reconciled", () => completePeriod({ id: period._id }), "Marked reconciled", `${accountName} is reconciled through ${formatDate(period.endDate)}.`);
  };

  const runAuto = async () => {
    if (!period || !auto?.ready) return;
    const ok = await confirm({
      title: "Auto-reconcile this statement?",
      message: `${pluralize(auto.toClearIds.length, "categorised transaction")} will be cleared as categorised and the statement completed as auto-reconciled. The difference is ${formatMoney(0)} once they are.`,
      confirmLabel: "Auto-reconcile",
    });
    if (!ok) return;
    void run("auto-reconcile", () => autoReconcile({ id: period._id }), "Auto-reconciled", `${accountName} is reconciled through ${formatDate(period.endDate)}.`);
  };

  return (
    <section className="recon-month-summary" aria-labelledby="recon-month-title">
      <div className="recon-month-summary__head">
        <div className="recon-month-summary__identity">
          <div className="recon-banner__eyebrow">{accountName}</div>
          <h2 className="recon-banner__title" id="recon-month-title">{monthTitle(detail.month)}</h2>
        </div>
        {period ? <PeriodStatusPill status={period.effectiveStatus} /> : <span className="period-pill period-pill--not-started">{status?.label ?? "Not started"}</span>}
        <div className="recon-banner__actions">
          {detail.statementDocument && (
            <button type="button" className="btn btn--sm" onClick={() => void openFile(detail.statementDocument!._id)}>
              <Download size={12} aria-hidden="true" /> Download statement
            </button>
          )}
          {period ? (
            <>
              <button type="button" className="btn btn--sm" onClick={() => onOpenPeriod(period._id)}>
                <SquareArrowOutUpRight size={12} aria-hidden="true" /> Open statement
              </button>
              {open && auto?.ready && !balanced && (
                <button type="button" className="btn btn--sm btn--accent" disabled={!canWrite || busy} onClick={() => void runAuto()}>
                  <Sparkles size={12} aria-hidden="true" /> Auto-reconcile
                </button>
              )}
              {open && (
                <button type="button" className={`btn btn--sm${auto?.ready && !balanced ? "" : " btn--accent"}`} disabled={!canWrite || busy || !balanced} onClick={markReconciled}>
                  <CheckCircle2 size={12} aria-hidden="true" /> Mark reconciled
                </button>
              )}
            </>
          ) : (
            <button type="button" className="btn btn--sm btn--accent" disabled={!canWrite} onClick={() => onStart(detail.end, detail.feedEndingBalanceCents)}>
              <Play size={12} aria-hidden="true" /> Start reconciliation
            </button>
          )}
        </div>
      </div>

      <dl className="recon-month-summary__figures">
        <div className="recon-figure recon-figure--computed">
          <dt>Reconciled balance</dt>
          <dd>{period ? <Money cents={period.clearedBalanceCents} /> : <span className="muted">—</span>}</dd>
        </div>
        <div className="recon-figure">
          <dt>{period ? "Statement ending balance" : "Feed balance at month end"}</dt>
          <dd><Money cents={period ? period.endingBalanceCents : detail.feedEndingBalanceCents} /></dd>
        </div>
        <div className={`recon-figure recon-figure--difference${period ? (balanced ? " is-zero" : " is-off") : ""}`}>
          <dt>Difference</dt>
          <dd>{period ? <Money cents={period.differenceCents} signDisplay="exceptZero" /> : <span className="muted">No statement yet</span>}</dd>
        </div>
      </dl>

      <div className="recon-banner__foot">
        {period && !exactMonth && <span>Statement covers {formatPeriodRange(period.startDate, period.endDate)}.</span>}
        {period && <span>{period.clearedCount} of {pluralize(period.transactionCount, "transaction")} cleared{period.completedAtISO && !open ? ` · completed ${formatDate(period.completedAtISO)}${period.completedByName ? ` by ${period.completedByName}` : ""}` : ""}</span>}
        {detail.statementDocument && (
          <Link to={`/app/documents/${detail.statementDocument._id}`} className="recon-banner__doc"><FileText size={12} aria-hidden="true" /> {detail.statementDocument.title}</Link>
        )}
        {open && auto && (
          <span className={`recon-month-summary__auto${auto.ready ? " is-ready" : ""}`} role="status">
            {balanced
              ? "The difference is $0.00: mark it reconciled to complete the statement."
              : auto.ready
                ? `Ready to auto-reconcile: every line is matched or categorised, and clearing the ${pluralize(auto.toClearIds.length, "categorised line")} brings the difference to $0.00.`
                : `Not ready to auto-reconcile: ${auto.reason}`}
          </span>
        )}
        {!period && <span>Start a reconciliation for this month with the ending balance on your bank statement. The feed shows {formatMoney(detail.feedEndingBalanceCents)} at {formatDate(detail.end)}.</span>}
      </div>
    </section>
  );
}
