import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { StaticConvexClient } from "../src/lib/staticConvex";
import { STATIC_DEMO_SOCIETY_ID } from "../src/lib/staticIds";
import { STATIC_DEMO_SEED } from "../src/lib/staticDemoStore";
import { activeBookkeepingConnection } from "../src/features/financials/lib/waveResources";

const native = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./authorization.js": () => import("../convex/authorization"),
  "./financialHub.js": () => import("../convex/financialHub"),
});
const issuer = betterAuthIssuer();
const fixture = await native.run(async (ctx) => {
  const societyId = await ctx.db.insert("societies", { name: "Connection state", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const foreignSocietyId = await ctx.db.insert("societies", { name: "Foreign connection", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  for (const [subject, role] of [["connection-admin", "Admin"], ["connection-member", "Member"]]) {
    await ctx.db.insert("users", { societyId, displayName: subject, email: `${subject}@fixture.example`, role, status: "Active", authIssuer: issuer, authSubject: subject, createdAtISO: new Date().toISOString() });
  }
  const connectionId = await ctx.db.insert("financialConnections", { societyId, provider: "wave", status: "connected", demo: true, connectedAtISO: new Date().toISOString() });
  const foreignId = await ctx.db.insert("financialConnections", { societyId: foreignSocietyId, provider: "wave", status: "connected", demo: true, connectedAtISO: new Date().toISOString() });
  return { connectionId, foreignId };
});
const admin = native.withIdentity({ issuer, subject: "connection-admin" });
const member = native.withIdentity({ issuer, subject: "connection-member" });
await assert.rejects(() => member.mutation(api.financialHub.disconnect, { connectionId: fixture.connectionId }));
await assert.rejects(() => admin.mutation(api.financialHub.disconnect, { connectionId: fixture.foreignId }));
assert.equal((await native.run((ctx) => ctx.db.get(fixture.foreignId)))!.status, "connected");
await admin.mutation(api.financialHub.disconnect, { connectionId: fixture.connectionId });
assert.equal((await native.run((ctx) => ctx.db.get(fixture.connectionId)))!.status, "disconnected");

const local = new StaticConvexClient();
try {
  const connections = await local.query("financialHub:connections", { societyId: STATIC_DEMO_SOCIETY_ID }) as any[];
  const connection = connections.find((row) => row.provider === "wave");
  assert.ok(connection);
  const accounts = await local.query("financialHub:accounts", { societyId: STATIC_DEMO_SOCIETY_ID });
  await local.mutation("financialHub:disconnect", { connectionId: connection._id });
  assert.equal((await local.query("financialHub:connections", { societyId: STATIC_DEMO_SOCIETY_ID }) as any[]).find((row) => row._id === connection._id).status, "disconnected");
  const reconnectedId = await local.mutation("financialHub:markConnectionConnected", { societyId: STATIC_DEMO_SOCIETY_ID, provider: "wave", accountLabel: "Demo reconnect", demo: true });
  assert.equal(reconnectedId, connection._id);
  const reconnected = (await local.query("financialHub:connections", { societyId: STATIC_DEMO_SOCIETY_ID }) as any[]).find((row) => row._id === connection._id);
  assert.equal(reconnected.status, "connected");
  assert.equal(reconnected.syncMode, "demo");
  assert.deepEqual(await local.query("financialHub:accounts", { societyId: STATIC_DEMO_SOCIETY_ID }), accounts, "disconnect/reconnect must retain existing cached records");
  await assert.rejects(() => local.mutation("financialHub:markConnectionConnected", { societyId: STATIC_DEMO_SOCIETY_ID, provider: "wave", demo: false }), /Live Wave connections require/);
  await assert.rejects(() => local.mutation("financialHub:markConnectionConnected", { societyId: STATIC_DEMO_SOCIETY_ID, provider: "other-provider", demo: true }), /Wave provider only/);
  // A manual bank account adds its own "connected" grouping row; Wave's
  // controls must stay on the Wave row and vanish once Wave is disconnected.
  await local.mutation("bankAccounts:createManualAccount", { societyId: STATIC_DEMO_SOCIETY_ID, name: "Petty cash tin", kind: "cash", openingBalanceCents: 0, openingDate: "2026-01-01" });
  const withManual = await local.query("financialHub:connections", { societyId: STATIC_DEMO_SOCIETY_ID }) as Array<{ _id: string; provider: string; status: string }>;
  assert.ok(withManual.some((row) => row.provider === "manual" && row.status === "connected"));
  assert.equal(activeBookkeepingConnection(withManual)?._id, connection._id);
  assert.equal(activeBookkeepingConnection([...withManual].reverse())?._id, connection._id, "row order must not hand Wave's controls to the manual row");
  await local.mutation("financialHub:disconnect", { connectionId: connection._id });
  const afterDisconnect = await local.query("financialHub:connections", { societyId: STATIC_DEMO_SOCIETY_ID }) as Array<{ provider: string; status: string }>;
  assert.equal(activeBookkeepingConnection(afterDisconnect), undefined, "manual or internal rows are not a bookkeeping feed");
  assert.equal(activeBookkeepingConnection([{ provider: "societyer", status: "connected" }, { provider: "demo", status: "connected" }])?.provider, "demo");
  const ordinary = await local.mutation("society:createWorkspace", { name: "Ordinary local workspace", fiscalYearEnd: "12-31" }) as any;
  await assert.rejects(() => local.mutation("financialHub:markConnectionConnected", { societyId: ordinary.societyId, provider: "wave", demo: true }), /demo workspace/);
} finally {
  local.close();
}
const importedLive = new StaticConvexClient({ seed: {
  ...STATIC_DEMO_SEED,
  financialConnections: [{ _id: "imported-live-wave", societyId: STATIC_DEMO_SOCIETY_ID, provider: "wave", status: "disconnected", demo: false, connectedAtISO: new Date().toISOString(), accountLabel: "Imported live connection" }],
} });
try {
  await assert.rejects(() => importedLive.mutation("financialHub:markConnectionConnected", { societyId: STATIC_DEMO_SOCIETY_ID, provider: "wave", demo: true }), /live connection cannot be changed/);
  const rows = await importedLive.query("financialHub:connections", { societyId: STATIC_DEMO_SOCIETY_ID }) as any[];
  assert.equal(rows[0].demo, false);
  assert.equal(rows[0].status, "disconnected");
  assert.equal(rows[0].accountLabel, "Imported live connection");
} finally { importedLive.close(); }
console.log("Financial connection state passed: actual local disconnect/demo reconnect retain cached records; manual bank rows never take the provider controls; hosted Member and foreign-workspace writes are denied; local live-provider and non-demo setup are rejected.");
