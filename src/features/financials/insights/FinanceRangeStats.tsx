import { formatMoney } from "../../../lib/money";
import type { FlowTotals } from "./series";

type Direction = "up-good" | "up-bad";

const plural = (n: number, noun: string) => `${n.toLocaleString("en-CA")} ${noun}${n === 1 ? "" : "s"}`;

function Delta({ current, previous, direction }: { current: number; previous: number; direction: Direction }) {
  const diff = current - previous;
  if (diff === 0) return <span className="insights__stat-delta">No change vs previous period</span>;
  const good = direction === "up-good" ? diff > 0 : diff < 0;
  return (
    <span className={`insights__stat-delta budget-bar__variance ${good ? "is-favourable" : "is-unfavourable"}`}>
      <span aria-hidden="true">{diff > 0 ? "▲" : "▼"}</span>
      {formatMoney(diff, { trimWholeCents: true, signDisplay: "always" })} vs previous period
    </span>
  );
}

/** Stat tiles for the selected range; they follow presets and drag-selection. */
export function FinanceRangeStats({
  totals,
  previous,
  closingBalance,
  previousClosing,
}: {
  totals: FlowTotals;
  previous: FlowTotals | null;
  closingBalance: number | null;
  previousClosing: number | null;
}) {
  const tiles: Array<{ key: string; label: string; value: number | null; prev: number | null | undefined; direction: Direction; sub?: string }> = [
    { key: "in", label: "Money in", value: totals.inflow, prev: previous?.inflow, direction: "up-good" },
    { key: "out", label: "Money out", value: totals.outflow, prev: previous?.outflow, direction: "up-bad" },
    { key: "net", label: "Net change", value: totals.net, prev: previous?.net, direction: "up-good" },
    { key: "close", label: "Closing balance", value: closingBalance, prev: previous ? previousClosing : undefined, direction: "up-good" },
  ];
  return (
    <div className="insights__stats" aria-live="polite">
      {tiles.map((tile) => (
        <div key={tile.key} className="stat">
          <div className="stat__label">{tile.label}</div>
          <div className="stat__value">
            {tile.value == null ? "—" : formatMoney(tile.value, { trimWholeCents: true, signDisplay: tile.key === "net" ? "exceptZero" : "auto" })}
          </div>
          {tile.prev != null && tile.value != null ? (
            <Delta current={tile.value} previous={tile.prev} direction={tile.direction} />
          ) : tile.key === "in" || tile.key === "out" ? (
            <span className="stat__sub">{plural(tile.key === "in" ? totals.inCount : totals.outCount, tile.key === "in" ? "deposit" : "payment")}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
