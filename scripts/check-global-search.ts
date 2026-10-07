/**
 * Global search (command palette, `firm:search`): covers meetings, minutes,
 * motions, members/people, tasks, committees, grants, policies, insurance and
 * filings, and every hit routes to the record itself (ui-operations M8).
 * Exercised through the static mirror over the seeded demo workspace.
 */
import assert from "node:assert/strict";
import { StaticConvexClient } from "../src/lib/staticConvex";
import { searchFold, searchMatches } from "../shared/functions/firm";

assert.equal(searchFold("Café Société"), "cafe societe");
assert.equal(searchMatches("youth grant", ["Youth resilience grant"]), true, "every term must match, in any order");
assert.equal(searchMatches("youth budget", ["Youth resilience grant"]), false);
assert.equal(searchMatches("  ", ["anything"]), false);
assert.equal(searchMatches("mina", [["Avery", "Mina Patel"]]), true, "array fields are searched");

const client = new StaticConvexClient({ databaseName: `societyer-static-search-${Date.now()}` });
type Hit = { kind: string; id: string; title: string; subtitle?: string; to: string };
const search = async (query: string) => (await client.query("firm:search", { query })) as Hit[];

assert.deepEqual(await search("a"), [], "single characters do not search");

const expectations: Array<{ query: string; kind: string; route: RegExp }> = [
  { query: "Northbridge", kind: "insurance", route: /^\/app\/insurance\/[^/?]+$/ },
  { query: "Youth resilience", kind: "grant", route: /^\/app\/grants\/[^/?]+$/ },
  { query: "Mina Patel", kind: "member", route: /^\/app\/members\/[^/?]+$/ },
  { query: "annual general meeting", kind: "meeting", route: /^\/app\/meetings\/[^/?]+$/ },
  { query: "annual general meeting", kind: "minutes", route: /^\/app\/meetings\/[^/?]+\?tab=minutes$/ },
  { query: "Current bylaws", kind: "document", route: /^\/app\/documents\/[^/?]+$/ },
  { query: "Governance committee", kind: "committee", route: /^\/app\/committees\/[^/?]+$/ },
  { query: "Prepare 2026", kind: "task", route: /^\/app\/tasks\?record=[^&]+$/ },
  { query: "director slate", kind: "filing", route: /^\/app\/filings\?record=[^&]+$/ },
  { query: "Conflict of Interest", kind: "policy", route: /^\/app\/policies$/ },
];
for (const { query, kind, route } of expectations) {
  const hits = await search(query);
  const hit = hits.find((row) => row.kind === kind);
  assert.ok(hit, `"${query}" should find a ${kind}; got ${JSON.stringify(hits.map((row) => row.kind))}`);
  assert.match(hit.to, route, `${kind} hit should open the record, got ${hit.to}`);
  assert.ok(hit.title.trim(), `${kind} hit needs a title`);
}

// Motions: search by the text of any seeded motion.
const motions = (await client.query("motions:list", { societyId: (await client.query("society:list", {}))[0]._id })) as any[];
if (motions.length) {
  const words = String(motions[0].text).split(/\s+/).filter((word) => word.length > 4).slice(0, 2).join(" ");
  const hit = (await search(words)).find((row) => row.kind === "motion");
  assert.ok(hit, `motion text "${words}" should be searchable`);
  assert.match(hit.to, /^\/app\/motions\?record=/);
}

console.log("PASS: global search covers meetings, minutes, motions, members, tasks, committees, grants, policies, insurance and filings with record routes");
