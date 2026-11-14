/**
 * How the procurement list draws a notice (NoticeTable.tsx): the title cell
 * (the new dot, the title on up to two lines, the buyer under it), the
 * closing date with how long is left, an award's supplier as a link to its
 * page with "Us" on the workspace's own wins, and the phone card. Also the
 * list's two quiet helpers: publishing its order for the notice page's
 * previous/next, and J/K/Enter.
 */
import { useCallback, useEffect, useMemo } from "react";
import {
  RecordTablePhoneCard,
  useRecordTableContextOrThrow,
  useRecordTableRowModel,
  useRecordTableState,
  useRecordTableStoreHandle,
  type RecordTableCardRenderer,
  type RecordTableCellRenderer,
} from "../../../platform/record-engine/record-table";
import { Badge } from "../../../components/ui";
import { shortSourceDate } from "../lib/notice";
import { triageLabel } from "../../../../shared/procurementTriage";
import type { NoticeRow } from "../../../../shared/procurementNoticeRow";
import { DocumentsCell, DocumentsCount } from "./DocumentsCell";
import { useReaderNavigation } from "./routes";
import { usePublishListOrder } from "./listOrder";
import type { TriagedRow } from "./triageList";

export function money(value: number | null, currency: string): string {
  if (value === null) return "";
  try {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: currency || "CAD",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${value.toLocaleString()} ${currency}`;
  }
}

/** The small dot on a notice issued since the person's last visit (lastVisit.ts). */
function NewDot() {
  return <span className="procurement-queue__new" role="img" aria-label="New since your last visit" title="New since your last visit" />;
}

/**
 * The title cell: the new dot, the title on up to two lines, and the buyer
 * under it in quieter text while the Buyer column is hidden (a buyer's own
 * page leaves it out, every row being theirs). Beside an open notice, where
 * the list is one narrow column (ProcurementReader's split view), it also
 * says when the notice closes and its classification.
 */
function NoticeTitle({ row, fresh, buyerFixed }: { row: NoticeRow & Partial<TriagedRow>; fresh: boolean; buyerFixed: boolean }) {
  const buyerColumnShown = useRecordTableState((state) =>
    state.columns.some((column) => column.field.name === "organization" && column.isVisible),
  );
  const buyer = !buyerFixed && !buyerColumnShown ? row.organization : "";
  const classification = row.classification ? triageLabel(row.classification) : "";
  return (
    <span className="procurement-queue__title">
      <span className="procurement-queue__title-text">
        {fresh && <NewDot />}
        {row.title}
      </span>
      {buyer && <span className="procurement-queue__buyer">{buyer}</span>}
      {row.kind !== "award" && (
        <span className="procurement-queue__split-meta" aria-hidden="true">
          <span className="procurement-reader__when" data-state={row.state}>
            {row.whenText || "No closing date"}
            {row.relative && <small> · {row.relative}</small>}
          </span>
          {classification && <span className="procurement-queue__split-class" data-classification={row.classification}>{classification}</span>}
        </span>
      )}
    </span>
  );
}

/** An award's supplier: a link to its page (a real link, so a middle-click opens a tab), and "Us" when it is the workspace. */
function SupplierLink({ name, ours }: { name: string; ours: boolean }) {
  const { partyHref, openParty } = useReaderNavigation();
  if (!name) return null;
  return (
    <span className="procurement-queue__party">
      <a
        className="procurement-queue__party-link"
        href={partyHref("supplier", name)}
        onClick={(event) => {
          // The row opens the award; the name opens the supplier.
          event.stopPropagation();
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          openParty("supplier", name);
        }}
      >
        {name}
      </a>
      {ours && <UsBadge />}
    </span>
  );
}

function UsBadge() {
  return (
    <span className="procurement-queue__us" title="Your organisation">
      <Badge tone="accent">Us</Badge>
    </span>
  );
}

export function useCells({
  openDocuments,
  fresh,
  buyerFixed,
  isOurs,
}: {
  openDocuments: (recordKey: string) => void;
  fresh: ReadonlySet<string>;
  buyerFixed: boolean;
  isOurs: (name: string) => boolean;
}): RecordTableCellRenderer {
  return useMemo<RecordTableCellRenderer>(
    () =>
      ({ record, field }) => {
        const row = record as NoticeRow & Partial<TriagedRow>;
        if (field.name === "title")
          return <NoticeTitle row={row} fresh={fresh.has(row._id)} buyerFixed={buyerFixed} />;
        if (field.name === "when") {
          return (
            <span
              className="procurement-reader__when"
              data-state={row.kind === "award" ? undefined : row.state}
            >
              <span>{row.whenText || "—"}</span>
              {row.relative && <small>{row.relative}</small>}
            </span>
          );
        }
        if (field.name === "supplier" && row.kind === "award")
          return <SupplierLink name={row.supplier} ours={isOurs(row.supplier)} />;
        if (field.name === "documents")
          return (
            <DocumentsCell
              recordKey={row._id}
              documents={row.documents}
              onOpen={() => openDocuments(row._id)}
            />
          );
        if (field.name === "value")
          return (
            <span className="procurement-reader__value">
              {money(row.value, row.currency)}
            </span>
          );
        return undefined;
      },
    [openDocuments, fresh, buyerFixed, isOurs],
  );
}

/**
 * Phones: the title on up to two lines, after the new dot, and the
 * classification (or, for a notice that isn't open, its status; "Open" says
 * nothing in an open view), then two lines of meta. The first is when, the day
 * without its time, plus how long is left ("Closes Nov 13 · in 2 days"); for
 * an award, its value. The second, quieter, is who (the buyer, or an award's
 * supplier, marked "Us" when it is the workspace), then the paperclip count
 * and whether we reviewed it. Each line truncates on its own, so a long buyer
 * name never pushes the date out.
 */
export function usePhoneCard(fresh: ReadonlySet<string>, isOurs: (name: string) => boolean): RecordTableCardRenderer {
  return useCallback<RecordTableCardRenderer>(
    (record, { open, field, selecting }) => {
      const row = record as unknown as NoticeRow & Partial<TriagedRow>;
      const award = row.kind === "award";
      const prefix =
        row.state === "unknown" || !row.whenText
          ? ""
          : award
            ? "Awarded "
            : row.state === "closed"
              ? "Closed "
              : "Closes ";
      // The card has no room for the time; the notice page shows it.
      const day = row.when ? shortSourceDate(row.when.slice(0, 10)) : row.whenText;
      const who = award ? row.supplier || row.organization : row.organization;
      return (
        <RecordTablePhoneCard
          title={fresh.has(row._id) ? <><NewDot />{row.title}</> : row.title}
          recordName={row.title}
          wrapTitle
          badge={
            award
              ? undefined
              : row.classification
                ? field("classification")
                : row.status && row.status !== "Open"
                  ? field("status")
                  : undefined
          }
          meta={[
            day && (
              <span
                className="procurement-reader__when"
                data-state={award ? undefined : row.state}
              >
                {prefix}
                {day}
                {row.relative && <small> · {row.relative}</small>}
              </span>
            ),
            award ? money(row.value, row.currency) : "",
          ]}
          detail={[
            who && award && isOurs(row.supplier) ? <>{who} <UsBadge /></> : who,
            !award && row.documents ? (
              <DocumentsCount documents={row.documents} />
            ) : (
              ""
            ),
            row.reviewed ? "Reviewed" : "",
          ]}
          onOpen={open}
          selecting={selecting}
        />
      );
    },
    [fresh, isOurs],
  );
}

/** Publishes the record keys the table shows, in its order (filters, search, sort and grouping applied), for the notice page's previous/next. */
export function PublishListOrder() {
  const { records } = useRecordTableRowModel();
  const keys = useMemo(() => records.map((record: { _id: unknown }) => String(record._id)), [records]);
  usePublishListOrder(keys);
  return null;
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * J and K move the highlighted row (the table's focused row) and Enter opens
 * it, while the list is what shows: not while a notice is open (the notice
 * page has its own keys), and never while typing or in a menu or dialog.
 * Inside the table its own keys move the row; Enter opens it unless it
 * started editing a cell.
 */
export function ListShortcuts({ enabled }: { enabled: boolean }) {
  const handle = useRecordTableStoreHandle();
  const { records } = useRecordTableRowModel();
  const { onRecordClick } = useRecordTableContextOrThrow();
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (isTyping(target) || target?.closest('[role="dialog"], [role="menu"], [role="listbox"], .modal')) return;
      const state = handle.get();
      if (state.type !== "table" || state.editingCell || records.length === 0) return;
      const inTable = !!target?.closest(".record-table__cell");
      const key = event.key.toLowerCase();
      if (key === "j" || key === "k") {
        if (inTable) return;
        event.preventDefault();
        const current = state.focusedCell?.rowIndex ?? -1;
        const rowIndex = Math.max(0, Math.min(records.length - 1, current + (key === "j" ? 1 : -1)));
        state.setRangeAnchor(null);
        state.setFocusedCell({ rowIndex, columnIndex: 0 });
        return;
      }
      if (event.key === "Enter") {
        // A focused button or link (the title's own button too) does its own thing.
        if (target?.closest("button, a[href]")) return;
        const record = state.focusedCell ? records[state.focusedCell.rowIndex] : undefined;
        if (!record) return;
        event.preventDefault();
        onRecordClick?.(String(record._id), record, { source: "row" });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, handle, records, onRecordClick]);
  return null;
}
