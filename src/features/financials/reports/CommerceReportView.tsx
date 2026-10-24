import { useState } from "react";
import { Link } from "react-router-dom";
import { ChartCard } from "../../../components/charts";
import { useElementWidth } from "../../../components/charts/hooks";
import {
  commerceReportChart,
  commerceReportTable,
  commerceReportSummary,
} from "../../../../shared/commerceReportDocument";
import {
  formatCommerceValue,
  type CommerceReportResult,
} from "../../../../shared/commerceReports";
const COLORS = ["#245c46", "#315c9a", "#ba5b33", "#7c4d94"];
function ComposerGraph({
  result,
  id,
  title,
}: {
  result: CommerceReportResult;
  id: string;
  title: string;
}) {
  const [chartRef, measuredWidth] = useElementWidth<HTMLDivElement>();
  const chart = result.charts.find((candidate) => candidate.id === id);
  if (!chart) return null;
  const formatted = commerceReportChart(result, id);
  const table = {
    caption: title,
    columns: [
      { key: "label", label: "Group" },
      ...chart.series.map((series) => ({
        key: series.key,
        label: series.label,
        numeric: true,
      })),
    ],
    rows: chart.labels.map((label, index) => ({
      label,
      ...Object.fromEntries(
        chart.series.map((series) => [
          series.key,
          formatCommerceValue(
            series.values[index],
            { type: series.type },
            result.filters.currency,
          ),
        ]),
      ),
    })),
  };
  const width = Math.max(240, measuredWidth || 600),
    height = 230,
    count = Math.max(chart.labels.length, 1),
    values = chart.series
      .flatMap((series) => series.values)
      .filter((value): value is number => value !== null),
    min = values.reduce((a, b) => Math.min(a, b), 0),
    max = values.reduce((a, b) => Math.max(a, b), 0),
    span = max - min || 1,
    y = (value: number) => 10 + ((max - value) / span) * 185,
    zero = y(0);
  const labelIndexes = [0, Math.floor((count - 1) / 2), count - 1].filter(
    (value, index, all) => all.indexOf(value) === index,
  );
  const labelCharacters = Math.max(
    6,
    Math.floor(width / Math.max(1, labelIndexes.length) / 6.5) - 2,
  );
  return (
    <ChartCard
      title={title}
      table={table}
      empty={!chart.labels.length}
      emptyMessage="No rows match this report."
      height={formatted?.kind === "svg" ? 300 : 260}
    >
      {formatted?.kind === "svg" && formatted.svg ? (
        <div
          role="region"
          aria-label={`${title} chart viewport`}
          tabIndex={0}
          style={{ overflow: "auto", maxHeight: 360 }}
        >
          <svg
            role="img"
            aria-label={title}
            viewBox={`0 0 ${formatted.svg.width} ${formatted.svg.height}`}
            style={{
              display: "block",
              width: formatted.svg.width,
              minWidth: formatted.svg.width,
              maxWidth: "none",
            }}
          >
            <title>{title}</title>
            <g dangerouslySetInnerHTML={{ __html: formatted.svg.content }} />
            {formatted.svg.annotations?.map((annotation, index) => (
              <text
                key={index}
                x={annotation.x}
                y={annotation.y + 10}
                fontSize={12}
                fill="var(--text, #18181b)"
              >
                {annotation.text}
              </text>
            ))}
          </svg>
        </div>
      ) : (
        <div ref={chartRef} style={{ minWidth: 0, width: "100%" }}>
          <svg
            role="img"
            aria-label={`${title}; ${chart.labels.length} data groups. Use View as table for all values.`}
            viewBox={`0 0 ${width} ${height}`}
            style={{ width: "100%", height, display: "block" }}
          >
            <title>{title}</title>
            <line
              x1={0}
              y1={zero}
              x2={width}
              y2={zero}
              stroke="var(--border, #b8bdc4)"
            />
            {chart.series.map((series, si) =>
              chart.type === "bar" ? (
                <g key={series.key} fill={COLORS[si % COLORS.length]}>
                  {series.values.map((value, index) =>
                    value === null ? null : (
                      <rect
                        key={index}
                        x={
                          (index * width) / count +
                          (width / count) * 0.1 +
                          (((si * width) / count) * 0.8) / chart.series.length
                        }
                        y={Math.min(zero, y(value))}
                        width={((width / count) * 0.75) / chart.series.length}
                        height={Math.abs(zero - y(value))}
                      >
                        <title>{`${chart.labels[index]} · ${series.label}: ${formatCommerceValue(value, { type: series.type }, result.filters.currency)}`}</title>
                      </rect>
                    ),
                  )}
                </g>
              ) : (
                <path
                  key={series.key}
                  fill="none"
                  stroke={COLORS[si % COLORS.length]}
                  strokeWidth={2}
                  d={series.values
                    .map((value, index) =>
                      value === null
                        ? ""
                        : `${index && series.values[index - 1] !== null ? "L" : "M"}${count === 1 ? width / 2 : (index * width) / (count - 1)} ${y(value)}`,
                    )
                    .join(" ")}
                />
              ),
            )}
            {labelIndexes.map((index) => (
              <text
                key={index}
                x={
                  count === 1
                    ? width / 2
                    : index === 0
                      ? 0
                      : index === count - 1
                        ? width
                        : width / 2
                }
                y={220}
                fontSize={12}
                textAnchor={
                  count === 1
                    ? "middle"
                    : index === 0
                      ? "start"
                      : index === count - 1
                        ? "end"
                        : "middle"
                }
                fill="currentColor"
              >
                <title>{chart.labels[index] ?? ""}</title>
                {(chart.labels[index]?.length ?? 0) > labelCharacters
                  ? `${chart.labels[index].slice(0, labelCharacters - 1)}…`
                  : (chart.labels[index] ?? "")}
              </text>
            ))}
          </svg>
        </div>
      )}
    </ChartCard>
  );
}
function ComposerTable({
  result,
  title,
  summary,
}: {
  result: CommerceReportResult;
  title: string;
  summary?: boolean;
}) {
  const [page, setPage] = useState(0),
    data = summary
      ? commerceReportSummary(result, title)
      : commerceReportTable(result, title),
    pageSize = 100,
    last = Math.max(0, Math.ceil(data.rows.length / pageSize) - 1),
    current = Math.min(page, last);
  return (
    <section
      className="card"
      style={{ padding: 14, minWidth: 0, maxWidth: "100%" }}
      aria-label={title}
    >
      <h3>{title}</h3>
      <div
        role="region"
        aria-label={`${title} table`}
        tabIndex={0}
        style={{
          overflowX: "auto",
          maxWidth: "100%",
          overscrollBehaviorX: "contain",
        }}
      >
        <table
          className="table"
          style={{
            display: "table",
            overflow: "visible",
            maxWidth: "none",
            minWidth: Math.max(300, data.columns.length * 115),
            width: "100%",
            tableLayout: "fixed",
          }}
        >
          <colgroup>
            {data.columns.map((column) => (
              <col
                key={column.key}
                style={{
                  width: `${((column.width ?? 1) / data.columns.reduce((sum, item) => sum + (item.width ?? 1), 0)) * 100}%`,
                }}
              />
            ))}
          </colgroup>
          <thead>
            <tr>
              {data.columns.map((column) => (
                <th
                  key={column.key}
                  style={{
                    textAlign: column.align ?? "left",
                    overflowWrap: "anywhere",
                  }}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows
              .slice(current * pageSize, (current + 1) * pageSize)
              .map((row, index) => (
                <tr key={row.key}>
                  {row.cells.map((cell, ci) => (
                    <td
                      key={ci}
                      style={{
                        textAlign: data.columns[ci]?.align ?? "left",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {cell}
                      {!summary &&
                      ci === 0 &&
                      result.rows[current * pageSize + index]?.links?.length ? (
                        <details>
                          <summary>
                            Source records (
                            {
                              result.rows[current * pageSize + index].links!
                                .length
                            }
                            )
                          </summary>
                          {result.rows[current * pageSize + index].links!.map(
                            (link, li) => (
                              <div key={li}>
                                <Link to={link.url}>{link.label}</Link>
                              </div>
                            ),
                          )}
                        </details>
                      ) : null}
                    </td>
                  ))}
                </tr>
              ))}
            {!data.rows.length && (
              <tr>
                <td colSpan={data.columns.length}>No matching rows.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div
        className="row"
        style={{ justifyContent: "space-between", marginTop: 12 }}
      >
        <span className="muted">
          {data.rows.length.toLocaleString()} rows · exports include every
          result row
        </span>
        {last > 0 && (
          <div>
            <button
              className="btn btn--sm"
              disabled={!current}
              onClick={() => setPage(current - 1)}
            >
              Previous
            </button>
            <span>
              {" "}
              Page {current + 1} of {last + 1}{" "}
            </span>
            <button
              className="btn btn--sm"
              disabled={current === last}
              onClick={() => setPage(current + 1)}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
export function CommerceReportView({
  result,
}: {
  result: CommerceReportResult;
}) {
  return (
    <div className="form-stack">
      {result.warnings.map((warning) => (
        <p className="books-report__note" key={warning}>
          {warning}
        </p>
      ))}
      {result.definition.sections
        .filter((section) => section.visible)
        .map((section) =>
          section.kind === "chart" ? (
            <ComposerGraph
              key={section.id}
              result={result}
              id={section.chartId!}
              title={
                section.title &&
                section.title !==
                  result.charts.find((chart) => chart.id === section.chartId)
                    ?.title
                  ? `${section.title} · ${result.charts.find((chart) => chart.id === section.chartId)?.title ?? ""}`
                  : section.title
              }
            />
          ) : (
            <ComposerTable
              key={section.id}
              result={result}
              title={section.title}
              summary={section.kind === "summary"}
            />
          ),
        )}
    </div>
  );
}
