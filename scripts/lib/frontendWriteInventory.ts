/** Binding-aware frontend write inventory. No type instantiation or dependency loading. */
import ts from "typescript";

export type SourceInput = { fileName: string; text: string };
type Binding = { kind: "unknown" } | { kind: "api"; path: string[] } | { kind: "namespace"; module: string } | { kind: "hook"; name: string };
const WRITE_HOOKS = new Set(["useMutation", "useAction", "usePermissionedMutation"]);
const isApiModule = (name: string) => /(?:^|\/)(?:convexApi|_generated\/api)(?:\.[cm]?[jt]s)?$/.test(name) || name === "convex/server";
const isHookModule = (name: string) => name === "convex/react" || /(?:^|\/)usePermissionedMutation(?:\.[jt]sx?)?$/.test(name);
const namePattern = /^[A-Za-z_][\w/]*:[A-Za-z_]\w*$/;
function unbox(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) node = node.expression;
  return node;
}
function imported(module: string, name: string): Binding[] {
  if (isApiModule(module) && (name === "api" || name === "anyApi")) return [{ kind: "api", path: [] }];
  if (isHookModule(module) && WRITE_HOOKS.has(name)) return [{ kind: "hook", name }];
  return [];
}
function moduleOf(node: ts.Node): string | null {
  let current: ts.Node | undefined = node;
  while (current && !ts.isImportDeclaration(current)) current = current.parent;
  return current && ts.isImportDeclaration(current) && ts.isStringLiteral(current.moduleSpecifier) ? current.moduleSpecifier.text : null;
}

export function inventoryFrontendWrites(inputs: readonly SourceInput[]) {
  const files = new Map(inputs.map((input) => [input.fileName, ts.createSourceFile(input.fileName, input.text, ts.ScriptTarget.Latest, true, input.fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)]));
  const options: ts.CompilerOptions = { noResolve: true, noLib: true, target: ts.ScriptTarget.ESNext, jsx: ts.JsxEmit.ReactJSX };
  const host: ts.CompilerHost = {
    getSourceFile: (name) => files.get(name), getDefaultLibFileName: () => "", writeFile: () => {},
    getCurrentDirectory: () => "/", getDirectories: () => [], fileExists: (name) => files.has(name),
    readFile: (name) => files.get(name)?.text, getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true, getNewLine: () => "\n",
  };
  const checker = ts.createProgram([...files.keys()], options, host).getTypeChecker();
  const refs = new Map<string, string[]>();
  const unresolved: string[] = [];
  function resolve(node: ts.Expression, seen = new Set<ts.Symbol>()): Binding[] {
    node = unbox(node);
    if (ts.isConditionalExpression(node)) {
      const left = resolve(node.whenTrue, new Set(seen));
      const right = resolve(node.whenFalse, new Set(seen));
      return [...left, ...right, ...(!left.length || !right.length ? [{ kind: "unknown" as const }] : [])];
    }
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      if (!symbol || seen.has(symbol)) return [];
      seen.add(symbol);
      return (symbol.declarations ?? []).flatMap((declaration): Binding[] => {
        if (ts.isImportSpecifier(declaration)) {
          const module = moduleOf(declaration);
          return module ? imported(module, (declaration.propertyName ?? declaration.name).text) : [];
        }
        if (ts.isNamespaceImport(declaration)) {
          const module = moduleOf(declaration);
          return module ? [{ kind: "namespace", module }] : [];
        }
        if (ts.isVariableDeclaration(declaration) && declaration.initializer) return resolve(declaration.initializer, seen);
        if (ts.isBindingElement(declaration) && ts.isObjectBindingPattern(declaration.parent)) {
          const variable = declaration.parent.parent;
          const property = declaration.propertyName ?? declaration.name;
          if (ts.isVariableDeclaration(variable) && variable.initializer && (ts.isIdentifier(property) || ts.isStringLiteral(property))) {
            return member(resolve(variable.initializer, seen), property.text);
          }
        }
        return [];
      });
    }
    if (ts.isPropertyAccessExpression(node)) return member(resolve(node.expression, seen), node.name.text);
    if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(unbox(node.argumentExpression))) {
      return member(resolve(node.expression, seen), (unbox(node.argumentExpression) as ts.StringLiteralLike).text);
    }
    return [];
  }
  function member(bindings: Binding[], name: string): Binding[] {
    return bindings.flatMap((binding): Binding[] => binding.kind === "api" ? [{ kind: "api", path: [...binding.path, name] }]
      : binding.kind === "namespace" ? imported(binding.module, name) : binding.kind === "unknown" ? [binding] : []);
  }
  function isForwardingWrapper(node: ts.Expression, file: ts.SourceFile) {
    // This one forwarding hook is inventoried at every imported call site.
    if (!/(?:^|\/)hooks\/usePermissionedMutation\.tsx?$/.test(file.fileName) || !ts.isIdentifier(node)) return false;
    const declarations = checker.getSymbolAtLocation(node)?.declarations ?? [];
    return declarations.some((declaration) => ts.isParameter(declaration) && ts.isFunctionDeclaration(declaration.parent) && declaration.parent.name?.text === "usePermissionedMutation");
  }
  for (const file of files.values()) {
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.arguments.length) {
        const writeHook = resolve(node.expression).some((binding) => binding.kind === "hook");
        const callee = unbox(node.expression);
        const clientCall = ts.isPropertyAccessExpression(callee) && (callee.name.text === "mutation" || callee.name.text === "action");
        if (writeHook || clientCall) {
          const argument = unbox(node.arguments[0]);
          const bindings = resolve(argument);
          const names = bindings.flatMap((binding) => {
            if (binding.kind !== "api" || binding.path.length < 2) return [];
            return [`${binding.path.slice(0, -1).join("/")}:${binding.path.at(-1)}`];
          });
          if (ts.isStringLiteralLike(argument) && namePattern.test(argument.text)) names.push(argument.text);
          const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
          for (const name of new Set(names)) refs.set(name, [...(refs.get(name) ?? []), `${file.fileName}:${line}`]);
          if (writeHook && (!names.length || bindings.some(binding => binding.kind === "unknown")) && !isForwardingWrapper(argument, file)) unresolved.push(`${file.fileName}:${line}: ${node.getText(file).slice(0, 160)}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return { refs, unresolved };
}

/** Count dispatch branches, not comments, logs, fixture strings, or arbitrary mentions. */
export function inventoryExplicitDispatch(inputs: readonly SourceInput[]): Set<string> {
  const handled = new Set<string>();
  const dispatchName = (node: ts.Expression) => ts.isIdentifier(unbox(node)) && (unbox(node) as ts.Identifier).text === "name";
  function conditions(node: ts.Expression): string[] {
    node = unbox(node);
    if (ts.isBinaryExpression(node)) {
      if ([ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(node.operatorToken.kind)) return [...conditions(node.left), ...conditions(node.right)];
      if (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken || node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken) {
        const literal = dispatchName(node.left) ? unbox(node.right) : dispatchName(node.right) ? unbox(node.left) : null;
        if (literal && ts.isStringLiteralLike(literal) && namePattern.test(literal.text)) return [literal.text];
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "includes" && node.arguments[0] && dispatchName(node.arguments[0])) {
      const receiver = unbox(node.expression.expression);
      if (ts.isArrayLiteralExpression(receiver)) return receiver.elements.flatMap((element) => ts.isStringLiteralLike(element) && namePattern.test(element.text) ? [element.text] : []);
    }
    return [];
  }
  function exits(node: ts.Node): boolean {
    if (ts.isReturnStatement(node) || ts.isThrowStatement(node)) return true;
    if (ts.isFunctionLike(node)) return false;
    return ts.forEachChild(node, exits) ?? false;
  }
  for (const input of inputs) {
    const file = ts.createSourceFile(input.fileName, input.text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isIfStatement(node) && exits(node.thenStatement)) for (const name of conditions(node.expression)) handled.add(name);
      if (ts.isSwitchStatement(node) && dispatchName(node.expression)) {
        for (const clause of node.caseBlock.clauses) if (ts.isCaseClause(clause) && ts.isStringLiteralLike(clause.expression) && namePattern.test(clause.expression.text)) handled.add(clause.expression.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return handled;
}
