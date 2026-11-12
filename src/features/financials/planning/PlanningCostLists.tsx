import { useState } from "react";
import { Checkbox } from "../../../components/Controls";
import type { PlanningCost, PlanningStatus, StaffCostPlan } from "../../../../shared/costPlanning";
import type { Archived } from "./planningFormUtils";
import type { CostProjection } from "./PlanningOverview";
import { PlanningCostsTable, PlanningStaffTable } from "./PlanningTables";

export function PlanningCostLists({ costs, staff, projection, canWrite, busy, onNewCost, onNewStaff, onEditCost, onEditStaff, onArchive, onCostStatus }: { costs: Archived<PlanningCost>[]; staff: Archived<StaffCostPlan>[]; projection?: CostProjection; canWrite: boolean; busy: boolean; onNewCost: () => void; onNewStaff: () => void; onEditCost: (value: PlanningCost) => void; onEditStaff: (value: StaffCostPlan) => void; onArchive: (kind: "cost" | "staff", id: string, archived: boolean) => void; onCostStatus: (value: PlanningCost, status: PlanningStatus) => void }) {
  const [showArchived, setShowArchived] = useState(false), [kind, setKind] = useState<"costs" | "staff">("costs");
  const visibleCosts = costs.filter((cost) => Boolean(cost.archivedAtISO) === showArchived), visibleStaff = staff.filter((member) => Boolean(member.archivedAtISO) === showArchived);
  const included = new Map(projection?.items.filter((item) => item.included).map((item) => [`${item.kind}:${item.id}`, item]) ?? []);
  return <section className="card cost-planner__panel"><div className="cost-planner__section-heading"><h2>Reusable planning assumptions</h2><div className="cost-planner__actions"><button type="button" className="btn btn--sm" aria-pressed={kind === "costs"} onClick={() => setKind("costs")}>Costs</button><button type="button" className="btn btn--sm" aria-pressed={kind === "staff"} onClick={() => setKind("staff")}>Staff</button><Checkbox checked={showArchived} onChange={setShowArchived} label="Show archived assumptions" /></div></div>
    {kind === "costs" ? <section aria-label="Reusable costs"><div className="cost-planner__section-heading"><p className="muted">Saved once and reused across semesters. Editing an assumption recalculates the live plan.</p>{canWrite && <button type="button" className="btn btn--accent btn--sm" disabled={busy} onClick={onNewCost}>Add reusable cost</button>}</div>
      <PlanningCostsTable costs={visibleCosts} included={included} canWrite={canWrite} busy={busy} emptyTitle={showArchived ? "No archived costs." : "No reusable costs yet. Add one or import an insurance policy or subscription."} onEdit={onEditCost} onArchive={(id, archived) => onArchive("cost", id, archived)} onStatus={onCostStatus} /></section>
    : <section aria-label="Staff costs"><div className="cost-planner__section-heading"><p className="muted">Editable employer-cost assumptions. Use <a href="/app/payroll/calculator">reviewed payroll calculations</a> to check employer cost components before updating forecasts; a single cheque does not determine a semester forecast.</p>{canWrite && <button type="button" className="btn btn--accent btn--sm" disabled={busy} onClick={onNewStaff}>New staff assumption</button>}</div>
      <PlanningStaffTable staff={visibleStaff} included={included} canWrite={canWrite} busy={busy} emptyTitle={showArchived ? "No archived staff assumptions." : "No staff assumptions yet. Add hourly or salary assumptions without creating a pay run."} onEdit={onEditStaff} onArchive={(id, archived) => onArchive("staff", id, archived)} /></section>}
  </section>;
}
