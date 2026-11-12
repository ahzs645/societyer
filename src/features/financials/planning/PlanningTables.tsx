import { useNavigate, Link } from "react-router-dom";
import { Archive, ArchiveRestore, CircleDot, FileDown, Landmark, Pencil, Receipt, Users } from "lucide-react";
import { FIELD_TYPES, RecordListTable, RecordTableEmpty, staticRecordTable } from "@/platform/record-engine";
import type { MenuSection } from "../../../components/Menu";
import { Money } from "../../../components/Money";
import { formatDate } from "../../../lib/format";
import {
  COST_CADENCES,
  COST_CADENCE_LABELS,
  PLANNING_STATUSES,
  PLANNING_STATUS_LABELS,
  type CostCadence,
  type CostProjectionItem,
  type PlanningCost,
  type PlanningStatus,
  type StaffCostPlan,
} from "../../../../shared/costPlanning";
import type { Archived, PlanningActual } from "./planningFormUtils";

/*
 * The cost planner's lists on the shared record table. Rows are planning
 * assumptions and source records already loaded by the planner; their own
 * editors stay in the planner's dialogs.
 */

const STATUS_COLOR: Record<PlanningStatus, string> = { committed: "green", planned: "blue", paused: "gray" };
const STATUS_OPTIONS = PLANNING_STATUSES.map((status) => ({ value: status, label: PLANNING_STATUS_LABELS[status], color: STATUS_COLOR[status] }));
const CADENCE_OPTIONS = COST_CADENCES.map((cadence) => ({ value: cadence, label: COST_CADENCE_LABELS[cadence], color: "gray" }));

/** Where Financials opens a bank transaction in its side panel. */
function transactionHref(transactionId: string) {
  return `/app/financials?tab=transactions&transactionId=${encodeURIComponent(transactionId)}`;
}

/** The page a planning cost was imported from. */
function importSourceHref(kind: "insurance" | "subscription", sourceId: string | undefined) {
  return kind === "insurance" && sourceId ? `/app/insurance/${encodeURIComponent(sourceId)}` : "/app/financials?tab=subscriptions";
}

function excluded(cents: number | null, currency: string) {
  return cents == null ? <span className="muted">Excluded</span> : <Money cents={cents} currency={currency} />;
}

/* ----------------------------------------------- linked budget bank spending */

const ACTUALS_TABLE = staticRecordTable({
  id: "cost-planner:actuals",
  nameSingular: "planningBankRecord",
  namePlural: "planningBankRecords",
  labelSingular: "Bank record",
  labelPlural: "Linked bank records",
  labelIdentifierFieldName: "description",
  viewName: "Linked bank records",
  fields: [
    { name: "date", label: "Date", fieldType: FIELD_TYPES.DATE, size: 120 },
    { name: "description", label: "Description", fieldType: FIELD_TYPES.TEXT, size: 260, config: { groupable: false } },
    { name: "spendCents", label: "Recorded spend", fieldType: FIELD_TYPES.CURRENCY, size: 160, config: { isCents: true } },
    { name: "sourceCurrency", label: "Source currency", fieldType: FIELD_TYPES.TEXT, size: 160 },
    { name: "included", label: "Included", fieldType: FIELD_TYPES.BOOLEAN, size: 110, isVisible: false, config: { trueLabel: "Included", falseLabel: "Excluded" } },
  ],
});

type ActualRecord = {
  _id: string;
  date: string;
  description: string;
  spendCents: number;
  sourceCurrency: string;
  included: boolean;
  row: PlanningActual;
};

/** Money out on the linked spending budget, each record opening its transaction. */
export function PlanningActualsTable({ rows }: { rows: PlanningActual[] }) {
  const navigate = useNavigate();
  const records = rows.map((row): ActualRecord => {
    const currency = row.currency ?? row.sourceCurrency ?? "";
    return {
      _id: row._id,
      date: row.date,
      description: row.description || "Bank transaction",
      spendCents: row.excludedReason ? Math.max(0, -row.amountCents) : row.spendCents ?? Math.max(0, -row.amountCents),
      sourceCurrency: currency,
      included: !row.excludedReason,
      row,
    };
  });
  return (
    <RecordListTable<ActualRecord>
      variant="card"
      table={ACTUALS_TABLE}
      tableId="cost-planner-actuals"
      label="Linked bank records"
      icon={<Landmark size={14} />}
      records={records}
      onOpen={(record) => navigate(transactionHref(record._id))}
      renderCell={({ record, field }) => {
        if (field.name === "description")
          return (
            <>
              {record.description}
              {record.row.excludedReason && <small className="muted"> · {record.row.excludedReason}</small>}
            </>
          );
        if (field.name === "spendCents")
          return record.sourceCurrency ? <Money cents={record.spendCents} currency={record.sourceCurrency} /> : `${(record.spendCents / 100).toFixed(2)} · currency unknown`;
        if (field.name === "sourceCurrency") return record.sourceCurrency || "Unknown · excluded";
        return undefined;
      }}
      emptyState={<RecordTableEmpty title="No recorded spending on the linked budget yet" />}
    />
  );
}

/* --------------------------------------------------------- import sources */

/** An insurance policy or subscription the planner can import as a cost. */
export type ImportSource = {
  _id: string;
  name: string;
  category: string;
  amountCents: number | null;
  currency: string | null;
  cadence: CostCadence;
  status: string;
  startDate: string;
  endDate?: string;
  renewalDate: string;
  requiresCurrency: boolean;
  importable: boolean;
  missingReason: string | null;
  importedCostId: string | null;
};

const IMPORT_SOURCES_TABLE = staticRecordTable({
  id: "cost-planner:import-sources",
  nameSingular: "planningImportSource",
  namePlural: "planningImportSources",
  labelSingular: "Source",
  labelPlural: "Import sources",
  labelIdentifierFieldName: "name",
  viewName: "Import sources",
  fields: [
    { name: "name", label: "Source", fieldType: FIELD_TYPES.TEXT, size: 240, config: { groupable: false } },
    { name: "amountCents", label: "Payment", fieldType: FIELD_TYPES.CURRENCY, size: 200, config: { isCents: true } },
    { name: "cadence", label: "Schedule", fieldType: FIELD_TYPES.SELECT, size: 180, config: { options: CADENCE_OPTIONS } },
    { name: "renewalDate", label: "Due", fieldType: FIELD_TYPES.DATE, size: 120, isVisible: false },
    { name: "planningLink", label: "Planning link", fieldType: FIELD_TYPES.TEXT, size: 260 },
  ],
});

type ImportSourceRecord = {
  _id: string;
  name: string;
  amountCents: number | null;
  cadence: CostCadence;
  renewalDate: string | null;
  planningLink: string;
  source: ImportSource;
};

/** Insurance policies or subscriptions to import, each with its "Import cost" button. */
export function PlanningImportSourcesTable({
  kind,
  sources,
  canWrite,
  busy,
  onImport,
}: {
  kind: "insurance" | "subscription";
  sources: ImportSource[];
  canWrite: boolean;
  busy: boolean;
  onImport: (source: ImportSource) => void;
}) {
  const plural = kind === "insurance" ? "insurance policies" : "subscriptions";
  const records = sources.map((source): ImportSourceRecord => ({
    _id: source._id,
    name: source.name,
    amountCents: source.amountCents,
    cadence: source.cadence,
    renewalDate: source.renewalDate || null,
    planningLink: source.importedCostId ? "Already linked · existing edits preserved" : source.missingReason ?? "Ready to import",
    source,
  }));
  return (
    <RecordListTable<ImportSourceRecord>
      variant="card"
      table={IMPORT_SOURCES_TABLE}
      tableId={`cost-planner-import-${kind}`}
      label={kind === "insurance" ? "Insurance policies" : "Subscriptions"}
      icon={<FileDown size={14} />}
      records={records}
      renderCell={({ record, field }) => {
        const { source } = record;
        if (field.name === "name")
          return (
            <>
              <Link to={importSourceHref(kind, source._id)}>{source.name}</Link>
              <small className="muted"> · {source.status} · {source.category}</small>
            </>
          );
        if (field.name === "amountCents")
          return source.amountCents === null ? "Amount missing" : source.currency ? <Money cents={source.amountCents} currency={source.currency} /> : `${(source.amountCents / 100).toFixed(2)} · currency confirmation required`;
        if (field.name === "cadence")
          return (
            <>
              {COST_CADENCE_LABELS[source.cadence]}
              <small className="muted"> · {source.renewalDate ? `Due ${formatDate(source.renewalDate)}` : "Due date missing"}</small>
            </>
          );
        return undefined;
      }}
      renderRowActions={(record) => (
        <button type="button" className="btn btn--sm" aria-label={`Import ${record.name}`} disabled={!canWrite || !record.source.importable || busy} onClick={() => onImport(record.source)}>
          Import cost
        </button>
      )}
      emptyState={<RecordTableEmpty title={`No ${plural} are available in this workspace.`} />}
    />
  );
}

/* ------------------------------------------------------ reusable costs */

const COSTS_TABLE = staticRecordTable({
  id: "cost-planner:costs",
  nameSingular: "planningCost",
  namePlural: "planningCosts",
  labelSingular: "Cost",
  labelPlural: "Reusable planning costs",
  labelIdentifierFieldName: "name",
  viewName: "Reusable costs",
  fields: [
    { name: "name", label: "Cost", fieldType: FIELD_TYPES.TEXT, size: 260, config: { groupable: false } },
    { name: "category", label: "Category / recurrence", fieldType: FIELD_TYPES.TEXT, size: 240 },
    { name: "cadence", label: "Recurrence", fieldType: FIELD_TYPES.SELECT, size: 160, isVisible: false, config: { options: CADENCE_OPTIONS } },
    { name: "amountCents", label: "Full payment", fieldType: FIELD_TYPES.CURRENCY, size: 140, config: { isCents: true } },
    { name: "status", label: "Status", fieldType: FIELD_TYPES.SELECT, size: 120, config: { options: STATUS_OPTIONS } },
    { name: "cashCents", label: "Period cash", fieldType: FIELD_TYPES.CURRENCY, size: 140, config: { isCents: true } },
    { name: "allocatedCents", label: "Period allocated", fieldType: FIELD_TYPES.CURRENCY, size: 150, config: { isCents: true } },
  ],
});

type CostRecord = {
  _id: string;
  name: string;
  category: string;
  cadence: CostCadence;
  amountCents: number;
  status: PlanningStatus;
  /** In this period; null when the projection leaves it out. */
  cashCents: number | null;
  allocatedCents: number | null;
  cost: Archived<PlanningCost>;
};

/** One-line period for an assumption: "Jan 1, 2027–Apr 30, 2027" or "… · ongoing". */
function coverage(startDate: string, endDate: string | undefined) {
  return `${formatDate(startDate)}${endDate ? `–${formatDate(endDate)}` : " · ongoing"}`;
}

/** Saved planning costs with their share of the period; Edit and Archive beside each, status behind its "…". */
export function PlanningCostsTable({
  costs,
  included,
  canWrite,
  busy,
  emptyTitle,
  onEdit,
  onArchive,
  onStatus,
}: {
  costs: Archived<PlanningCost>[];
  /** The projection's included items, by `cost:<id>`. */
  included: Map<string, CostProjectionItem>;
  canWrite: boolean;
  busy: boolean;
  emptyTitle: string;
  onEdit: (cost: PlanningCost) => void;
  onArchive: (id: string, archived: boolean) => void;
  onStatus: (cost: PlanningCost, status: PlanningStatus) => void;
}) {
  const records = costs.map((cost): CostRecord => {
    const item = included.get(`cost:${cost._id}`);
    return {
      _id: cost._id,
      name: cost.name,
      category: cost.category,
      cadence: cost.cadence,
      amountCents: cost.amountCents,
      status: cost.status,
      cashCents: item ? item.cashCents : null,
      allocatedCents: item ? item.allocatedCents : null,
      cost,
    };
  });
  const statusMenu = (record: CostRecord): MenuSection[] =>
    canWrite && !record.cost.archivedAtISO
      ? [
          {
            id: "status",
            label: "Status",
            items: PLANNING_STATUSES.map((status) => ({
              id: status,
              label: PLANNING_STATUS_LABELS[status],
              icon: <CircleDot size={14} />,
              hint: status === record.status ? "Current" : undefined,
              disabled: busy || status === record.status,
              onSelect: () => onStatus(record.cost, status),
            })),
          },
        ]
      : [];
  return (
    <RecordListTable<CostRecord>
      variant="card"
      table={COSTS_TABLE}
      tableId="cost-planner-costs"
      label="Reusable costs"
      icon={<Receipt size={14} />}
      records={records}
      renderCell={({ record, field }) => {
        const { cost } = record;
        if (field.name === "name")
          return (
            <>
              {cost.name}
              <small className="muted">
                {" · "}{coverage(cost.startDate, cost.endDate)}
                {cost.sourceKind !== "manual" && <> · <Link to={importSourceHref(cost.sourceKind, cost.sourceId)}>imported {cost.sourceKind}</Link></>}
              </small>
            </>
          );
        if (field.name === "category")
          return (
            <>
              {cost.category}
              <small className="muted"> · {COST_CADENCE_LABELS[cost.cadence]} · due {formatDate(cost.anchorDate)}</small>
            </>
          );
        if (field.name === "amountCents") return <Money cents={cost.amountCents} currency={cost.currency} />;
        if (field.name === "cashCents") return excluded(record.cashCents, cost.currency);
        if (field.name === "allocatedCents") return excluded(record.allocatedCents, cost.currency);
        return undefined;
      }}
      renderRowActions={(record) => (canWrite ? <PlanningRowActions kind="cost" name={record.name} archived={Boolean(record.cost.archivedAtISO)} busy={busy} onEdit={() => onEdit(record.cost)} onArchive={() => onArchive(record._id, !record.cost.archivedAtISO)} /> : null)}
      rowMenuSections={statusMenu}
      emptyState={<RecordTableEmpty title={emptyTitle} />}
    />
  );
}

/* ------------------------------------------------------ staff assumptions */

const STAFF_TABLE = staticRecordTable({
  id: "cost-planner:staff",
  nameSingular: "planningStaffCost",
  namePlural: "planningStaffCosts",
  labelSingular: "Staff assumption",
  labelPlural: "Staff planning costs",
  labelIdentifierFieldName: "name",
  viewName: "Staff assumptions",
  fields: [
    { name: "name", label: "Staff assumption", fieldType: FIELD_TYPES.TEXT, size: 260, config: { groupable: false } },
    { name: "rateCents", label: "Compensation", fieldType: FIELD_TYPES.CURRENCY, size: 200, config: { isCents: true } },
    { name: "status", label: "Status", fieldType: FIELD_TYPES.SELECT, size: 120, config: { options: STATUS_OPTIONS } },
    { name: "assumptionsConfirmed", label: "Confirmed", fieldType: FIELD_TYPES.BOOLEAN, size: 110, isVisible: false },
    { name: "cashCents", label: "Period cash", fieldType: FIELD_TYPES.CURRENCY, size: 140, config: { isCents: true } },
    { name: "allocatedCents", label: "Period allocated", fieldType: FIELD_TYPES.CURRENCY, size: 150, config: { isCents: true } },
  ],
});

type StaffRecord = {
  _id: string;
  name: string;
  rateCents: number;
  status: PlanningStatus;
  assumptionsConfirmed: boolean;
  cashCents: number | null;
  allocatedCents: number | null;
  member: Archived<StaffCostPlan>;
};

/** Staff cost assumptions with their share of the period; Edit and Archive beside each. */
export function PlanningStaffTable({
  staff,
  included,
  canWrite,
  busy,
  emptyTitle,
  onEdit,
  onArchive,
}: {
  staff: Archived<StaffCostPlan>[];
  /** The projection's included items, by `staff:<id>`. */
  included: Map<string, CostProjectionItem>;
  canWrite: boolean;
  busy: boolean;
  emptyTitle: string;
  onEdit: (member: StaffCostPlan) => void;
  onArchive: (id: string, archived: boolean) => void;
}) {
  const records = staff.map((member): StaffRecord => {
    const item = included.get(`staff:${member._id}`);
    return {
      _id: member._id,
      name: member.name,
      rateCents: member.rateCents,
      status: member.status,
      assumptionsConfirmed: member.assumptionsConfirmed,
      cashCents: item ? item.cashCents : null,
      allocatedCents: item ? item.allocatedCents : null,
      member,
    };
  });
  return (
    <RecordListTable<StaffRecord>
      variant="card"
      table={STAFF_TABLE}
      tableId="cost-planner-staff"
      label="Staff assumptions"
      icon={<Users size={14} />}
      records={records}
      renderCell={({ record, field }) => {
        const { member } = record;
        if (field.name === "name")
          return (
            <>
              {member.name}
              <small className="muted"> · {coverage(member.startDate, member.endDate)}{!member.assumptionsConfirmed ? " · assumptions unconfirmed" : ""}</small>
            </>
          );
        if (field.name === "rateCents")
          return (
            <>
              <Money cents={member.rateCents} currency={member.currency} /> / {member.compensation === "hourly" ? "hour" : member.compensation === "monthly" ? "month" : "year"}
              {member.compensation === "hourly" && <small className="muted"> · {member.hoursPerWeek ?? "Missing"} hours / week</small>}
            </>
          );
        if (field.name === "cashCents") return excluded(record.cashCents, member.currency);
        if (field.name === "allocatedCents") return excluded(record.allocatedCents, member.currency);
        return undefined;
      }}
      renderRowActions={(record) => (canWrite ? <PlanningRowActions kind="staff" name={record.name} archived={Boolean(record.member.archivedAtISO)} busy={busy} onEdit={() => onEdit(record.member)} onArchive={() => onArchive(record._id, !record.member.archivedAtISO)} /> : null)}
      emptyState={<RecordTableEmpty title={emptyTitle} />}
    />
  );
}

/** Edit (live assumptions only) and Archive or Restore, named for the row ("Edit staff cost Sam"). */
function PlanningRowActions({ kind, name, archived, busy, onEdit, onArchive }: { kind: "cost" | "staff"; name: string; archived: boolean; busy: boolean; onEdit: () => void; onArchive: () => void }) {
  const noun = kind === "cost" ? "cost" : "staff cost";
  return (
    <>
      {!archived && (
        <button type="button" className="btn btn--ghost btn--sm" disabled={busy} aria-label={`Edit ${noun} ${name}`} onClick={onEdit}>
          <Pencil size={12} aria-hidden="true" /> Edit
        </button>
      )}
      <button type="button" className="btn btn--ghost btn--sm" disabled={busy} aria-label={`${archived ? "Restore" : "Archive"} ${noun} ${name}`} onClick={onArchive}>
        {archived ? <ArchiveRestore size={12} aria-hidden="true" /> : <Archive size={12} aria-hidden="true" />} {archived ? "Restore" : "Archive"}
      </button>
    </>
  );
}
