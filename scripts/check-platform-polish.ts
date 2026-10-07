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
import { openableExternalUrl } from "../src/lib/externalUrl";
import { parseTypedDate } from "../src/lib/typedDate";
import { userDisplayName } from "../shared/functions/users";
import { newSocietyOwnerFields } from "../shared/functions/society";

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

// O-3: functions the local mirror serves on purpose are classified in the
// portable manifest, and the local client only warns for unclassified ones.
const manifest = JSON.parse(readFileSync(new URL("../shared/functions/portable-manifest.json", import.meta.url), "utf8"));
for (const name of ["society:createWorkspace", "workflows:get", "workflows:listCatalog"]) {
  const entry = manifest.functions.find((fn: { name: string }) => fn.name === name);
  assert.equal(entry?.classification, "static-fallback", `${name} is classified static-fallback`);
}
const staticClient = readFileSync(new URL("../src/lib/staticConvexClient.ts", import.meta.url), "utf8");
assert.match(staticClient, /known\.has\(name\)\)\s*\{\s*console\.debug/, "classified static fallbacks are logged at debug level");

// O-4: Vue feature flags for Milkdown's toolbar are defined at build time.
const viteConfig = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
for (const flag of ["__VUE_OPTIONS_API__", "__VUE_PROD_DEVTOOLS__", "__VUE_PROD_HYDRATION_MISMATCH_DETAILS__"]) {
  assert.match(viteConfig, new RegExp(`${flag}:`), `vite define sets ${flag}`);
}

// O-9: typed date entry in the shared date picker.
const typedOk = (text: string, bounds?: { min?: string; max?: string }) => {
  const result = parseTypedDate(text, bounds);
  return result.ok ? result.value : `ERR ${result.error}`;
};
assert.equal(typedOk("2012-03-04"), "2012-03-04");
assert.equal(typedOk("1998/3/4"), "1998-03-04");
assert.equal(typedOk("19980304"), "1998-03-04");
assert.equal(typedOk("4 March 2012"), "2012-03-04");
assert.equal(typedOk("March 4, 2012"), "2012-03-04");
assert.equal(typedOk("4 mars 2012"), "2012-03-04");
assert.equal(typedOk("1er janvier 2001"), "2001-01-01");
assert.match(typedOk("2023-02-29"), /^ERR .*not a calendar date/);
assert.match(typedOk("03/04/2012"), /^ERR Day\/month order is ambiguous/);
assert.match(typedOk("soon"), /^ERR /);
assert.match(typedOk("2001-01-01", { min: "2005-01-01" }), /^ERR The date must be on or after 2005-01-01/);
const datePicker = readFileSync(new URL("../src/components/DatePicker.tsx", import.meta.url), "utf8");
assert.match(datePicker, /parseTypedDate\(typed, \{ min, max \}\)/, "the date picker validates typed dates against its bounds");

// Sidebar counts say what they count and hide a misleading "Meetings 0".
const layoutInternal = readFileSync(new URL("../src/components/Layout.internal.tsx", import.meta.url), "utf8");
assert.match(layoutInternal, /case "\/app\/meetings": return counts\.meetingsThisYear \|\| null;/);
assert.match(layoutInternal, /className="sr-only">, \{description\}/, "count badges carry an announced description");
assert.match(layoutInternal, /"meeting this year", "meetings this year"/);

// Users always have a visible name (a blank privacy-officer name left the
// sidebar user button and Users table empty).
assert.equal(userDisplayName({ displayName: "  ", email: "office@example.org" }), "office@example.org");
assert.equal(userDisplayName({ displayName: "Ada" }), "Ada");
assert.equal(userDisplayName({}), "Unnamed user");
assert.equal(
  newSocietyOwnerFields({ kind: "system" } as any, { societyId: "s", placeholderEmail: "o@example.org", placeholderDisplayName: "", createdAtISO: "2026-01-01" }).displayName,
  "Owner",
  "a workspace created without an owner name still names its Owner",
);

// Settings → Restore validates the whole backup before the replace prompt.
const storageCard = readFileSync(new URL("../src/components/WorkspaceStorageCard.tsx", import.meta.url), "utf8");
assert.ok(storageCard.indexOf("readWorkspaceBackupFile(file)") > -1 && storageCard.indexOf("readWorkspaceBackupFile(file)") < storageCard.indexOf('title: "Restore this backup?"'), "the backup is read and validated before the restore confirmation");

// Integration links only become anchors when a browser can open them.
assert.equal(openableExternalUrl("demo://paperless/1001"), null, "placeholder schemes are not links");
assert.equal(openableExternalUrl("javascript:alert(1)"), null);
assert.equal(openableExternalUrl(" https://paperless.example.org/documents/12/ "), "https://paperless.example.org/documents/12/");

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
