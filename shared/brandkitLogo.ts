import { DOMParser, type Element } from "@xmldom/xmldom";
import svgpath from "svgpath";

export const BRANDKIT_PROFILE_SCHEMA = "brandkit/consumer-profile/1" as const;
export type LogoViewBox = [number, number, number, number];
type Matrix = [number, number, number, number, number, number];
type Paint = { fill: string; stroke: string; width: number; rule: string; cap: string; join: string; miter: number };
const identity: Matrix = [1, 0, 0, 1, 0, 0];
const svgNamespace = "http://www.w3.org/2000/svg";
const numeric = /[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi;
const vectorError = () => new Error("The brand logo must be a self-contained vector logo with supported geometry.");
const rounded = (value: number) => Number(value.toFixed(6));

function numbers(value: string): number[] {
  if (!value.trim() || value.replace(numeric, "").replace(/[\s,]/g, "")) throw vectorError();
  const result = (value.match(numeric) ?? []).map(Number);
  if (result.some((n) => !Number.isFinite(n) || Math.abs(n) > 1_000_000)) throw vectorError();
  return result;
}
function scalar(value: string, fallback: number, positive = false): number {
  if (!value) return fallback;
  const result = numbers(value);
  if (result.length !== 1 || (positive && result[0] < 0)) throw vectorError();
  return result[0];
}
export function brandkitViewBox(value: unknown): LogoViewBox {
  if (!Array.isArray(value) || value.length !== 4 || value.some((n) => typeof n !== "number" || !Number.isFinite(n)) || value[0] !== 0 || value[1] !== 0 || value[2] <= 0 || value[3] <= 0 || value[2] > 10000 || value[3] > 10000) throw new Error("The brand logo needs a bounded, positive viewBox starting at 0 0.");
  return value as LogoViewBox;
}
function multiply(a: Matrix, b: Matrix): Matrix {
  const result: Matrix = [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  if (result.some((n) => !Number.isFinite(n) || Math.abs(n) > 1_000_000)) throw vectorError();
  return result;
}
function transform(value: string): Matrix {
  if (!value) return identity;
  let matrix = identity, end = 0, count = 0;
  for (const match of value.matchAll(/([a-zA-Z]+)\s*\(([^()]*)\)/g)) {
    if (value.slice(end, match.index).trim().replace(/,/g, "") || ++count > 20) throw vectorError();
    end = match.index! + match[0].length;
    const n = numbers(match[2]);
    let next: Matrix;
    if (match[1] === "translate" && (n.length === 1 || n.length === 2)) next = [1, 0, 0, 1, n[0], n[1] ?? 0];
    else if (match[1] === "scale" && (n.length === 1 || n.length === 2)) next = [n[0], 0, 0, n[1] ?? n[0], 0, 0];
    else if (match[1] === "matrix" && n.length === 6) next = n as Matrix;
    else if (match[1] === "rotate" && (n.length === 1 || n.length === 3)) {
      const angle = n[0] * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle), x = n[1] ?? 0, y = n[2] ?? 0;
      next = [c, s, -s, c, x - c * x + s * y, y - s * x - c * y];
    } else throw vectorError();
    matrix = multiply(matrix, next);
  }
  if (!count || value.slice(end).trim()) throw vectorError();
  return matrix;
}
function colour(value: string, fallback: string): string {
  if (!value) return fallback;
  if (value === "none") return value;
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(value)) return `#${[...value.slice(1)].map((c) => c + c).join("")}`.toUpperCase();
  throw vectorError();
}
function choice(value: string, fallback: string, allowed: string[]): string {
  if (!value) return fallback;
  if (!allowed.includes(value)) throw vectorError();
  return value;
}
function paintFor(element: Element, inherited: Paint): Paint {
  return {
    fill: colour(element.getAttribute("fill") ?? "", inherited.fill), stroke: colour(element.getAttribute("stroke") ?? "", inherited.stroke),
    width: scalar(element.getAttribute("stroke-width") ?? "", inherited.width, true),
    rule: choice(element.getAttribute("fill-rule") ?? "", inherited.rule, ["evenodd", "nonzero"]),
    cap: choice(element.getAttribute("stroke-linecap") ?? "", inherited.cap, ["butt", "round", "square"]),
    join: choice(element.getAttribute("stroke-linejoin") ?? "", inherited.join, ["miter", "round", "bevel"]),
    miter: scalar(element.getAttribute("stroke-miterlimit") ?? "", inherited.miter, true),
  };
}
function shapePath(element: Element): string {
  const get = (name: string, positive = false) => scalar(element.getAttribute(name) ?? "", 0, positive);
  if (element.tagName === "path") return element.getAttribute("d") ?? "";
  if (element.tagName === "polygon") {
    const points = numbers(element.getAttribute("points") ?? "");
    if (points.length < 6 || points.length % 2 || points.length > 20000) throw vectorError();
    return `M${points.slice(0, 2).join(" ")}L${points.slice(2).join(" ")}Z`;
  }
  const x = get("cx"), y = get("cy"), rx = get(element.tagName === "circle" ? "r" : "rx", true), ry = element.tagName === "circle" ? rx : get("ry", true);
  return rx && ry ? `M${x - rx} ${y}A${rx} ${ry} 0 1 0 ${x + rx} ${y}A${rx} ${ry} 0 1 0 ${x - rx} ${y}Z` : "";
}

/** Parse passive Brandkit artwork into the same flat path subset used by HTML and PDF. */
export function normalizeBrandkitLogo(svg: unknown, expectedViewBox: LogoViewBox): string {
  if (typeof svg !== "string" || svg.length > 200000 || /<!|<\?/.test(svg)) throw vectorError();
  const viewBox = brandkitViewBox(expectedViewBox);
  let document;
  try { document = new DOMParser({ onError: () => { throw vectorError(); } }).parseFromString(svg, "image/svg+xml"); }
  catch { throw vectorError(); }
  const root = document.documentElement;
  if (!root || root.tagName !== "svg" || root.namespaceURI !== svgNamespace) throw vectorError();
  const declared = numbers(root.getAttribute("viewBox") ?? "");
  if (declared.length !== 4 || declared.some((n, i) => Math.abs(n - viewBox[i]) > 0.000001)) throw vectorError();
  const result: string[] = [];
  let count = 0, segments = 0;
  const common = ["fill", "stroke", "stroke-width", "fill-rule", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "transform"];
  const attributes: Record<string, string[]> = { svg: ["xmlns", "viewBox", "width", "height"], g: [], path: ["d"], circle: ["cx", "cy", "r"], ellipse: ["cx", "cy", "rx", "ry"], polygon: ["points"], title: [], desc: [] };
  const visit = (element: Element, parentMatrix: Matrix, inherited: Paint, depth: number) => {
    if (++count > 4000 || depth > 32 || element.namespaceURI !== svgNamespace || !Object.hasOwn(attributes, element.tagName) || (element.tagName === "svg" && element !== root)) throw vectorError();
    for (let i = 0; i < element.attributes.length; i++) {
      const attr = element.attributes.item(i)!;
      if (attr.name === "xmlns" && element === root && attr.value === svgNamespace) continue;
      if (!common.includes(attr.name) && !attributes[element.tagName].includes(attr.name) && !/^(?:aria-label|role|id|data-[a-z0-9-]+)$/.test(attr.name)) throw vectorError();
    }
    const matrix = multiply(parentMatrix, transform(element.getAttribute("transform") ?? ""));
    const paint = paintFor(element, inherited);
    const metadata = element.tagName === "title" || element.tagName === "desc";
    const container = element.tagName === "svg" || element.tagName === "g";
    if (!metadata && !container) {
      const source = shapePath(element);
      if (source) {
        if (!/^[MmZzLlHhVvCcSsQqTtAaEe0-9+.,\s-]+$/.test(source)) throw vectorError();
        const path = svgpath(source);
        if ((path as unknown as { err: string }).err) throw vectorError();
        path.unarc().matrix(matrix).round(6).iterate((segment) => {
          if (++segments > 30000 || segment.slice(1).some((n) => typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 1_000_000)) throw vectorError();
        });
        let stroke = "";
        if (paint.stroke !== "none") {
          const sx = Math.hypot(matrix[0], matrix[1]), sy = Math.hypot(matrix[2], matrix[3]);
          if (Math.abs(sx - sy) > 0.000001 * Math.max(1, sx, sy) || Math.abs(matrix[0] * matrix[2] + matrix[1] * matrix[3]) > 0.000001 * Math.max(1, sx * sy)) throw vectorError();
          stroke = ` stroke="${paint.stroke}" stroke-width="${rounded(paint.width * sx)}" stroke-linecap="${paint.cap}" stroke-linejoin="${paint.join}" stroke-miterlimit="${paint.miter}"`;
        }
        result.push(`<path fill="${paint.fill}" d="${path.toString()}"${paint.rule === "evenodd" ? ' fill-rule="evenodd"' : ""}${stroke}/>`);
      }
    }
    for (let node = element.firstChild; node; node = node.nextSibling) {
      if (node.nodeType === 1 && container) visit(node as Element, matrix, paint, depth + 1);
      else if (node.nodeType !== 3 || (!metadata && node.textContent?.trim())) throw vectorError();
    }
  };
  visit(root, identity, { fill: "#000000", stroke: "none", width: 1, rule: "nonzero", cap: "butt", join: "miter", miter: 4 }, 0);
  if (!result.length) throw vectorError();
  const output = `<svg xmlns="${svgNamespace}" viewBox="${viewBox.join(" ")}">${result.join("")}</svg>`;
  if (output.length > 200000) throw vectorError();
  return output;
}
