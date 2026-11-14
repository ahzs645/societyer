/**
 * Opportunities or awards on the shared record table, in memory: the rows a
 * source's `useList` loaded (the whole kind, or a buyer's share of it), so
 * sort, filter, search and grouping see every row, not a page. Opportunities
 * open as a review queue (queue.ts, QueueBar.tsx): each view picks its rows
 * before the table, so the person's own filters show as the only chips. Cells
 * and phone cards are drawn here once for the catalog list and the buyer
 * pages alike, with a dot on notices issued since the person's last visit
 * (lastVisit.ts).
 *
 * Opportunities can also be narrowed by BC Bid's own facts (BcBidFilters.tsx).
 * Those live in the URL rather than the table, but share its Filter button,
 * filter editor and pills, so a reviewer has one place to filter.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FileSearch } from "lucide-react";
import {
  RecordListTableMemory,
  RecordTable,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  RecordTableScope,
  RecordTableToolbar,
  listTableMemoryKey,
  listViewFieldsHash,
  restoreListTableMemory,
  staticRecordTable,
  useRecordTableState,
  useRecordTableStoreHandle,
} from "../../../platform/record-engine/record-table";
import { FIELD_TYPES } from "../../../platform/record-engine/types";
import type {
  HydratedView,
  ViewFilter,
  ViewSort,
} from "../../../platform/record-engine/types";
import { useSociety } from "../../../hooks/useSociety";
import { useCurrentUserId } from "../../../hooks/useCurrentUser";
import { useIsBottomSheet } from "../../../lib/useSheetDrag";
import { zoneToday } from "../lib/notice";
import { useIsOurOrganisation } from "../lib/ourOrganisation";
import {
  BC_FILTER_KEYS,
  bcBidSourceFilters,
  matchesBcBidSourceFilters,
  type BcBidSourceFilters,
} from "../../../../shared/bcBidSourceFilters";
import {
  BcBidFilterFields,
  bcBidFilterChips,
  bcBidFilterPatch,
  isCommodityCode,
} from "./BcBidFilters";
import { readerPlaces, useReaderNavigation } from "./routes";
import { useReaderSource, type ListRow } from "./source";
import { useProcurementClock } from "../lib/clock";
import { ServerNoticeRows } from "./ServerNoticeRows";
import { useNoticeTextMatches } from "./noticeTextMatches";
import { useReaderTriage } from "./triage";
import { TRIAGE_FIELDS, joinTriage, useTriageEditing, type TriagedRow } from "./triageList";
import { ListShortcuts, PublishListOrder, useCells, usePhoneCard } from "./noticeCells";
import { newSince, usePreviousVisit } from "./lastVisit";
import { QueueBar } from "./QueueBar";
import { useSplitView } from "./splitView";
import {
  OPEN_VIEWS,
  availableView,
  countNoticeViews,
  inNoticeView,
  moreViews,
  noticeViewName,
  primaryViews,
  type NoticeViewId,
} from "./queue";

export type NoticeKind = "opportunity" | "award";

export { NOTICE_VIEWS, isNoticeView, type NoticeViewId } from "./queue";

const STATUS_OPTIONS = [
  { value: "Open", label: "Open", color: "green" },
  { value: "Closed", label: "Closed", color: "gray" },
  { value: "Awarded", label: "Awarded", color: "blue" },
  { value: "Cancelled", label: "Cancelled", color: "red" },
];

function tableFor(kind: NoticeKind, triage = false) {
  const award = kind === "award";
  return staticRecordTable({
    id: `procurement-review:${kind}`,
    nameSingular: award ? "procurementAward" : "procurementOpportunity",
    namePlural: award ? "procurementAwards" : "procurementOpportunities",
    labelSingular: award ? "Award" : "Opportunity",
    labelPlural: award ? "Awards" : "Opportunities",
    labelIdentifierFieldName: "title",
    fields: award
      ? [
          {
            name: "title",
            config: { groupable: false },
            label: "Award",
            fieldType: FIELD_TYPES.TEXT,
            size: 440,
          },
          {
            name: "organization",
            label: "Buyer",
            fieldType: FIELD_TYPES.TEXT,
            size: 220,
            // Shown under the title instead (NoticeTitle); the column is a click away.
            isVisible: false,
          },
          {
            name: "supplier",
            label: "Supplier",
            fieldType: FIELD_TYPES.TEXT,
            size: 220,
          },
          {
            name: "value",
            config: { groupable: false },
            label: "Value",
            fieldType: FIELD_TYPES.NUMBER,
            size: 130,
          },
          {
            name: "when",
            label: "Awarded",
            fieldType: FIELD_TYPES.DATE_TIME,
            size: 140,
          },
          {
            name: "source",
            config: { sortable: false },
            label: "Source",
            fieldType: FIELD_TYPES.TEXT,
            size: 130,
            // Still a column to show and a field to filter by.
            isVisible: false,
          },
          {
            name: "procurementType",
            label: "Type",
            fieldType: FIELD_TYPES.TEXT,
            size: 180,
            isVisible: false,
          },
        ]
      : [
          {
            name: "title",
            config: { groupable: false },
            label: "Opportunity",
            fieldType: FIELD_TYPES.TEXT,
            size: 460,
          },
          {
            name: "organization",
            label: "Buyer",
            fieldType: FIELD_TYPES.TEXT,
            size: 210,
            isVisible: false,
          },
          {
            name: "when",
            label: "Closes",
            fieldType: FIELD_TYPES.DATE_TIME,
            size: 200,
          },
          ...(triage ? TRIAGE_FIELDS : []),
          {
            name: "issuedFor",
            label: "Issued for",
            fieldType: FIELD_TYPES.TEXT,
            size: 200,
            isVisible: false,
          },
          {
            name: "source",
            config: { sortable: false },
            label: "Source",
            fieldType: FIELD_TYPES.TEXT,
            size: 130,
            // Still a column to show and a field to filter by.
            isVisible: false,
          },
          {
            name: "status",
            label: "Status",
            fieldType: FIELD_TYPES.SELECT,
            size: 110,
            config: { options: STATUS_OPTIONS },
          },
          {
            name: "documents",
            config: { groupable: false },
            label: "Documents",
            fieldType: FIELD_TYPES.NUMBER,
            size: 110,
          },
        ],
  });
}
const TABLES: Record<NoticeKind, ReturnType<typeof tableFor>> = {
  opportunity: tableFor("opportunity"),
  award: tableFor("award"),
};
/** Opportunities with the workspace's triage columns. */
const TRIAGED_OPPORTUNITIES = tableFor("opportunity", true);
const fieldId = (kind: NoticeKind, name: string) =>
  `procurement-review:${kind}:field:${name}`;


/**
 * A view's sort and default columns, as the table loads it. A list held in
 * memory picks the view's rows itself (queue.ts `inNoticeView`), so the view
 * carries no filters and none show as chips; a server-paged list has the
 * server filter, so there the view's rule is a table filter it can change.
 */
function presetView(
  kind: NoticeKind,
  viewId: NoticeViewId,
  hiddenFields: readonly string[],
  today: string,
  triaged: boolean,
  inMemory: boolean,
): HydratedView {
  const { hydratedView } = triaged ? TRIAGED_OPPORTUNITIES : TABLES[kind];
  const field = (name: string) => fieldId(kind, name);
  const status = (value: string): ViewFilter => ({
    id: "status",
    fieldMetadataId: field("status"),
    operator: "eq",
    value,
  });
  const by = (name: string, direction: "asc" | "desc"): ViewSort => ({ id: name, fieldMetadataId: field(name), direction });
  let filters: ViewFilter[] = [];
  let sorts: ViewSort[] = [by("when", "desc")];
  if (kind === "opportunity") {
    if (viewId === "review" || viewId === "upcoming" || viewId === "progress") sorts = [by("when", "asc")];
    // Best classification first (unclassified last), each closing soonest first.
    else if (viewId === "shortlist" || viewId === "triage") sorts = [by("classification", "asc"), by("when", "asc")];
    if (!inMemory) {
      if (viewId === "upcoming" || viewId === "triage") {
        // "Open" is the derived status: an open notice whose deadline passed reads Closed (statusOf in lib/notice.ts).
        filters = [
          status("Open"),
          { id: "closes", fieldMetadataId: field("when"), operator: "between", value: { preset: "custom", start: today } },
        ];
      } else if (viewId === "documents") {
        filters = [{ id: "documents", fieldMetadataId: field("documents"), operator: "gt", value: 0 }];
      } else if (viewId === "Open" || viewId === "Closed" || viewId === "Awarded" || viewId === "Cancelled") {
        filters = [status(viewId)];
      }
    }
  }
  const hidden = new Set(hiddenFields);
  // Every row of an open view is open.
  if (kind === "opportunity" && OPEN_VIEWS.has(viewId)) hidden.add("status");
  return {
    view: {
      ...hydratedView.view,
      _id: `${hydratedView.view._id}:${viewId}`,
      name: kind === "award" ? "All awards" : noticeViewName(viewId),
      filters,
      sorts,
    },
    columns: hydratedView.columns.map((column) =>
      hidden.has(column.field.name) ? { ...column, isVisible: false } : column,
    ),
  };
}

export { toNoticeRow } from "../../../../shared/procurementNoticeRow";
import {
  toNoticeRow,
  type NoticeRow,
} from "../../../../shared/procurementNoticeRow";

/** A list grows a page at a time; each row is drawn once, not again for every page that arrives after it. */
const drawn = new WeakMap<ListRow, { minute: number; result: NoticeRow }>();
function drawnRow(row: ListRow, now: number): NoticeRow {
  const minute = now, cached = drawn.get(row);
  if (cached?.minute === minute) return cached.result;
  const result = toNoticeRow(row, now);
  drawn.set(row, { minute, result });
  return result;
}

/**
 * Opportunities or awards in the shared table, with the catalog list's
 * columns, cells, phone cards and clicks (a row opens its notice; the
 * paperclip opens the notice's documents; an award's supplier opens the
 * supplier). Pass the rows to show, already narrowed (a buyer's notices, say),
 * and a `tableId` unique to the place. `view` picks a view (queue.ts); give
 * `onChangeView` to offer the queue states and "More views" (opportunities).
 * `search`/`onSearch` keep the search box in the caller's state (the URL);
 * without them it lasts for the visit. `progress` says how many rows of how
 * many have arrived while the list still loads.
 *
 * Each person's columns, sort, filters, grouping and density are remembered
 * per view in this browser (the shared table's list memory), as every other
 * list in the app does.
 */
export function NoticeTable({
  kind,
  rows,
  serverPaging = false,
  fixedParty,
  tableId,
  view: requestedView = "upcoming",
  onChangeView,
  search,
  onSearch,
  progress,
  hiddenFields = [],
  label,
  emptyState,
  publishOrder = false,
  keyboardShortcuts = false,
}: {
  kind: NoticeKind;
  rows: ListRow[];
  serverPaging?: boolean;
  fixedParty?: { field: "organization" | "issuedFor"; name: string };
  tableId: string;
  view?: NoticeViewId;
  onChangeView?: (view: NoticeViewId) => void;
  search?: string;
  onSearch?: (value: string) => void;
  progress?: { loaded: number; total: number; done: boolean };
  /** Columns to hide by default here (a buyer page hides Buyer). */
  hiddenFields?: readonly string[];
  /** The toolbar's title when there's no view switcher. */
  label?: string;
  emptyState?: ReactNode;
  /** Publish the rows' order for the notice page's previous/next (the reader's main list). */
  publishOrder?: boolean;
  /** J/K/Enter while the list shows (the reader's main list). */
  keyboardShortcuts?: boolean;
}) {
  const nav = useReaderNavigation();
  const source = useReaderSource();
  // The workspace's triage joins onto a list held in memory (the catalog service's); a list paged
  // by the server is ordered and filtered there, without it.
  const readerTriage = useReaderTriage();
  const triage = kind === "opportunity" && !serverPaging ? readerTriage : null;
  const triaged = !!triage;
  const inMemory = !serverPaging;
  const actionItems = triage?.actionItems;
  const view = kind === "award" ? "all" : availableView(requestedView, triaged);
  const { objectMetadata } = triaged ? TRIAGED_OPPORTUNITIES : TABLES[kind];
  const hidden = hiddenFields.join(",");
  const now = useProcurementClock();
  const today = zoneToday(now);
  // One view object per view: a new object reloads the table's sorts and columns, so this
  // follows whether there is a triage, not each change to it.
  const hydratedView = useMemo(
    () => presetView(kind, view, hidden ? hidden.split(",") : [], today, triaged, inMemory),
    [kind, view, hidden, today, triaged, inMemory],
  );
  // Only opportunities carry BC Bid's facts, and only their list offers the filters.
  const offersSourceFilters = kind === "opportunity";
  const sourceFilterKey = offersSourceFilters
    ? JSON.stringify(
        Object.fromEntries(
          BC_FILTER_KEYS.map((key) => [key, nav.params.get(key)]).filter(
            ([, value]) => value,
          ),
        ),
      )
    : "{}";
  const sourceFilters = useMemo<BcBidSourceFilters>(() => {
    // A hand-edited link with a malformed filter shows the unfiltered list rather than an error page.
    try {
      return bcBidSourceFilters(JSON.parse(sourceFilterKey));
    } catch {
      return {};
    }
  }, [sourceFilterKey]);
  const shownRows = useMemo(
    () => rows.filter((row) => matchesBcBidSourceFilters(row, sourceFilters)),
    [rows, sourceFilters],
  );
  const drawnRows = useMemo(() => shownRows.map((row) => drawnRow(row, now)), [shownRows, now]);
  const previousVisit = usePreviousVisit();
  const fresh = useMemo(() => newSince(shownRows, previousVisit), [shownRows, previousVisit]);
  // The search box also finds notices by their text (where the source can search it): those
  // notices carry the words in their search text, so the table's own search keeps them.
  const textMatches = useNoticeTextMatches(kind, serverPaging ? "" : search ?? "");
  const entries = triage?.entries;
  const joinedRows = useMemo<(NoticeRow | TriagedRow)[]>(
    () => (entries ? joinTriage(drawnRows, entries) : drawnRows),
    [drawnRows, entries],
  );
  const viewRows = useMemo(
    () => (kind === "opportunity" && inMemory ? joinedRows.filter((row) => inNoticeView(view, row, today, actionItems)) : joinedRows),
    [joinedRows, kind, inMemory, view, today, actionItems],
  );
  const records = useMemo(
    () =>
      textMatches.keys.size
        ? viewRows.map((row) =>
            textMatches.keys.has(row._id)
              ? { ...row, _searchText: `${row._searchText}\n${textMatches.query}` }
              : row,
          )
        : viewRows,
    [viewRows, textMatches],
  );
  const offersViews = !!onChangeView && kind === "opportunity";
  const hasActionItems = actionItems !== undefined;
  const primary = useMemo(() => primaryViews(triaged, hasActionItems), [triaged, hasActionItems]);
  const more = useMemo(() => moreViews(triaged, hasActionItems), [triaged, hasActionItems]);
  // Counts for a list held in memory, before the person's own filters and search.
  const counted = useMemo(
    () => (offersViews && inMemory && (!triage || entries) ? countNoticeViews([...primary, ...more], joinedRows, today, actionItems, fresh) : null),
    [offersViews, inMemory, triage, entries, primary, more, joinedRows, today, actionItems, fresh],
  );
  const { onUpdate, rowMenuSections, dialog: actionItemDialog } = useTriageEditing(triage, rows);
  const { openNotice } = nav;
  const isOurOrganisation = useIsOurOrganisation();
  const isOurs = useCallback((name: string) => isOurOrganisation(name), [isOurOrganisation]);
  const buyerFixed = hiddenFields.includes("organization");
  const renderCell = useCells({
    openDocuments: useCallback((recordKey: string) => openNotice(recordKey, "documents"), [openNotice]),
    fresh,
    buyerFixed,
    isOurs,
  });
  const renderPhoneCard = usePhoneCard(fresh, isOurs);
  // Until the triage arrives a triaged list would show archived rows, so it waits for it.
  const loading = (progress ? !progress.done && records.length === 0 : false) || (!!triage && !entries);
  const [filtering, setFiltering] = useState(false);
  const isPhone = useIsBottomSheet();
  const places = readerPlaces(nav.params);
  const splitView = useSplitView();
  const openKey = places.notice;

  // This person's last state of each view, kept in this browser (as RecordListTable does).
  const society = useSociety() as { _id?: string } | null | undefined;
  const userId = useCurrentUserId();
  const societyId = society?._id ? String(society._id) : null;
  const memoryKey = societyId && userId ? listTableMemoryKey(societyId, String(userId), `${tableId}:${view}`) : null;
  const fieldsHash = useMemo(() => listViewFieldsHash(objectMetadata), [objectMetadata]);
  const initialize = (store: Parameters<typeof restoreListTableMemory>[0]) => {
    if (memoryKey) restoreListTableMemory(store, memoryKey, fieldsHash, hydratedView);
  };

  // The BC Bid filters as the filter editor is changing them; null while they are as applied.
  const [sourceDraft, setSourceDraft] = useState<BcBidSourceFilters | null>(null);
  const [codeInvalid, setCodeInvalid] = useState(false);
  const closeFilters = () => {
    setFiltering(false);
    setSourceDraft(null);
    setCodeInvalid(false);
  };
  const applySourceDraft = () => {
    if (!sourceDraft) return true;
    if (sourceDraft.commodityCode && !isCommodityCode(sourceDraft.commodityCode)) {
      setCodeInvalid(true);
      return false;
    }
    const pickedHistorical =
      sourceDraft.historicalType &&
      sourceDraft.historicalType !== sourceFilters.historicalType;
    nav.update({
      ...bcBidFilterPatch(sourceDraft),
      // Pre-2023 notices closed long ago; the default "open" view would hide them all.
      ...(pickedHistorical ? { status: "all" } : {}),
    });
    return true;
  };
  const { update } = nav;
  const sourceChips = useMemo(
    () =>
      offersSourceFilters
        ? bcBidFilterChips(sourceFilters).map((chip) => ({
            ...chip,
            onRemove: () => update({ [chip.key]: null }),
          }))
        : [],
    [offersSourceFilters, sourceFilters, update],
  );
  const clearSourceFilters = useCallback(() => update(bcBidFilterPatch()), [update]);

  const renderTable = (onEndReached?: () => void, serverLoading = false, hasMore = false, footer?: ReactNode) => (
        <RecordTable
          fillViewport
          // Beside an open notice (the split view), stepping to the next notice keeps its row in sight.
          followHighlight={splitView}
          onEndReached={onEndReached}
          listFooter={footer}
          loading={loading || serverLoading}
          showAggregateFooter={false}
          renderCell={renderCell}
          renderPhoneCard={renderPhoneCard}
          rowMenuSections={rowMenuSections}
          emptyState={
            emptyState ?? (
              <div className="record-table__empty">
                <div className="record-table__empty-title">
                  {serverPaging && hasMore
                    ? "Continue checking results"
                    : search
                    ? `Nothing matches “${search}”`
                    : view === "review" && triaged
                    ? "Nothing to review"
                    : `No ${objectMetadata.labelPlural.toLowerCase()} here`}
                </div>
                <div className="record-table__empty-desc">
                  {serverPaging && hasMore
                    ? "None of the notices checked so far match."
                    : search
                    ? "Try fewer or different words."
                    : view === "review" && triaged
                    ? "Every open opportunity has been reviewed. New ones show here as they are published."
                    : "Choose another view, or change the filters, to see more."}
                </div>
                {serverPaging && hasMore && footer && <div className="record-table__empty-action">{footer}</div>}
              </div>
            )
          }
        />
  );

  return (
    <div className="procurement-reader">
      <RecordTableScope
        // Once the workspace is known, start again from what this person left.
        key={societyId ?? "unremembered"}
        tableId={tableId}
        objectMetadata={objectMetadata}
        hydratedView={hydratedView}
        records={records}
        serverProcessed={serverPaging}
        cellPreviews={false}
        defaultDisplayMode="continuous"
        loadingProgress={
          progress && !progress.done
            ? { loaded: progress.loaded, total: progress.total }
            : null
        }
        onRecordClick={(recordId) => openNotice(recordId)}
        onRecordIntent={source.prefetchRecord}
        onUpdate={onUpdate}
        highlightedRecordId={openKey}
        initialize={initialize}
      >
        {memoryKey && <RecordListTableMemory storageKey={memoryKey} fieldsHash={fieldsHash} base={hydratedView} />}
        {onSearch && <SearchSync search={search ?? ""} onSearch={onSearch} />}
        {publishOrder && <PublishListOrder />}
        <ListShortcuts enabled={keyboardShortcuts && !places.notice && !places.party && !places.analytics} />
        <RecordTableToolbar
          label={label ?? objectMetadata.labelPlural}
          icon={<FileSearch size={14} />}
          collapsibleSearch
          searchPlaceholder={source.searchText && !serverPaging ? `Search ${objectMetadata.labelPlural.toLowerCase()} and notice text…` : undefined}
          onOpenFilter={() => (filtering ? closeFilters() : setFiltering(true))}
          extraFilterCount={sourceChips.length}
          viewTypeNames={VIEW_TYPE_NAMES}
          leading={
            offersViews && onChangeView ? (
              <QueueBar
                primary={primary}
                more={more}
                current={view}
                counts={counted?.counts}
                fresh={counted?.newToReview ?? 0}
                onChange={onChangeView}
              />
            ) : undefined
          }
        />
        <RecordTableFilterPopover
          open={filtering}
          onClose={closeFilters}
          {...(offersSourceFilters
            ? {
                extra: (
                  <BcBidFilterFields
                    value={sourceDraft ?? sourceFilters}
                    onChange={(next) => {
                      setSourceDraft(next);
                      setCodeInvalid(false);
                    }}
                    codeInvalid={codeInvalid}
                  />
                ),
                onApply: applySourceDraft,
              }
            : {})}
        />
        {/* Phones keep the active filters in the filter sheet, counted on its button, so the cards start higher. */}
        {!isPhone && (
          <RecordTableFilterChips
            extraChips={sourceChips}
            onClearExtra={offersSourceFilters ? clearSourceFilters : undefined}
          />
        )}
        {(textMatches.truncated || textMatches.error) && (
          <p className="procurement-reader__search-note small muted" role="status">
            {textMatches.error
              ? "Notice text can't be searched right now, so only the columns are searched."
              : "More notices mention these words than the list can show. Add words to narrow the search."}
          </p>
        )}
        {serverPaging ? (
          <ServerNoticeRows kind={kind} fixedParty={fixedParty} sourceFilters={sourceFilters}>
            {({ onEndReached, loading: serverLoading, hasMore, footer }) => renderTable(onEndReached, serverLoading, hasMore, footer)}
          </ServerNoticeRows>
        ) : renderTable()}

      </RecordTableScope>
      {actionItemDialog}
    </div>
  );
}

/** The toolbar's view types, named: the board groups by its first choice field (Classification, where there is a triage), the calendar by the closing (or award) date. */
const VIEW_TYPE_NAMES = { table: "Table", kanban: "Board", calendar: "Calendar" };

/**
 * The search box follows the caller's term (the URL): seeded from it, and
 * written back after a pause in typing. Only a term changed elsewhere (Back,
 * a link) is put into the box; the URL catching up with the typing must not
 * put an older term back over letters typed since. Loading a view (a preset)
 * resets the table's search, so the term from before the load is put back.
 */
function SearchSync({
  search,
  onSearch,
}: {
  search: string;
  onSearch: (value: string) => void;
}) {
  const handle = useRecordTableStoreHandle();
  const term = useRecordTableState((s) => s.searchTerm);

  // The term the URL has, or is being given, from this box.
  const synced = useRef<string | null>(null);
  useEffect(() => {
    if (synced.current === search) return;
    synced.current = search;
    if (handle.get().searchTerm.trim() !== search)
      handle.get().setSearchTerm(search);
  }, [handle, search]);
  useEffect(
    () =>
      handle.subscribe((state, previous) => {
        if (
          state.savedView !== previous.savedView &&
          state.searchTerm !== previous.searchTerm
        )
          state.setSearchTerm(previous.searchTerm);
      }),
    [handle],
  );

  useEffect(() => {
    const value = term.trim();
    if (value === synced.current || value.length > 200) return;
    const timer = setTimeout(() => {
      synced.current = value;
      onSearch(value);
    }, 300);
    return () => clearTimeout(timer);
  }, [term]); // eslint-disable-line react-hooks/exhaustive-deps -- only typing schedules a write
  return null;
}
