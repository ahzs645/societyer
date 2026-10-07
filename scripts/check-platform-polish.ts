/**
 * Shared-UI polish gate (WP-A): French catalogue parity, translated navigation,
 * pluralisation, and the shared floating-layer outside-click selector.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import en from "../src/i18n/locales/en.json";
import fr from "../src/i18n/locales/fr.json";
import { ROUTE_IDENTITY } from "../src/lib/routeIdentity";
import { pluralize } from "../src/lib/format";
import { FLOATING_LAYER_SELECTOR } from "../src/lib/floatingLayer";
import { NAV_ITEM_LABEL_KEYS, translateNavLabel } from "../src/i18n/navLabels";
import { formatDocumentTitle } from "../src/lib/documentTitle";

type Catalog = { [key: string]: string | Catalog };
function flatten(catalog: Catalog, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(catalog)) {
    if (typeof value === "string") out.set(prefix + key, value);
    else for (const [k, v] of flatten(value, `${prefix}${key}.`)) out.set(k, v);
  }
  return out;
}
const enKeys = flatten(en as Catalog);
const frKeys = flatten(fr as Catalog);
assert.deepEqual([...enKeys.keys()].filter((key) => !frKeys.has(key)), [], "every English key needs a French translation");
assert.deepEqual([...frKeys.keys()].filter((key) => !enKeys.has(key)), [], "French keys must exist in English");
for (const [key, value] of frKeys) assert.ok(value.trim(), `fr ${key} is empty`);
for (const [key, value] of enKeys) {
  const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(",");
  assert.equal(placeholders(frKeys.get(key)!), placeholders(value), `fr ${key} must keep the same {{placeholders}}`);
}

// Every sidebar/palette route label resolves to a catalogue key.
const mapped = new Map(Object.entries(NAV_ITEM_LABEL_KEYS));
const labels = new Set<string>();
for (const identity of Object.values(ROUTE_IDENTITY) as Array<{ label: string; labelByEntityKind?: Record<string, string> }>) {
  labels.add(identity.label);
  for (const label of Object.values(identity.labelByEntityKind ?? {})) labels.add(label);
}
const untranslated = [...labels].filter((label) => !mapped.has(label));
assert.deepEqual(untranslated, [], "navigation labels without a translation key");
for (const [label, key] of mapped) {
  assert.ok(enKeys.has(key), `${label} maps to missing key ${key}`);
  assert.ok(frKeys.has(key), `${label} maps to ${key}, missing in French`);
}
for (const group of ["workspace", "people", "work", "meetings", "records", "compliance", "finance", "workflows", "advanced", "administration"]) {
  assert.ok(frKeys.has(`nav.${group}`), `sidebar group ${group} needs nav.${group}`);
}

assert.equal(pluralize(1, "record"), "1 record");
assert.equal(pluralize(0, "record"), "0 records");
assert.equal(pluralize(2, "comment"), "2 comments");
assert.equal(pluralize(1, "policy", "policies"), "1 policy");
assert.equal(pluralize(1200, "record"), "1,200 records");

for (const selector of ["[data-floating-layer]", ".menu", ".calendar", ".menu-backdrop"]) {
  assert.ok(FLOATING_LAYER_SELECTOR.includes(selector), `floating layers must include ${selector}`);
}

// Page headers translate their sidebar label (the page heading matches the
// sidebar entry in French) and leave free text such as record names alone.
const frLookup = (key: string, fallback: string) => frKeys.get(key) ?? fallback;
assert.equal(translateNavLabel(frLookup, "Dashboard"), frKeys.get("nav.dashboard"));
assert.notEqual(translateNavLabel(frLookup, "Dashboard"), "Dashboard");
assert.equal(translateNavLabel(frLookup, "Q2 board meeting"), "Q2 board meeting");
// Every page names the browser tab after itself.
assert.equal(formatDocumentTitle("Members"), "Members · Societyer");
assert.equal(formatDocumentTitle("  "), "Societyer");
const helpers = readFileSync(new URL("../src/pages/_helpers.tsx", import.meta.url), "utf8");
assert.match(helpers, /useDocumentTitle\(/, "the shared PageHeader sets the document title");
assert.match(helpers, /translateNavLabel\(t, title\)/, "the shared PageHeader translates sidebar labels");
const moduleGate = readFileSync(new URL("../src/components/ModuleGate.tsx", import.meta.url), "utf8");
assert.match(moduleGate, /\/app\/settings\?tab=modules/, "a disabled module links straight to the Modules tab");
// A module that gates a route also hides its sidebar/palette entry, and the
// other way round: otherwise a nav item opens a "module is disabled" card.
const mainSource = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
const gatedRoutes = new Map([...mainSource.matchAll(/path="([^"]+)"\s*element=\{withModule\("(\w+)"/g)].map((m) => [`/app/${m[1]}`, m[2]]));
assert.ok(gatedRoutes.size > 20, "found the module-gated routes in main.tsx");
for (const [path, module] of gatedRoutes) {
  const identity = (ROUTE_IDENTITY as Record<string, { module?: string }>)[path];
  if (identity) assert.equal(identity.module, module, `${path} is gated by ${module} in main.tsx; its nav identity must use the same module`);
}
for (const [path, identity] of Object.entries(ROUTE_IDENTITY as Record<string, { module?: string }>)) {
  if (identity.module && !path.includes(":")) assert.equal(gatedRoutes.get(path), identity.module, `${path} is hidden with ${identity.module}; its route must be gated by it too`);
}

// Destructive platform actions name what is lost before they run.
const calendarSync = readFileSync(new URL("../src/pages/CalendarSync.tsx", import.meta.url), "utf8");
assert.match(calendarSync, /const disableFeed = async \(\) => \{[\s\S]{0,120}await confirm\(/, "disabling the calendar feed is confirmed");
assert.match(calendarSync, /const enableFeed = async \(\) => \{[\s\S]{0,160}feedToken && !\(await confirm\(/, "rotating the calendar feed link is confirmed");
const aiAgents = readFileSync(new URL("../src/pages/AiAgents.tsx", import.meta.url), "utf8");
assert.match(aiAgents, /await confirm\(\{\s*title: `Delete the skill[\s\S]{0,900}await removeSkill\(/, "deleting an AI skill is confirmed");

// Stack-on-phone tables must beat the more specific scrolling-table rules.
const tableCss = readFileSync(new URL("../src/styles/_components-tables-misc.scss", import.meta.url), "utf8");
assert.match(tableCss, /\.table-wrap > \.table\.table--stack-mobile/, "stacked phone tables override .table-wrap > .table");
assert.match(tableCss, /\.table-scroll > \.table\.table--stack-mobile/, "stacked phone tables override .table-scroll > .table");

console.log(`PASS: ${frKeys.size} French keys in parity, ${labels.size} navigation labels translated, pluralisation and floating-layer selector`);
