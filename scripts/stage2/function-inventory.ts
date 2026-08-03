import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export type FunctionSurface = "convex" | "http" | "portable";
export type FunctionKind = "query" | "mutation" | "action" | "http";
export type AccessClassification = "public" | "authenticated" | "service" | "unclassified";

export type ArgumentTemplate =
  | { kind: "id"; table: string }
  | { kind: "string" }
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "literal"; value: string | number | boolean | null }
  | { kind: "array"; item: ArgumentTemplate }
  | { kind: "object"; fields: ArgumentField[] }
  | { kind: "unknown" };

export interface ArgumentField {
  name: string;
  optional: boolean;
  value: ArgumentTemplate;
}

export interface IdArgument {
  path: string;
  table: string;
  array: boolean;
  optional: boolean;
}

export interface FunctionInventoryEntry {
  key: string;
  surface: FunctionSurface;
  name: string;
  kind: FunctionKind;
  access: AccessClassification;
  scopes?: string[];
  source: string;
  line: number;
  argumentTemplate?: ArgumentTemplate;
  idArguments: IdArgument[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "../..");
export const INVENTORY_SNAPSHOT_PATH = path.join(here, "function-inventory.json");

const CONVEX_KINDS = new Map<string, { kind: FunctionKind; service: boolean }>([
  ["query", { kind: "query", service: false }],
  ["mutation", { kind: "mutation", service: false }],
  ["action", { kind: "action", service: false }],
  ["internalQuery", { kind: "query", service: true }],
  ["internalMutation", { kind: "mutation", service: true }],
  ["internalAction", { kind: "action", service: true }],
]);

function sourceFile(file: string): ts.SourceFile {
  const text = readFileSync(file, "utf8");
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function isExported(node: ts.Node): boolean {
  return Boolean(ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export);
}

function callName(expression: ts.Expression): string | undefined {
  if (ts.isAsExpression(expression) || ts.isParenthesizedExpression(expression)) return callName(expression.expression);
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    const parent = callName(expression.expression);
    return parent ? `${parent}.${expression.name.text}` : expression.name.text;
  }
  return undefined;
}

function propertyName(node: ts.ObjectLiteralElementLike): string | undefined {
  if (!ts.isPropertyAssignment(node) && !ts.isShorthandPropertyAssignment(node)) return undefined;
  const name = node.name;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

function property(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  const match = object.properties.find((candidate) => propertyName(candidate) === name);
  return match && ts.isPropertyAssignment(match) ? match.initializer : undefined;
}

function literalValue(expression: ts.Expression): string | number | boolean | null | undefined {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
  if (ts.isNumericLiteral(expression)) return Number(expression.text);
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (expression.kind === ts.SyntaxKind.NullKeyword) return null;
  return undefined;
}

function parseValidator(expression: ts.Expression): { optional: boolean; value: ArgumentTemplate } {
  if (ts.isObjectLiteralExpression(expression)) {
    return { optional: false, value: parseArgsObject(expression) };
  }
  if (!ts.isCallExpression(expression)) return { optional: false, value: { kind: "unknown" } };

  const name = callName(expression.expression);
  const validatorName = name?.split(".").at(-1);
  if (validatorName === "optional" && expression.arguments[0]) {
    const nested = parseValidator(expression.arguments[0]);
    return { optional: true, value: nested.value };
  }
  if (validatorName === "id") {
    const table = expression.arguments[0] && literalValue(expression.arguments[0]);
    return { optional: false, value: { kind: "id", table: typeof table === "string" ? table : "unknown" } };
  }
  if (validatorName === "string") return { optional: false, value: { kind: "string" } };
  if (validatorName === "number" || validatorName === "int64" || validatorName === "float64") {
    return { optional: false, value: { kind: "number" } };
  }
  if (validatorName === "boolean") return { optional: false, value: { kind: "boolean" } };
  if (validatorName === "literal" && expression.arguments[0]) {
    const value = literalValue(expression.arguments[0]);
    return { optional: false, value: value === undefined ? { kind: "unknown" } : { kind: "literal", value } };
  }
  if (validatorName === "array" && expression.arguments[0]) {
    return { optional: false, value: { kind: "array", item: parseValidator(expression.arguments[0]).value } };
  }
  if (validatorName === "object" && expression.arguments[0] && ts.isObjectLiteralExpression(expression.arguments[0])) {
    return { optional: false, value: parseArgsObject(expression.arguments[0]) };
  }
  if (validatorName === "union" && expression.arguments[0]) return parseValidator(expression.arguments[0]);
  if (validatorName === "null") return { optional: false, value: { kind: "literal", value: null } };
  return { optional: false, value: { kind: "unknown" } };
}

function parseArgsObject(object: ts.ObjectLiteralExpression): ArgumentTemplate {
  const fields: ArgumentField[] = [];
  for (const candidate of object.properties) {
    if (!ts.isPropertyAssignment(candidate)) continue;
    const name = propertyName(candidate);
    if (!name) continue;
    const parsed = parseValidator(candidate.initializer);
    fields.push({ name, optional: parsed.optional, value: parsed.value });
  }
  return { kind: "object", fields };
}

function collectIdArguments(
  template: ArgumentTemplate | undefined,
  prefix = "",
  inheritedOptional = false,
): IdArgument[] {
  if (!template) return [];
  if (template.kind === "id") {
    return [{ path: prefix, table: template.table, array: false, optional: inheritedOptional }];
  }
  if (template.kind === "array" && template.item.kind === "id") {
    return [{ path: prefix, table: template.item.table, array: true, optional: inheritedOptional }];
  }
  if (template.kind !== "object") return [];
  return template.fields.flatMap((field) =>
    collectIdArguments(
      field.value,
      prefix ? `${prefix}.${field.name}` : field.name,
      inheritedOptional || field.optional,
    ),
  );
}

function lineOf(file: ts.SourceFile, node: ts.Node): number {
  return file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
}

interface PortableMetadata {
  access: AccessClassification;
  scopes?: string[];
  kind: FunctionKind;
  line: number;
}

function defaultPortableAccess(): AccessClassification {
  const file = sourceFile(path.join(REPO_ROOT, "shared/portable/define.ts"));
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "DEFAULT_PORTABLE_ACCESS") continue;
      if (!declaration.initializer || !ts.isObjectLiteralExpression(declaration.initializer)) return "unclassified";
      const audience = property(declaration.initializer, "audience");
      if (audience && ts.isStringLiteral(audience) && ["public", "authenticated", "service"].includes(audience.text)) {
        return audience.text as AccessClassification;
      }
    }
  }
  return "unclassified";
}

function portableMetadata(): Map<string, PortableMetadata> {
  const filePath = path.join(REPO_ROOT, "shared/functions/registry.ts");
  const file = sourceFile(filePath);
  const metadata = new Map<string, PortableMetadata>();
  const defaultAccess = defaultPortableAccess();

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const name = callName(node.expression);
      if ((name === "definePortableQuery" || name === "definePortableMutation") && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
        const object = node.arguments[0];
        const inventoryName = property(object, "name");
        if (inventoryName && ts.isStringLiteral(inventoryName)) {
          const accessExpression = property(object, "access");
          let access: AccessClassification = defaultAccess;
          let scopes: string[] | undefined;
          if (accessExpression && ts.isObjectLiteralExpression(accessExpression)) {
            const audience = property(accessExpression, "audience");
            if (audience && ts.isStringLiteral(audience) && ["public", "authenticated", "service"].includes(audience.text)) {
              access = audience.text as AccessClassification;
            }
            const scopeExpression = property(accessExpression, "scopes");
            if (scopeExpression && ts.isArrayLiteralExpression(scopeExpression)) {
              scopes = scopeExpression.elements.flatMap((item) => ts.isStringLiteral(item) ? [item.text] : []);
            }
          }
          metadata.set(inventoryName.text, {
            access,
            ...(scopes ? { scopes } : {}),
            kind: name === "definePortableQuery" ? "query" : "mutation",
            line: lineOf(file, node),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return metadata;
}

function classifyConvex(initializerText: string, isService: boolean): AccessClassification {
  if (isService) return "service";
  const authenticatedSignals = [
    "requireRole(",
    "requireRolePortable(",
    "requirePrincipalRole(",
    "getUserIdentity(",
    "principalUserId(",
    "requireAuthenticated",
  ];
  return authenticatedSignals.some((signal) => initializerText.includes(signal)) ? "authenticated" : "unclassified";
}

function convexEntries(portable: Map<string, PortableMetadata>): FunctionInventoryEntry[] {
  const convexDir = path.join(REPO_ROOT, "convex");
  const entries: FunctionInventoryEntry[] = [];
  for (const filename of readdirSync(convexDir).filter((name) => name.endsWith(".ts") && name !== "http.ts").sort()) {
    const filePath = path.join(convexDir, filename);
    const file = sourceFile(filePath);
    const moduleName = filename.slice(0, -3);
    for (const statement of file.statements) {
      if (!ts.isVariableStatement(statement) || !isExported(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer || !ts.isCallExpression(declaration.initializer)) continue;
        const constructorName = callName(declaration.initializer.expression);
        const convexKind = constructorName && CONVEX_KINDS.get(constructorName);
        if (!convexKind) continue;
        const name = `${moduleName}:${declaration.name.text}`;
        const definition = declaration.initializer.arguments[0];
        const argsExpression = definition && ts.isObjectLiteralExpression(definition) ? property(definition, "args") : undefined;
        const argumentTemplate = argsExpression && ts.isObjectLiteralExpression(argsExpression)
          ? parseArgsObject(argsExpression)
          : undefined;
        const portableEntry = portable.get(name);
        entries.push({
          key: `convex:${name}`,
          surface: "convex",
          name,
          kind: convexKind.kind,
          access: portableEntry?.access ?? classifyConvex(declaration.initializer.getText(file), convexKind.service),
          ...(portableEntry?.scopes ? { scopes: portableEntry.scopes } : {}),
          source: `convex/${filename}`,
          line: lineOf(file, declaration),
          ...(argumentTemplate ? { argumentTemplate } : {}),
          idArguments: collectIdArguments(argumentTemplate),
        });
      }
    }
  }
  return entries;
}

function httpEntries(): FunctionInventoryEntry[] {
  const filename = "convex/http.ts";
  const file = sourceFile(path.join(REPO_ROOT, filename));
  const entries: FunctionInventoryEntry[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && callName(node.expression) === "http.route" && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
      const object = node.arguments[0];
      const pathExpression = property(object, "path");
      const methodExpression = property(object, "method");
      if (pathExpression && ts.isStringLiteral(pathExpression) && methodExpression && ts.isStringLiteral(methodExpression)) {
        const routeName = `${methodExpression.text} ${pathExpression.text}`;
        const text = node.getText(file);
        let access: AccessClassification = "unclassified";
        let scopes: string[] | undefined;
        if (methodExpression.text === "OPTIONS") access = "public";
        if (/verify(?:Stripe|Resend|Twilio)Signature/.test(text)) {
          access = "service";
          scopes = [`webhook:${pathExpression.text.split("/").filter(Boolean)[0] ?? "provider"}`];
        }
        const bodyIdArguments = [...text.matchAll(/\b(?:body|searchParams)\.([A-Za-z][A-Za-z0-9]*Id)\b/g)]
          .map((match) => match[1]);
        entries.push({
          key: `http:${routeName}`,
          surface: "http",
          name: routeName,
          kind: "http",
          access,
          ...(scopes ? { scopes } : {}),
          source: filename,
          line: lineOf(file, node),
          idArguments: [...new Set(bodyIdArguments)].sort().map((argumentPath) => ({
            path: argumentPath,
            table: argumentPath === "societyId" ? "societies" : "unknown",
            array: false,
            optional: false,
          })),
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return entries;
}

export function buildFunctionInventory(): FunctionInventoryEntry[] {
  const portable = portableMetadata();
  const convex = convexEntries(portable);
  const convexByName = new Map(convex.map((entry) => [entry.name, entry]));
  const portableEntries: FunctionInventoryEntry[] = [...portable.entries()].map(([name, metadata]) => {
    const hosted = convexByName.get(name);
    return {
      key: `portable:${name}`,
      surface: "portable",
      name,
      kind: metadata.kind,
      access: metadata.access,
      ...(metadata.scopes ? { scopes: metadata.scopes } : {}),
      source: "shared/functions/registry.ts",
      line: metadata.line,
      ...(hosted?.argumentTemplate ? { argumentTemplate: hosted.argumentTemplate } : {}),
      idArguments: hosted?.idArguments ?? [],
    };
  });
  return [...convex, ...httpEntries(), ...portableEntries].sort((left, right) =>
    left.surface.localeCompare(right.surface) || left.name.localeCompare(right.name) || left.line - right.line,
  );
}

export function readInventorySnapshot(): FunctionInventoryEntry[] {
  return JSON.parse(readFileSync(INVENTORY_SNAPSHOT_PATH, "utf8")) as FunctionInventoryEntry[];
}

// `line` is deliberately excluded: it shifts whenever unrelated code above a
// function changes, which would dirty the committed snapshot on every edit and
// train reviewers to regenerate it blindly. Drift should mean "a function was
// added, removed, or reclassified", not "a file grew a line".
export function inventoryForSnapshot(
  inventory: FunctionInventoryEntry[],
): Omit<FunctionInventoryEntry, "argumentTemplate" | "line">[] {
  return inventory.map(
    ({ argumentTemplate: _argumentTemplate, line: _line, ...entry }) => entry,
  );
}

function inventorySummary(inventory: FunctionInventoryEntry[]): string {
  const counts = new Map<AccessClassification, number>();
  for (const entry of inventory) counts.set(entry.access, (counts.get(entry.access) ?? 0) + 1);
  return ["public", "authenticated", "service", "unclassified"]
    .map((classification) => `${classification}=${counts.get(classification as AccessClassification) ?? 0}`)
    .join(", ");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inventory = buildFunctionInventory();
  if (process.argv.includes("--write")) {
    writeFileSync(INVENTORY_SNAPSHOT_PATH, `${JSON.stringify(inventoryForSnapshot(inventory), null, 2)}\n`);
    console.log(`Wrote ${inventory.length} entries to ${path.relative(REPO_ROOT, INVENTORY_SNAPSHOT_PATH)} (${inventorySummary(inventory)}).`);
  } else {
    console.log(`Function inventory: ${inventory.length} entries (${inventorySummary(inventory)}).`);
  }
}
