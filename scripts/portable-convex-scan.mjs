// Shared static parser for the manifest gate and registry authoring aid.
// Parse expressions rather than slicing from one recognized export to the next:
// wrappers, casts, comments and neighbouring internal handlers cannot leak in.
import ts from "typescript";

export const SERVER_ONLY_KINDS = new Set(["action", "internalQuery", "internalMutation", "internalAction"]);
export const EXPLICIT_SERVER_ONLY = new Set([
  "seed:run",
  "seed:reset",
  "seedRecordTableMetadata:run",
  "seedRecordTableMetadata:runForSociety",
  "seedRecordTableMetadata:wipe",
  // Operator credentials and deployment identity policy stay on the host.
  "apiPlatform:bootstrapUserIdentity",
  "apiPlatform:migrateUserToClerk",
]);
// These are deliberate local demo implementations, not hosted delegations.
// Require the exact registry handler and a surviving Convex counterpart so
// this exception cannot conceal a rename, deletion or live-provider exposure.
export const LOCAL_RUNTIME_VARIANTS = new Map([
  ["financialHub:markConnectionConnected", {
    handler: "financialHubFns.markDemoConnectionConnectedPortable",
    reason: "Local demo Wave setup; hosted implementation validates operator workspace bindings.",
  }],
  ["paperless:recordConnectionTest", {
    handler: "paperlessFns.recordConnectionTestPortable",
    reason: "Local demo-only simulation; hosted internal mutation records verified provider results.",
  }],
]);
const KINDS = new Set(["query", "mutation", ...SERVER_ONLY_KINDS]);
const WRAPPERS = new Map([
  ["authorizedQuery", "query"],
  ["authorizedMutation", "mutation"],
  ["authorizedAction", "action"],
]);

function unwrap(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node))) {
    node = node.expression;
  }
  return node;
}

export function scanModule(source, module) {
  const file = ts.createSourceFile(`${module}.ts`, source, ts.ScriptTarget.Latest, true);
  if (file.parseDiagnostics.length) throw new Error(`${module}: cannot scan invalid TypeScript: ${ts.flattenDiagnosticMessageText(file.parseDiagnostics[0].messageText, "\n")}`);
  const bindings = new Map();
  const shared = new Map();
  const namespaces = new Map();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const path = statement.moduleSpecifier.text;
    const imports = statement.importClause?.namedBindings;
    if (!imports || statement.importClause.isTypeOnly) continue;
    const match = path.match(/^\.\.\/shared\/functions\/([\w-]+)$/);
    if (ts.isNamespaceImport(imports)) {
      if (match) namespaces.set(imports.name.text, match[1]);
      continue;
    }
    if (!ts.isNamedImports(imports)) continue;
    for (const spec of imports.elements) {
      if (spec.isTypeOnly) continue;
      const imported = (spec.propertyName ?? spec.name).text;
      bindings.set(spec.name.text, imported);
      if (match) shared.set(spec.name.text, { fn: imported, sharedModule: match[1] });
    }
  }
  const identifier = (node) => {
    node = unwrap(node);
    return node && ts.isIdentifier(node) ? (bindings.get(node.text) ?? node.text) : null;
  };
  function sharedCallee(node) {
    node = unwrap(node);
    if (ts.isIdentifier(node)) return shared.get(node.text);
    if (!ts.isPropertyAccessExpression(node)) return;
    let owner = unwrap(node.expression);
    if (ts.isIdentifier(owner) && namespaces.has(owner.text)) return { fn: node.name.text, sharedModule: namespaces.get(owner.text) };
    if (ts.isAwaitExpression(owner)) owner = unwrap(owner.expression);
    if (ts.isCallExpression(owner) && owner.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(owner.arguments[0])) {
      const match = owner.arguments[0].text.match(/^\.\.\/shared\/functions\/([\w-]+)$/);
      if (match) return { fn: node.name.text, sharedModule: match[1] };
    }
  }
  const out = [];
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement) || !statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const init = unwrap(declaration.initializer);
      if (!init || !ts.isCallExpression(init)) continue;
      const builder = unwrap(init.expression);
      let kind;
      if (ts.isCallExpression(builder) && WRAPPERS.has(identifier(builder.expression))) {
        kind = WRAPPERS.get(identifier(builder.expression));
        if (identifier(builder.arguments[1]) !== kind) throw new Error(`${module}: authorization wrapper/builder mismatch`);
      } else {
        kind = identifier(builder);
      }
      if (!KINDS.has(kind)) throw new Error(`${module}:${declaration.name.getText(file)}: unrecognized exported function builder ${builder.getText(file)}`);
      const definition = unwrap(init.arguments[0]);
      if (!definition || !ts.isObjectLiteralExpression(definition)) throw new Error(`${module}: expected a function definition object`);
      const handler = definition.properties.find((p) => p.name && p.name.getText(file) === "handler");
      const adapted = new Map();
      function adaptation(node) {
        node = unwrap(node);
        if (!node) return null;
        if (ts.isAwaitExpression(node)) return adaptation(node.expression);
        if (ts.isIdentifier(node)) return adapted.get(node.text) ?? null;
        if (!ts.isCallExpression(node)) return null;
        const id = identifier(node.expression);
        if (/^toPortable(?:Query|Mutation)Ctx$/.test(id ?? "")) return { capability: node.arguments.length > 1 };
        if (/^with\w*Caps$/.test(id ?? "")) return { capability: true };
        return null;
      }
      const locals = new Map();
      function collectLocals(node) {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
          locals.set(node.name.text, node.initializer);
          const adapter = adaptation(node.initializer);
          if (adapter) adapted.set(node.name.text, adapter);
        }
        ts.forEachChild(node, collectLocals);
      }
      if (handler) collectLocals(handler);
      const handlers = [];
      let capability = false;
      const visited = new Set();
      function visitReturned(node, resolveLocal = false) {
        node = unwrap(node);
        if (visited.has(node) || ts.isFunctionLike(node)) return;
        visited.add(node);
        if (resolveLocal && ts.isIdentifier(node) && locals.has(node.text)) return visitReturned(locals.get(node.text), true);
        if (ts.isAwaitExpression(node)) return visitReturned(node.expression, resolveLocal);
        if (ts.isCallExpression(node)) {
          const sharedFn = sharedCallee(node.expression);
          const adapter = adaptation(node.arguments[0]);
          // Auth helpers are guards, even when a callback returns their value.
          if (sharedFn && !["access", "identity", "actionPolicy"].includes(sharedFn.sharedModule) && sharedFn.fn !== "requirePermissionPortable" && (adapter || (sharedFn.fn.endsWith("Portable") && node.arguments.length === 0))) {
            handlers.push(sharedFn);
            capability ||= adapter?.capability ?? false;
          }
        }
        ts.forEachChild(node, child => visitReturned(child));
      }
      const body = handler && ts.isPropertyAssignment(handler) ? handler.initializer.body : null;
      function collectReturns(node) {
        if (ts.isFunctionLike(node)) return; // Nested callbacks are not the exported handler.
        if (ts.isReturnStatement(node) && node.expression) visitReturned(node.expression, true);
        else ts.forEachChild(node, collectReturns);
      }
      if (body) {
        if (ts.isBlock(body)) collectReturns(body);
        else visitReturned(body, true);
      }
      const delegation = handlers.length > 0;
      const exportName = declaration.name.getText(file);
      const name = `${module}:${exportName}`;
      const classification = SERVER_ONLY_KINDS.has(kind) || EXPLICIT_SERVER_ONLY.has(name)
        ? "server-only"
        : delegation ? (capability ? "capability-backed" : "portable") : "static-fallback";
      out.push({ name, module, export: exportName, kind, classification, delegates: handlers,
        ...(LOCAL_RUNTIME_VARIANTS.has(name) ? { localRuntimeVariant: LOCAL_RUNTIME_VARIANTS.get(name) } : {}),
      });
    }
  }
  return out;
}
