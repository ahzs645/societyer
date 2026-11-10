import assert from "node:assert/strict";
import { CatalogAccess } from "../src/features/procurementReview/reader/catalogAccess";

let grants = 0, reads = 0;
const mint = async () => { grants++; await Promise.resolve(); return { token: "fixture-" + grants, expiresAt: Date.now() + 600_000, baseUrl: "https://catalog.example.test" }; };
const client = new CatalogAccess("fixture", "https://catalog.example.test", mint, (async (url, init) => {
  reads++; assert.equal(String(url), "https://catalog.example.test/v1/fixture/catalog"); assert.equal(init?.credentials, "omit"); assert.equal(init?.redirect, "error");
  return Response.json({ ok: true });
}) as typeof fetch);
await Promise.all([client.read("/catalog"), client.read("/catalog")]); assert.equal(grants, 1, "Concurrent loads deduplicate the grant"); assert.equal(reads, 2);
client.close(); await assert.rejects(client.read("/catalog")); assert.equal(reads, 2, "Closing a workspace reader prevents further requests");
let attempts = 0;
const refresh = new CatalogAccess("fixture", "https://catalog.example.test", mint, (async () => { attempts++; return attempts === 1 ? new Response("expired", { status: 401 }) : Response.json({ ok: true }); }) as typeof fetch);
await refresh.read("/catalog"); assert.equal(attempts, 2); assert.equal(grants, 3); refresh.close();
attempts = 0;
const denied = new CatalogAccess("fixture", "https://catalog.example.test", mint, (async () => { attempts++; return new Response("denied", { status: 403 }); }) as typeof fetch);
await assert.rejects(denied.read("/catalog"), /403/); assert.equal(attempts, 1); denied.close();
let leaked = false;
const wrong = new CatalogAccess("fixture", "https://catalog.example.test", async () => ({ token: "must-not-leave", expiresAt: Date.now() + 600_000, baseUrl: "https://wrong.example.test" }), (async () => { leaked = true; return Response.json({}); }) as typeof fetch);
await assert.rejects(wrong.read("/catalog"), /another service/); assert.equal(leaked, false); wrong.close();
let almostExpiredMints = 0;
const early = new CatalogAccess("fixture", "https://catalog.example.test", async () => ({ token: "early-" + ++almostExpiredMints, expiresAt: Date.now() + (almostExpiredMints === 1 ? 100_000 : 600_000), baseUrl: "https://catalog.example.test" }), (async () => Response.json({})) as typeof fetch);
await early.read("/catalog"); await early.read("/catalog"); assert.equal(almostExpiredMints, 2, "Refresh before the final 20 percent of a grant's lifetime"); early.close();
console.log("Catalog client checks passed: in-memory scope, concurrent grant reuse, early refresh, one 401 retry, no 403 retry, service binding and workspace-close cancellation.");
