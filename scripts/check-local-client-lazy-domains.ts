/**
 * SU-11: the local data client loads heavy handler domains and Dexie on first
 * use instead of in its boot chunk (the localDashboard bundle budget). This gate
 * pins the lazy loading in place and checks its semantics; the size itself is
 * checked by test:frontend-bundle-budget on a build.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lazyHandlers } from "../shared/portable/lazyHandlers";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";

const registry = readFileSync("shared/functions/registry.ts", "utf8");
const LAZY_DOMAINS = [
  "intake", "intakeReview", "importSessions", "importReviewQueue", "rosterPromotion", "minutesReview", "financialReview",
  "organizationHistory", "continuity", "representationGaps", "legalDocuments", "legalRecords", "filingBot", "accounting",
  "inventoryHub", "minuteBook", "evidenceRegisters", "elections", "assets", "grants", "fundingSources", "aiAgents",
  "motionBacklog", "documentCatalog", "seedRecordTableMetadata", "minutesRepair", "meetingMerge", "pathways", "workflows", "firm",
];
for (const domain of LAZY_DOMAINS) {
  assert.match(registry, new RegExp(`lazyHandlers\\(\\(\\) => import\\("\\./${domain}"\\)`), `${domain} handlers load on first call`);
  assert.doesNotMatch(registry, new RegExp(`^import [^;]* from ["']\\./${domain}["'];`, "m"), `${domain} is not statically imported by the registry`);
}
const rowStore = readFileSync("src/lib/localDexieRowStore.ts", "utf8");
assert.doesNotMatch(rowStore, /^import (?!type )[^;]*from "dexie";/m, "the row store does not import Dexie statically");
assert.doesNotMatch(rowStore, /^import \{[^}]*\bLocalDexieDatabase\b[^}]*\} from "\.\/localDexieDatabase";/m, "the vault schema loads with the vault");
assert.match(rowStore, /import\("\.\/localDexieDatabase"\)/);

// Registry semantics: every entry still names a callable handler, and lazy ones run.
assert.ok(PORTABLE_FUNCTIONS.every((def) => typeof def.handler === "function"), "every registry entry has a handler");
const names = PORTABLE_FUNCTIONS.map((def) => def.name);
assert.equal(new Set(names).size, names.length, "registry names stay unique");
assert.ok(names.includes("intake:listRuns") || names.some((name) => name.startsWith("intake:")), "intake handlers are still registered");

let loads = 0;
let failNext = true;
const lazy = lazyHandlers(async () => {
  loads += 1;
  if (failNext) { failNext = false; throw new Error("chunk fetch failed"); }
  return { double: async (_ctx: unknown, args: { n: number }) => args.n * 2, sync: (_ctx: unknown, args: { n: number }) => args.n + 1 };
}, "test module");
assert.equal((lazy as any).then, undefined, "a lazy module is never mistaken for a promise");
assert.equal(loads, 0, "nothing loads until a handler is called");
await assert.rejects(() => lazy.double({}, { n: 2 }), /chunk fetch failed/);
assert.equal(await lazy.double({}, { n: 2 }), 4, "a failed load is retried on the next call");
assert.equal(await lazy.sync({}, { n: 2 }), 3, "synchronous exports become async handlers");
assert.equal(loads, 2, "the module loads once after success");
assert.equal(lazy.double, lazy.double, "a handler reference is stable");
await assert.rejects(() => (lazy as any).missing({}, {}), /test module has no handler "missing"/);

console.log(`Local client lazy domains: ${LAZY_DOMAINS.length} handler domains and Dexie load on first use; ${names.length} registry entries intact.`);
