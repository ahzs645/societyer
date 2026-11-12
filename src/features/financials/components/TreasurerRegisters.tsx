import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, CalendarPlus, Landmark, Pencil, Receipt, Trash2 } from "lucide-react";
import { FIELD_TYPES, RecordTableEmpty, RecordTablePhoneCard, staticRecordTable } from "@/platform/record-engine";
import { Badge } from "../../../components/ui";
import { Money } from "../../../components/Money";
import type { MenuSection } from "../../../components/Menu";
import { formatDate } from "../../../lib/format";
import { mileageSummary } from "../../../../shared/expensePolicy";
import type { Id } from "../../../../convex/_generated/dataModel";
import { RecordListTable } from "@/platform/record-engine";

/* ------------------------------------------------------------------ shapes */

/** An expense claim as `expenseReports.list` returns it (the fields the register reads). */
export type ExpenseClaim = {
  _id: Id<"expenseReports">;
  title: string;
  claimantName?: string;
  status: string;
  category?: string;
  claimType?: string;
  mileage?: { distanceKm: number } | null;
  incurredAtISO?: string;
  amountCents?: number;
  currency?: string;
  receiptDocument?: { _id: string; title: string } | null;
};

export type FundingEvent = {
  _id: Id<"fundingSourceEvents">;
  eventDate: string;
  kind?: string;
  label?: string;
  amountCents?: number | null;
  memberCount?: number | null;
  periodStart?: string;
  periodEnd?: string;
  attributionStatus?: string;
};

/** A funding source as `fundingSources.list` returns it, with its events. */
export type FundingSource = {
  _id: Id<"fundingSources">;
  name: string;
  sourceType?: string;
  status?: string;
  currency?: string;
  collectionAgentName?: string;
  collectionFrequency?: string;
  nextExpectedCollectionDate?: string;
  memberDisclosureLevel?: string;
  committedTotalCents?: number;
  receivedTotalCents?: number;
  events?: FundingEvent[];
};

type RowMenu = { canWrite: boolean; onEdit: () => void; deleteLabel: string; onDelete: () => void };

/** The row "⋯" the treasurer registers share: edit and delete, after any extras. */
function rowMenu(
  { canWrite, onEdit, deleteLabel, onDelete }: RowMenu,
  extraItems: { id: string; label: string; icon: ReactNode; onSelect: () => void }[] = [],
): MenuSection[] {
  return [
    {
      id: "row-actions",
      items: [
        ...extraItems.map((item) => ({ ...item, disabled: !canWrite })),
        { id: "edit", label: "Edit", icon: <Pencil size={14} />, disabled: !canWrite, onSelect: onEdit },
        { id: "delete", label: deleteLabel, icon: <Trash2 size={14} />, destructive: true, disabled: !canWrite, onSelect: onDelete },
      ],
    },
  ];
}

export function expenseStatusTone(status: string) {
  switch (status) {
    case "Paid": return "success" as const;
    case "Approved": return "info" as const;
    case "Submitted": return "warn" as const;
    case "Rejected": return "danger" as const;
    default: return "neutral" as const;
  }
}

/* ------------------------------------------------------------ expense claims */

const CLAIMS_TABLE = staticRecordTable({
  id: "treasurer:expense-claims",
  nameSingular: "treasurerExpenseClaim",
  namePlural: "treasurerExpenseClaims",
  labelSingular: "Claim",
  labelPlural: "Claims",
  labelIdentifierFieldName: "title",
  viewName: "All claims",
  fields: [
    { name: "title", label: "Claim", fieldType: FIELD_TYPES.TEXT, size: 240, config: { groupable: false } },
    { name: "category", label: "Category", fieldType: FIELD_TYPES.TEXT, size: 150 },
    { name: "incurredAtISO", label: "Incurred", fieldType: FIELD_TYPES.DATE, size: 120 },
    { name: "claimantName", label: "Claimant", fieldType: FIELD_TYPES.TEXT, size: 160 },
    {
      name: "status",
      label: "Status",
      fieldType: FIELD_TYPES.SELECT,
      size: 110,
      config: {
        options: [
          { value: "Draft", label: "Draft", color: "gray" }, { value: "Submitted", label: "Submitted", color: "amber" }, { value: "Approved", label: "Approved", color: "blue" },
          { value: "Paid", label: "Paid", color: "green" }, { value: "Rejected", label: "Rejected", color: "red" }, { value: "Recalled", label: "Recalled", color: "gray" },
        ],
      },
    },
    { name: "amountCents", label: "Amount", fieldType: FIELD_TYPES.CURRENCY, size: 120, config: { isCents: true } },
    { name: "receipt", label: "Receipt", fieldType: FIELD_TYPES.TEXT, size: 180 },
  ],
});

type ClaimRecord = {
  _id: string;
  title: string;
  /** The claim's kind: its expense category, or "Mileage · 12 km". */
  category: string;
  incurredAtISO: string | null;
  claimantName: string;
  status: string;
  amountCents: number | null;
  currency?: string;
  /** The receipt document's title; empty when there is none. */
  receipt: string;
  claim: ExpenseClaim;
};

/**
 * Reimbursement claims: the next step for each (Submit, Approve, Mark paid)
 * beside the row, edit and delete behind its "⋯". The claim's name opens it
 * for editing.
 */
export function ExpenseClaimsTable({
  claims,
  canWrite,
  onSubmit,
  onApprove,
  onMarkPaid,
  onEdit,
  onDelete,
}: {
  claims: ExpenseClaim[] | undefined;
  canWrite: boolean;
  onSubmit: (claim: ExpenseClaim) => void;
  onApprove: (claim: ExpenseClaim) => void;
  onMarkPaid: (claim: ExpenseClaim) => void;
  onEdit: (claim: ExpenseClaim) => void;
  onDelete: (claim: ExpenseClaim) => void;
}) {
  const records = useMemo<ClaimRecord[]>(
    () =>
      (claims ?? []).map((claim) => ({
        _id: claim._id,
        title: claim.title,
        category: claim.claimType === "mileage" ? mileageSummary(claim.mileage) : claim.category ?? "",
        incurredAtISO: claim.incurredAtISO ?? null,
        claimantName: claim.claimantName ?? "",
        status: claim.status,
        amountCents: claim.amountCents ?? null,
        currency: claim.currency,
        receipt: claim.receiptDocument?.title ?? "",
        claim,
      })),
    [claims],
  );
  return (
    <RecordListTable<ClaimRecord>
      variant="card"
      table={CLAIMS_TABLE}
      tableId="treasurer-expense-claims"
      label="All claims"
      icon={<Receipt size={14} />}
      records={records}
      loading={claims === undefined}
      onOpen={canWrite ? (row) => onEdit(row.claim) : undefined}
      renderCell={({ record, field }) => {
        if (field.name === "status") return <Badge tone={expenseStatusTone(record.status)}>{record.status}</Badge>;
        if (field.name === "amountCents") return <Money cents={record.amountCents} currency={record.currency} />;
        if (field.name === "receipt") {
          const document = record.claim.receiptDocument;
          return document ? (
            <Link to={`/app/documents/${document._id}`}>{document.title}</Link>
          ) : (
            <span className="muted">{record.claim.claimType === "mileage" ? "Not needed" : "No receipt"}</span>
          );
        }
        return undefined;
      }}
      renderRowActions={(record) => {
        const { claim } = record;
        if (claim.status === "Draft")
          return <button type="button" className="btn btn--ghost btn--sm" onClick={() => onSubmit(claim)} disabled={!canWrite}>Submit</button>;
        if (claim.status === "Submitted")
          return <button type="button" className="btn btn--ghost btn--sm" onClick={() => onApprove(claim)} disabled={!canWrite}>Approve</button>;
        if (claim.status === "Approved")
          return <button type="button" className="btn btn--ghost btn--sm" onClick={() => onMarkPaid(claim)} disabled={!canWrite}>Mark paid</button>;
        return null;
      }}
      rowMenuSections={(record) =>
        rowMenu({ canWrite, onEdit: () => onEdit(record.claim), deleteLabel: "Delete report", onDelete: () => onDelete(record.claim) })
      }
      renderPhoneCard={(record, { open, field, selecting }) => (
        <RecordTablePhoneCard
          title={record.title}
          badge={field("status")}
          meta={[
            <Money key="amount" cents={record.amountCents} currency={record.currency} />,
            record.claimantName,
          ]}
          detail={[record.category, record.incurredAtISO ? `incurred ${formatDate(record.incurredAtISO)}` : ""]}
          onOpen={canWrite ? open : undefined}
          selecting={selecting}
        />
      )}
      emptyState={<RecordTableEmpty title="No reimbursement claims yet." />}
    />
  );
}

/* ----------------------------------------------------------- source register */

const SOURCE_STATUS_TONE: Record<string, "success" | "warn" | "neutral"> = { Active: "success", Prospect: "warn" };

const SOURCES_TABLE = staticRecordTable({
  id: "treasurer:funding-sources",
  nameSingular: "treasurerFundingSource",
  namePlural: "treasurerFundingSources",
  labelSingular: "Funding source",
  labelPlural: "Funding sources",
  labelIdentifierFieldName: "name",
  viewName: "All sources",
  fields: [
    { name: "name", label: "Name", fieldType: FIELD_TYPES.TEXT, size: 220, config: { groupable: false } },
    {
      name: "status",
      label: "Status",
      fieldType: FIELD_TYPES.SELECT,
      size: 100,
      config: {
        options: [
          { value: "Active", label: "Active", color: "green" }, { value: "Prospect", label: "Prospect", color: "amber" }, { value: "Paused", label: "Paused", color: "gray" },
          { value: "Ended", label: "Ended", color: "gray" },
        ],
      },
    },
    { name: "committedTotalCents", label: "Committed", fieldType: FIELD_TYPES.CURRENCY, size: 120, config: { isCents: true } },
    { name: "receivedTotalCents", label: "Received", fieldType: FIELD_TYPES.CURRENCY, size: 120, config: { isCents: true } },
    {
      name: "sourceType",
      label: "Type",
      fieldType: FIELD_TYPES.SELECT,
      size: 140,
      isVisible: false,
      config: {
        options: [
          { value: "Member dues", label: "Member dues", color: "blue" }, { value: "Donor", label: "Donor", color: "purple" }, { value: "Grant funder", label: "Grant funder", color: "teal" },
          { value: "Sponsor", label: "Sponsor", color: "pink" }, { value: "Government", label: "Government", color: "violet" }, { value: "Program revenue", label: "Program revenue", color: "green" },
          { value: "Other", label: "Other", color: "gray" },
        ],
      },
    },
    { name: "collectionAgentName", label: "Collected by", fieldType: FIELD_TYPES.TEXT, size: 160, isVisible: false },
    {
      name: "collectionFrequency",
      label: "Frequency",
      fieldType: FIELD_TYPES.SELECT,
      size: 140,
      isVisible: false,
      config: {
        options: [
          { value: "semester", label: "Semester / term", color: "blue" }, { value: "annual", label: "Annual", color: "teal" }, { value: "monthly", label: "Monthly", color: "purple" },
          { value: "one_time", label: "One-time", color: "amber" }, { value: "irregular", label: "Irregular", color: "pink" }, { value: "unknown", label: "Unknown", color: "gray" },
        ],
      },
    },
    { name: "nextExpectedCollectionDate", label: "Next collection", fieldType: FIELD_TYPES.DATE, size: 130, isVisible: false },
    {
      name: "memberDisclosureLevel",
      label: "Member disclosure",
      fieldType: FIELD_TYPES.SELECT,
      size: 160,
      isVisible: false,
      config: {
        options: [
          { value: "named_members", label: "Named members", color: "green" }, { value: "aggregate_count", label: "Aggregate count", color: "blue" }, { value: "aggregate_amount", label: "Aggregate amount only", color: "amber" },
          { value: "unknown", label: "Unknown", color: "gray" },
        ],
      },
    },
  ],
});

type SourceRecord = {
  _id: string;
  name: string;
  status: string;
  committedTotalCents: number | null;
  receivedTotalCents: number | null;
  currency?: string;
  sourceType: string;
  collectionAgentName: string;
  collectionFrequency: string;
  nextExpectedCollectionDate: string | null;
  memberDisclosureLevel: string;
  source: FundingSource;
};

/** The funding source register: each source's commitments and receipts, with edit, delete and "Add funding event" behind its "⋯". */
export function FundingSourcesTable({
  sources,
  canWrite,
  emptyDescription,
  onAddEvent,
  onEdit,
  onDelete,
}: {
  sources: FundingSource[] | undefined;
  canWrite: boolean;
  /** What to add, in the organization's words. */
  emptyDescription: string;
  onAddEvent: (source: FundingSource) => void;
  onEdit: (source: FundingSource) => void;
  onDelete: (source: FundingSource) => void;
}) {
  const records = useMemo<SourceRecord[]>(
    () =>
      (sources ?? []).map((source) => ({
        _id: source._id,
        name: source.name,
        status: source.status ?? "",
        committedTotalCents: source.committedTotalCents || null,
        receivedTotalCents: source.receivedTotalCents || null,
        currency: source.currency,
        sourceType: source.sourceType ?? "",
        collectionAgentName: source.collectionAgentName ?? "",
        collectionFrequency: source.collectionFrequency ?? "",
        nextExpectedCollectionDate: source.nextExpectedCollectionDate || null,
        memberDisclosureLevel: source.memberDisclosureLevel ?? "",
        source,
      })),
    [sources],
  );
  return (
    <RecordListTable<SourceRecord>
      variant="card"
      table={SOURCES_TABLE}
      tableId="treasurer-funding-sources"
      label="All sources"
      icon={<Landmark size={14} />}
      records={records}
      loading={sources === undefined}
      onOpen={canWrite ? (row) => onEdit(row.source) : undefined}
      renderCell={({ record, field }) => {
        if (field.name === "status") return <Badge tone={SOURCE_STATUS_TONE[record.status] ?? "neutral"}>{record.status}</Badge>;
        if (field.name === "committedTotalCents") return <Money cents={record.committedTotalCents} currency={record.currency} />;
        if (field.name === "receivedTotalCents") return <Money cents={record.receivedTotalCents} currency={record.currency} />;
        return undefined;
      }}
      rowMenuSections={(record) =>
        rowMenu(
          { canWrite, onEdit: () => onEdit(record.source), deleteLabel: "Delete source", onDelete: () => onDelete(record.source) },
          [{ id: "event", label: "Add funding event", icon: <CalendarPlus size={14} />, onSelect: () => onAddEvent(record.source) }],
        )
      }
      renderPhoneCard={(record, { open, field, selecting }) => (
        <RecordTablePhoneCard
          title={record.name}
          badge={record.status ? field("status") : undefined}
          meta={[
            record.receivedTotalCents !== null ? <span key="received">Received <Money cents={record.receivedTotalCents} currency={record.currency} /></span> : "",
            record.committedTotalCents !== null ? <span key="committed">Committed <Money cents={record.committedTotalCents} currency={record.currency} /></span> : "",
          ]}
          detail={[record.sourceType, record.collectionAgentName ? `collected by ${record.collectionAgentName}` : ""]}
          onOpen={canWrite ? open : undefined}
          selecting={selecting}
        />
      )}
      emptyState={<RecordTableEmpty title="No funding sources yet." description={emptyDescription} />}
    />
  );
}

/* ---------------------------------------------------------- source timeline */

const EVENTS_TABLE = staticRecordTable({
  id: "treasurer:funding-events",
  nameSingular: "treasurerFundingEvent",
  namePlural: "treasurerFundingEvents",
  labelSingular: "Funding event",
  labelPlural: "Funding events",
  labelIdentifierFieldName: "label",
  viewName: "All events",
  fields: [
    { name: "label", label: "Event", fieldType: FIELD_TYPES.TEXT, size: 220, config: { groupable: false } },
    { name: "eventDate", label: "Date", fieldType: FIELD_TYPES.DATE, size: 120 },
    { name: "sourceName", label: "Source", fieldType: FIELD_TYPES.TEXT, size: 200 },
    {
      name: "kind",
      label: "Kind",
      fieldType: FIELD_TYPES.SELECT,
      size: 120,
      config: {
        options: [
          { value: "Received", label: "Received", color: "green" }, { value: "Pledged", label: "Pledged", color: "blue" }, { value: "Agreement", label: "Agreement", color: "purple" },
          { value: "Report", label: "Report", color: "teal" }, { value: "Renewal", label: "Renewal", color: "amber" }, { value: "Contact", label: "Contact", color: "pink" },
          { value: "Other", label: "Other", color: "gray" },
        ],
      },
    },
    { name: "amountCents", label: "Amount", fieldType: FIELD_TYPES.CURRENCY, size: 120, config: { isCents: true } },
    {
      name: "attributionStatus",
      label: "Attribution",
      fieldType: FIELD_TYPES.SELECT,
      size: 130,
      config: {
        options: [
          { value: "named", label: "named", color: "blue" }, { value: "aggregate", label: "aggregate", color: "blue" }, { value: "unknown", label: "unknown", color: "blue" },
        ],
      },
    },
    { name: "sourceType", label: "Source type", fieldType: FIELD_TYPES.TEXT, size: 140, isVisible: false },
    { name: "period", label: "Period", fieldType: FIELD_TYPES.TEXT, size: 200, isVisible: false },
    { name: "memberCount", label: "Members", fieldType: FIELD_TYPES.NUMBER, size: 100, isVisible: false },
  ],
});

type EventRecord = {
  _id: string;
  label: string;
  eventDate: string;
  sourceName: string;
  kind: string;
  amountCents: number | null;
  currency?: string;
  attributionStatus: string;
  sourceType: string;
  /** "2026-01-01 to 2026-04-30"; empty without a period. */
  period: string;
  memberCount: number | null;
  event: FundingEvent;
  source: FundingSource;
};

/** Every funding event across the sources, latest first, with edit and delete behind each row's "⋯". */
export function FundingEventsTable({
  sources,
  canWrite,
  onEdit,
  onDelete,
}: {
  sources: FundingSource[] | undefined;
  canWrite: boolean;
  onEdit: (event: FundingEvent, source: FundingSource) => void;
  onDelete: (event: FundingEvent) => void;
}) {
  const records = useMemo<EventRecord[]>(
    () =>
      (sources ?? [])
        .flatMap((source) =>
          (source.events ?? []).map((event) => ({
            _id: event._id,
            label: event.label ?? "",
            eventDate: event.eventDate,
            sourceName: source.name,
            kind: event.kind ?? "",
            amountCents: event.amountCents ?? null,
            currency: source.currency,
            attributionStatus: event.attributionStatus ?? "",
            sourceType: source.sourceType ?? "",
            period: event.periodStart || event.periodEnd ? `${event.periodStart || "?"} to ${event.periodEnd || "?"}` : "",
            memberCount: event.memberCount || null,
            event,
            source,
          })),
        )
        .sort((a, b) => b.eventDate.localeCompare(a.eventDate)),
    [sources],
  );
  return (
    <RecordListTable<EventRecord>
      variant="card"
      table={EVENTS_TABLE}
      tableId="treasurer-funding-events"
      label="All events"
      icon={<CalendarClock size={14} />}
      records={records}
      loading={sources === undefined}
      onOpen={canWrite ? (row) => onEdit(row.event, row.source) : undefined}
      renderCell={({ record, field }) => {
        if (field.name === "amountCents") return <Money cents={record.amountCents} currency={record.currency} />;
        if (field.name === "attributionStatus")
          return record.attributionStatus ? <Badge tone="info">{record.attributionStatus}</Badge> : <span className="muted">—</span>;
        return undefined;
      }}
      rowMenuSections={(record) =>
        rowMenu({ canWrite, onEdit: () => onEdit(record.event, record.source), deleteLabel: "Delete event", onDelete: () => onDelete(record.event) })
      }
      renderPhoneCard={(record, { open, selecting }) => (
        <RecordTablePhoneCard
          title={record.label || record.sourceName}
          meta={[
            formatDate(record.eventDate),
            record.amountCents !== null ? <Money key="amount" cents={record.amountCents} currency={record.currency} /> : "",
          ]}
          detail={[record.sourceName, record.kind, record.attributionStatus]}
          onOpen={canWrite ? open : undefined}
          selecting={selecting}
        />
      )}
      emptyState={
        <RecordTableEmpty
          title="No funding events yet."
          description="Record receipts, pledges and remittances from a source's ⋯ menu."
        />
      }
    />
  );
}
