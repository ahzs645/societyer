/**
 * Opportunities or awards on the shared record table, in memory: the rows a
 * source's `useList` loaded (the whole kind, or a buyer's share of it), so
 * sort, filter, search and grouping see every row, not a page. The view
 * presets are ordinary engine filters and sorts, so they show as chips and can
 * be changed. Cells and phone cards are drawn here once for the catalog list
 * and the buyer pages alike.
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
  RecordTable,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  RecordTablePhoneCard,
  RecordTableScope,
  RecordTableToolbar,
  staticRecordTable,
  useRecordTableState,
  useRecordTableStoreHandle,
  type RecordTableCardRenderer,
  type RecordTableCellRenderer,
} from "../../../platform/record-engine/record-table";
import { FIELD_TYPES } from "../../../platform/record-engine/types";
import type {
  HydratedView,
  ViewFilter,
  ViewSort,
} from "../../../platform/record-engine/types";
import {
  deadlineOf,
  shortSourceDate,
  sortableDate,
  sourceLabel,
  statusOf,
  zoneToday,
  type NoticeDeadline,
} from "../lib/notice";
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
import { DocumentsCell, DocumentsCount } from "./DocumentsCell";
import { useReaderNavigation } from "./routes";
import { useReaderSource, type ListRow } from "./source";
import { useProcurementClock } from "../lib/clock";
import { ServerNoticeRows } from "./ServerNoticeRows";
import { useNoticeTextMatches } from "./noticeTextMatches";
import { useReaderTriage } from "./triage";
import { TRIAGE_FIELDS, joinTriage, useTriageEditing, type TriagedRow } from "./triageList";

export type NoticeKind = "opportunity" | "award";

/** The opportunity list's presets ("upcoming" is the default); awards have one view, latest first. */
export type NoticeViewId =
  | "upcoming"
  | "Open"
  | "all"
  | "Closed"
  | "Awarded"
  | "Cancelled"
  | "documents"
  | "triage"
  | "archived";
export const NOTICE_VIEWS: {
  _id: NoticeViewId;
  name: string;
  isSystem: boolean;
  /** Offered only where the workspace's triage is (triageList.tsx). */
  triage?: true;
}[] = [
  { _id: "upcoming", name: "Open, closing soonest", isSystem: false },
  { _id: "triage", name: "Open, best classification first", isSystem: false, triage: true },
  { _id: "Open", name: "All open, including unverified closing dates", isSystem: false },
  { _id: "all", name: "All, latest closing first", isSystem: false },
  { _id: "Closed", name: "Closed", isSystem: false },
  { _id: "Awarded", name: "Awarded", isSystem: false },
  { _id: "Cancelled", name: "Cancelled", isSystem: false },
  { _id: "documents", name: "With documents", isSystem: false },
  { _id: "archived", name: "Archived: reviewed, not doable", isSystem: false, triage: true },
];
export const isNoticeView = (value: string | null): value is NoticeViewId =>
  NOTICE_VIEWS.some((view) => view._id === value);

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
            size: 340,
          },
          {
            name: "organization",
            label: "Buyer",
            fieldType: FIELD_TYPES.TEXT,
            size: 220,
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
            size: 340,
          },
          {
            name: "organization",
            label: "Buyer",
            fieldType: FIELD_TYPES.TEXT,
            size: 210,
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

/** A preset's filters and sorts, as a view the table loads (and shows as chips). */
function presetView(
  kind: NoticeKind,
  viewId: NoticeViewId,
  hiddenFields: readonly string[],
  today = zoneToday(),
  triaged = false,
): HydratedView {
  const { hydratedView } = triaged ? TRIAGED_OPPORTUNITIES : TABLES[kind];
  const field = (name: string) => fieldId(kind, name);
  const status = (value: string): ViewFilter => ({
    id: "status",
    fieldMetadataId: field("status"),
    operator: "eq",
    value,
  });
  const latest: ViewSort[] = [
    { id: "when", fieldMetadataId: field("when"), direction: "desc" },
  ];
  let filters: ViewFilter[] = [];
  let sorts = latest;
  if (kind === "opportunity") {
    if (viewId === "upcoming" || viewId === "triage") {
      // "Open" is the derived status: an open notice whose deadline passed reads Closed (statusOf in lib/notice.ts).
      filters = [
        status("Open"),
        {
          id: "closes",
          fieldMetadataId: field("when"),
          operator: "between",
          value: { preset: "custom", start: today },
        },
      ];
      sorts = [
        // Best classification first (unclassified last), each closing soonest first.
        ...(viewId === "triage"
          ? [{ id: "classification", fieldMetadataId: field("classification"), direction: "asc" as const }]
          : []),
        { id: "when", fieldMetadataId: field("when"), direction: "asc" },
      ];
    } else if (viewId === "documents")
      filters = [
        {
          id: "documents",
          fieldMetadataId: field("documents"),
          operator: "gt",
          value: 0,
        },
      ];
    // The archived rows are chosen before the table (triageList.tsx joinTriage); the view only orders them.
    else if (viewId !== "all" && viewId !== "archived") filters = [status(viewId)];
  }
  const name =
    kind === "award"
      ? "All awards"
      : (NOTICE_VIEWS.find((view) => view._id === viewId)?.name ?? "");
  return {
    view: {
      ...hydratedView.view,
      _id: `${hydratedView.view._id}:${viewId}`,
      name,
      filters,
      sorts,
    },
    columns: hydratedView.columns.map((column) =>
      hiddenFields.includes(column.field.name)
        ? { ...column, isVisible: false }
        : column,
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

function money(value: number | null, currency: string): string {
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

function useCells(
  openDocuments: (recordKey: string) => void,
): RecordTableCellRenderer {
  return useMemo<RecordTableCellRenderer>(
    () =>
      ({ record, field }) => {
        const row = record as NoticeRow;
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
    [openDocuments],
  );
}

/**
 * Phones: the title on up to two lines and the status tag, then two lines of
 * meta. The first is when, the day without its time, plus how long is left
 * ("Closes Nov 13 · in 2 days"); for an award, its value. The second, quieter,
 * is who (the buyer, or an award's supplier), then the paperclip count and
 * whether we reviewed it. Each line truncates on its own, so a long buyer
 * name never pushes the date out.
 */
const renderPhoneCard: RecordTableCardRenderer = (
  record,
  { open, field, selecting },
) => {
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
  return (
    <RecordTablePhoneCard
      title={row.title}
      wrapTitle
      // The workspace's classification, once there is one, says more than "Open" in the open views.
      badge={award ? undefined : row.classification ? field("classification") : row.status ? field("status") : undefined}
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
        award ? row.supplier || row.organization : row.organization,
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
};

/**
 * Opportunities or awards in the shared table, with the catalog list's
 * columns, cells, phone cards and clicks (a row opens its notice; the
 * paperclip opens the notice's documents). Pass the rows to show, already
 * narrowed (a buyer's notices, say), and a `tableId` unique to the place.
 * `view` picks a preset; give `onChangeView` to offer the preset picker
 * (opportunities). `search`/`onSearch` keep the search box in the caller's
 * state (the URL); without them it lasts for the visit. `progress` says how
 * many rows of how many have arrived while the list still loads.
 */
export function NoticeTable({
  kind,
  rows,
  serverPaging = false,
  fixedParty,
  tableId,
  view = "upcoming",
  onChangeView,
  search,
  onSearch,
  progress,
  hiddenFields = [],
  label,
  emptyState,
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
  /** The toolbar's title when there's no preset picker. */
  label?: string;
  emptyState?: ReactNode;
}) {
  const nav = useReaderNavigation();
  const source = useReaderSource();
  // The workspace's triage joins onto a list held in memory (the catalog service's); a list paged
  // by the server is ordered and filtered there, without it.
  const readerTriage = useReaderTriage();
  const triage = kind === "opportunity" && !serverPaging ? readerTriage : null;
  if (!triage && NOTICE_VIEWS.find((entry) => entry._id === view)?.triage) view = "upcoming";
  const triaged = !!triage;
  const { objectMetadata } = triaged ? TRIAGED_OPPORTUNITIES : TABLES[kind];
  const hidden = hiddenFields.join(",");
  const now = useProcurementClock();
  const today = zoneToday(now);
  // One view object per preset: a new object reloads the table's filters and sorts, so this
  // follows whether there is a triage, not each change to it.
  const hydratedView = useMemo(
    () => presetView(kind, view, hidden ? hidden.split(",") : [], today, triaged),
    [kind, view, hidden, today, triaged],
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
  const drawnRows = useMemo(
    () =>
      rows
        .filter((row) => matchesBcBidSourceFilters(row, sourceFilters))
        .map((row) => drawnRow(row, now)),
    [rows, now, sourceFilters],
  );
  // The search box also finds notices by their text (where the source can search it): those
  // notices carry the words in their search text, so the table's own search keeps them.
  const textMatches = useNoticeTextMatches(kind, serverPaging ? "" : search ?? "");
  const entries = triage?.entries;
  const triagedRows = useMemo<(NoticeRow | TriagedRow)[]>(
    () => (entries ? joinTriage(drawnRows, entries, view === "archived") : drawnRows),
    [drawnRows, entries, view],
  );
  const records = useMemo(
    () =>
      textMatches.keys.size
        ? triagedRows.map((row) =>
            textMatches.keys.has(row._id)
              ? { ...row, _searchText: `${row._searchText}\n${textMatches.query}` }
              : row,
          )
        : triagedRows,
    [triagedRows, textMatches],
  );
  const { onUpdate, rowMenuSections, dialog: actionItemDialog } = useTriageEditing(triage, rows);
  const { openNotice } = nav;
  const renderCell = useCells(
    useCallback(
      (recordKey: string) => openNotice(recordKey, "documents"),
      [openNotice],
    ),
  );
  // Until the triage arrives a triaged list would show archived rows, so it waits for it.
  const loading = (progress ? !progress.done && records.length === 0 : false) || (!!triage && !entries);
  const [filtering, setFiltering] = useState(false);

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
                    : `No ${objectMetadata.labelPlural.toLowerCase()} here`}
                </div>
                <div className="record-table__empty-desc">
                  {serverPaging && hasMore
                    ? "None of the notices checked so far match."
                    : search
                    ? "Try fewer or different words."
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
      >
        {onSearch && <SearchSync search={search ?? ""} onSearch={onSearch} />}
        <RecordTableToolbar
          label={label ?? objectMetadata.labelPlural}
          icon={<FileSearch size={14} />}
          collapsibleSearch
          searchPlaceholder={source.searchText && !serverPaging ? `Search ${objectMetadata.labelPlural.toLowerCase()} and notice text…` : undefined}
          onOpenFilter={() => (filtering ? closeFilters() : setFiltering(true))}
          extraFilterCount={sourceChips.length}
          {...(onChangeView && kind === "opportunity"
            ? {
                views: triage ? NOTICE_VIEWS : NOTICE_VIEWS.filter((entry) => !entry.triage),
                currentViewId: view,
                onChangeView: (viewId: string) => {
                  if (isNoticeView(viewId)) onChangeView(viewId);
                },
              }
            : {})}
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
        <RecordTableFilterChips
          extraChips={sourceChips}
          onClearExtra={offersSourceFilters ? clearSourceFilters : undefined}
        />
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
