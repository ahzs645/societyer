import svgpath from "svgpath";

type Point = [number, number];
type Edge = { from: Point; to: Point; controls?: [Point, Point] };
type Contour = { edges: Edge[]; polygon: Point[] };

/** Keep compound logo paths intact in PDF engines that only support nonzero filling. */
export function evenOddPathToNonzero(path: string): string {
  const normalized = svgpath(path).abs().unshort().unarc();
  if (!normalized.toString()) throw new Error("Invalid logo path.");
  const segments: Array<[string, ...number[]]> = [];
  normalized.iterate((segment) => { segments.push(segment as [string, ...number[]]); });
  const contours: Contour[] = [];
  let current: Point = [0, 0];
  let first: Point = current;
  let edges: Edge[] = [];
  const finish = () => {
    if (!edges.length) return;
    if (current[0] !== first[0] || current[1] !== first[1]) edges.push({ from: current, to: first });
    const polygon: Point[] = [first];
    for (const edge of edges) {
      if (!edge.controls) { polygon.push(edge.to); continue; }
      const [a, b] = edge.controls;
      for (let i = 1; i <= 24; i++) {
        const t = i / 24, u = 1 - t;
        polygon.push([
          u ** 3 * edge.from[0] + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t ** 3 * edge.to[0],
          u ** 3 * edge.from[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t ** 3 * edge.to[1],
        ]);
      }
    }
    contours.push({ edges, polygon });
    edges = [];
  };
  for (const segment of segments) {
    const [command, ...n] = segment as [string, ...number[]];
    if (command === "M") { finish(); current = [n[0], n[1]]; first = current; continue; }
    if (command.toUpperCase() === "Z") { finish(); current = first; continue; }
    let to: Point;
    let controls: [Point, Point] | undefined;
    if (command === "H") to = [n[0], current[1]];
    else if (command === "V") to = [current[0], n[0]];
    else if (command === "L") to = [n[0], n[1]];
    else if (command === "C") { to = [n[4], n[5]]; controls = [[n[0], n[1]], [n[2], n[3]]]; }
    else if (command === "Q") {
      to = [n[2], n[3]];
      controls = [[current[0] + 2 / 3 * (n[0] - current[0]), current[1] + 2 / 3 * (n[1] - current[1])], [to[0] + 2 / 3 * (n[0] - to[0]), to[1] + 2 / 3 * (n[1] - to[1])]];
    } else throw new Error("Unsupported logo path segment.");
    edges.push({ from: current, to, ...(controls ? { controls } : {}) });
    current = to;
  }
  finish();
  const contains = ([x, y]: Point, polygon: Point[]) => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  return contours.map((contour, index) => {
    const depth = contours.filter((other, otherIndex) => otherIndex !== index && contains(contour.polygon[0], other.polygon)).length;
    const area = contour.polygon.reduce((sum, point, i, points) => {
      const next = points[(i + 1) % points.length];
      return sum + point[0] * next[1] - next[0] * point[1];
    }, 0);
    const reverse = Math.sign(area) !== (depth % 2 === 0 ? 1 : -1);
    const ordered = reverse ? [...contour.edges].reverse().map((edge): Edge => ({ from: edge.to, to: edge.from, ...(edge.controls ? { controls: [edge.controls[1], edge.controls[0]] } : {}) })) : contour.edges;
    const point = (p: Point) => p.map((n) => Number(n.toFixed(6))).join(" ");
    return `M${point(ordered[0].from)}${ordered.map((edge) => edge.controls ? `C${point(edge.controls[0])} ${point(edge.controls[1])} ${point(edge.to)}` : `L${point(edge.to)}`).join("")}Z`;
  }).join("");
}
