/**
 * Opportunities or awards on the shared record table, in memory: the rows a
 * source's `useList` loaded (the whole kind, or a buyer's share of it), so
 * sort, filter, search and grouping see every row, not a page. The view
 * presets are ordinary engine filters and sorts, so they show as chips and can
 * be changed. Cells and phone cards are drawn here once for the catalog list
 * and the buyer pages alike.
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
import { DocumentsCell, DocumentsCount } from "./DocumentsCell";
import { useReaderNavigation } from "./routes";
import { useReaderSource, type ListRow } from "./source";
import { ServerNoticeRows } from "./ServerNoticeRows";

export type NoticeKind = "opportunity" | "award";

/** The opportunity list's presets ("upcoming" is the default); awards have one view, latest first. */
export type NoticeViewId =
  | "upcoming"
  | "all"
  | "Closed"
  | "Awarded"
  | "Cancelled"
  | "documents";
export const NOTICE_VIEWS: {
  _id: NoticeViewId;
  name: string;
  isSystem: boolean;
}[] = [
  { _id: "upcoming", name: "Open, closing soonest", isSystem: false },
  { _id: "all", name: "All, latest closing first", isSystem: false },
  { _id: "Closed", name: "Closed", isSystem: false },
  { _id: "Awarded", name: "Awarded", isSystem: false },
  { _id: "Cancelled", name: "Cancelled", isSystem: false },
  { _id: "documents", name: "With documents", isSystem: false },
];
export const isNoticeView = (value: string | null): value is NoticeViewId =>
  NOTICE_VIEWS.some((view) => view._id === value);

const STATUS_OPTIONS = [
  { value: "Open", label: "Open", color: "green" },
  { value: "Closed", label: "Closed", color: "gray" },
  { value: "Awarded", label: "Awarded", color: "blue" },
  { value: "Cancelled", label: "Cancelled", color: "red" },
];

function tableFor(kind: NoticeKind) {
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
            name: "when",
            label: "Closes",
            fieldType: FIELD_TYPES.DATE_TIME,
            size: 200,
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
const fieldId = (kind: NoticeKind, name: string) =>
  `procurement-review:${kind}:field:${name}`;

/** A preset's filters and sorts, as a view the table loads (and shows as chips). */
function presetView(
  kind: NoticeKind,
  viewId: NoticeViewId,
  hiddenFields: readonly string[],
): HydratedView {
  const { hydratedView } = TABLES[kind];
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
    if (viewId === "upcoming") {
      // "Open" is the derived status: an open notice whose deadline passed reads Closed (statusOf in lib/notice.ts).
      filters = [
        status("Open"),
        {
          id: "closes",
          fieldMetadataId: field("when"),
          operator: "between",
          value: { preset: "custom", start: zoneToday() },
        },
      ];
      sorts = [
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
    else if (viewId !== "all") filters = [status(viewId)];
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
const drawn = new WeakMap<ListRow, NoticeRow>();
function drawnRow(row: ListRow): NoticeRow {
  let result = drawn.get(row);
  if (!result) drawn.set(row, (result = toNoticeRow(row)));
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
 * Phones: the title, the status tag, and one line of meta: the paperclip
 * count first (it is short, and the line truncates at its end), then the date
 * (a long buyer name would push it out of the line), then who.
 */
const renderPhoneCard: RecordTableCardRenderer = (
  record,
  { open, field, selecting },
) => {
  const row = record as unknown as NoticeRow;
  const award = row.kind === "award";
  const prefix =
    row.state === "unknown" || !row.whenText
      ? ""
      : award
        ? "Awarded "
        : row.state === "closed"
          ? "Closed "
          : "Closes ";
  return (
    <RecordTablePhoneCard
      title={row.title}
      badge={!award && row.status ? field("status") : undefined}
      meta={[
        !award && row.documents ? (
          <DocumentsCount documents={row.documents} />
        ) : (
          ""
        ),
        row.whenText && (
          <span
            className="procurement-reader__when"
            data-state={award ? undefined : row.state}
          >
            {prefix}
            {row.whenText}
            {row.relative && <small> · {row.relative}</small>}
          </span>
        ),
        award ? money(row.value, row.currency) : "",
        award ? row.supplier || row.organization : row.organization,
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
  const { objectMetadata } = TABLES[kind];
  const hidden = hiddenFields.join(",");
  // One view object per preset: a new object reloads the table's filters and sorts.
  const hydratedView = useMemo(
    () => presetView(kind, view, hidden ? hidden.split(",") : []),
    [kind, view, hidden],
  );
  const records = useMemo(() => rows.map(drawnRow), [rows]);
  const { openNotice } = nav;
  const renderCell = useCells(
    useCallback(
      (recordKey: string) => openNotice(recordKey, "documents"),
      [openNotice],
    ),
  );
  const loading = progress ? !progress.done && records.length === 0 : false;
  const [filtering, setFiltering] = useState(false);

  const renderTable = (onEndReached?: () => void, serverLoading = false) => (
        <RecordTable
          fillViewport
          onEndReached={onEndReached}
          loading={loading || serverLoading}
          showAggregateFooter={false}
          renderCell={renderCell}
          renderPhoneCard={renderPhoneCard}
          emptyState={
            emptyState ?? (
              <div className="record-table__empty">
                <div className="record-table__empty-title">
                  {search
                    ? `Nothing matches “${search}”`
                    : `No ${objectMetadata.labelPlural.toLowerCase()} here`}
                </div>
                <div className="record-table__empty-desc">
                  {search
                    ? "Try fewer or different words."
                    : "Choose another view, or change the filters, to see more."}
                </div>
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
      >
        {onSearch && <SearchSync search={search ?? ""} onSearch={onSearch} />}
        <RecordTableToolbar
          label={label ?? objectMetadata.labelPlural}
          icon={<FileSearch size={14} />}
          collapsibleSearch
          onOpenFilter={() => setFiltering((open) => !open)}
          {...(onChangeView && kind === "opportunity"
            ? {
                views: NOTICE_VIEWS,
                currentViewId: view,
                onChangeView: (viewId: string) => {
                  if (isNoticeView(viewId)) onChangeView(viewId);
                },
              }
            : {})}
        />
        <RecordTableFilterPopover
          open={filtering}
          onClose={() => setFiltering(false)}
        />
        <RecordTableFilterChips />
        {serverPaging ? (
          <ServerNoticeRows kind={kind} fixedParty={fixedParty}>
            {({ onEndReached, loading: serverLoading }) => renderTable(onEndReached, serverLoading)}
          </ServerNoticeRows>
        ) : renderTable()}

      </RecordTableScope>
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
