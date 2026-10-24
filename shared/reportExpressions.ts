/** A bounded arithmetic language for report metrics. No JS, property access or side effects. */
export type ReportExpressionNode = { kind: "number"; value: number } | { kind: "field"; key: string } | { kind: "unary"; sign: number; value: ReportExpressionNode } | { kind: "binary"; op: string; left: ReportExpressionNode; right: ReportExpressionNode } | { kind: "call"; name: string; args: ReportExpressionNode[] };
const FUNCTIONS: Record<string, { min: number; max: number; run: (...values: number[]) => number }> = {
  abs: { min: 1, max: 1, run: Math.abs }, round: { min: 1, max: 1, run: Math.round }, min: { min: 2, max: 8, run: Math.min }, max: { min: 2, max: 8, run: Math.max },
};
export function parseReportExpression(expression: string, fields: readonly string[]): ReportExpressionNode {
  if (typeof expression !== "string" || !expression.trim() || expression.length > 500) throw new Error("A metric expression must contain 1–500 characters.");
  const tokens: string[] = []; let cursor = 0;
  while (cursor < expression.length) {
    const rest = expression.slice(cursor), token = /^(?:\s+|(?:\d+(?:\.\d+)?|\.\d+)|[A-Za-z_][A-Za-z_0-9]*|[+\-*/(),])/.exec(rest)?.[0];
    if (!token) throw new Error(`Unsupported expression character at position ${cursor + 1}. Use field names, numbers and arithmetic.`);
    cursor += token.length; if (token.trim()) tokens.push(token); if (tokens.length > 180) throw new Error("Metric expression is too complex.");
  }
  let index = 0; const allowed = new Set(fields);
  const primary = (depth: number): ReportExpressionNode => {
    if (depth > 16) throw new Error("Metric expressions may nest at most 16 levels.");
    const token = tokens[index++];
    if (!token) throw new Error("Incomplete metric expression.");
    if (token === "+" || token === "-") return { kind: "unary", sign: token === "-" ? -1 : 1, value: primary(depth + 1) };
    if (token === "(") { const value = sum(depth + 1); if (tokens[index++] !== ")") throw new Error("Missing closing parenthesis."); return value; }
    if (/^(?:\d|\.)/.test(token)) { const value = Number(token); if (!Number.isFinite(value) || Math.abs(value) > 1e15) throw new Error("Metric constant is too large."); return { kind: "number", value }; }
    if (tokens[index] === "(") {
      const fn = FUNCTIONS[token]; if (!fn) throw new Error(`Unknown metric function: ${token}.`); index++;
      const args: ReportExpressionNode[] = [sum(depth + 1)];
      while (tokens[index] === ",") { index++; args.push(sum(depth + 1)); if (args.length > fn.max) throw new Error(`${token} takes at most ${fn.max} arguments.`); }
      if (tokens[index++] !== ")" || args.length < fn.min) throw new Error(`Invalid arguments to ${token}.`);
      return { kind: "call", name: token, args };
    }
    if (!allowed.has(token) || ["__proto__", "constructor", "prototype"].includes(token)) throw new Error(`Unknown numeric report field: ${token}.`);
    return { kind: "field", key: token };
  };
  const product = (depth: number): ReportExpressionNode => { let left = primary(depth); while (tokens[index] === "*" || tokens[index] === "/") { const op = tokens[index++]; left = { kind: "binary", op, left, right: primary(depth + 1) }; } return left; };
  const sum = (depth: number): ReportExpressionNode => { let left = product(depth); while (tokens[index] === "+" || tokens[index] === "-") { const op = tokens[index++]; left = { kind: "binary", op, left, right: product(depth + 1) }; } return left; };
  const node = sum(0); if (index !== tokens.length) throw new Error("Unexpected token in metric expression."); return node;
}
export function evaluateReportExpression(node: ReportExpressionNode, values: Record<string, string | number | null>): number | null {
  const run = (part: ReportExpressionNode): number | null => {
    if (part.kind === "number") return part.value;
    if (part.kind === "field") { const value = values[part.key]; return typeof value === "number" && Number.isFinite(value) ? value : null; }
    if (part.kind === "unary") { const value = run(part.value); return value === null ? null : value * part.sign; }
    if (part.kind === "call") { const args = part.args.map(run); return args.some((value) => value === null) ? null : FUNCTIONS[part.name].run(...args as number[]); }
    const left = run(part.left), right = run(part.right); if (left === null || right === null || (part.op === "/" && right === 0)) return null;
    return part.op === "+" ? left + right : part.op === "-" ? left - right : part.op === "*" ? left * right : left / right;
  };
  const result = run(node); return result === null || !Number.isFinite(result) || Math.abs(result) > Number.MAX_SAFE_INTEGER ? null : result;
}
