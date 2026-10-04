import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { matchPath } from "react-router-dom";
import { INTERFACE_ROUTES } from "../tests/helpers/interfaceRoutes";
import { interfaceRouteReadPermission } from "../shared/interfaceRouteAccess";

const source = ts.createSourceFile("main.tsx", readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
type DeclaredRoute = { pattern: string; line: number; index: boolean; module?: string };
const declared: DeclaredRoute[] = [];
let pathless = 0;
function visit(node: ts.Node, parentPath = "") {
  let inheritedPath = parentPath;
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
    const opening = ts.isJsxElement(node) ? node.openingElement : node;
    if (opening.tagName.getText(source) === "Route") {
      const attributes = opening.attributes.properties;
      const path = attributes.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "path") as ts.JsxAttribute | undefined;
      const index = attributes.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "index");
      let literal: string | undefined;
      if (path?.initializer) {
        const value = ts.isJsxExpression(path.initializer) ? path.initializer.expression : path.initializer;
        assert.ok(value && (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)), `Route path at line ${source.getLineAndCharacterOfPosition(opening.getStart(source)).line + 1} needs explicit AST coverage`);
        literal = value.text;
      }
      const pattern = literal === undefined ? index ? parentPath : undefined : literal.startsWith("/") ? literal : [parentPath, literal].filter(Boolean).join("/");
      if (pattern !== undefined) {
        const element = attributes.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "element") as ts.JsxAttribute | undefined;
        const module = element?.initializer?.getText(source).match(/withModule\("([^"]+)"/)?.[1];
        declared.push({ pattern, index, line: source.getLineAndCharacterOfPosition(opening.getStart(source)).line + 1, ...(module ? { module } : {}) });
        inheritedPath = pattern;
      } else pathless += 1;
    }
  }
  ts.forEachChild(node, child => visit(child, inheritedPath));
}
visit(source);

const patterns = [...new Set(declared.map(route => route.pattern))].sort();
const manifestPatterns = INTERFACE_ROUTES.map(route => route.pattern);
assert.equal(new Set(manifestPatterns).size, manifestPatterns.length, "Interface manifest has duplicate patterns");
const missing = patterns.filter(pattern => !manifestPatterns.includes(pattern));
const obsolete = manifestPatterns.filter(pattern => !patterns.includes(pattern));
assert.deepEqual(missing, [], `Uncovered route patterns: ${missing.join(", ")}`);
assert.deepEqual(obsolete, [], `Manifest paths removed from routing: ${obsolete.join(", ")}`);
for (const route of INTERFACE_ROUTES) {
  const expectedKind = route.pattern === "*" ? "fallback" : route.pattern === "/app" || route.pattern.startsWith("/app/") ? "app" : "public";
  assert.equal(route.kind, expectedKind, `Incorrect coverage category for ${route.pattern}`);
  const path = route.path.replace(/^\/demo(?=\/|$)/, "") || "/";
  const pathname = path.split(/[?#]/, 1)[0];
  if (route.kind === "app") assert.ok(interfaceRouteReadPermission(pathname), `App route ${route.pattern} lacks an explicit UI access scope`);
  assert.ok(matchPath({ path: route.pattern, end: true }, pathname), `Fixture ${route.path} does not match declared route ${route.pattern}`);
  assert.equal(/:[a-zA-Z][a-zA-Z0-9_]*/.test(pathname), false, `Fixture still contains unresolved parameters: ${route.path}`);
  if (route.pattern.includes(":")) assert.ok(["seeded", "missing-record", "invalid-token", "route"].includes(route.fixture), `Dynamic route ${route.pattern} lacks an explicit fixture classification`);
}
const modules = declared.filter(route => route.module);
for (const path of ["/app/Financials", "/app/%66inancials", "/app/financials/"]) {
  assert.equal(interfaceRouteReadPermission(path), "financials:read", `Router-equivalent path ${path} needs the same access explanation`);
}
assert.equal(interfaceRouteReadPermission("/app/unknown"), undefined);
assert.equal(interfaceRouteReadPermission("/app/financials-extra"), undefined);
console.log(`Interface route coverage: ${patterns.length} unique patterns; ${declared.filter(route => !route.index).length} path declarations, ${declared.filter(route => route.index).length} index routes, ${pathless} provider-only route; ${patterns.filter(pattern => pattern.includes(":")).length} dynamic patterns; ${modules.length} module-gated paths across ${new Set(modules.map(route => route.module)).size} modules.`);
