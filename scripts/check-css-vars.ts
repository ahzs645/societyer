/**
 * Fails when source code reads a CSS custom property that is never defined.
 *
 * The Sass `token()` helper validates names at compile time, but inline
 * `style={{ color: "var(--red)" }}` in TSX and raw `var(--x)` in SCSS/CSS
 * bypass it, so a typo or a token that never existed silently renders as
 * `unset` (the Treasurer variance colours were invisible for exactly this
 * reason). This script:
 *
 *   1. collects every `--name:` declared in src/theme/*.css, any CSS/SCSS
 *      under src/, and any custom property set from TS/TSX (style objects
 *      such as `{ "--x": ... }`, `setProperty("--x", ...)`, or `--x:` inside
 *      a template string);
 *   2. scans src/**\/*.{ts,tsx,scss,css} for `var(--name)` reads whose name
 *      is never defined (with or without a fallback: a fallback for a name
 *      nobody sets is a hard-coded value that ignores the theme);
 *   3. prints file:line for each offender and exits non-zero.
 *
 * Known offenders that belong to another owner can be listed, one
 * `path/to/file.tsx --name` pair per line, in scripts/css-vars-allowlist.txt.
 *
 * Run: npm run test:css-vars
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, extname } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SRC = join(ROOT, "src");
const ALLOWLIST = join(ROOT, "scripts", "css-vars-allowlist.txt");
const EXTENSIONS = new Set([".ts", ".tsx", ".scss", ".css"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (EXTENSIONS.has(extname(entry))) out.push(full);
  }
  return out;
}

const files = walk(SRC);
const sources = new Map(files.map((file) => [file, readFileSync(file, "utf8")]));

// ---------- 1. Definitions ----------
const defined = new Set<string>();
const DEFINITION_PATTERNS: RegExp[] = [
  // CSS / SCSS declarations and `--x:` inside TS template strings.
  /(?<![\w-])--([a-zA-Z0-9_-]+)\s*:/g,
  // Style objects: { "--x": value } or { '--x': value }.
  /["'`]--([a-zA-Z0-9_-]+)["'`]\s*[:,]/g,
  // element.style.setProperty("--x", ...)
  /setProperty\(\s*["'`]--([a-zA-Z0-9_-]+)["'`]/g,
];
for (const text of sources.values()) {
  for (const pattern of DEFINITION_PATTERNS) {
    for (const match of text.matchAll(pattern)) defined.add(match[1]);
  }
}

// ---------- 2. Allowlist ----------
const allowed = new Set<string>();
if (existsSync(ALLOWLIST)) {
  for (const raw of readFileSync(ALLOWLIST, "utf8").split("\n")) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const [file, name] = line.split(/\s+/);
    if (file && name) allowed.add(`${file} ${name.replace(/^--/, "")}`);
  }
}

// ---------- 3. Usages ----------
// `var(--name)` with no fallback resolves to the property's initial value
// when the name is undefined: always an error. `var(--name, fallback)` for a
// name defined nowhere is also reported: the fallback (usually a raw hex
// colour) is then the only value ever used, so it silently ignores the theme.
// Optional hooks that a parent sets at runtime are fine as long as something
// in src/ sets them (style object, setProperty, or a CSS declaration).
const USAGE = /var\(\s*--([a-zA-Z0-9_-]+)\s*([,)])/g;
const offenders: string[] = [];
const usedAllowances = new Set<string>();
for (const [file, text] of sources) {
  const rel = relative(ROOT, file);
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    // Comment lines (`//`, `/*`, ` *`) document var() usage; they never apply.
    if (/^\s*(\/\/|\/\*|\*)/.test(line)) return;
    for (const match of line.matchAll(USAGE)) {
      const name = match[1];
      if (defined.has(name)) continue;
      const key = `${rel} ${name}`;
      if (allowed.has(key)) {
        usedAllowances.add(key);
        continue;
      }
      const how = match[2] === "," ? "is never defined (only its hard-coded fallback ever applies)" : "is never defined";
      offenders.push(`${rel}:${index + 1}  var(--${name}) ${how}`);
    }
  });
}

const staleAllowances = [...allowed].filter((key) => !usedAllowances.has(key));
if (staleAllowances.length) {
  console.warn("css-vars: allowlist entries no longer needed (remove them):");
  for (const key of staleAllowances) console.warn(`  ${key}`);
}

if (offenders.length) {
  console.error(`css-vars: ${offenders.length} read(s) of undefined CSS custom properties:`);
  for (const line of offenders) console.error(`  ${line}`);
  console.error(
    "\nUse a real token from src/theme/tokens.css (e.g. --danger, --danger-soft, --bg-panel, --text-tertiary, --warn, --s-4),\n" +
      "add a fallback (var(--x, ...)), or define the property where it is set.",
  );
  process.exit(1);
}
console.log(`css-vars: OK (${defined.size} custom properties defined, ${allowed.size} allowlisted read(s)).`);
