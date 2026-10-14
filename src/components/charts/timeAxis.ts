import { daysBetween, formatDayShort, formatMonth } from "./dates";
import { thinIndexes } from "./scales";

export type AxisTick = { index: number; label: string };

/**
 * X-axis ticks for evenly spaced date rows. Short spans tick by day, medium
 * spans by month (year shown on January and the first tick), long spans by
 * year. Labels keep at least `minGap` pixels apart.
 */
export function timeTicks(dates: string[], plotWidth: number, minGap = 64): AxisTick[] {
  const n = dates.length;
  if (n === 0) return [];
  if (n === 1) return [{ index: 0, label: formatDayShort(dates[0]) }];
  const span = daysBetween(dates[0], dates[n - 1]);
  const pxPerRow = plotWidth / Math.max(1, n - 1);

  if (span <= 62) {
    return thinIndexes(n, plotWidth, minGap).map((index) => ({ index, label: formatDayShort(dates[index]) }));
  }

  // Candidate rows: the first row of each month (or year for long spans).
  const yearly = span > 365 * 3;
  const candidates: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const prev = i === 0 ? null : dates[i - 1];
    const changed = prev === null || (yearly ? prev.slice(0, 4) !== dates[i].slice(0, 4) : prev.slice(0, 7) !== dates[i].slice(0, 7));
    if (changed) candidates.push(i);
  }
  // Drop a leading partial-period tick that would crowd the next one.
  const partialStart = yearly ? dates[0].slice(5) !== "01-01" : dates[0].slice(8) !== "01";
  if (partialStart && candidates.length > 1 && (candidates[1] - candidates[0]) * pxPerRow < minGap) candidates.shift();

  const every = Math.max(1, Math.ceil(minGap / Math.max(1, avgGap(candidates) * pxPerRow)));
  const picked = candidates.filter((_, i) => i % every === 0);
  return picked.map((index, i) => {
    const date = dates[index];
    if (yearly) return { index, label: date.slice(0, 4) };
    const withYear = i === 0 || date.slice(5, 7) === "01" || picked[i - 1] === undefined || dates[picked[i - 1]].slice(0, 4) !== date.slice(0, 4);
    return { index, label: formatMonth(date, withYear) };
  });
}

function avgGap(indexes: number[]) {
  if (indexes.length < 2) return Number.POSITIVE_INFINITY;
  return (indexes[indexes.length - 1] - indexes[0]) / (indexes.length - 1);
}
