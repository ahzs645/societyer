import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { useRecordTableRowModel, type RecordTableRowItem } from "../hooks/useRecordTableRowModel";
import { useLongPress } from "../hooks/useLongPress";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";
import { useRecordTableContextOrThrow } from "../contexts/RecordTableContext";
import { RecordTableCardActionsContext, type RecordTableCardActionsValue } from "../contexts/RecordTableCardActionsContext";
import { FieldDisplay } from "../../record-field/components/FieldDisplay";
import { recordTitleText } from "../utils/recordTitle";
import { RecordTableEmpty } from "./RecordTableEmpty";

/** A record as the card list hands it to a page (pages read their own fields). */
export type RecordTableCardRecord = Record<string, unknown>;

export type RecordTableCardHelpers = {
  /** Opens the record the way tapping its table row does (the table's onRecordClick). */
  open: () => void;
  /** A field drawn exactly as its table cell draws it (select colours, date format). */
  field: (fieldName: string) => ReactNode;
  /** True while "Select records" is on: the card list owns taps then. */
  selecting: boolean;
};

export type RecordTableCardRenderer = (record: RecordTableCardRecord, helpers: RecordTableCardHelpers) => ReactNode;

/**
 * Longer lists are windowed: only the cards near the viewport are mounted
 * (the page's own scroll container drives it), so a register of thousands
 * renders a screenful of cards, not thousands.
 */
const VIRTUALIZE_CARDS_ABOVE = 40;
/** Cards mounted beyond the viewport, above and below (px). */
const CARD_OVERSCAN = 600;

/** The nearest ancestor that scrolls vertically (the app's `.page`), if any. */
function scrollParentOf(node: HTMLElement | null): HTMLElement | null {
  for (let el = node?.parentElement ?? null; el; el = el.parentElement) {
    const overflowY = getComputedStyle(el).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return el;
  }
  return null;
}

// Virtuoso measures each item's box, so the list is a plain block and the
// gap between cards is padding inside each item (`.record-cards__slot`).
const VirtualCardList = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function VirtualCardList(props, ref) {
  return <div ref={ref} {...props} className="record-cards__virtual-list" />;
});
const VirtualCardSlot = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function VirtualCardSlot(props, ref) {
  return <div ref={ref} {...props} className="record-cards__slot" />;
});

/**
 * Phone body for a register whose records read better as cards than as a
 * frozen-column table. It walks the same row model as the table — the
 * toolbar's search, filters, sort and group-by all apply — and puts each
 * group's header (with its count, tap to fold) between the cards.
 *
 * With `selectable`, a long press starts "Select records" (as on table rows)
 * and, while it is on, a tap anywhere on a card toggles it.
 *
 * The table's row actions reach each card through
 * RecordTableCardActionsContext; `RecordTablePhoneCard` puts them behind a
 * "…" button, so a page's own card keeps the row's menu.
 */
export function RecordTableCardList({
  renderCard,
  emptyState,
  label,
  selectable = false,
  renderRowActions,
  rowMenuSections,
  onEndReached,
}: {
  onEndReached?: () => void;
  renderCard: RecordTableCardRenderer;
  emptyState?: ReactNode;
  /** Accessible name for the list, e.g. "Assets". */
  label: string;
  selectable?: boolean;
  /** The table's row actions, offered on each card (see RecordTablePhoneCard). */
  renderRowActions?: RecordTableCardActionsValue["renderRowActions"];
  rowMenuSections?: RecordTableCardActionsValue["rowMenuSections"];
}) {
  const model = useRecordTableRowModel();
  const handle = useRecordTableStoreHandle();
  const hasRecords = useRecordTableState((s) => s.records.length > 0);
  const virtualize = model.items.length > VIRTUALIZE_CARDS_ABOVE;
  const anchorRef = useRef<HTMLDivElement>(null);
  // Found once mounted: `undefined` until then, `null` when the window scrolls.
  const [scrollParent, setScrollParent] = useState<HTMLElement | null | undefined>(undefined);
  useLayoutEffect(() => {
    if (!virtualize) return;
    const parent = scrollParentOf(anchorRef.current);
    setScrollParent((current) => (current === parent ? current : parent));
  }, [virtualize]);

  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (virtualize || !onEndReached || !endRef.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) onEndReached();
    }, { root: scrollParentOf(endRef.current), rootMargin: "120px" });
    observer.observe(endRef.current);
    return () => observer.disconnect();
  }, [virtualize, onEndReached, model.items.length]);

  if (model.ordered.length === 0) {
    return hasRecords
      ? <RecordTableEmpty variant="filtered" title="No matches" description="Nothing matches the current search or filters." />
      : <>{emptyState ?? <RecordTableEmpty />}</>;
  }

  // Windowed, each item says where it sits in the whole list.
  const renderItem = (item: RecordTableRowItem, index?: number) => {
    const position = index === undefined ? undefined : { "aria-posinset": index + 1, "aria-setsize": model.items.length };
    return item.kind === "group" ? (
      <div key={item.key} className="record-cards__group" role="listitem" {...position}>
        <button
          type="button"
          className="record-cards__group-toggle"
          aria-expanded={!item.collapsed}
          onClick={() => handle.get().toggleGroupCollapsed(item.group.key)}
        >
          <ChevronRight size={14} aria-hidden="true" className="record-cards__chevron" />
          <span className="record-cards__group-label">{item.group.isEmpty ? "No value" : item.group.label}</span>
          <span className="record-cards__group-count">{item.group.records.length}</span>
        </button>
      </div>
    ) : (
      <RecordTableCardItem
        key={item.key}
        record={item.record}
        renderCard={renderCard}
        selectable={selectable}
        position={position}
        renderRowActions={renderRowActions}
        rowMenuSections={rowMenuSections}
      />
    );
  };

  if (virtualize) {
    return (
      <div ref={anchorRef} className="record-cards record-cards--virtual" role="list" aria-label={label}>
        {/* Wait for the scroll container so the first frame is windowed against it. */}
        {scrollParent !== undefined && (
          <Virtuoso
            endReached={onEndReached}
            data={model.items}
            {...(scrollParent ? { customScrollParent: scrollParent } : { useWindowScroll: true })}
            increaseViewportBy={CARD_OVERSCAN}
            computeItemKey={(_index, item) => item.key}
            components={{ List: VirtualCardList, Item: VirtualCardSlot }}
            itemContent={(index, item) => renderItem(item, index)}
          />
        )}
      </div>
    );
  }

  return (
    <div ref={anchorRef} className="record-cards" role="list" aria-label={label}>
      {model.items.map((item) => renderItem(item))}
      <div ref={endRef} aria-hidden="true" />
    </div>
  );
}

function RecordTableCardItem({
  record,
  renderCard,
  selectable,
  position,
  renderRowActions,
  rowMenuSections,
}: {
  record: RecordTableCardRecord;
  renderCard: RecordTableCardRenderer;
  selectable: boolean;
  position?: { "aria-posinset": number; "aria-setsize": number };
  renderRowActions?: RecordTableCardActionsValue["renderRowActions"];
  rowMenuSections?: RecordTableCardActionsValue["rowMenuSections"];
}) {
  const { objectMetadata, onRecordClick } = useRecordTableContextOrThrow();
  const handle = useRecordTableStoreHandle();
  const recordId = String(record._id);
  const selecting = useRecordTableState((s) => selectable && s.mobileSelectionMode);
  const isSelected = useRecordTableState((s) => s.selectedRecordIds.has(recordId));
  const actions = useMemo<RecordTableCardActionsValue>(
    () => ({ record, renderRowActions, rowMenuSections }),
    [record, renderRowActions, rowMenuSections],
  );

  const toggle = useCallback(() => {
    const next = new Set(handle.get().selectedRecordIds);
    if (next.has(recordId)) next.delete(recordId);
    else next.add(recordId);
    handle.get().setSelectedRecordIds(next);
  }, [handle, recordId]);

  const longPress = useLongPress(selectable ? () => {
    if (handle.get().mobileSelectable) handle.get().setMobileSelectionMode(true);
    const next = new Set(handle.get().selectedRecordIds);
    next.add(recordId);
    handle.get().setSelectedRecordIds(next);
  } : undefined);

  const helpers: RecordTableCardHelpers = {
    open: () => onRecordClick?.(recordId, record, { source: "row" }),
    field: (fieldName) => {
      const field = objectMetadata.fields.find((entry) => entry.name === fieldName);
      if (!field) return null;
      const value = record[fieldName];
      if (value == null || value === "") return null;
      return <FieldDisplay value={value} record={record} field={field} />;
    },
    selecting,
  };

  const className = [
    "record-cards__item",
    selecting ? "is-selecting" : "",
    selecting && isSelected ? "is-selected" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={className} role="listitem" {...position} {...longPress}>
      <RecordTableCardActionsContext.Provider value={actions}>
        {renderCard(record, helpers)}
      </RecordTableCardActionsContext.Provider>
      {selecting && (
        // Covers the card so a tap anywhere toggles it instead of opening it.
        <label className="record-cards__select">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={toggle}
            aria-label={`${isSelected ? "Deselect" : "Select"} ${recordTitleText(record, objectMetadata.labelIdentifierFieldName) ?? objectMetadata.labelSingular.toLowerCase()}`}
          />
        </label>
      )}
    </div>
  );
}
