import type { ListRow } from "./procurementListRow";
import {
  deadlineOf,
  shortSourceDate,
  sortableDate,
  sourceLabel,
  statusOf,
  procurementDeadlineValue,
  type NoticeDeadline,
} from "../src/features/procurementReview/lib/notice";
/** A list row as the table draws it. */
export type NoticeRow = {
  _id: string;
  kind: string;
  title: string;
  organization: string;
  issuedFor: string;
  source: string;
  status: string;
  /** Sortable (YYYY-MM-DDTHH:MM in the source zone; a bare day sorts at its end) or "". */
  when: string;
  /** What the date cell shows. */
  whenText: string;
  relative: string;
  state: NoticeDeadline["state"];
  documents: number;
  supplier: string;
  value: number | null;
  currency: string;
  procurementType: string;
  /** Searched with the columns: the source's reference isn't one. */
  _searchText: string;
};

/** The derived status, folded into the four the filters offer ("Expired" is closed); anything else keeps its words. */
function statusLabel(row: ListRow, deadline: NoticeDeadline | null): string {
  const label = statusOf(row.kind, row.status, deadline)?.label ?? "";
  const key = label.toLowerCase();
  if (/cancel/.test(key)) return "Cancelled";
  if (/award/.test(key)) return "Awarded";
  if (/closed|expired|complete/.test(key)) return "Closed";
  return label;
}

export function toNoticeRow(row: ListRow, now = Date.now()): NoticeRow {
  // Imports before October 18, 2026 kept the source's own text in `date`.
  const sortable = sortableDate(row.date) || sortableDate(row.dateText);
  const raw = sortable || row.dateText || row.date;
  const opportunity = row.kind === "opportunity";
  const deadline = opportunity ? deadlineOf(procurementDeadlineValue(row), now) : null;
  return {
    _id: row.recordKey,
    kind: row.kind,
    title: row.title || "Untitled notice",
    organization: row.organization,
    issuedFor: row.issuedFor,
    source: sourceLabel(row.recordKey),
    status: statusLabel(row, deadline),
    when: !sortable
      ? ""
      : sortable.includes("T")
        ? sortable
        : `${sortable}T23:59`,
    whenText: !raw
      ? opportunity
        ? "No closing date"
        : ""
      : sortable
        ? shortSourceDate(sortable, now)
        : raw,
    relative: deadline && deadline.state !== "closed" ? deadline.relative : "",
    state: deadline?.state ?? (sortable ? "closed" : "unknown"),
    documents: row.documents,
    supplier: row.supplier,
    value: row.value,
    currency: row.currency,
    procurementType: row.procurementType,
    _searchText: row.reference,
  };
}
