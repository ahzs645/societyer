import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { ConvexHttpClient, ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { importJWK, SignJWT, generateKeyPair } from "jose";

process.loadEnvFile(new URL("../.env.local", import.meta.url));
const url = process.env.CONVEX_SELF_HOSTED_URL;
const adminKey = process.env.CONVEX_SELF_HOSTED_ADMIN_KEY;
if (url !== "http://127.0.0.1:43210" || !adminKey?.startsWith("societyer-offline-pilot|")) throw new Error("Local pilot target required.");
const issuer = "http://127.0.0.1:43212";
const jwk = JSON.parse(readFileSync(new URL("../.env.signer.local", import.meta.url), "utf8"));
const key = await importJWK(jwk, "ES256");
const run = randomUUID();
const admin = new ConvexHttpClient(url, { logger: false });
admin.setAdminAuth(adminKey);
const ref = (name) => makeFunctionReference(name);
const internal = (name, args) => admin.function(ref(name), undefined, args);
const ids = await internal("localPilotAdmin:seed", { issuer, run });
async function token(actor, options = {}) {
  return new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: jwk.kid }).setSubject(`${actor}-${run}`)
    .setIssuer(options.issuer ?? issuer).setAudience(options.audience ?? issuer).setIssuedAt()
    .setExpirationTime(options.expiration ?? "5m").sign(options.key ?? key);
}
async function client(actor, options) {
  const value = new ConvexHttpClient(url, { logger: false });
  if (actor) value.setAuth(await token(actor, options));
  return value;
}
const owner = await client("owner-a"), viewer = await client("viewer-a"), foreign = await client("owner-b"), anonymous = await client();
const keys = Object.fromEntries(["meeting", "minutes", "agenda", "item", "document", "material"].map(name => [name, randomUUID()]));
const bytes = Buffer.from("A real local Convex attachment\n");
const command = { version: 1, operationId: randomUUID(), meetingUuid: keys.meeting, baseRevision: 0, kind: "create-meeting", keys,
  title: "Local Convex preparation", scheduledAt: "2026-11-15T10:00:00Z", notes: "Native backend", agendaTitle: "Review preparation",
  file: { name: "preparation.txt", mime: "text/plain", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } };
const args = { societyId: ids.societyA, command };
const apply = (who, value = args) => who.mutation(ref("offlineMeetings:applyCommand"), value);
const snapshot = (who = owner) => who.query(ref("offlineMeetings:authorizedSnapshot"), { societyId: ids.societyA });
const results = [];
async function check(name, body) { await body(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
let accepted;
await check("Signed ES256 JWT is verified and bound to workspace membership", async () => {
  assert.deepEqual(await owner.query(ref("offlineMeetings:syncIdentity"), { societyId: ids.societyA }), { actorKey: `${issuer}|owner-a-${run}`, societyId: ids.societyA });
});
await check("Anonymous callers cannot invoke admin-only fixtures or business commands", async () => {
  await assert.rejects(() => apply(anonymous), /membership not found|authenticated/i);
  await assert.rejects(() => anonymous.mutation(ref("localPilotAdmin:seed"), { issuer, run: randomUUID() }));
});
await check("Forged signatures, expired JWTs, wrong issuer and wrong audience are denied", async () => {
  const fakeKey = (await generateKeyPair("ES256")).privateKey;
  for (const options of [{ key: fakeKey }, { expiration: Math.floor(Date.now() / 1000) - 120 }, { issuer: "http://127.0.0.1:43213" }, { audience: "foreign-audience" }]) {
    await assert.rejects(() => client("owner-a", options).then(value => apply(value)));
  }
});
await check("Owner command creates the real meeting/agenda/minutes/attachment graph atomically", async () => {
  accepted = await apply(owner); assert.equal(accepted.revision, 1); assert.equal(accepted.mappings.length, 6);
  const state = await internal("localPilotAdmin:inspect", { societyId: ids.societyA });
  assert.equal(state.meetings.length, 1); assert.equal(state.aggregates[0].updatedByUserId, ids.users["owner-a"]);
});
await check("Lost acknowledgement replay has one durable effect and stable ID mappings", async () => {
  const replay = await apply(owner); assert.equal(replay.replay, true); assert.deepEqual(replay.mappings, accepted.mappings);
  assert.equal((await internal("localPilotAdmin:inspect", { societyId: ids.societyA })).meetings.length, 1);
});
await check("Changed replay payload is rejected", async () => {
  await assert.rejects(() => apply(owner, { ...args, command: { ...command, title: "Substituted" } }), /REPLAY_MISMATCH/);
});
await check("Viewer retains allowed reads but cannot upload commands", async () => {
  assert.equal((await snapshot(viewer)).length, 1);
  assert.equal((await snapshot(viewer))[0].files.length, 0);
  await assert.rejects(() => apply(viewer), /Permission meetings:write/);
});
await check("Foreign workspace reads, uploads and role changes are denied", async () => {
  await assert.rejects(() => snapshot(foreign), /membership not found/i);
  await assert.rejects(() => apply(foreign), /membership not found/i);
  await assert.rejects(() => foreign.mutation(ref("users:setRole"), { id: ids.users["viewer-a"], role: "Owner" }), /membership not found|authorized|permission/i);
});
await check("Stale revisions cannot overwrite accepted preparation", async () => {
  await assert.rejects(() => apply(owner, { ...args, command: { version: 1, operationId: randomUUID(), meetingUuid: keys.meeting, baseRevision: 0, kind: "edit-meeting", title: "Stale", notes: "" } }), /REVISION_CONFLICT/);
  assert.equal((await snapshot())[0].title, command.title);
});
await check("Per-principal projections match authorized snapshots", async () => {
  for (const value of [owner, viewer]) {
    const rows = await value.query(ref("offlineMeetings:downloads"), { societyId: ids.societyA });
    assert.deepEqual(rows.map(row => JSON.parse(row.payload)), await snapshot(value));
    assert.equal(rows[0].society_id, ids.societyA);
  }
});
async function upload(content) {
  const uploadUrl = await owner.mutation(ref("offlineMeetings:prepareFileUpload"), { societyId: ids.societyA });
  const response = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "text/plain" }, body: content });
  assert.equal(response.ok, true); return (await response.json()).storageId;
}
await check("Native file upload verifies content hash before linking metadata", async () => {
  for (const value of [viewer, foreign, anonymous]) {
    await assert.rejects(() => value.mutation(ref("offlineMeetings:prepareFileUpload"), { societyId: ids.societyA }));
  }
  const bad = await upload(Buffer.from("wrong bytes"));
  await assert.rejects(() => owner.mutation(ref("offlineMeetings:commitFile"), { societyId: ids.societyA, meetingUuid: keys.meeting, storageId: bad }), /FILE_HASH_MISMATCH/);
  const storageId = await upload(bytes);
  await owner.mutation(ref("offlineMeetings:commitFile"), { societyId: ids.societyA, meetingUuid: keys.meeting, storageId });
  const replay = await owner.mutation(ref("offlineMeetings:commitFile"), { societyId: ids.societyA, meetingUuid: keys.meeting, storageId });
  assert.equal(replay.storageId, storageId); assert.equal((await snapshot())[0].files[0].available, true);
  const downloadId = await owner.query(ref("offlineMeetings:fileForDownload"), { societyId: ids.societyA, meetingUuid: keys.meeting });
  const downloadUrl = await owner.query(ref("files:getUrl"), { storageId: downloadId });
  assert.deepEqual(Buffer.from(await (await fetch(downloadUrl)).arrayBuffer()), bytes);
  await assert.rejects(() => viewer.query(ref("files:getUrl"), { storageId }), /access|permission|authorized|not found/i);
});
await check("Two independently authenticated WebSocket clients observe committed child edits", async () => {
  const clients = [new ConvexClient(url, { logger: false }), new ConvexClient(url, { logger: false })];
  const subscribers = [];
  try {
    for (const value of clients) value.setAuth(() => token("owner-a"));
    const observations = clients.map(value => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for live Convex subscription")), 15000);
      subscribers.push(value.onUpdate(ref("offlineMeetings:authorizedSnapshot"), { societyId: ids.societyA }, rows => {
        if (rows[0]?.discussion === "Live child edit") { clearTimeout(timer); resolve(rows); }
      }, error => { clearTimeout(timer); reject(error); }));
    }));
    await apply(owner, { ...args, command: { version: 1, operationId: randomUUID(), meetingUuid: keys.meeting, baseRevision: 1, kind: "edit-minutes", discussion: "Live child edit" } });
    await Promise.all(observations);
  } finally { subscribers.forEach(unsubscribe => unsubscribe()); await Promise.all(clients.map(value => value.close())); }
});
await check("Last active Owner cannot be demoted, removed or ordinarily disabled", async () => {
  await assert.rejects(() => owner.mutation(ref("users:setRole"), { id: ids.users["owner-a"], role: "Viewer" }), /last Active Owner/);
  await assert.rejects(() => owner.mutation(ref("users:remove"), { id: ids.users["owner-a"] }), /last Active Owner/);
  await assert.rejects(() => owner.mutation(ref("users:upsert"), { id: ids.users["owner-a"], societyId: ids.societyA, email: "owner-a@example.test", displayName: "owner-a", role: "Owner", status: "Disabled" }), /last Active Owner/);
});
await check("Viewer cannot grant themselves Owner authority", async () => {
  await assert.rejects(() => viewer.mutation(ref("users:setRole"), { id: ids.users["viewer-a"], role: "Owner" }), /role|permission|authorized/i);
});
await check("Promoting another Owner allows demotion; current roles gate even receipt replays", async () => {
  await owner.mutation(ref("users:setRole"), { id: ids.users["viewer-a"], role: "Owner" });
  await owner.mutation(ref("users:setRole"), { id: ids.users["owner-a"], role: "Viewer" });
  await assert.rejects(() => apply(owner), /Permission meetings:write/);
});
await check("Disabled membership denies reads and automatically removes its projection", async () => {
  await viewer.mutation(ref("users:securityDisable"), { id: ids.users["owner-a"], reason: "Local pilot revocation check" });
  await assert.rejects(() => snapshot(owner), /disabled/i);
  const state = await internal("localPilotAdmin:inspect", { societyId: ids.societyA });
  assert.equal(state.downloads.some(row => row.actor_key === `${issuer}|owner-a-${run}`), false);
});
writeFileSync(new URL("../../../artifacts/offline/local-convex-results.json", import.meta.url), JSON.stringify({
  completedAt: new Date().toISOString(), endpoint: url, image: "ghcr.io/get-convex/convex-backend@sha256:d715e9ec088784407ca4ba2d3db592702cd328d02c76cdca3852c0018f2a76b4",
  auth: "Local ES256 test signer with real Convex JWT verification; production identity/membership policies",
  passed: results.length, results,
  limitations: ["No live Clerk or tenant-restricted Microsoft login flow exercised", "PowerSync service/download replication not exercised by this test", "Supported pilot user-role/status/removal mutations refresh projections automatically; other document ACL/external identity/expiry pathways remain outside this qualification", "Local cloud-workspace instance, not the user's Mac or Zoer host"],
}, null, 2) + "\n");
console.log(`${results.length} live local Convex checks passed.`);
