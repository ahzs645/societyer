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
const layout = readFileSync(new URL("../src/components/Layout.internal.tsx", import.meta.url), "utf8");
const start = layout.indexOf("const NAV_ITEM_LABEL_KEYS");
const block = layout.slice(start, layout.indexOf("};", start));
const mapped = new Map([...block.matchAll(/^\s+(?:"([^"]+)"|([A-Za-z]+)): "([^"]+)"/gm)].map((m) => [m[1] ?? m[2], m[3]]));
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

console.log(`PASS: ${frKeys.size} French keys in parity, ${labels.size} navigation labels translated, pluralisation and floating-layer selector`);
