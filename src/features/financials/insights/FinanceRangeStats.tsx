import { formatMoney } from "../../../lib/money";
import { Money } from "../../../components/Money";
import { StatTile, type StatTileTrend } from "../../../components/StatTile";
import type { FlowTotals } from "./series";

type Direction = "up-good" | "up-bad";

const plural = (n: number, noun: string) => `${n.toLocaleString("en-CA")} ${noun}${n === 1 ? "" : "s"}`;

function delta(current: number, previous: number, direction: Direction): StatTileTrend {
  const diff = current - previous;
  if (diff === 0) return { value: "No change", label: "vs previous period" };
  return {
    value: formatMoney(diff, { trimWholeCents: true, signDisplay: "always" }),
    direction: diff > 0 ? "up" : "down",
    favourable: direction === "up-good" ? diff > 0 : diff < 0,
    label: "vs previous period",
  };
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
        <StatTile
          key={tile.key}
          label={tile.label}
          value={tile.value == null ? "—" : <Money variant="hero" trimWholeCents cents={tile.value} signDisplay={tile.key === "net" ? "exceptZero" : "auto"} />}
          trend={tile.prev != null && tile.value != null ? delta(tile.value, tile.prev, tile.direction) : undefined}
          sub={tile.prev == null && (tile.key === "in" || tile.key === "out")
            ? plural(tile.key === "in" ? totals.inCount : totals.outCount, tile.key === "in" ? "deposit" : "payment")
            : undefined}
        />
      ))}
    </div>
  );
}
