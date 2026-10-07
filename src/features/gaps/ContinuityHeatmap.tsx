import { Fragment } from "react";
import type { ContinuityPeriod, ContinuityRow, ContinuityStatus } from "../../../shared/continuity";
import { SEVERITY_LABELS, STATUS_META, STATUS_ORDER, worstStatus } from "./statusMeta";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type HeatmapSelect = (row: ContinuityRow, periods: ContinuityPeriod[]) => void;

export function StatusLegend({ statuses = STATUS_ORDER }: { statuses?: ContinuityStatus[] }) {
  return (
    <div className="coverage-legend" aria-label="Status legend">
      {statuses.map((status) => (
        <span key={status} className="coverage-legend__item" title={STATUS_META[status].description}>
          <span className={`continuity-cell continuity-swatch continuity-cell--${status}`} aria-hidden="true">{STATUS_META[status].glyph}</span>
          {STATUS_META[status].label}
        </span>
      ))}
    </div>
  );
}

function cellTitle(row: ContinuityRow, label: string, periods: ContinuityPeriod[], status: ContinuityStatus) {
  const counts = periods.length > 1 ? ` (${periods.filter((period) => period.status === "satisfied").length}/${periods.length} on file)` : "";
  const note = periods.length === 1 && periods[0].note ? ` — ${periods[0].note}` : "";
  return `${row.expectation.title}, ${row.bodyLabel}, ${label}: ${STATUS_META[status].label}${counts}${note}`;
}

/**
 * Body × year (or body × month for one year) record-continuity heat-map.
 * Each cell aggregates the expected periods it covers to the most actionable
 * status; clicking opens the evidence and actions for those periods.
 */
export function ContinuityHeatmap({
  rows,
  fromYear,
  toYear,
  mode,
  year,
  onSelect,
}: {
  rows: ContinuityRow[];
  fromYear: number;
  toYear: number;
  mode: "years" | "months";
  year: number;
  onSelect: HeatmapSelect;
}) {
  if (!rows.length) return <div className="muted">No expectations apply yet. Add one on the Expectations tab.</div>;
  const columns = mode === "years" ? Array.from({ length: toYear - fromYear + 1 }, (_, i) => fromYear + i) : MONTH_LABELS.map((_, i) => i + 1);
  const colWidth = mode === "years" ? 38 : 46;
  return (
    <div className="continuity-scroll" role="region" aria-label="Record continuity heat-map" tabIndex={0}>
      <div className="continuity-grid" style={{ gridTemplateColumns: `var(--continuity-label, minmax(200px, 260px)) repeat(${columns.length}, ${colWidth}px)` }}>
        <div className="continuity-grid__head continuity-grid__corner" style={{ gridColumn: 1, gridRow: 1 }}>Body and expectation</div>
        {columns.map((column, index) => (
          <div key={column} className="continuity-grid__head" style={{ gridColumn: index + 2, gridRow: 1 }}>
            {mode === "years" ? `’${String(column).slice(2)}` : MONTH_LABELS[column - 1]}
          </div>
        ))}
        {rows.map((row, rowIndex) => {
          const gridRow = rowIndex + 2;
          const cells: { start: number; span: number; periods: ContinuityPeriod[]; label: string }[] = [];
          if (mode === "years") {
            columns.forEach((column, index) => {
              const periods = row.periods.filter((period) => period.periodKey.slice(0, 4) === String(column));
              if (periods.length) cells.push({ start: index + 2, span: 1, periods, label: String(column) });
            });
          } else {
            for (const period of row.periods.filter((item) => item.periodKey.slice(0, 4) === String(year))) {
              const key = period.periodKey;
              if (/^\d{4}-\d{2}$/.test(key)) cells.push({ start: Number(key.slice(5, 7)) + 1, span: 1, periods: [period], label: period.label });
              else if (/^\d{4}-Q[1-4]$/.test(key)) cells.push({ start: (Number(key.slice(6)) - 1) * 3 + 2, span: 3, periods: [period], label: period.label });
              else cells.push({ start: 2, span: 12, periods: [period], label: period.label });
            }
          }
          return (
            <Fragment key={row.expectation.key}>
              <div className="continuity-grid__label" style={{ gridColumn: 1, gridRow }}>
                <strong>{row.bodyLabel}</strong>
                <small>{row.expectation.title} · {SEVERITY_LABELS[String(row.expectation.severity)] ?? row.expectation.severity}</small>
              </div>
              {cells.map((cell) => {
                const status = worstStatus(cell.periods.map((period) => period.status)) ?? "not_applicable";
                const meta = STATUS_META[status];
                const multi = cell.periods.length > 1;
                const satisfied = cell.periods.filter((period) => period.status === "satisfied" || period.status === "draft_only").length;
                const title = cellTitle(row, cell.label, cell.periods, status);
                return (
                  <button
                    key={`${row.expectation.key}:${cell.start}`}
                    type="button"
                    className={`continuity-cell continuity-cell--${status}`}
                    style={{ gridColumn: `${cell.start} / span ${cell.span}`, gridRow }}
                    title={title}
                    aria-label={title}
                    onClick={() => onSelect(row, cell.periods)}
                  >
                    {multi && mode === "years" ? <span>{satisfied}/{cell.periods.length}</span> : <span aria-hidden="true">{meta.glyph}</span>}
                    {cell.span > 1 && <span>{cell.label}</span>}
                  </button>
                );
              })}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
