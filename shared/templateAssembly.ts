/**
 * TEMPLATE ASSEMBLY ENGINE (pure logic).
 *
 * A tiny, dependency-free string template engine. It is the generalization of
 * the ad-hoc {Token}/{#SoleVotDir}/{#VotingDirectors} helpers that were hand
 * rolled in scripts/starter-template-rendering.ts.
 *
 * Supported syntax (deliberately minimal, scan/parse based, NO arbitrary JS
 * evaluation):
 *
 *   1. Token interpolation:  {path.to.value}
 *        -> String(resolvedValue); "" when the value is undefined or null.
 *
 *   2. Conditional block:    {#if path}...{/if}
 *                            {#if path}...{#else}...{/if}
 *        -> Truthiness of the RESOLVED VALUE. Callers precompute booleans;
 *           there are no operators or expressions. Falsy values are:
 *           undefined, null, false, 0, "" and the empty array. Everything
 *           else (including non-empty arrays/strings and true) is truthy.
 *
 *   3. Loop block:           {#each path}...{/each}
 *        -> path must resolve to an array. The body is rendered once per item
 *           and concatenated. Inside the body:
 *             {this}          -> the current item (String()'d)
 *             {this.field}    -> a field of the current item
 *             {.field}        -> shorthand for {this.field}
 *             {@index}        -> 0-based index of the current item
 *
 *   4. Blocks nest correctly via a recursive descent parser over a balanced
 *      tag scan (an {#each} may contain {#if}, etc.).
 *
 *   5. Unknown tokens render as "". Single braces are control syntax; use the
 *      {{ and }} escapes to emit literal "{" and "}".
 */

export type TemplateValues = Record<string, unknown>;

/**
 * Dotted-path lookup over a context object. Returns undefined if any segment
 * along the path is missing (or the value is not an object you can index into).
 */
export function resolvePath(context: TemplateValues, path: string): unknown {
  if (path === "") {
    return undefined;
  }
  const segments = path.split(".");
  let current: unknown = context;
  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Render a template string against a context.
 */
export function renderTemplate(template: string, context: TemplateValues): string {
  const nodes = parse(tokenize(template));
  return renderNodes(nodes, context, undefined, undefined);
}

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

type TextToken = { type: "text"; value: string };
type TagToken = { type: "tag"; raw: string; inner: string };
type Token = TextToken | TagToken;

function tokenize(template: string): Token[] {
  const tokens: Token[] = [];
  let buffer = "";
  let i = 0;
  const n = template.length;

  const flushText = () => {
    if (buffer.length > 0) {
      tokens.push({ type: "text", value: buffer });
      buffer = "";
    }
  };

  while (i < n) {
    const ch = template[i];
    if (ch === "{") {
      // Literal "{{" escape -> "{".
      if (template[i + 1] === "{") {
        buffer += "{";
        i += 2;
        continue;
      }
      const close = template.indexOf("}", i + 1);
      if (close === -1) {
        // Unterminated brace: treat the rest as literal text.
        buffer += template.slice(i);
        break;
      }
      const inner = template.slice(i + 1, close);
      flushText();
      tokens.push({ type: "tag", raw: template.slice(i, close + 1), inner });
      i = close + 1;
      continue;
    }
    if (ch === "}" && template[i + 1] === "}") {
      // Literal "}}" escape -> "}".
      buffer += "}";
      i += 2;
      continue;
    }
    buffer += ch;
    i += 1;
  }
  flushText();
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser (recursive descent over the token stream)
// ---------------------------------------------------------------------------

type TextNode = { kind: "text"; value: string };
type InterpNode = { kind: "interp"; expr: string };
type IfNode = { kind: "if"; path: string; consequent: Node[]; alternate: Node[] };
type EachNode = { kind: "each"; path: string; body: Node[] };
type Node = TextNode | InterpNode | IfNode | EachNode;

function parse(tokens: Token[]): Node[] {
  let pos = 0;

  function parseNodes(stopTags: string[]): Node[] {
    const nodes: Node[] = [];
    while (pos < tokens.length) {
      const token = tokens[pos];
      if (token.type === "text") {
        nodes.push({ kind: "text", value: token.value });
        pos += 1;
        continue;
      }
      const inner = token.inner.trim();
      if (stopTags.includes(inner)) {
        // Leave the stop tag for the caller to consume.
        return nodes;
      }
      if (inner.startsWith("#if ")) {
        pos += 1; // consume {#if ...}
        const path = inner.slice(4).trim();
        const consequent = parseNodes(["#else", "/if"]);
        let alternate: Node[] = [];
        const next = tokens[pos];
        if (next && next.type === "tag" && next.inner.trim() === "#else") {
          pos += 1; // consume {#else}
          alternate = parseNodes(["/if"]);
        }
        expectClose("/if");
        nodes.push({ kind: "if", path, consequent, alternate });
        continue;
      }
      if (inner.startsWith("#each ")) {
        pos += 1; // consume {#each ...}
        const path = inner.slice(6).trim();
        const body = parseNodes(["/each"]);
        expectClose("/each");
        nodes.push({ kind: "each", path, body });
        continue;
      }
      // Plain interpolation / unknown token.
      nodes.push({ kind: "interp", expr: inner });
      pos += 1;
    }
    return nodes;
  }

  function expectClose(tag: string): void {
    const token = tokens[pos];
    if (!token || token.type !== "tag" || token.inner.trim() !== tag) {
      throw new Error(`templateAssembly: expected closing {${tag}} but found ${describe(token)}`);
    }
    pos += 1;
  }

  const result = parseNodes([]);
  if (pos < tokens.length) {
    throw new Error(`templateAssembly: unexpected ${describe(tokens[pos])}`);
  }
  return result;
}

function describe(token: Token | undefined): string {
  if (!token) {
    return "end of template";
  }
  if (token.type === "text") {
    return `text "${token.value.slice(0, 20)}"`;
  }
  return token.raw;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

function renderNodes(
  nodes: Node[],
  context: TemplateValues,
  currentItem: unknown,
  currentIndex: number | undefined,
): string {
  let out = "";
  for (const node of nodes) {
    out += renderNode(node, context, currentItem, currentIndex);
  }
  return out;
}

function renderNode(
  node: Node,
  context: TemplateValues,
  currentItem: unknown,
  currentIndex: number | undefined,
): string {
  switch (node.kind) {
    case "text":
      return node.value;
    case "interp":
      return renderInterp(node.expr, context, currentItem, currentIndex);
    case "if": {
      const value = resolveExpr(node.path, context, currentItem);
      const branch = isTruthy(value) ? node.consequent : node.alternate;
      return renderNodes(branch, context, currentItem, currentIndex);
    }
    case "each": {
      const value = resolveExpr(node.path, context, currentItem);
      if (!Array.isArray(value)) {
        return "";
      }
      let out = "";
      for (let index = 0; index < value.length; index += 1) {
        out += renderNodes(node.body, context, value[index], index);
      }
      return out;
    }
  }
}

function renderInterp(
  expr: string,
  context: TemplateValues,
  currentItem: unknown,
  currentIndex: number | undefined,
): string {
  if (expr === "@index") {
    return currentIndex === undefined ? "" : String(currentIndex);
  }
  const value = resolveExpr(expr, context, currentItem);
  if (value === undefined || value === null) {
    return "";
  }
  return String(value);
}

/**
 * Resolve a token expression. Handles the loop-local forms ({this},
 * {this.field}, {.field}) and falls back to a context dotted-path lookup.
 */
function resolveExpr(expr: string, context: TemplateValues, currentItem: unknown): unknown {
  if (expr === "this" || expr === ".") {
    return currentItem;
  }
  if (expr.startsWith("this.")) {
    return resolveFromValue(currentItem, expr.slice(5));
  }
  if (expr.startsWith(".")) {
    return resolveFromValue(currentItem, expr.slice(1));
  }
  return resolvePath(context, expr);
}

function resolveFromValue(value: unknown, path: string): unknown {
  if (value === null || value === undefined || typeof value !== "object") {
    return undefined;
  }
  return resolvePath(value as TemplateValues, path);
}

function isTruthy(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return Boolean(value);
}
