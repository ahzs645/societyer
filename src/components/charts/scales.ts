/**
 * Tiny scale helpers for the hand-rolled SVG charts. Enough of d3-scale for
 * linear value axes and evenly spaced category / date positions, without the
 * dependency.
 */

export type LinearScale = ((value: number) => number) & {
  invert: (pixel: number) => number;
  domain: [number, number];
  range: [number, number];
};

export function linearScale(domain: [number, number], range: [number, number]): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  const scale = ((value: number) => r0 + ((value - d0) / span) * (r1 - r0)) as LinearScale;
  scale.invert = (pixel: number) => d0 + ((pixel - r0) / (r1 - r0 || 1)) * span;
  scale.domain = domain;
  scale.range = range;
  return scale;
}

/** A "nice" step (1, 2, 2.5, 5 × 10ⁿ) that yields roughly `count` ticks. */
function niceStep(span: number, count: number) {
  const raw = span / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const residual = raw / magnitude;
  const factor = residual > 5 ? 10 : residual > 2.5 ? 5 : residual > 2 ? 2.5 : residual > 1 ? 2 : 1;
  return factor * magnitude;
}

/**
 * Round a value domain outwards to clean tick values. `count` is a target, not
 * a promise. A flat series still gets a usable band around its value.
 */
export function niceDomain(min: number, max: number, count = 5, minStep = 0): { domain: [number, number]; ticks: number[] } {
  let lo = Math.min(min, max);
  let hi = Math.max(min, max);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = 0;
    hi = 1;
  }
  if (lo === hi) {
    const pad = Math.abs(lo) * 0.1 || 1;
    lo = lo >= 0 && lo - pad < 0 ? 0 : lo - pad;
    hi += pad;
  }
  const raw = niceStep(hi - lo, count);
  const step = minStep > 0 ? Math.max(minStep, Math.ceil(raw / minStep) * minStep) : raw;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= end + step / 2; value += step) {
    ticks.push(Math.abs(value) < step / 1e6 ? 0 : Number(value.toPrecision(12)));
  }
  return { domain: [start, end], ticks };
}

/** Index of the item whose position is closest to `pixel` (positions ascending). */
export function nearestIndex(positions: number[], pixel: number): number {
  if (positions.length === 0) return -1;
  let lo = 0;
  let hi = positions.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (positions[mid] < pixel) lo = mid;
    else hi = mid;
  }
  return Math.abs(positions[lo] - pixel) <= Math.abs(positions[hi] - pixel) ? lo : hi;
}

/** Pick every n-th index so labels keep at least `minGap` pixels between them. */
export function thinIndexes(count: number, width: number, minGap: number): number[] {
  if (count <= 0) return [];
  const every = Math.max(1, Math.ceil((count * minGap) / Math.max(1, width)));
  const out: number[] = [];
  for (let i = 0; i < count; i += every) out.push(i);
  return out;
}

/** Rough label width for margin sizing (11–13px UI sans, tabular digits). */
export function estimateTextWidth(text: string, charWidth = 6.6) {
  return Math.ceil(text.length * charWidth);
}

/**
 * Path for a bar with a rounded data-end and a square baseline end.
 * `up` bars round their top; downward bars round their bottom.
 */
export function barPath(x: number, width: number, baseline: number, tip: number, radius = 4): string {
  const height = Math.abs(tip - baseline);
  if (height < 0.5) return "";
  const r = Math.min(radius, width / 2, height);
  const up = tip < baseline;
  const x1 = x + width;
  if (up) {
    return `M${x},${baseline}V${tip + r}Q${x},${tip} ${x + r},${tip}H${x1 - r}Q${x1},${tip} ${x1},${tip + r}V${baseline}Z`;
  }
  return `M${x},${baseline}V${tip - r}Q${x},${tip} ${x + r},${tip}H${x1 - r}Q${x1},${tip} ${x1},${tip - r}V${baseline}Z`;
}
