import { Link } from "react-router-dom";
import { Pencil } from "lucide-react";
import { Badge, Drawer } from "../../../components/ui";
import { Progress } from "../../../components/primitives";
import { Money } from "../../../components/Money";
import { formatDate } from "../../../lib/format";
import { CLAIM_STATUS_LABEL, CLAIM_STATUS_TONE } from "../approvals/ApprovalProgress";
import type { SpendBudgetRow } from "./types";

export const BUDGET_STATUS_TONE = { active: "success", upcoming: "info", ended: "neutral" } as const;

export function spendTone(row: Pick<SpendBudgetRow, "spend">): "success" | "warn" | "danger" | undefined {
  if (row.spend.overLimit) return "danger";
  if (row.spend.percentSpent >= 80) return "warn";
  return undefined;
}

export function windowLabel(row: Pick<SpendBudgetRow, "cycle" | "spend">): string {
  const { start, end } = row.spend.window;
  return row.cycle === "once" ? `${formatDate(start)} – ${formatDate(end)}` : `This ${row.cycle === "weekly" ? "week" : row.cycle === "monthly" ? "month" : "quarter"}: ${formatDate(start, "MMM d")} – ${formatDate(end)}`;
}

/** A spend budget's current cycle: what's been spent, by whom, and who may charge it. */
export function SpendBudgetDetail({ budget, canWrite, onClose, onEdit }: { budget: SpendBudgetRow; canWrite: boolean; onClose: () => void; onEdit: () => void }) {
  const tone = spendTone(budget);
  return (
    <Drawer
      open
      onClose={onClose}
      title={budget.name}
      className="spend-budget-detail"
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>Close</button>
          <button className="btn btn--accent" type="button" disabled={!canWrite} onClick={onEdit}><Pencil size={12} aria-hidden="true" /> Edit</button>
        </>
      }
    >
      <div className="spend-budget-detail__hero">
        <div>
          <Money cents={budget.spend.spentCents} variant="hero" /> <span className="muted">of <Money cents={budget.limitCents} /></span>
        </div>
        <Badge tone={BUDGET_STATUS_TONE[budget.status]}>{budget.archived ? "Archived" : budget.statusLabel}</Badge>
      </div>
      <Progress value={budget.spend.percentSpent} tone={tone} />
      <p className="muted spend-budget-detail__window">
        {windowLabel(budget)} · {budget.spend.percentSpent}% spent ·{" "}
        {budget.spend.overLimit ? <strong className="spend-budget-detail__over"><Money cents={-budget.spend.remainingCents} /> over the limit</strong> : <><Money cents={budget.spend.remainingCents} /> left</>}
      </p>
      <dl className="claim-drawer__facts">
        <div><dt>Resets</dt><dd>{budget.cycleLabel}</dd></div>
        <div><dt>Active</dt><dd>{formatDate(budget.startDate)}{budget.endDate ? ` – ${formatDate(budget.endDate)}` : " onward"}</dd></div>
        {budget.committeeName && <div><dt>Committee</dt><dd>{budget.committeeName}</dd></div>}
        {budget.memberNames.length > 0 && <div><dt>People</dt><dd>{budget.memberNames.join(", ")}</dd></div>}
      </dl>
      {budget.notes && <p className="claim-drawer__notes">{budget.notes}</p>}
      <section className="claim-drawer__section" aria-labelledby="spend-budget-claims">
        <h3 id="spend-budget-claims" className="claim-drawer__section-title">Claims this cycle</h3>
        {budget.claims.length === 0 ? (
          <p className="muted">No claims charged to this budget in the current cycle.</p>
        ) : (
          <ul className="spend-budget-detail__claims">
            {budget.claims.map((claim) => (
              <li key={claim._id}>
                <Link to={`/app/approvals?claim=${encodeURIComponent(claim._id)}`}>{claim.title}</Link>
                <span className="muted">{claim.claimantName} · {formatDate(claim.incurredAtISO)}{claim.claimType === "mileage" ? " · Mileage" : ""}</span>
                <Badge tone={CLAIM_STATUS_TONE[claim.status] ?? "neutral"}>{CLAIM_STATUS_LABEL[claim.status] ?? claim.status}</Badge>
                <Money cents={claim.amountCents} />
              </li>
            ))}
          </ul>
        )}
        <p className="muted spend-budget-detail__note">Submitted, approved and paid claims count; drafts, declined and recalled claims don't.</p>
      </section>
    </Drawer>
  );
}
