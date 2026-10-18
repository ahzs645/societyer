import { forwardRef, type CSSProperties, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
// NOTE: if you're adding another hook to this file, it MUST go above all the
// early returns (`if (loading) ...`, etc). React's rules of hooks require a
// stable call order on every render. An earlier iteration had a useMemo
// after the virtualization branch and it crashed the page once the record
// count grew past the threshold on a re-render.
import { lowerLabel } from "../utils/lowerLabel";
import { TableVirtuoso, type TableVirtuosoHandle } from "react-virtuoso";
import { useRecordTableState, useRecordTableStoreHandle, type CellPosition } from "../state/recordTableStore";
import { useFilteredRecords } from "../hooks/useFilteredRecords";
import { useRecordTableRowModel, type RecordTableRowItem } from "../hooks/useRecordTableRowModel";
import { useRecordTableColumns } from "../hooks/useRecordTableColumns";
import { RecordTableGroupRowCells } from "./RecordTableGroupRow";
import { useRecordTableContextOrThrow } from "../contexts/RecordTableContext";
import { RecordTableHeader } from "./RecordTableHeader";
import { RecordTableRow, useRecordRowClassName } from "./RecordTableRow";
import { RecordTableEmpty } from "./RecordTableEmpty";
import { RecordTableCardList, type RecordTableCardRenderer } from "./RecordTableCardList";
import { useAutoPhoneCard } from "./RecordTableAutoPhoneCard";
import { RecordTableAggregateFooter, RecordTableAggregateFooterRow } from "./RecordTableAggregateFooter";
import { RecordTableActionRow, RecordTableActionRowCells } from "./RecordTableActionRow";
import { useRecordTableKeyboardNavigation } from "../hooks/useRecordTableKeyboardNavigation";
import { useRecordTableUpdate } from "../hooks/useRecordTableUpdate";
import { useCurrentUserId } from "../../../../hooks/useCurrentUser";
import { useIsMobile } from "../../../../lib/useIsMobile";
import { getMobileTableLayout } from "../../../../lib/mobileTableLayout";
import { FieldDisplay } from "../../record-field/components/FieldDisplay";
import { isFieldEditable } from "../../record-field/components/FieldInput";
import { CalendarView } from "../../../../components/CalendarView";
import { RecordBoard, type RecordBoardColumn } from "../../../../components/RecordBoard";
import { ContextMenu } from "../../../../components/ContextMenu";
import type { MenuSection } from "../../../../components/Menu";
import { FIELD_TYPES, type FieldMetadata, type RecordField } from "../../types";
import { isEmptyValue } from "../utils/filterRecords";
import { isOutsidePointerEvent } from "../../../../lib/floatingLayer";

const INTERACTIVE_BOARD_FIELD_TYPES: ReadonlySet<FieldMetadata["fieldType"]> = new Set([
  FIELD_TYPES.EMAIL,
  FIELD_TYPES.PHONE,
  FIELD_TYPES.LINK,
  FIELD_TYPES.EMAILS,
  FIELD_TYPES.PHONES,
  FIELD_TYPES.LINKS,
  FIELD_TYPES.FILES,
]);

// react-virtuoso attaches refs to the four table subcomponents so it can
// measure them for virtualization. Plain function components can't accept
// refs, so each override has to be a `forwardRef`. They're defined outside
// the main component so React doesn't re-create them every render (which
// would thrash virtuoso's internal keys).
const VirtuosoTable = forwardRef<HTMLTableElement, React.TableHTMLAttributes<HTMLTableElement>>(
  function VirtuosoTable(props, ref) {
    return <table ref={ref} {...props} className="record-table" role="grid" />;
  },
);

const VirtuosoTableHead = forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  function VirtuosoTableHead(props, ref) {
    return <thead ref={ref} {...props} className="record-table__thead" />;
  },
);

// Virtuoso gives its sticky footer an inline `z-index: 1`, below the sticky
// selection/identifier cells (z-index 3–5) of rows scrolling under it, so row
// checkboxes peeked through the "N records" footer. Lift it above them.
const VirtuosoTableFoot = forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  function VirtuosoTableFoot(props, ref) {
    return <tfoot ref={ref} {...props} style={{ ...props.style, zIndex: 6 }} />;
  },
);

const VirtuosoTableBody = forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  function VirtuosoTableBody(props, ref) {
    return <tbody ref={ref} {...props} className="record-table__tbody" />;
  },
);

type RowContextMenuHandler = (event: React.MouseEvent, record: any) => void;

const VIRTUAL_ACTION_ROW = { __recordTableActionRow: true } as const;

function isVirtualActionRow(item: unknown): item is typeof VIRTUAL_ACTION_ROW {
  return !!item && typeof item === "object" && "__recordTableActionRow" in item;
}

type VirtualItem = RecordTableRowItem | typeof VIRTUAL_ACTION_ROW;

const VirtuosoTableRow = forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement> & {
    item?: VirtualItem;
    context?: { onRowContextMenu?: RowContextMenuHandler };
  }
>(function VirtuosoTableRow({ item, context, ...props }, ref) {
  const isActionRow = isVirtualActionRow(item);
  const recordItem = !isActionRow && item?.kind === "record" ? item : null;
  const rowClassName = useRecordRowClassName(recordItem ? recordItem.key : null);
  if (isActionRow) return <tr ref={ref} {...props} className="record-table__action-row" />;
  if (item?.kind === "group") {
    return (
      <tr
        ref={ref}
        {...props}
        className={`record-table__group-row${item.collapsed ? " is-collapsed" : ""}`}
        data-group-key={item.group.key}
      />
    );
  }
  return (
    <tr
      ref={ref}
      {...props}
      className={rowClassName}
      data-row-index={recordItem?.rowIndex}
      onContextMenu={
        context?.onRowContextMenu && recordItem
          ? (event) => context.onRowContextMenu!(event, recordItem.record)
          : undefined
      }
    />
  );
});

/** A record `<tr>` for the plain (non-virtualized) body. */
function PlainRecordRow({
  item,
  onRowContextMenu,
  children,
}: {
  item: Extract<RecordTableRowItem, { kind: "record" }>;
  onRowContextMenu?: RowContextMenuHandler;
  children: ReactNode;
}) {
  const className = useRecordRowClassName(item.key);
  return (
    <tr
      className={className}
      data-row-index={item.rowIndex}
      onContextMenu={onRowContextMenu ? (event) => onRowContextMenu(event, item.record) : undefined}
    >
      {children}
    </tr>
  );
}

/** How many new ids in one records update still count as "just created" (not a data swap). */
const FLASH_MAX_NEW_ROWS = 10;
const FLASH_DURATION_MS = 2800;

/** Tablet/desktop long-table cap; keep in step with `[data-capped]` in _record-table.scss. */
const SCROLL_CAP_MIN = 600;
const SCROLL_CAP_VIEWPORT_OFFSET = 200;

function trackScrollState(node: HTMLElement, classTarget: HTMLElement, { capHeight = false } = {}) {
  let isScrolledX = false;
  let isScrolledY = false;
  let hasMoreRight = false;
  let isCapped = false;

  const update = () => {
    const nextScrolledX = node.scrollLeft > 0;
    const nextScrolledY = node.scrollTop > 0;
    // Columns still out of view on the right scroll under the pinned row
    // actions, which then show a divider (data-more-right on the frame).
    const nextMoreRight = node.scrollLeft + node.clientWidth < node.scrollWidth - 1;
    if (nextMoreRight !== hasMoreRight) {
      hasMoreRight = nextMoreRight;
      classTarget.toggleAttribute("data-more-right", hasMoreRight);
    }

    // Sticky layers only need a class mutation when an edge changes state;
    // avoiding writes on every scroll frame keeps the hot path read-only.
    if (nextScrolledX !== isScrolledX) {
      isScrolledX = nextScrolledX;
      classTarget.classList.toggle("is-scrolled-x", isScrolledX);
    }
    if (nextScrolledY !== isScrolledY) {
      isScrolledY = nextScrolledY;
      classTarget.classList.toggle("is-scrolled-y", isScrolledY);
    }
  };

  // A plain table only becomes its own vertical scroll box (so its header
  // stays pinned) once it is taller than the cap; a shorter table keeps no
  // inner box at all and scrolls with the page.
  const updateCap = () => {
    if (!capHeight) return;
    const content = node.firstElementChild as HTMLElement | null;
    const cap = Math.max(SCROLL_CAP_MIN, window.innerHeight - SCROLL_CAP_VIEWPORT_OFFSET);
    const nextCapped = !!content && content.offsetHeight > cap;
    if (nextCapped !== isCapped) {
      isCapped = nextCapped;
      node.toggleAttribute("data-capped", isCapped);
    }
  };
  const refresh = () => {
    updateCap();
    update();
  };

  refresh();
  node.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", refresh);
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(refresh);
  observer?.observe(node);
  if (node.firstElementChild) observer?.observe(node.firstElementChild);

  return () => {
    node.removeEventListener("scroll", update);
    window.removeEventListener("resize", refresh);
    observer?.disconnect();
    if (isScrolledX) classTarget.classList.remove("is-scrolled-x");
    if (isScrolledY) classTarget.classList.remove("is-scrolled-y");
    if (hasMoreRight) classTarget.removeAttribute("data-more-right");
    if (isCapped) node.removeAttribute("data-capped");
  };
}

/** Pointers with no hover keep the inline, always-visible row actions. */
const TOUCH_MEDIA_QUERY = "(hover: none), (pointer: coarse)";
/** Horizontal padding of `.record-table__row-actions-cell` (inline layout). */
const ROW_ACTIONS_CELL_PADDING = 12;

/**
 * Whether the row actions fit inline: the table at its saved column sizes,
 * plus the widest row's action buttons, plus the fill column's floor, within
 * the scroller. Independent of the current layout (the buttons keep their
 * width while hidden in the pinned cell), so switching never oscillates.
 */
function rowActionsFitInline(root: HTMLElement, scroller: HTMLElement, fixedWidth: number) {
  let actionsWidth = 0;
  root.querySelectorAll<HTMLElement>(".record-table__row .record-table__row-actions").forEach((actions) => {
    actionsWidth = Math.max(actionsWidth, actions.offsetWidth);
  });
  return fixedWidth + actionsWidth + ROW_ACTIONS_CELL_PADDING + FILL_COLUMN_MIN + 2 <= scroller.clientWidth;
}

/**
 * Opt-in escape hatch for pages that need a custom cell renderer on
 * specific fields (links, badges with domain-specific tones, composite
 * content). Return `undefined` to fall through to the default
 * metadata-driven `FieldDisplay`.
 */
export type RecordTableCellRenderer = (ctx: {
  record: any;
  field: FieldMetadata;
  value: unknown;
}) => ReactNode | undefined;

/**
 * The table itself — headers + virtualized body. Requires a surrounding
 * <RecordTableScope>. Any toolbar (search/filter/views) lives outside and
 * writes into the same store via the hooks.
 *
 * `selectable` turns on the checkbox column + enables bulk actions.
 */
/** Columns grow to share spare width, but not past this multiple of their saved size. */
const MAX_COLUMN_STRETCH = 1.8;
const FILL_COLUMN_MIN = 24;
/** Phones shrink columns to fit the frame, but not below this multiple of their saved size. */
const MIN_PHONE_COLUMN_STRETCH = 0.5;

export function RecordTable({
  selectable = false,
  emptyState,
  loading = false,
  virtualizeAbove = 40,
  renderRowActions,
  rowMenuSections,
  renderCell,
  keyboardNavigation = true,
  showAggregateFooter = true,
  renderPhoneCard,
  autoPhoneCard = true,
}: {
  selectable?: boolean;
  emptyState?: ReactNode;
  loading?: boolean;
  /** Use virtualization only once the filtered row count exceeds this. */
  virtualizeAbove?: number;
  /**
   * Optional per-row action slot — renders in a sticky right-hand column
   * (e.g. "Bot", "Mark filed" inline buttons). Keep it compact; bulk
   * actions belong in RecordTableBulkBar instead.
   */
  renderRowActions?: (record: any) => ReactNode;
  /**
   * Preferred way to expose per-row actions: menu sections rendered both
   * behind a trailing "…" kebab button and on row right-click (context
   * menu). Keeps rows clean instead of a strip of inline buttons.
   */
  rowMenuSections?: (record: any) => MenuSection[];
  /**
   * Optional per-cell renderer override. Return undefined to fall
   * through to the default metadata-driven display. Use sparingly —
   * prefer adding a proper field type + display component when a
   * pattern recurs.
   */
  renderCell?: RecordTableCellRenderer;
  keyboardNavigation?: boolean;
  showAggregateFooter?: boolean;
  /**
   * Phones, table view: draw each record as this card instead of a
   * frozen-column row. The cards follow the same search, filters, sort and
   * group-by (group headers sit between them); "Select records" and a long
   * press select cards for the bulk bar. Kanban and calendar are unchanged.
   * `RecordTablePhoneCard` is the standard card.
   *
   * Without one, a table that can open records gets an automatic card on
   * phones (title, status badge, a short fact and a date, row actions behind
   * "…"; see useAutoPhoneCard) whenever its view has a title-like identifier.
   */
  renderPhoneCard?: RecordTableCardRenderer;
  /** Set false to keep the phone column table instead of the automatic card. */
  autoPhoneCard?: boolean;
}) {
  const columns = useRecordTableState((s) => s.columns);
  const density = useRecordTableState((s) => s.density);
  const records = useRecordTableState((s) => s.records);
  const focusedCell = useRecordTableState((s) => s.focusedCell);
  const viewType = useRecordTableState((s) => s.type);
  const kanbanFieldMetadataId = useRecordTableState((s) => s.kanbanFieldMetadataId);
  const calendarFieldMetadataId = useRecordTableState((s) => s.calendarFieldMetadataId);
  const calendarLayout = useRecordTableState((s) => s.calendarLayout);
  const filtered = useFilteredRecords();
  const rowModel = useRecordTableRowModel();
  const { objectMetadata, onRecordClick, onUpdate, onCreate, onReorder } = useRecordTableContextOrThrow();
  const { columns: visibleColumns, collapsed: collapsedColumns } = useRecordTableColumns(objectMetadata.labelIdentifierFieldName);
  const tableId = useRecordTableState((s) => s.tableId);
  const viewId = useRecordTableState((s) => s.viewId);
  const hasFilters = useRecordTableState((s) => s.filters.length > 0 || s.searchTerm.trim().length > 0);
  const handle = useRecordTableStoreHandle();
  const saveRecord = useRecordTableUpdate();
  const getTableState = handle.get;
  const tableRootRef = useRef<HTMLDivElement | null>(null);
  const scrollCleanupRef = useRef<(() => void) | null>(null);
  const virtualScrollCleanupRef = useRef<(() => void) | null>(null);
  const virtuosoRef = useRef<TableVirtuosoHandle>(null);
  const [rowContextMenu, setRowContextMenu] = useState<{ x: number; y: number; record: any } | null>(null);

  const isMobile = useIsMobile();
  const actorId = useCurrentUserId();
  const mobileSelectionMode = useRecordTableState((s) => s.mobileSelectionMode);
  const toolbarMounted = useRecordTableState((s) => s.toolbarMounted);
  const setMobileSelectionMode = (on: boolean) => handle.get().setMobileSelectionMode(on);
  // Tell a mounted toolbar whether to offer the phone "Select records" toggle.
  useEffect(() => {
    handle.get().setMobileSelectable(Boolean(isMobile && selectable && viewType === "table"));
    return () => handle.get().setMobileSelectable(false);
  }, [handle, isMobile, selectable, viewType]);
  const selectionScope = useRef({ actorId, objectName: objectMetadata._id });
  const inlineSelection = isMobile && selectable && mobileSelectionMode && viewType === "table";
  useEffect(() => {
    const scopeChanged = selectionScope.current.actorId !== actorId || selectionScope.current.objectName !== objectMetadata._id;
    selectionScope.current = { actorId, objectName: objectMetadata._id };
    if (scopeChanged || !isMobile || !selectable || viewType !== "table") {
      setMobileSelectionMode(false);
      if (scopeChanged || mobileSelectionMode) handle.get().clearSelection();
    }
  }, [actorId, objectMetadata._id, isMobile, selectable, viewType, mobileSelectionMode, handle]);
  const autoPhoneCardRenderer = useAutoPhoneCard({
    enabled: autoPhoneCard && !renderPhoneCard && isMobile && viewType === "table" && !!onRecordClick,
    renderCell,
    renderRowActions,
    rowMenuSections,
  });
  // Phones, table view: the page's card, else the automatic one, else rows.
  const phoneCard = isMobile && viewType === "table" ? renderPhoneCard ?? autoPhoneCardRenderer ?? undefined : undefined;
  const mobileSelectionControls = isMobile && selectable && !toolbarMounted ? (
    <div className="record-table__mobile-selection-controls">
      <button type="button" className="btn btn--sm" aria-pressed={inlineSelection}
        onKeyDown={(event) => {
          if (!event.ctrlKey && !event.metaKey && !event.altKey) event.stopPropagation();
        }}
        onClick={() => {
          if (mobileSelectionMode) handle.get().clearSelection();
          setMobileSelectionMode(!mobileSelectionMode);
        }}>
        {inlineSelection ? "Exit selection" : "Select records"}
      </button>
    </div>
  ) : null;
  // Share spare width among columns on wide screens (see columnWidthStyle).
  // Columns folded beside the preview panel take no width.
  const columnSizeTotal = visibleColumns.reduce(
    (sum, column) => sum + (collapsedColumns.has(column.viewFieldId) ? 0 : column.size),
    0,
  );
  const [stretchRoot, setStretchRoot] = useState<HTMLElement | null>(null);
  const [columnStretch, setColumnStretch] = useState(1);
  const hasOpenRecordAction = !!onRecordClick;
  const hasRowActions = !!renderRowActions || !!rowMenuSections || hasOpenRecordAction;
  // Lays out the row actions and shares spare width among the columns. The
  // actions show inline while the table fits its frame; once it would scroll
  // sideways they collapse into a narrow cell pinned to the right edge
  // (`data-row-actions="pinned"`, see _record-table.scss), so they stay in
  // reach without covering more than 40px of the scrolling columns.
  const measureLayoutRef = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    if (!stretchRoot || typeof ResizeObserver === "undefined") {
      measureLayoutRef.current = () => {};
      setColumnStretch(1);
      return;
    }
    const touch = window.matchMedia(TOUCH_MEDIA_QUERY);
    const measure = () => {
      const scroller = stretchRoot.querySelector<HTMLElement>(".record-table__scroll, .record-table__virtuoso") ?? stretchRoot;
      const fixed = Array.from(
        stretchRoot.querySelectorAll<HTMLElement>(".record-table__header-row > :is(.record-table__checkbox-cell, .record-table__drag-head)"),
      ).reduce((sum, cell) => sum + cell.offsetWidth, 0);
      const actionsLayout = !hasRowActions
        ? null
        : !touch.matches && !rowActionsFitInline(stretchRoot, scroller, columnSizeTotal + fixed) ? "pinned" : "inline";
      if (actionsLayout === null) delete stretchRoot.dataset.rowActions;
      else if (stretchRoot.dataset.rowActions !== actionsLayout) stretchRoot.dataset.rowActions = actionsLayout;
      // Phones: the capped table (identifier + a couple of columns) shrinks
      // its columns, frozen identifier included, to share the frame instead
      // of panning (`data-phone-fit`, see _record-table.scss). Trailing row
      // actions stay in the scroller, a short swipe away.
      if (isMobile && columnSizeTotal) stretchRoot.dataset.phoneFit = "";
      else delete stretchRoot.dataset.phoneFit;
      if (!columnSizeTotal) {
        setColumnStretch(1);
        return;
      }
      if (isMobile) {
        const room = scroller.clientWidth - FILL_COLUMN_MIN - 2;
        const next = Math.min(1, Math.max(MIN_PHONE_COLUMN_STRETCH, room / columnSizeTotal));
        setColumnStretch((current) => (Math.abs(current - next) < 0.005 ? current : next));
        return;
      }
      const actionsHead = stretchRoot.querySelector<HTMLElement>(".record-table__header-row > .record-table__row-actions-head")?.offsetWidth ?? 0;
      // The trailing fill column keeps a 24px floor (see _record-table.scss);
      // leaving it out made a stretched table overflow by exactly that much.
      // The scroller's width leaves out a capped table's vertical scrollbar.
      const next = Math.min(MAX_COLUMN_STRETCH, Math.max(1, (scroller.clientWidth - fixed - actionsHead - FILL_COLUMN_MIN - 2) / columnSizeTotal));
      setColumnStretch((current) => (Math.abs(current - next) < 0.005 ? current : next));
    };
    measureLayoutRef.current = measure;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stretchRoot);
    touch.addEventListener("change", measure);
    return () => {
      observer.disconnect();
      touch.removeEventListener("change", measure);
    };
  }, [stretchRoot, isMobile, columnSizeTotal, hasRowActions]);
  // Rows (and so the widest row's actions) change without the frame resizing.
  useLayoutEffect(() => {
    measureLayoutRef.current();
  }, [rowModel.items, visibleColumns, renderRowActions]);
  const onRowContextMenu: RowContextMenuHandler | undefined = rowMenuSections
    ? (event, record) => {
        event.preventDefault();
        setRowContextMenu({ x: event.clientX, y: event.clientY, record });
      }
    : undefined;
  const rowContextMenuElement = rowMenuSections ? (
    <ContextMenu
      position={rowContextMenu ? { x: rowContextMenu.x, y: rowContextMenu.y } : null}
      sections={rowContextMenu ? rowMenuSections(rowContextMenu.record) : []}
      onClose={() => setRowContextMenu(null)}
    />
  ) : null;
  // On phones we drop the selection column so the first data column (the
  // record name) sits flush left and can be frozen while the rest of the
  // table scrolls horizontally — the Twenty-style narrow-screen table.
  const { showSelectionColumn: effectiveSelectable, showDragHandle } =
    getMobileTableLayout({ isMobile, selectable, hasDragHandle: !!onReorder });
  const tableColumnCount =
    visibleColumns.length +
    1 +
    (effectiveSelectable ? 1 : 0) +
    (showDragHandle ? 1 : 0) +
    (hasRowActions ? 1 : 0);
  const virtualizedRows = useMemo<VirtualItem[]>(
    () => (onCreate ? [...rowModel.items, VIRTUAL_ACTION_ROW] : rowModel.items),
    [rowModel.items, onCreate],
  );

  // New-row flash: ids that appear after the table has loaded (a create, an
  // import, an undo/restore) get `.row-flash` for a moment. A large batch is
  // a data swap (another source, a workspace switch), not a creation.
  const knownIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(records.map((record: any) => String(record?._id)));
    const known = knownIdsRef.current;
    knownIdsRef.current = ids;
    if (!known || known.size === 0) return;
    const added = [...ids].filter((id) => !known.has(id));
    if (added.length === 0 || added.length > FLASH_MAX_NEW_ROWS) return;
    handle.get().setFlashRecordIds(new Set([...handle.get().flashRecordIds, ...added]));
    const timer = window.setTimeout(() => {
      const next = new Set(handle.get().flashRecordIds);
      added.forEach((id) => next.delete(id));
      handle.get().setFlashRecordIds(next);
    }, FLASH_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [records, handle]);

  // Folded groups are a per-person convenience: remember them per view in
  // this browser (never part of the saved view, so folding is not "dirty").
  const groupFieldId = rowModel.groupBy?.fieldMetadataId ?? null;
  const collapsedStorageKey = groupFieldId ? `societyer:record-groups:${tableId}:${viewId ?? "default"}:${groupFieldId}` : null;
  const restoredCollapseKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!collapsedStorageKey || restoredCollapseKeyRef.current === collapsedStorageKey) return;
    restoredCollapseKeyRef.current = collapsedStorageKey;
    let keys: string[] = [];
    try {
      const raw = window.localStorage.getItem(collapsedStorageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) keys = parsed.map(String);
    } catch {
      keys = [];
    }
    handle.get().setCollapsedGroupKeys(new Set(keys));
  }, [collapsedStorageKey, handle]);
  const collapsedGroupKeys = useRecordTableState((s) => s.collapsedGroupKeys);
  useEffect(() => {
    if (!collapsedStorageKey || restoredCollapseKeyRef.current !== collapsedStorageKey) return;
    try {
      if (collapsedGroupKeys.size === 0) window.localStorage.removeItem(collapsedStorageKey);
      else window.localStorage.setItem(collapsedStorageKey, JSON.stringify([...collapsedGroupKeys]));
    } catch {
      // Storage blocked: folding still works for this visit.
    }
  }, [collapsedGroupKeys, collapsedStorageKey]);
  const setScrollNode = useCallback(
    (node: HTMLDivElement | null) => {
      scrollCleanupRef.current?.();
      scrollCleanupRef.current = null;
      tableRootRef.current = node;
      if (node) {
        scrollCleanupRef.current = trackScrollState(node, node.parentElement ?? node, { capHeight: true });
      }
    },
    [],
  );
  const setVirtualScrollNode = useCallback((node: HTMLElement | Window | null) => {
    virtualScrollCleanupRef.current?.();
    virtualScrollCleanupRef.current = null;
    if (node instanceof HTMLElement) {
      virtualScrollCleanupRef.current = trackScrollState(node, node.parentElement ?? node);
    }
  }, []);

  useEffect(
    () => () => {
      // Callback refs normally receive null on detach; this also covers a
      // virtualization teardown that does not forward its final ref update.
      scrollCleanupRef.current?.();
      virtualScrollCleanupRef.current?.();
      scrollCleanupRef.current = null;
      virtualScrollCleanupRef.current = null;
    },
    [],
  );
  const handleTableKeyDown = useRecordTableKeyboardNavigation({
    enabled: keyboardNavigation,
    selectable: effectiveSelectable || inlineSelection,
  });

  // The focused/editing cell follows its record, not its row number: when an
  // edit (or anyone's change) re-sorts the rows, the ring moves with the
  // record it was on, and the moved row flashes so the jump is visible.
  const previousRowRecordsRef = useRef<any[]>(rowModel.records);
  useLayoutEffect(() => {
    const previous = previousRowRecordsRef.current;
    const next = rowModel.records;
    previousRowRecordsRef.current = next;
    if (previous === next) return;
    const state = handle.get();
    if (!state.focusedCell && !state.editingCell) return;
    const indexById = new Map<string, number>();
    next.forEach((record, index) => indexById.set(String(record?._id), index));
    const follow = (position: CellPosition | null) => {
      if (!position) return position;
      const recordId = previous[position.rowIndex]?._id;
      if (recordId == null) return position;
      const rowIndex = indexById.get(String(recordId));
      if (rowIndex === undefined || rowIndex === position.rowIndex) return position;
      return { ...position, rowIndex };
    };
    const focusedCell = follow(state.focusedCell);
    const editingCell = follow(state.editingCell);
    if (focusedCell === state.focusedCell && editingCell === state.editingCell) return;
    handle.set({ focusedCell, editingCell, rangeAnchor: null });
    const movedId = focusedCell ? next[focusedCell.rowIndex]?._id : null;
    if (movedId != null && focusedCell !== state.focusedCell) {
      const id = String(movedId);
      handle.get().setFlashRecordIds(new Set([...handle.get().flashRecordIds, id]));
      window.setTimeout(() => {
        const remaining = new Set(handle.get().flashRecordIds);
        remaining.delete(id);
        handle.get().setFlashRecordIds(remaining);
      }, FLASH_DURATION_MS);
    }
  }, [rowModel.records, handle]);

  const itemIndexByRowIndex = rowModel.itemIndexByRowIndex;
  useEffect(() => {
    if (!focusedCell) return;
    virtuosoRef.current?.scrollToIndex({
      index: itemIndexByRowIndex[focusedCell.rowIndex] ?? focusedCell.rowIndex,
      align: "center",
      behavior: "smooth",
    });
    const frame = window.requestAnimationFrame(() => {
      // Opening an editor focuses its input. Do not let the delayed cell-focus
      // pass steal focus back from that input: doing so fires the editor's blur
      // commit and closes it immediately after it opens.
      if (getTableState().editingCell) return;
      // Only follow the focused cell while the user is working in the grid.
      // A focused-cell update must never pull focus out of a control elsewhere
      // (command palette trigger, dialogs, toolbar buttons).
      const active = document.activeElement;
      const root = tableRootRef.current;
      const focusIsFree = !active || active === document.body || active === document.documentElement;
      if (!focusIsFree && !root?.contains(active)) return;
      if (active instanceof HTMLElement && root?.contains(active) && active.closest("button, a[href], input, textarea, select, [contenteditable='true']")
        && !active.closest(".record-table__cell")) return;
      const focusedElement = tableRootRef.current
        ?.querySelector<HTMLElement>(
          `[data-row-index="${focusedCell.rowIndex}"][data-column-index="${focusedCell.columnIndex}"]`,
        );
      focusedElement?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      focusedElement?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedCell, getTableState, itemIndexByRowIndex]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const root = tableRootRef.current;
      // Inline editors portal their popovers (select menus, calendars) to
      // <body>; interacting with them must not tear the editor down.
      if (!root || !isOutsidePointerEvent(event, root)) return;
      // Tapping or clicking away finishes an edit the way Enter does: save
      // the open editor's draft before tearing it down. (Clearing first
      // unmounted the input before its blur could save, losing the edit.)
      // Escape remains the way to throw an edit away.
      const { editingCell, editorFlush } = handle.get();
      if (editingCell && editorFlush && editorFlush() === false) return;
      handle.get().setFocusedCell(null);
      handle.get().setEditingInitialValue(undefined);
      handle.get().setEditingCell(null);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [handle]);

  if (loading) {
    if (phoneCard) {
      return (
        <div className="record-table__loading record-table__loading--cards" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="record-table__loading-card">
              <span className="record-table__loading-line record-table__loading-line--title" />
              <span className="record-table__loading-line" />
            </div>
          ))}
        </div>
      );
    }
    return (
      <div className="record-table__loading">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="record-table__loading-row" />
        ))}
      </div>
    );
  }

  if (!visibleColumns.length) {
    return (
      <RecordTableEmpty
        title="No columns to display"
        description="Add a column from the field picker."
      />
    );
  }

  if (filtered.length === 0) {
    if (records.length > 0 && hasFilters) {
      return (
        <RecordTableEmpty
          variant="filtered"
          title="Nothing matches these filters"
          description={`None of the ${records.length} ${lowerLabel(records.length === 1 ? objectMetadata.labelSingular : objectMetadata.labelPlural)} match the current search and filters.`}
          action={
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => {
                handle.get().setSearchTerm("");
                handle.get().setFilters([]);
                handle.get().setFilterGroups([]);
              }}
            >
              Clear filters
            </button>
          }
        />
      );
    }
    return (
      emptyState ?? (
        <RecordTableEmpty title={`No ${lowerLabel(objectMetadata.labelPlural)} yet`} />
      )
    );
  }

  if (phoneCard) {
    return (
      <>
        {mobileSelectionControls}
        <RecordTableCardList
          renderCard={phoneCard}
          emptyState={emptyState}
          label={objectMetadata.labelPlural}
          selectable={selectable}
        />
      </>
    );
  }

  // Density lives on the wrapper (CSS selectors are descendant-based —
  // `.record-table--compact .record-table__cell`), so the <table> itself
  // can keep a static `record-table` class. That lets `VirtuosoTable` be a
  // module-level forwardRef with no closure over render-time state, which
  // keeps the hook order stable across both render branches.
  const densityClass =
    density === "comfortable" ? "record-table--comfortable" : "record-table--compact";

  if (viewType === "kanban" || viewType === "board") {
    const groupColumn =
      columns.find((column) => column.fieldMetadataId === kanbanFieldMetadataId) ??
      columns.find((column) =>
        [FIELD_TYPES.SELECT, FIELD_TYPES.MULTI_SELECT, FIELD_TYPES.BOOLEAN, FIELD_TYPES.RELATION].includes(
          column.field.fieldType as any,
        ),
      );
    const labelColumn = getLabelColumn(columns, objectMetadata.labelIdentifierFieldName);
    const boardDetailColumns = columns.filter(
      (column) =>
        column.isVisible &&
        column.fieldMetadataId !== labelColumn?.fieldMetadataId &&
        column.fieldMetadataId !== groupColumn?.fieldMetadataId,
    );
    const boardColumns = buildBoardColumns(filtered, groupColumn);
    const canMoveBoardRecords = !!onUpdate && !!groupColumn && isFieldEditable(groupColumn.field);

    if (!groupColumn || boardColumns.length === 0) {
      return (
        <RecordTableEmpty
          title="Choose a kanban field"
          description="Use View options to select a select, boolean, relation or status field."
        />
      );
    }

    return (
      <div className="record-table__view-surface">
        <RecordBoard<any>
          columns={boardColumns}
          items={filtered}
          getItemId={(record) => String(record._id)}
          getColumnId={(record) => normalizeBoardValue(record[groupColumn.field.name])}
          canMove={canMoveBoardRecords}
          // Values that match no column (empty, retired options) gather in
          // their own column instead of silently dropping off the board.
          unassignedLabel={`No ${groupColumn.field.label.toLowerCase()}`}
          onMove={(record, toColumnId) => {
            if (!onUpdate) return;
            const value =
              groupColumn.field.fieldType === FIELD_TYPES.MULTI_SELECT
                ? [toColumnId]
                : groupColumn.field.fieldType === FIELD_TYPES.BOOLEAN
                  ? toColumnId === "true"
                  : toColumnId;
            void saveRecord(
              { recordId: String(record._id), fieldName: groupColumn.field.name, value },
              { fieldLabel: groupColumn.field.label },
            );
          }}
          renderCard={(record) => {
            const detailColumns = boardDetailColumns
              .filter((column) => !isEmptyValue(record[column.field.name]))
              .slice(0, 3);
            const rawTitle = record[labelColumn?.field.name ?? "_id"];
            const title = String(rawTitle ?? "").trim() || "Untitled";

            return (
              <button
                type="button"
                className="record-table__board-card"
                onClick={() =>
                  onRecordClick?.(String(record._id), record, { source: "row" })
                }
              >
                <span className="record-table__board-card-title record-table__identifier-primary">
                  {title}
                </span>
                {detailColumns.length > 0 && (
                  <span className="record-table__board-card-fields">
                    {detailColumns.map((column) => (
                      <span
                        key={column.fieldMetadataId}
                        className="record-table__board-card-field record-table__identifier-secondary"
                      >
                        {INTERACTIVE_BOARD_FIELD_TYPES.has(column.field.fieldType) ? (
                          <span className="record-cell__text">
                            {getBoardCardPlainText(record[column.field.name])}
                          </span>
                        ) : (
                          <FieldDisplay
                            record={record}
                            field={column.field}
                            value={record[column.field.name]}
                          />
                        )}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            );
          }}
        />
      </div>
    );
  }

  if (viewType === "calendar") {
    const dateColumn =
      columns.find((column) => column.fieldMetadataId === calendarFieldMetadataId) ??
      columns.find((column) =>
        column.field.fieldType === FIELD_TYPES.DATE ||
        column.field.fieldType === FIELD_TYPES.DATE_TIME,
      );
    const labelColumn = getLabelColumn(columns, objectMetadata.labelIdentifierFieldName);

    if (!dateColumn) {
      return (
        <RecordTableEmpty
          title="Choose a calendar field"
          description="Use View options to select a date field for this view."
        />
      );
    }

    return (
      <div className="record-table__view-surface">
        <CalendarView<any>
          items={filtered}
          layout={calendarLayout}
          onLayoutChange={(layout) => handle.get().setCalendarLayout(layout)}
          getId={(record) => String(record._id)}
          getDate={(record) => record[dateColumn.field.name]}
          getLabel={(record) => String(record[labelColumn?.field.name ?? "_id"] ?? "Untitled")}
          onSelect={(record) =>
            onRecordClick?.(String(record._id), record, { source: "row" })
          }
        />
      </div>
    );
  }

  // Small result sets render without virtuoso — simpler, faster for
  // common <100-row tables. Once we cross the threshold we switch on
  // react-virtuoso.
  const frameModifiers =
    (inlineSelection ? " is-mobile-selecting" : "") +
    (collapsedColumns.size > 0 ? " is-condensed" : "") +
    (rowModel.groups ? " is-grouped" : "");
  const groupRowProps = {
    selectable: effectiveSelectable,
    showDragHandle,
    hasRowActions,
  };

  if (rowModel.items.length <= virtualizeAbove) {
    return (
      <div
        role="region"
        aria-label={`${objectMetadata.labelPlural} table`}
        tabIndex={0}
        onKeyDown={handleTableKeyDown}
        ref={setStretchRoot}
        className={`record-table__scroll-frame${frameModifiers}`}
        style={{
          "--record-table-identifier-left": effectiveSelectable ? "28px" : "0px",
          "--rt-stretch": columnStretch,
        } as CSSProperties}
      >
        {mobileSelectionControls}
        <div ref={setScrollNode} className={`record-table__scroll ${densityClass}`}>
          <table className="record-table" role="grid">
            <thead className="record-table__thead">
              <RecordTableHeader selectable={effectiveSelectable} hasRowActions={hasRowActions} showDragHandle={showDragHandle} />
            </thead>
            <tbody className="record-table__tbody">
              {rowModel.items.map((item) =>
                item.kind === "group" ? (
                  <tr
                    key={item.key}
                    className={`record-table__group-row${item.collapsed ? " is-collapsed" : ""}`}
                    data-group-key={item.group.key}
                  >
                    <RecordTableGroupRowCells group={item.group} collapsed={item.collapsed} {...groupRowProps} />
                  </tr>
                ) : (
                  <PlainRecordRow key={item.key} item={item} onRowContextMenu={onRowContextMenu}>
                    <RecordTableRow
                      record={item.record}
                      rowIndex={item.rowIndex}
                      selectable={effectiveSelectable}
                      mobileSelectionMode={inlineSelection}
                      showDragHandle={showDragHandle}
                      renderRowActions={renderRowActions}
                      rowMenuSections={rowMenuSections}
                      showOpenRecordAction={hasOpenRecordAction}
                      longPressSelect={selectable}
                      renderCell={renderCell}
                    />
                  </PlainRecordRow>
                ),
              )}
              {onCreate && (
                <RecordTableActionRow colSpan={tableColumnCount} />
              )}
            </tbody>
            {showAggregateFooter && (
              <RecordTableAggregateFooter selectable={effectiveSelectable} hasRowActions={hasRowActions} showDragHandle={showDragHandle} />
            )}
          </table>
        </div>
        {rowContextMenuElement}
      </div>
    );
  }

  // TableVirtuoso applies `height: 100%` inline by default, which overrides
  // the 600px from `.record-table__virtuoso` in CSS (inline > class). If the
  // parent card has no explicit height, 100% collapses to 0 and virtuoso
  // renders an empty tbody. Pass height inline so our value wins.
  return (
    <div
      ref={(node) => {
        tableRootRef.current = node;
        setStretchRoot(node);
      }}
      className={`record-table__interaction-root${frameModifiers}`}
      role="region"
      aria-label={`${objectMetadata.labelPlural} table`}
      tabIndex={0}
      onKeyDown={handleTableKeyDown}
      style={{
        "--record-table-identifier-left": effectiveSelectable ? "28px" : "0px",
        "--rt-stretch": columnStretch,
      } as CSSProperties}
    >
      {mobileSelectionControls}
      <TableVirtuoso
        ref={virtuosoRef}
        scrollerRef={setVirtualScrollNode}
        data={virtualizedRows}
        context={{ onRowContextMenu }}
        className={`record-table__virtuoso ${densityClass}`}
        style={{ height: 600 }}
        components={{
          Table: VirtuosoTable,
          TableHead: VirtuosoTableHead,
          TableBody: VirtuosoTableBody,
          TableRow: VirtuosoTableRow,
          TableFoot: VirtuosoTableFoot,
        }}
        fixedHeaderContent={() => (
          <RecordTableHeader selectable={effectiveSelectable} hasRowActions={hasRowActions} showDragHandle={showDragHandle} />
        )}
        fixedFooterContent={showAggregateFooter ? () => (
          <RecordTableAggregateFooterRow
            selectable={effectiveSelectable}
            hasRowActions={hasRowActions}
            showDragHandle={showDragHandle}
          />
        ) : undefined}
        computeItemKey={(index, item) =>
          isVirtualActionRow(item) ? "__action-row" : item?.key ?? String(index)
        }
        itemContent={(_index, item: VirtualItem | undefined) =>
          !item || isVirtualActionRow(item) ? (
            <RecordTableActionRowCells colSpan={tableColumnCount} />
          ) : item.kind === "group" ? (
            <RecordTableGroupRowCells group={item.group} collapsed={item.collapsed} {...groupRowProps} />
          ) : (
            <RecordTableRow
              record={item.record}
              rowIndex={item.rowIndex}
              selectable={effectiveSelectable}
              mobileSelectionMode={inlineSelection}
              showDragHandle={showDragHandle}
              renderRowActions={renderRowActions}
              rowMenuSections={rowMenuSections}
              showOpenRecordAction={hasOpenRecordAction}
              longPressSelect={selectable}
              renderCell={renderCell}
            />
          )
        }
      />
      {rowContextMenuElement}
    </div>
  );
}

function getLabelColumn(columns: RecordField[], labelIdentifierFieldName?: string) {
  return (
    columns.find((column) => column.field.name === labelIdentifierFieldName) ??
    columns.find((column) => column.isVisible) ??
    columns[0]
  );
}

function buildBoardColumns(records: any[], column: RecordField | undefined): RecordBoardColumn[] {
  if (!column) return [];
  const options = Array.isArray(column.field.config?.options)
    ? column.field.config.options
    : [];
  if (options.length > 0) {
    return options.map((option: any) => ({
      id: String(option.value),
      label: String(option.label ?? option.value),
      tone: option.color,
    }));
  }
  if (column.field.fieldType === FIELD_TYPES.BOOLEAN) {
    return [
      { id: "true", label: column.field.config?.trueLabel ?? "True", tone: "green" },
      { id: "false", label: column.field.config?.falseLabel ?? "False", tone: "gray" },
    ];
  }
  const values = new Set<string>();
  for (const record of records) values.add(normalizeBoardValue(record[column.field.name]));
  return Array.from(values)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ id: value, label: value }));
}

function normalizeBoardValue(value: unknown): string {
  if (Array.isArray(value)) return normalizeBoardValue(value[0]);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return String(record.value ?? record.id ?? record._id ?? record.label ?? record.name ?? "");
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value ?? "");
}

function getBoardCardPlainText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(getBoardCardPlainText).filter(Boolean).join(", ");
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const label =
      record.label ??
      record.name ??
      record.title ??
      record.email ??
      record.phone ??
      record.url ??
      record.fileName;
    if (label != null) return String(label);
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value ?? "");
}
