import type { ReactNode } from "react";
import { formatMoney } from "../../../lib/money";
import { Money } from "../../../components/Money";
import { StatTile, type StatTileTrend } from "../../../components/StatTile";
import type { FlowTotals } from "./series";

type Direction = "up-good" | "up-bad";
type TileKey = "balance" | "in" | "out" | "net" | "close";
type Tile = { key: TileKey; label: string; value: number | null; prev: number | null | undefined; direction: Direction; sub?: ReactNode; info?: ReactNode };

const plural = (n: number, noun: string) => `${n.toLocaleString("en-CA")} ${noun}${n === 1 ? "" : "s"}`;

function delta(current: number, previous: number, direction: Direction, label: string, currency: string): StatTileTrend {
  const diff = current - previous;
  if (diff === 0) return { value: "No change", label };
  return {
    value: formatMoney(diff, { currency, trimWholeCents: true, signDisplay: "always" }),
    direction: diff > 0 ? "up" : "down",
    favourable: direction === "up-good" ? diff > 0 : diff < 0,
    label,
  };
}

/**
 * Stat tiles for the selected range; they follow presets and drag-selection.
 *
 * The range's closing balance is the bank balance whenever the range ends
 * today (balances are worked back from today's balance), so it only earns
 * its own tile when it differs; otherwise Net change says where it ends.
 *
 * `headline` (phones): four tiles — bank balance, net change, money in,
 * money out — and every other figure goes to `more` (the closing balance
 * when it differs, then `children`).
 */
export function FinanceRangeStats({
  totals,
  previous,
  closingBalance,
  previousClosing,
  currentBalance,
  compareLabel = "vs previous period",
  currency = "CAD",
  headline = false,
  more,
  children,
}: {
  /** Extra tiles after the range tiles (e.g. figures that do not follow the range). */
  children?: ReactNode;
  currency?: string;
  totals: FlowTotals;
  previous: FlowTotals | null;
  closingBalance: number | null;
  previousClosing: number | null;
  /** Today's bank and card balance (the same figure as the page's "Bank balance"). */
  currentBalance: number;
  /** Trend caption, e.g. "vs same period last year". */
  compareLabel?: string;
  headline?: boolean;
  /** Headline layout: renders the overflow tiles (e.g. into a "More metrics" fold). */
  more?: (tiles: ReactNode, count: number) => ReactNode;
}) {
  const closingIsBank = closingBalance != null && closingBalance === currentBalance;
  const countSub = (key: "in" | "out") =>
    plural(key === "in" ? totals.inCount : totals.outCount, key === "in" ? "deposit" : "payment");
  const closeTile: Tile = { key: "close", label: "Closing balance", value: closingBalance, prev: previous ? previousClosing : undefined, direction: "up-good" };
  const inTile: Tile = { key: "in", label: "Money in", value: totals.inflow, prev: previous?.inflow, direction: "up-good", sub: previous ? undefined : countSub("in") };
  const outTile: Tile = { key: "out", label: "Money out", value: totals.outflow, prev: previous?.outflow, direction: "up-bad", sub: previous ? undefined : countSub("out") };
  const netTile: Tile = {
    key: "net",
    label: "Net change",
    value: totals.net,
    prev: previous?.net,
    direction: "up-good",
    // The closing balance folds in here when it is just today's bank balance.
    sub: closingIsBank && !headline ? <>Ends at <Money currency={currency} cents={closingBalance} trimWholeCents />, today's bank balance</> : undefined,
  };

  const render = (tile: Tile) => (
    <StatTile
      key={tile.key}
      label={tile.label}
      value={tile.value == null ? "—" : <Money currency={currency} variant="hero" trimWholeCents cents={tile.value} signDisplay={tile.key === "net" ? "exceptZero" : "auto"} />}
      trend={tile.prev != null && tile.value != null ? delta(tile.value, tile.prev, tile.direction, compareLabel, currency) : undefined}
      sub={tile.sub}
      info={tile.info}
    />
  );

  if (headline) {
    const balanceTile: Tile = {
      key: "balance",
      label: "Bank balance",
      value: currentBalance,
      prev: undefined,
      direction: "up-good",
      // Phones hide sub-lines, so the closing balance is explained in the ⓘ.
      info: closingIsBank
        ? <p>Today's bank and card balance. It is also the closing balance for the range above, since balances are worked back from today through imported transactions.</p>
        : <p>Today's bank and card balance. The closing balance for the selected range is under More metrics.</p>,
    };
    const extra = closingIsBank ? [] : [closeTile];
    const extraCount = extra.length + countChildren(children);
    return (
      <>
        <div className="insights__stats insights__stats--headline" aria-live="polite">
          {[balanceTile, netTile, inTile, outTile].map(render)}
        </div>
        {more?.(<>{extra.map(render)}{children}</>, extraCount)}
      </>
    );
  }

  return (
    <div className="insights__stats" aria-live="polite">
      {[inTile, outTile, netTile, ...(closingIsBank ? [] : [closeTile])].map(render)}
      {children}
    </div>
  );
}

function countChildren(children: ReactNode): number {
  if (children == null || typeof children === "boolean") return 0;
  if (Array.isArray(children)) return children.reduce((sum: number, child: ReactNode) => sum + countChildren(child), 0);
  return 1;
}
