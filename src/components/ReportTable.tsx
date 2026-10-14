import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { Money } from "./Money";
import { InfoPopover } from "./InfoPopover";
import { Skeleton } from "./ui";
import type { NegativeStyle } from "../lib/money";

/**
 * Financial report table: hierarchical rows (sections → accounts →
 * sub-accounts), several value columns (periods), optional prior-period
 * comparison with Δ and Δ% columns, collapsible sections, and drilldown on
 * any amount. Amounts render through <Money> with accounting parentheses by
 * default so every statement in the app reads the same way.
 */

export type ReportRowKind = "section" | "row" | "subtotal" | "total" | "note";

export type ReportValue = number | null | undefined;

export type ReportRow<M = unknown> = {
  id: string;
  kind: ReportRowKind;
  label: ReactNode;
  /** Plain-text label for screen readers and drilldown titles when `label` is not a string. */
  title?: string;
  /** Account code shown muted before the label. */
  code?: string;
  /** Integer cents keyed by column id. */
  values?: Record<string, ReportValue>;
  /** Custom cell content keyed by column id (badges, dates, links). Wins over `values`. */
  cells?: Record<string, ReactNode>;
  children?: ReportRow<M>[];
  /** Small explanatory text under the label (calculated rows: retained earnings, net assets…). */
  note?: ReactNode;
  /** Marks the row as derived rather than posted; shows a "Calculated" tag. */
  calculated?: boolean;
  /** Which direction of change is good, so Δ can be coloured favourable/unfavourable. */
  favourable?: "increase" | "decrease";
  /** Override whether amounts on this row can be drilled into. Defaults to true for "row". */
  drilldown?: boolean;
  currency?: string;
  meta?: M;
};

export type ReportColumn = {
  id: string;
  label: ReactNode;
  /** Plain-text header for aria labels on amount buttons. */
  title?: string;
  /** Explanation opened from an ⓘ button in the header. */
  help?: ReactNode;
  /** Bold the column (the current period). */
  emphasis?: boolean;
  currency?: string;
};

export type ReportComparison = {
  current: string;
  prior: string;
  /** Show the Δ% column too (default true). */
  percent?: boolean;
  deltaLabel?: ReactNode;
};

type ReportTableProps<M> = {
  ariaLabel: string;
  columns: ReportColumn[];
  rows: ReportRow<M>[];
  labelHeader?: ReactNode;
  comparison?: ReportComparison | null;
  negativeStyle?: NegativeStyle;
  currency?: string;
  onDrilldown?: (row: ReportRow<M>, column: ReportColumn) => void;
  /** Column Enter / row click drills into. Defaults to the comparison's current column, else the first. */
  drillColumn?: string;
  /** Section ids collapsed on first render, or `true` to start fully collapsed. */
  defaultCollapsed?: string[] | boolean;
  /** Extra controls rendered left of Expand / Collapse all (period selector, filters). */
  toolbar?: ReactNode;
  loading?: boolean;
  empty?: ReactNode;
  /** Render zero as "—" instead of $0.00. */
  zeroAsDash?: boolean;
  className?: string;
  /** Cap the height on wide screens so the header stays visible while scrolling. */
  maxHeight?: "none" | "default";
};

const DELTA_ID = "__delta";
const DELTA_PCT_ID = "__delta_pct";

type FlatRow<M> = {
  row: ReportRow<M>;
  depth: number;
  parentId: string | null;
  hidden: boolean;
  collapsible: boolean;
  collapsed: boolean;
};

function collectCollapsibleIds<M>(rows: ReportRow<M>[], out: string[] = []) {
  for (const row of rows) {
    if (row.children?.length) {
      out.push(row.id);
      collectCollapsibleIds(row.children, out);
    }
  }
  return out;
}

function flatten<M>(rows: ReportRow<M>[], collapsed: Set<string>) {
  const out: FlatRow<M>[] = [];
  const walk = (list: ReportRow<M>[], depth: number, parentId: string | null, hidden: boolean) => {
    for (const row of list) {
      const collapsible = Boolean(row.children?.length);
      const isCollapsed = collapsible && collapsed.has(row.id);
      out.push({ row, depth, parentId, hidden, collapsible, collapsed: isCollapsed });
      if (collapsible) walk(row.children!, depth + 1, row.id, hidden || isCollapsed);
    }
  };
  walk(rows, 0, null, false);
  return out;
}

function textOf(row: ReportRow<unknown>) {
  if (row.title) return row.title;
  return typeof row.label === "string" ? row.label : row.id;
}

/** "+12.3%" / "−4.0%" / "—" when there is no base to compare against. */
export function formatPercentChange(ratio: number | null | undefined) {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  const value = Math.round(ratio * 1000) / 10;
  if (value === 0) return "0.0%";
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}%`;
}

function deltaFor(row: ReportRow<unknown>, comparison: ReportComparison) {
  const current = row.values?.[comparison.current];
  const prior = row.values?.[comparison.prior];
  if (current == null && prior == null) return null;
  const cents = (current ?? 0) - (prior ?? 0);
  const percent = !prior ? null : cents / Math.abs(prior);
  return { cents, percent };
}

function deltaTone(row: ReportRow<unknown>, cents: number): "auto" | "favourable" | "unfavourable" {
  if (!row.favourable || cents === 0) return "auto";
  const good = row.favourable === "increase" ? cents > 0 : cents < 0;
  return good ? "favourable" : "unfavourable";
}

export function ReportTable<M = unknown>({
  ariaLabel,
  columns,
  rows,
  labelHeader = "Account",
  comparison,
  negativeStyle = "parentheses",
  currency,
  onDrilldown,
  drillColumn,
  defaultCollapsed,
  toolbar,
  loading,
  empty,
  zeroAsDash,
  className,
  maxHeight = "default",
}: ReportTableProps<M>) {
  const collapsibleIds = useMemo(() => collectCollapsibleIds(rows), [rows]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    if (defaultCollapsed === true) return new Set(collapsibleIds);
    return new Set(Array.isArray(defaultCollapsed) ? defaultCollapsed : []);
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());

  const flat = useMemo(() => flatten(rows, collapsed), [rows, collapsed]);
  const visible = useMemo(() => flat.filter((entry) => !entry.hidden), [flat]);
  const focusId = activeId && visible.some((entry) => entry.row.id === activeId) ? activeId : visible[0]?.row.id ?? null;

  const allColumns: ReportColumn[] = useMemo(() => {
    if (!comparison) return columns;
    const extra: ReportColumn[] = [{ id: DELTA_ID, label: comparison.deltaLabel ?? "Change", title: "Change" }];
    if (comparison.percent !== false) extra.push({ id: DELTA_PCT_ID, label: "Change %", title: "Change percent" });
    return [...columns, ...extra];
  }, [columns, comparison]);
  const defaultDrill = drillColumn ?? comparison?.current ?? columns[0]?.id;

  const toggle = useCallback((id: string, next?: boolean) => {
    setCollapsed((prev) => {
      const copy = new Set(prev);
      const shouldCollapse = next ?? !copy.has(id);
      if (shouldCollapse) copy.add(id);
      else copy.delete(id);
      return copy;
    });
  }, []);

  const canDrill = (row: ReportRow<M>, columnId: string) => {
    if (!onDrilldown || columnId === DELTA_ID || columnId === DELTA_PCT_ID) return false;
    if (row.cells?.[columnId] !== undefined) return false;
    const value = row.values?.[columnId];
    if (value == null) return false;
    return row.drilldown ?? row.kind === "row";
  };

  const focusRow = (id: string | undefined) => {
    if (!id) return;
    setActiveId(id);
    rowRefs.current.get(id)?.focus();
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, entry: FlatRow<M>) => {
    if (event.target !== event.currentTarget) return;
    const index = visible.findIndex((candidate) => candidate.row.id === entry.row.id);
    const { row } = entry;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusRow(visible[index + 1]?.row.id);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusRow(visible[index - 1]?.row.id);
        break;
      case "Home":
        event.preventDefault();
        focusRow(visible[0]?.row.id);
        break;
      case "End":
        event.preventDefault();
        focusRow(visible[visible.length - 1]?.row.id);
        break;
      case "ArrowRight":
        if (!entry.collapsible) break;
        event.preventDefault();
        if (entry.collapsed) toggle(row.id, false);
        else focusRow(row.children?.[0]?.id);
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (entry.collapsible && !entry.collapsed) toggle(row.id, true);
        else if (entry.parentId) focusRow(entry.parentId);
        break;
      case "Enter":
        event.preventDefault();
        if (defaultDrill && canDrill(row, defaultDrill)) {
          const column = allColumns.find((candidate) => candidate.id === defaultDrill);
          if (column) onDrilldown?.(row, column);
        } else if (entry.collapsible) toggle(row.id);
        break;
      case " ":
        if (!entry.collapsible) break;
        event.preventDefault();
        toggle(row.id);
        break;
      default:
        break;
    }
  };

  const renderValue = (entry: FlatRow<M>, column: ReportColumn) => {
    const { row } = entry;
    const custom = row.cells?.[column.id];
    if (custom !== undefined) return custom;
    const rowCurrency = row.currency ?? column.currency ?? currency;
    if (column.id === DELTA_ID || column.id === DELTA_PCT_ID) {
      if (!comparison || row.kind === "section" || row.kind === "note") return null;
      const delta = deltaFor(row, comparison);
      if (!delta) return null;
      if (column.id === DELTA_PCT_ID) {
        if (delta.percent == null) return <span className="money money--empty">—</span>;
        return <span className={`report-table__pct money--${deltaTone(row, delta.cents)}`}>{formatPercentChange(delta.percent)}</span>;
      }
      return <Money cents={delta.cents} currency={rowCurrency} signDisplay="exceptZero" tone={deltaTone(row, delta.cents)} />;
    }
    const value = row.values?.[column.id];
    if (value == null) return row.kind === "section" ? null : <span className="money money--empty">—</span>;
    const money = zeroAsDash && value === 0
      ? <span className="money money--empty">—</span>
      : <Money cents={value} currency={rowCurrency} negativeStyle={negativeStyle} />;
    if (!canDrill(row, column.id)) return money;
    return (
      <button
        type="button"
        tabIndex={-1}
        className="report-table__amount"
        aria-label={`${textOf(row as ReportRow<unknown>)}, ${column.title ?? (typeof column.label === "string" ? column.label : column.id)}: show entries`}
        onClick={(event) => {
          event.stopPropagation();
          onDrilldown?.(row, column);
        }}
      >
        {money}
      </button>
    );
  };

  const colCount = allColumns.length + 1;
  const showControls = Boolean(toolbar) || collapsibleIds.length > 0;
  const allCollapsed = collapsibleIds.length > 0 && collapsibleIds.every((id) => collapsed.has(id));

  return (
    <div className={`report-table${className ? ` ${className}` : ""}`}>
      {showControls && (
        <div className="report-table__controls">
          {toolbar && <div className="report-table__toolbar">{toolbar}</div>}
          {collapsibleIds.length > 0 && (
            <div className="report-table__expand">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(collapsibleIds))}
              >
                {allCollapsed ? <ChevronsUpDown size={14} aria-hidden="true" /> : <ChevronsDownUp size={14} aria-hidden="true" />}
                {allCollapsed ? "Expand all" : "Collapse all"}
              </button>
            </div>
          )}
        </div>
      )}
      <div
        className={`report-table__scroll${maxHeight === "default" ? " report-table__scroll--capped" : ""}`}
        role="region"
        aria-label={ariaLabel}
        tabIndex={0}
      >
        <table className="report-table__table" aria-busy={loading || undefined}>
          <thead>
            <tr>
              <th scope="col" className="report-table__label-head">{labelHeader}</th>
              {allColumns.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  className={`num report-table__col-head${column.emphasis ? " is-emphasis" : ""}${column.id === DELTA_ID || column.id === DELTA_PCT_ID ? " is-delta" : ""}`}
                >
                  <span className="report-table__col-label">
                    {column.label}
                    {column.help && (
                      <InfoPopover label={`About ${column.title ?? (typeof column.label === "string" ? column.label : "this column")}`}>
                        {column.help}
                      </InfoPopover>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 5 }).map((_, index) => (
                  <tr key={`skeleton-${index}`} className="report-table__row report-table__row--skeleton">
                    <th scope="row" className="report-table__label">
                      <Skeleton variant="line" width={index % 2 ? "60%" : "45%"} />
                    </th>
                    {allColumns.map((column) => (
                      <td key={column.id} className="num">
                        <Skeleton variant="line" width="70%" />
                      </td>
                    ))}
                  </tr>
                ))
              : flat.map((entry) => {
                  const { row } = entry;
                  if (row.kind === "note") {
                    return (
                      <tr key={row.id} className={`report-table__row report-table__row--note${entry.hidden ? " is-collapsed" : ""}`} data-depth={entry.depth}>
                        <td colSpan={colCount} className="report-table__note-cell">
                          {row.label}
                        </td>
                      </tr>
                    );
                  }
                  const drillable = Boolean(defaultDrill && canDrill(row, defaultDrill));
                  return (
                    <tr
                      key={row.id}
                      ref={(node) => {
                        if (node) rowRefs.current.set(row.id, node);
                        else rowRefs.current.delete(row.id);
                      }}
                      className={[
                        "report-table__row",
                        `report-table__row--${row.kind}`,
                        entry.hidden ? "is-collapsed" : "",
                        drillable || entry.collapsible ? "is-interactive" : "",
                        row.calculated ? "is-calculated" : "",
                      ].filter(Boolean).join(" ")}
                      data-depth={Math.min(entry.depth, 4)}
                      tabIndex={entry.hidden ? -1 : focusId === row.id ? 0 : -1}
                      onFocus={() => setActiveId(row.id)}
                      onKeyDown={(event) => onRowKeyDown(event, entry)}
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest("button, a, input, select")) return;
                        if (entry.collapsible) toggle(row.id);
                        else if (drillable && defaultDrill) {
                          const column = allColumns.find((candidate) => candidate.id === defaultDrill);
                          if (column) onDrilldown?.(row, column);
                        }
                      }}
                    >
                      <th scope="row" className="report-table__label">
                        <span className="report-table__label-inner">
                          {entry.collapsible ? (
                            <button
                              type="button"
                              tabIndex={-1}
                              className="report-table__toggle"
                              aria-expanded={!entry.collapsed}
                              aria-label={`${entry.collapsed ? "Expand" : "Collapse"} ${textOf(row as ReportRow<unknown>)}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggle(row.id);
                              }}
                            >
                              {entry.collapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                            </button>
                          ) : (
                            entry.depth > 0 || collapsibleIds.length > 0 ? <span className="report-table__toggle-spacer" aria-hidden="true" /> : null
                          )}
                          <span className="report-table__label-text">
                            {row.code && <span className="report-table__code">{row.code}</span>}
                            <span>{row.label}</span>
                            {row.calculated && <span className="report-table__calc-tag">Calculated</span>}
                            {row.note && <span className="report-table__row-note">{row.note}</span>}
                          </span>
                        </span>
                      </th>
                      {allColumns.map((column) => (
                        <td
                          key={column.id}
                          className={`num report-table__value${column.emphasis ? " is-emphasis" : ""}${column.id === DELTA_ID || column.id === DELTA_PCT_ID ? " is-delta" : ""}`}
                        >
                          {renderValue(entry, column)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
            {!loading && rows.length === 0 && (
              <tr className="report-table__row report-table__row--empty">
                <td colSpan={colCount} className="report-table__empty-cell">
                  {empty ?? "Nothing to report for this period."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
