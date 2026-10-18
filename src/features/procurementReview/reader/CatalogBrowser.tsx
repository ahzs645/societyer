/**
 * The procurement reader's list: opportunities or awards on the shared record
 * table (toolbar, column picker, density, phone cards). The catalog is too
 * large for the browser, so the table runs in its server-query mode: the
 * search box and the view presets become the server query, 25 records a page.
 * The kind, view and search live in the URL, so a notice's Back returns to the
 * same list.
 */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FileSearch } from "lucide-react";
import {
  RecordTable,
  RecordTablePager,
  RecordTablePhoneCard,
  RecordTableScope,
  RecordTableToolbar,
  staticRecordTable,
  useRecordTableState,
  useRecordTableStoreHandle,
  type RecordTableCardRenderer,
  type RecordTableCellRenderer,
  type RecordTableServerQuery,
} from "../../../platform/record-engine/record-table";
import { FIELD_TYPES } from "../../../platform/record-engine/types";
import { Tabs } from "../../../components/primitives";
import { deadlineOf, shortSourceDate, sourceLabel, statusOf, zoneToday, type NoticeDeadline } from "../lib/notice";
import { NoticePage } from "./NoticePage";
import { useReaderSource, type RecordSummary } from "./source";

const PAGE_SIZE = 25;
/** The notice open over the list: `?notice=<record key>` (the shared table keeps `record` for its side panel). */
export const NOTICE_PARAM = "notice";

/** Reference data (taxonomy terms and the like) is published too, but isn't something a reviewer browses. */
const KINDS = [
  { id: "opportunity", label: "Opportunities" },
  { id: "award", label: "Awards" },
] as const;
type Kind = (typeof KINDS)[number]["id"];

type StatusFilter = "upcoming" | "all" | "Closed" | "Awarded" | "Cancelled";
const VIEWS: { _id: StatusFilter; name: string; isSystem: boolean }[] = [
  { _id: "upcoming", name: "Open, closing soonest", isSystem: false },
  { _id: "all", name: "All, latest closing first", isSystem: false },
  { _id: "Closed", name: "Closed", isSystem: false },
  { _id: "Awarded", name: "Awarded", isSystem: false },
  { _id: "Cancelled", name: "Cancelled", isSystem: false },
];
const isStatus = (value: string | null): value is StatusFilter => VIEWS.some((view) => view._id === value);

const STATUS_OPTIONS = [
  { value: "Open", label: "Open", color: "green" },
  { value: "Closed", label: "Closed", color: "gray" },
  { value: "Awarded", label: "Awarded", color: "blue" },
  { value: "Cancelled", label: "Cancelled", color: "red" },
];

function tableFor(kind: Kind) {
  const award = kind === "award";
  return staticRecordTable({
    id: `procurement-review:${kind}`,
    nameSingular: award ? "procurementAward" : "procurementOpportunity",
    namePlural: award ? "procurementAwards" : "procurementOpportunities",
    labelSingular: award ? "Award" : "Opportunity",
    labelPlural: award ? "Awards" : "Opportunities",
    labelIdentifierFieldName: "title",
    viewName: award ? "All awards" : "Open, closing soonest",
    fields: [
      { name: "title", label: award ? "Award" : "Opportunity", fieldType: FIELD_TYPES.TEXT, size: 360 },
      { name: "organization", label: "Buyer", fieldType: FIELD_TYPES.TEXT, size: 220 },
      { name: "source", label: "Source", fieldType: FIELD_TYPES.TEXT, size: 140 },
      { name: "status", label: "Status", fieldType: FIELD_TYPES.SELECT, size: 110, config: { options: STATUS_OPTIONS } },
      { name: "when", label: award ? "Awarded" : "Closes", fieldType: FIELD_TYPES.TEXT, size: 210 },
    ],
  });
}
const TABLES: Record<Kind, ReturnType<typeof tableFor>> = { opportunity: tableFor("opportunity"), award: tableFor("award") };

/** A list row as the table draws it. */
type NoticeRow = {
  _id: string;
  kind: string;
  title: string;
  organization: string;
  source: string;
  status: string;
  when: string;
  relative: string;
  state: NoticeDeadline["state"];
};

function toRow(summary: RecordSummary): NoticeRow {
  // Older imports stored the source's own text in `date`; newer ones keep it in `dateText`.
  const raw = summary.date || summary.dateText || "";
  const opportunity = summary.kind === "opportunity";
  const deadline = opportunity ? deadlineOf(raw) : null;
  const dated = deadline ? deadline.state !== "unknown" : Boolean(raw);
  return {
    _id: summary.recordKey,
    kind: summary.kind,
    title: summary.title || "Untitled notice",
    organization: summary.organization,
    source: sourceLabel(summary.recordKey),
    status: statusOf(summary.kind, summary.status, deadline)?.label ?? "",
    when: !raw ? (opportunity ? "No closing date" : "") : dated ? shortSourceDate(raw) : raw,
    relative: deadline && deadline.state !== "closed" ? deadline.relative : "",
    state: deadline?.state ?? "unknown",
  };
}

/** The date column: the day (and time), with how long is left under it. */
const renderCell: RecordTableCellRenderer = ({ record, field }) => {
  if (field.name !== "when") return undefined;
  const row = record as NoticeRow;
  return (
    <span className="procurement-reader__when" data-state={row.state}>
      <span>{row.when || "—"}</span>
      {row.relative && <small>{row.relative}</small>}
    </span>
  );
};

/** Phones: the title, the status tag, and the buyer with the date (which says what it is, without a column heading). */
const renderPhoneCard: RecordTableCardRenderer = (record, { open, field, selecting }) => {
  const row = record as unknown as NoticeRow;
  const prefix = row.state === "unknown" || !row.when ? "" : row.kind === "award" ? "Awarded " : row.state === "closed" ? "Closed " : "Closes ";
  return (
    <RecordTablePhoneCard
      title={row.title}
      badge={row.status ? field("status") : undefined}
      // The date leads: a long buyer name would otherwise push it out of the one-line meta.
      meta={[
        row.when && (
          <span className="procurement-reader__when" data-state={row.state}>
            {prefix}{row.when}{row.relative && <small> · {row.relative}</small>}
          </span>
        ),
        row.organization,
      ]}
      onOpen={open}
      selecting={selecting}
    />
  );
};

export function CatalogBrowser() {
  const source = useReaderSource();
  const [params, setParams] = useSearchParams();
  const noticeKey = params.get(NOTICE_PARAM);
  const kinds = KINDS.filter((kind) => (source.catalog.counts[kind.id] ?? 0) > 0);
  const kind: Kind = kinds.find((item) => item.id === params.get("kind"))?.id ?? kinds[0]?.id ?? "opportunity";

  const update = (patch: Record<string, string | null>) => setParams((current) => {
    const next = new URLSearchParams(current);
    for (const [key, value] of Object.entries(patch)) { if (value) next.set(key, value); else next.delete(key); }
    return next;
  }, { replace: true });

  const listParams = new URLSearchParams(params);
  listParams.delete(NOTICE_PARAM);
  listParams.delete("tab");
  const listHref = `?${listParams.toString()}`;
  if (noticeKey) return <NoticePage recordKey={noticeKey} listHref={listHref} onBack={() => update({ [NOTICE_PARAM]: null, tab: null })} />;

  return (
    <>
      {kinds.length > 1 && (
        <Tabs
          value={kind}
          onChange={(next) => update({ kind: next === "opportunity" ? null : next, status: null, q: null })}
          items={kinds.map((item) => ({ id: item.id, label: item.label, count: source.catalog.counts[item.id] }))}
          tabRoles
          ariaLabel="Catalog"
        />
      )}
      <CatalogTable key={kind} kind={kind} params={params} update={update} />
    </>
  );
}

function CatalogTable({ kind, params, update }: { kind: Kind; params: URLSearchParams; update: (patch: Record<string, string | null>) => void }) {
  const source = useReaderSource();
  const { objectMetadata, hydratedView } = TABLES[kind];
  const opportunity = kind === "opportunity";
  const requested = params.get("status");
  const status: StatusFilter = !opportunity ? "all" : isStatus(requested) ? requested : "upcoming";
  const search = params.get("q") ?? "";
  // A changed query starts again from its first page.
  const query = `${status}\u0000${search}`;
  const [paging, setPaging] = useState<{ query: string; cursors: (string | null)[] }>({ query, cursors: [null] });
  const cursors = paging.query === query ? paging.cursors : [null];
  const from = useMemo(() => (status === "upcoming" ? zoneToday() : undefined), [status]);
  const page = source.useRecords({
    kind, search,
    status: status === "upcoming" ? "Open" : status === "all" ? "" : status,
    ...(from ? { from } : {}),
    cursor: cursors[cursors.length - 1], pageSize: PAGE_SIZE,
  });
  const rows = useMemo(() => (page ? page.page.map(toRow) : null), [page]);
  // The last page stays on screen while the next one loads, so the table doesn't flash empty.
  const [shown, setShown] = useState<NoticeRow[] | null>(null);
  useEffect(() => { if (rows) setShown(rows); }, [rows]);
  const records = rows ?? shown ?? [];

  const serverQuery = useMemo<RecordTableServerQuery>(() => ({
    sortableFieldNames: [],
    pagination: page ? {
      page: cursors.length,
      hasPrevious: cursors.length > 1,
      hasNext: !page.isDone,
      onPrevious: () => setPaging({ query, cursors: cursors.slice(0, -1) }),
      onNext: () => setPaging({ query, cursors: [...cursors, page.continueCursor] }),
    } : undefined,
  }), [page, cursors, query]);

  return (
    <div className="procurement-reader">
      <RecordTableScope
        tableId={`procurement-review:${kind}`}
        objectMetadata={objectMetadata}
        hydratedView={hydratedView}
        records={records}
        serverQuery={serverQuery}
        cellPreviews={false}
        onRecordClick={(recordId) => update({ [NOTICE_PARAM]: recordId })}
      >
        <SearchSync search={search} onSearch={(value) => update({ q: value || null })} />
        <RecordTableToolbar
          label={objectMetadata.labelPlural}
          icon={<FileSearch size={14} />}
          {...(opportunity ? {
            views: VIEWS,
            currentViewId: status,
            onChangeView: (viewId: string) => update({ status: viewId === "upcoming" ? null : viewId }),
          } : {})}
        />
        <RecordTable
          loading={!rows && !shown}
          showAggregateFooter={false}
          renderCell={renderCell}
          renderPhoneCard={renderPhoneCard}
          emptyState={
            <div className="record-table__empty">
              <div className="record-table__empty-title">{search ? `Nothing matches “${search}”` : `No ${objectMetadata.labelPlural.toLowerCase()} here`}</div>
              <div className="record-table__empty-desc">{search ? "Try fewer or different words." : "Choose another view to see more."}</div>
            </div>
          }
        />
        <RecordTablePager />
      </RecordTableScope>
    </div>
  );
}

/** The toolbar's search box is the server query: seeded from the URL, written back after a pause in typing. */
function SearchSync({ search, onSearch }: { search: string; onSearch: (value: string) => void }) {
  const handle = useRecordTableStoreHandle();
  const term = useRecordTableState((s) => s.searchTerm);
  useEffect(() => { if (handle.get().searchTerm.trim() !== search) handle.get().setSearchTerm(search); }, [handle, search]);
  useEffect(() => {
    const value = term.trim();
    if (value === search || value.length > 200) return;
    const timer = setTimeout(() => onSearch(value), 300);
    return () => clearTimeout(timer);
  }, [term]); // eslint-disable-line react-hooks/exhaustive-deps -- only typing schedules a search
  return null;
}
