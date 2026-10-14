/** SVG path builders shared by the line, area and sparkline charts. */

export type Point = { x: number; y: number | null };

/** Split points into runs without gaps (null values break the line). */
function runs(points: Point[]): Array<Array<{ x: number; y: number }>> {
  const out: Array<Array<{ x: number; y: number }>> = [];
  let current: Array<{ x: number; y: number }> = [];
  for (const point of points) {
    if (point.y == null || !Number.isFinite(point.y)) {
      if (current.length) out.push(current);
      current = [];
    } else {
      current.push({ x: point.x, y: point.y });
    }
  }
  if (current.length) out.push(current);
  return out;
}

function runPath(run: Array<{ x: number; y: number }>, curve: "linear" | "step") {
  let d = `M${run[0].x.toFixed(1)},${run[0].y.toFixed(1)}`;
  for (let i = 1; i < run.length; i += 1) {
    const p = run[i];
    d += curve === "step" ? `H${p.x.toFixed(1)}V${p.y.toFixed(1)}` : `L${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }
  return d;
}

export function linePath(points: Point[], curve: "linear" | "step" = "linear"): string {
  return runs(points)
    .map((run) => (run.length === 1 ? `M${run[0].x - 1},${run[0].y}h2` : runPath(run, curve)))
    .join("");
}

export function areaPath(points: Point[], baseline: number, curve: "linear" | "step" = "linear"): string {
  return runs(points)
    .filter((run) => run.length > 1)
    .map((run) => `${runPath(run, curve)}V${baseline.toFixed(1)}H${run[0].x.toFixed(1)}Z`)
    .join("");
}
