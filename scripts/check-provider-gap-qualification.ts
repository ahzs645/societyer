import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID, createHmac } from "node:crypto";
import { makeFunctionReference } from "convex/server";
import { createFixture } from "../experiments/offline-convex/fixture";
import { sendEmail } from "../convex/providers/email";
import { sendSms } from "../convex/providers/sms";
import { createCheckoutSession } from "../convex/providers/billing";
import { testPaperlessConnection, downloadPaperlessDocument, listPaperlessDocuments, uploadDocumentToPaperless, getPaperlessTask } from "../convex/providers/paperless";
import { recordConnectionTestPortable } from "../shared/functions/paperless";
import { toPortableMutationCtx } from "../convex/lib/portable";
import { waveHealthCheck } from "../convex/providers/waveData";
import { writeTrackedReport } from "./lib/writeTrackedReport.mjs";

// Real adapter HTTP against loopback protocol fixtures, never provider accounts.
const envNames = ["PAPERLESS_NGX_URL", "PAPERLESS_SOCIETY_ID", "SOCIETYER_WAVE_WORKSPACE_BINDINGS_JSON", "PAPERLESS_NGX_TOKEN", "RESEND_API_KEY", "RESEND_FROM_EMAIL", "RESEND_FROM", "RESEND_API_BASE_URL", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "TWILIO_MESSAGING_SERVICE_SID", "TWILIO_MESSAGES_API_BASE_URL", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "WAVE_ACCESS_TOKEN", "WAVE_BUSINESS_ID", "WAVE_GRAPHQL_ENDPOINT", "SOCIETYER_OUTBOUND_ALLOW_LOCAL_DEVELOPMENT", "NODE_ENV", "RUSTFS_ENDPOINT", "RUSTFS_ACCESS_KEY", "RUSTFS_SECRET_KEY", "RUSTFS_BUCKET"];
const previousEnv = new Map(envNames.map(name => [name, process.env[name]]));
let mode = "ok";
let requestCount = 0;
const privateToken = randomUUID();
const cases: string[] = [];
const pass = (name: string) => { cases.push(name); console.log(`PASS ${name}`); };
const server = createServer(async (request, response) => {
  requestCount++;
  let body = ""; for await (const chunk of request) body += chunk;
  const url = new URL(request.url!, "http://fixture.invalid");
  response.setHeader("content-type", "application/json");
  if (mode === "network") { request.socket.destroy(); return; }
  if (mode === "failure") { response.statusCode = 503; response.end(JSON.stringify({ error: privateToken })); return; }
  if (mode === "unauthorized") { response.statusCode = 401; response.end(JSON.stringify({ error: privateToken })); return; }
  if (mode === "malformed") { response.end("{}"); return; }
  if (url.pathname === "/emails") { assert.equal(request.headers.authorization, `Bearer ${privateToken}`); response.end(JSON.stringify({ id: "mail-fixture-1" })); return; }
  if (url.pathname === "/sms") { assert.match(String(request.headers.authorization), /^Basic /); response.end(JSON.stringify({ sid: "sms-fixture-1" })); return; }
  if (url.pathname === "/stripe") { assert.equal(request.headers.authorization, `Bearer ${privateToken}`); const form = new URLSearchParams(body); assert.equal(form.get("mode"), "subscription"); response.end(JSON.stringify({ id: "cs_fixture_1", url: "https://checkout.stripe.com/c/pay/cs_fixture_1" })); return; }
  if (url.pathname === "/wave") {
    const input = JSON.parse(body); const connection = { pageInfo: { totalPages: 1, currentPage: 1, totalCount: 1 }, edges: [{ node: { id: "business-fixture", name: "Fixture business", currency: { code: "CAD" } } }] };
    response.end(JSON.stringify({ data: input.query.includes("businesses(") ? { businesses: connection } : { business: { id: "business-fixture", name: "Fixture business", currency: { code: "CAD" }, accounts: connection } } })); return;
  }
  if (url.pathname === "/feed") { response.setHeader("content-type", "application/rss+xml"); response.end('<rss version="2.0"><channel><title>Fixtures</title><item><guid>fixture-grant</guid><title>Fixture grant opportunity</title><link>https://funder.example.test/opportunity</link><description>Fixture funding</description></item></channel></rss>'); return; }
  if (url.pathname.endsWith("/file-fixture")) { response.setHeader("content-type", "text/plain"); response.end("Fixture stored source bytes"); return; }
  assert.equal(request.headers.authorization, `Token ${privateToken}`);
  if (url.pathname === "/api/documents/") {
    const second = url.searchParams.get("page") === "2";
    response.end(JSON.stringify({ count: 2, results: [{ id: second ? 2 : 1, title: second ? "Second fixture" : "First fixture" }], next: mode === "repeating" ? `${base}/api/documents/?page=2` : second ? null : `${base}/api/documents/?page=2` })); return;
  }
  if (url.pathname === "/api/documents/12/") { response.end(JSON.stringify({ id: 12, title: "Fixture file", original_filename: "fixture.txt" })); return; }
  if (url.pathname === "/api/documents/12/download/") { response.setHeader("content-type", "text/plain"); response.end("Fixture actual bytes"); return; }
  if (url.pathname === "/api/documents/post_document/") { response.end(JSON.stringify("task-fixture-1")); return; }
  if (url.pathname === "/api/tasks/") { response.end(JSON.stringify([{ status: "SUCCESS", related_document: 12 }])); return; }
  response.statusCode = 404; response.end("{}");
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (raw === "https://api.stripe.com/v1/checkout/sessions") return originalFetch(`${base}/stripe`, init);
  assert.equal(new URL(raw).origin, base, "Fixture qualification must never contact real providers");
  return originalFetch(input, init);
};
try {
  for (const name of envNames) delete process.env[name];
  await assert.rejects(sendEmail({ to: "recipient@example.test", subject: "Fixture", text: "Fixture" }), /RESEND_API_KEY/);
  await assert.rejects(sendSms({ to: "+15555550199", body: "Fixture" }), /TWILIO_ACCOUNT_SID/);
  const checkout = { priceCents: 1000, currency: "CAD", interval: "month" as const, successUrl: "https://app.example.test/success", cancelUrl: "https://app.example.test/cancel", email: "recipient@example.test" };
  await assert.rejects(createCheckoutSession(checkout), /STRIPE_SECRET_KEY/);
  assert.equal((await testPaperlessConnection()).ok, false);
  await assert.rejects(listPaperlessDocuments(), /PAPERLESS_NGX_URL/);
  assert.equal((await waveHealthCheck()).mode, "not_configured");
  assert.equal(requestCount, 0); pass("unconfigured delivery, billing and Paperless fail closed; Wave reports unavailable without requests");
  assert.equal((await sendEmail({ to: "recipient@example.test", subject: "Fixture", demo: true })).provider, "demo");
  assert.equal((await sendSms({ to: "+15555550199", body: "Fixture", demo: true })).provider, "demo");
  assert.equal((await createCheckoutSession({ ...checkout, demo: true })).provider, "demo");
  assert.equal((await testPaperlessConnection({ demo: true })).demo, true);
  assert.equal(requestCount, 0); pass("explicit simulations never contact providers");
  Object.assign(process.env, { PAPERLESS_NGX_URL: base, PAPERLESS_NGX_TOKEN: privateToken, RESEND_API_KEY: privateToken, RESEND_FROM_EMAIL: "fixture@example.test", RESEND_API_BASE_URL: `${base}/emails`, TWILIO_ACCOUNT_SID: "ACfixture", TWILIO_AUTH_TOKEN: privateToken, TWILIO_FROM_NUMBER: "+15555550198", TWILIO_MESSAGES_API_BASE_URL: `${base}/sms`, STRIPE_SECRET_KEY: privateToken, WAVE_ACCESS_TOKEN: privateToken, WAVE_BUSINESS_ID: "business-fixture", WAVE_GRAPHQL_ENDPOINT: `${base}/wave`, SOCIETYER_OUTBOUND_ALLOW_LOCAL_DEVELOPMENT: "true", NODE_ENV: "test" });
  assert.equal((await sendEmail({ to: "recipient@example.test", subject: "Fixture" })).id, "mail-fixture-1");
  assert.equal((await sendSms({ to: "+15555550199", body: "Fixture" })).id, "sms-fixture-1");
  assert.equal((await createCheckoutSession(checkout)).provider, "stripe");
  assert.equal((await testPaperlessConnection()).documentCount, 2);
  assert.deepEqual((await listPaperlessDocuments()).map(row => row.id), [1, 2]);
  const upload = { blob: new Blob(["Fixture document"]), fileName: "fixture.txt", title: "Fixture", tags: [], autoCreateTags: false };
  assert.equal((await uploadDocumentToPaperless(upload)).taskId, "task-fixture-1");
  assert.equal((await getPaperlessTask("task-fixture-1")).documentId, 12);
  const downloaded = await downloadPaperlessDocument(12);
  assert.equal(await downloaded.blob.text(), "Fixture actual bytes");
  assert.equal(downloaded.documentUrl, `${base}/documents/12/details`);
  assert.equal(downloaded.demo, false);
  assert.equal((await waveHealthCheck()).ok, true); pass("configured adapters authenticate and parse local HTTP protocol success, Paperless pagination/upload/task and Wave GraphQL");
  for (const failure of ["failure", "unauthorized", "network", "malformed"]) {
    mode = failure;
    for (const work of [() => sendEmail({ to: "recipient@example.test", subject: "Fixture" }), () => sendSms({ to: "+15555550199", body: "Fixture" }), () => createCheckoutSession(checkout), () => uploadDocumentToPaperless(upload)]) {
      await assert.rejects(work(), error => !String(error).includes(privateToken));
    }
    assert.equal((await testPaperlessConnection()).ok, false);
    assert.equal((await waveHealthCheck()).ok, false); pass(`${failure} responses cannot fabricate acceptance or expose credential bodies`);
  }
  mode = "repeating"; await assert.rejects(listPaperlessDocuments(), /repeating pagination/); pass("Paperless repeated pagination terminates with an actionable failure");
  mode = "ok"; assert.equal((await testPaperlessConnection()).ok, true); pass("read-only provider retry succeeds after transient failure");
  const fixture = await createFixture({ "./subscriptions.js": () => import("../convex/subscriptions"), "./society.js": () => import("../convex/society"), "./authorization.js": () => import("../convex/authorization"), "./users.js": () => import("../convex/users"), "./paperless.js": () => import("../convex/paperless"), "./grantSources.js": () => import("../convex/grantSources"), "./communications.js": () => import("../convex/communications"), "./members.js": () => import("../convex/members"), "./directors.js": () => import("../convex/directors"), "./volunteers.js": () => import("../convex/volunteers"), "./committees.js": () => import("../convex/committees"), "./notifications.js": () => import("../convex/notifications"), "./http.js": () => import("../convex/http"), "./waveCache.js": () => import("../convex/waveCache"), "./financialHub.js": () => import("../convex/financialHub") });
  process.env.PAPERLESS_SOCIETY_ID = String(fixture.ids.societyA);
  process.env.SOCIETYER_WAVE_WORKSPACE_BINDINGS_JSON = JSON.stringify({ [fixture.ids.societyA]: "business-fixture" });
  const owner = fixture.actor("owner-a"), viewer = fixture.actor("viewer-a");
  const planId = await owner.mutation(makeFunctionReference("subscriptions:upsertPlan"), { societyId: fixture.ids.societyA, name: "Fixture plan", priceCents: 1000, currency: "CAD", interval: "month", benefits: [], active: true });
  const checkoutArgs = { societyId: fixture.ids.societyA, planId, email: "recipient@example.test", fullName: "Fixture recipient" };
  const begin = makeFunctionReference<"action">("subscriptions:beginCheckout");
  const activate = makeFunctionReference<"mutation">("subscriptions:simulateActivation");
  const connect = makeFunctionReference<"mutation">("paperless:upsertConnection");
  const paperlessArgs = { societyId: fixture.ids.societyA, autoCreateTags: false, autoUpload: false };
  const beforeDenied = requestCount;
  await assert.rejects(viewer.action(begin, checkoutArgs));
  await assert.rejects(owner.action(begin, { ...checkoutArgs, societyId: fixture.ids.societyB }));
  await assert.rejects(viewer.mutation(connect, paperlessArgs));
  await assert.rejects(owner.mutation(connect, { ...paperlessArgs, societyId: fixture.ids.societyB }));
  assert.equal(requestCount, beforeDenied); pass("native Viewer and foreign workspace denied before checkout or Paperless side effects");
  await assert.rejects(owner.mutation(activate, checkoutArgs), /explicit demo workspace/); pass("native real workspaces cannot fabricate payment activation");
  delete process.env.STRIPE_SECRET_KEY; delete process.env.PAPERLESS_NGX_TOKEN;
  await assert.rejects(owner.action(begin, checkoutArgs), /STRIPE_SECRET_KEY/);
  await assert.rejects(owner.mutation(connect, paperlessArgs), /PAPERLESS_NGX_TOKEN/);
  assert.equal((await fixture.native.run(ctx => ctx.db.query("memberSubscriptions").collect())).length, 0);
  assert.equal((await fixture.native.run(ctx => ctx.db.query("paperlessConnections").collect())).length, 0); pass("native unconfigured services do not persist pretend paid or connected records");
  await fixture.native.run(ctx => ctx.db.patch(fixture.ids.societyA, { demoMode: true }));
  await owner.action(begin, checkoutArgs); await owner.mutation(activate, checkoutArgs);
  assert.equal((await fixture.native.run(ctx => ctx.db.query("memberSubscriptions").collect()))[0].demo, true);
  await assert.rejects(owner.mutation(activate, checkoutArgs), /No pending demo checkout/); pass("explicit demo checkout activation remains usable and cannot replay a consumed pending checkout");
  await fixture.native.run(ctx => ctx.db.patch(fixture.ids.societyA, { demoMode: false, disabledModules: ["membershipBilling", "paperless", "grants"] }));
  const beforeDisabled = requestCount;
  await assert.rejects(owner.action(begin, checkoutArgs), /disabled/);
  await assert.rejects(owner.mutation(connect, paperlessArgs), /disabled/);
  await assert.rejects(owner.action(makeFunctionReference("paperless:testConnection"), { societyId: fixture.ids.societyA }), /disabled/);
  assert.equal(requestCount, beforeDisabled); pass("disabled billing and Paperless execution deny before outbound calls while existing records remain");
  await fixture.native.run(ctx => ctx.db.patch(fixture.ids.societyA, { disabledModules: [] }));
  process.env.PAPERLESS_NGX_TOKEN = privateToken;
  await owner.mutation(connect, paperlessArgs);
  let savedPaperless = (await fixture.native.run(ctx => ctx.db.query("paperlessConnections").collect()))[0];
  assert.equal(savedPaperless.status, "configured");
  const testConnection = makeFunctionReference<"action">("paperless:testConnection");
  mode = "unauthorized"; assert.equal((await owner.action(testConnection, { societyId: fixture.ids.societyA })).ok, false);
  savedPaperless = (await fixture.native.run(ctx => ctx.db.query("paperlessConnections").collect()))[0];
  assert.equal(savedPaperless.status, "error");
  mode = "ok"; assert.equal((await owner.action(testConnection, { societyId: fixture.ids.societyA })).ok, true);
  savedPaperless = (await fixture.native.run(ctx => ctx.db.query("paperlessConnections").collect()))[0];
  assert.equal(savedPaperless.status, "connected"); assert.equal(savedPaperless.demo, false);
  assert.equal((await import("../convex/paperless")).recordConnectionTest.isInternal, true);
  await owner.run(async ctx => assert.rejects(recordConnectionTestPortable(await toPortableMutationCtx(ctx), { societyId: fixture.ids.societyA, ok: true, demo: false }), /only by the configured server adapter/));
  pass("Paperless save is configured until real native adapter test succeeds; failed auth and retry persist honest state, public clients cannot forge completion");
  const beforeProviderBindingDenial = requestCount;
  const paperlessAssignment = process.env.PAPERLESS_SOCIETY_ID;
  delete process.env.PAPERLESS_SOCIETY_ID;
  await assert.rejects(owner.action(testConnection, { societyId: fixture.ids.societyA }), /PAPERLESS_SOCIETY_ID/);
  process.env.PAPERLESS_SOCIETY_ID = String(fixture.ids.societyB);
  await assert.rejects(owner.action(testConnection, { societyId: fixture.ids.societyA }), /not assigned/);
  process.env.PAPERLESS_SOCIETY_ID = paperlessAssignment;
  await assert.rejects(owner.mutation(connect, { ...paperlessArgs, autoUpload: true }), /Automatic Paperless uploads/);
  assert.equal(requestCount, beforeProviderBindingDenial);
  pass("Paperless missing/foreign operator assignment and unsupported automatic uploads deny before provider requests");
  process.env.RUSTFS_ENDPOINT = base; process.env.RUSTFS_ACCESS_KEY = privateToken; process.env.RUSTFS_SECRET_KEY = privateToken;
  const paperlessDocs = await fixture.native.run(async ctx => {
    await ctx.db.insert("users", { societyId: fixture.ids.societyA, role: "Director", status: "Active", email: "director@example.test", displayName: "Director", authSubject: "director-a", authProvider: "clerk", authIssuer: "https://offline-evaluation.clerk.accounts.dev", createdAtISO: new Date().toISOString() });
    const doc = await ctx.db.insert("documents", { societyId: fixture.ids.societyA, title: "Source fixture", category: "Other", createdAtISO: new Date().toISOString(), flaggedForDeletion: false, tags: [], sourceExternalIds: ["paperless:12"] });
    const version = await ctx.db.insert("documentVersions", { societyId: fixture.ids.societyA, documentId: doc, version: 1, storageProvider: "rustfs", storageKey: "file-fixture", fileName: "fixture.txt", uploadedAtISO: new Date().toISOString(), isCurrent: true });
    const meeting = await ctx.db.insert("meetings", { societyId: fixture.ids.societyA, title: "Restricted", type: "Board", scheduledAt: "2026-01-01", electronic: false, status: "Scheduled", attendeeIds: [] });
    const material = await ctx.db.insert("meetingMaterials", { societyId: fixture.ids.societyA, meetingId: meeting, documentId: doc, order: 0, requiredForMeeting: false, accessLevel: "restricted", accessGrants: [], createdAtISO: new Date().toISOString() });
    return { doc, version, material };
  });
  const director = fixture.actor("director-a");
  const syncDocument = makeFunctionReference<"action">("paperless:syncDocument");
  const manualArgs = { societyId: fixture.ids.societyA, documentId: paperlessDocs.doc, versionId: paperlessDocs.version };
  const beforeManualDenial = requestCount;
  await assert.rejects(director.action(syncDocument, manualArgs));
  await assert.rejects(viewer.action(syncDocument, manualArgs));
  await assert.rejects(owner.action(syncDocument, { ...manualArgs, societyId: fixture.ids.societyB }));
  for (const name of ["createDiscoveryImportSession", "createMeetingMinutesImportSession", "createTransposedImportSession", "createBylawsHistoryImportSession"]) await assert.rejects(director.action(makeFunctionReference("paperless:" + name), { societyId: fixture.ids.societyA }));
  await assert.rejects(director.query(makeFunctionReference("paperless:sourcePullContext"), { societyId: fixture.ids.societyA, documentId: paperlessDocs.doc }));
  assert.equal(requestCount, beforeManualDenial);
  assert.equal((await fixture.native.run(ctx => ctx.db.query("paperlessDocumentSyncs").collect())).length, 0);
  pass("Paperless archive-wide discovery and source pull require current administrator permission; restricted document upload, Viewer and foreign tenant deny before network/write");
  assert.equal((await owner.action(syncDocument, manualArgs)).status, "queued");
  let manualSync = (await fixture.native.run(ctx => ctx.db.query("paperlessDocumentSyncs").collect()))[0];
  assert.equal(manualSync.status, "queued");
  assert.deepEqual(await director.query(makeFunctionReference("paperless:recentSyncs"), { societyId: fixture.ids.societyA }), []);
  await assert.rejects(director.query(makeFunctionReference("paperless:getSync"), { id: manualSync._id }));
  await owner.action(makeFunctionReference("paperless:refreshSync"), { syncId: manualSync._id });
  manualSync = (await fixture.native.run(ctx => ctx.db.query("paperlessDocumentSyncs").collect()))[0];
  assert.equal(manualSync.status, "complete"); assert.equal(manualSync.paperlessDocumentUrl, `${base}/documents/12/details`);
  await fixture.native.run(ctx => ctx.db.delete(paperlessDocs.material));
  assert.equal((await director.action(syncDocument, manualArgs)).status, "queued");
  const beforeSimulatedSource = requestCount;
  await fixture.native.run(ctx => ctx.db.patch(paperlessDocs.version, { storageProvider: "demo" }));
  await assert.rejects(owner.action(syncDocument, manualArgs), /Simulated document/);
  assert.equal(requestCount, beforeSimulatedSource);
  await fixture.native.run(ctx => ctx.db.patch(paperlessDocs.version, { storageProvider: "rustfs" }));
  mode = "failure";
  await assert.rejects(owner.action(syncDocument, manualArgs));
  mode = "ok";
  assert.equal((await owner.action(syncDocument, manualArgs)).status, "queued");
  const paperlessModule = await import("../convex/paperless");
  for (const name of ["recordConnectionTest", "recordSyncResult", "recordSyncRefresh"] as const) {
    assert.equal(paperlessModule[name].isInternal, true); assert.notEqual(paperlessModule[name].isPublic, true);
  }
  const beforeInternalWrite = await fixture.native.run(ctx => ctx.db.get(manualSync._id));
  await assert.rejects(viewer.mutation(makeFunctionReference("paperless:recordSyncRefresh"), { syncId: manualSync._id, status: "complete", paperlessDocumentId: 999 }));
  await fixture.native.run(ctx => ctx.db.patch(fixture.ids.societyA, { disabledModules: ["paperless"] }));
  await assert.rejects(owner.mutation(makeFunctionReference("paperless:recordSyncRefresh"), { syncId: manualSync._id, status: "complete", paperlessDocumentId: 999 }));
  await fixture.native.run(ctx => ctx.db.patch(fixture.ids.societyA, { disabledModules: [] }));
  assert.deepEqual(await fixture.native.run(ctx => ctx.db.get(manualSync._id)), beforeInternalWrite);
  pass("Paperless connection and sync completion recorders are internal-only; current Viewer/module authority rejects privileged helper writes without changing records");
  pass("native manual Paperless sync reads real loopback stored bytes, uploads and refreshes actual task status, enforces sync ACL, permits authorized Director upload and rejects simulated live sources");
  const beforeWaveDenial = requestCount;
  const waveHealth = makeFunctionReference<"action">("waveCache:healthCheck");
  const waveBindings = process.env.SOCIETYER_WAVE_WORKSPACE_BINDINGS_JSON;
  delete process.env.SOCIETYER_WAVE_WORKSPACE_BINDINGS_JSON;
  await assert.rejects(owner.action(waveHealth, { societyId: fixture.ids.societyA }), /SOCIETYER_WAVE_WORKSPACE_BINDINGS_JSON/);
  process.env.SOCIETYER_WAVE_WORKSPACE_BINDINGS_JSON = waveBindings;
  await assert.rejects(owner.action(waveHealth, { societyId: fixture.ids.societyA, businessId: "foreign-business" }), /not assigned/);
  await assert.rejects(viewer.action(waveHealth, { societyId: fixture.ids.societyA }));
  await assert.rejects(owner.action(waveHealth, { societyId: fixture.ids.societyB }));
  await assert.rejects(owner.action(makeFunctionReference("waveCache:invoicePaymentProbe"), { societyId: fixture.ids.societyA, allAccessibleBusinesses: true }), /cannot enumerate/);
  await assert.rejects(owner.mutation(makeFunctionReference("financialHub:markConnectionConnected"), { societyId: fixture.ids.societyA, provider: "wave", externalBusinessId: "foreign-business", demo: false }), /not assigned/);
  await assert.rejects(owner.mutation(makeFunctionReference("financialHub:importBrowserWaveTransactions"), { societyId: fixture.ids.societyA, businessId: "foreign-business", accounts: [], transactions: [] }), /not assigned/);
  assert.equal(requestCount, beforeWaveDenial);
  pass("native Wave missing binding, foreign external business, global enumeration and unauthorized tenant roles deny with zero provider calls");
  assert.equal((await owner.action(waveHealth, { societyId: fixture.ids.societyA })).ok, true);
  pass("bound native Wave health probes only the operator-approved business via real local GraphQL protocol");
  const event = makeFunctionReference<"mutation">("subscriptions:handleStripeEvent");
  const object = { id: "cs_fixture_paid", payment_status: "paid", metadata: { societyId: fixture.ids.societyA, planId, fullName: "Fixture recipient" }, customer_email: checkoutArgs.email, customer: "cus_fixture", subscription: "sub_fixture_paid", amount_total: 1000 };
  await fixture.native.mutation(event, { type: "checkout.session.completed", payload: JSON.stringify({ ...object, payment_status: "unpaid" }), eventId: "evt_fixture_unpaid" });
  assert.equal((await fixture.native.run(ctx => ctx.db.query("memberSubscriptions").collect())).length, 1); pass("unpaid checkout completion does not activate membership");
  await fixture.native.mutation(event, { type: "checkout.session.completed", payload: JSON.stringify({ ...object, metadata: { ...object.metadata, societyId: fixture.ids.societyB } }), eventId: "evt_fixture_foreign" });
  assert.equal((await fixture.native.run(ctx => ctx.db.query("memberSubscriptions").collect())).length, 1); pass("verified provider metadata cannot pair a plan with another workspace");
  await fixture.native.mutation(event, { type: "checkout.session.completed", payload: JSON.stringify(object), eventId: "evt_fixture_paid" });
  const afterPaid = await fixture.native.run(async ctx => ({ subs: await ctx.db.query("memberSubscriptions").collect(), notifications: await ctx.db.query("notifications").collect(), receipts: await ctx.db.query("integrationSyncStates").collect() }));
  assert.equal(afterPaid.subs.length, 2);
  for (const eventId of ["evt_fixture_paid", "evt_fixture_other_same_checkout"]) await fixture.native.mutation(event, { type: "checkout.session.completed", payload: JSON.stringify(object), eventId });
  const afterReplay = await fixture.native.run(async ctx => ({ subs: await ctx.db.query("memberSubscriptions").collect(), notifications: await ctx.db.query("notifications").collect(), receipts: await ctx.db.query("integrationSyncStates").collect() }));
  assert.deepEqual(afterReplay, afterPaid); pass("paid checkout and same-session replay are transactionally idempotent");
  const liveSub = afterPaid.subs.find(row => !row.demo)!;
  await assert.rejects(owner.mutation(makeFunctionReference("subscriptions:cancelSubscription"), { id: liveSub._id }), /verified Stripe webhook/); pass("record-only cancellation cannot falsely promise to stop live provider charges");
  const invoicePayload = JSON.stringify({ id: "in_fixture", subscription: "sub_fixture_paid", amount_paid: 1500, lines: { data: [{ period: { end: 1893456000 } }] } });
  for (let index = 0; index < 2; index++) await fixture.native.mutation(event, { type: "invoice.paid", payload: invoicePayload, eventId: "evt_fixture_invoice" });
  assert.equal((await fixture.native.run(ctx => ctx.db.get(liveSub._id)))?.lastPaymentCents, 1500);
  const invoices = await fixture.native.run(ctx => ctx.db.query("integrationSyncStates").collect());
  assert.equal(invoices.filter(row => row.resourceId === "evt_fixture_invoice").length, 1); pass("recurring invoice payment retry updates once and preserves provider authority");
  const sourceId = await owner.mutation(makeFunctionReference("grantSources:upsert"), { societyId: fixture.ids.societyA, patch: { name: "Fixture RSS source", url: `${base}/feed`, sourceType: "rss" } });
  const discover = makeFunctionReference<"action">("grantSources:discoverFromSource");
  const discoveryArgs = { societyId: fixture.ids.societyA, sourceId };
  const firstDiscovery = await owner.action(discover, discoveryArgs);
  assert.equal(firstDiscovery.inserted, 1);
  assert.equal((await owner.action(discover, discoveryArgs)).inserted, 0);
  assert.equal((await fixture.native.run(ctx => ctx.db.query("grantOpportunityCandidates").collect())).length, 1);
  pass("actual native grant RSS ingestion persists a review candidate and deduplicates repeated feed items");
  const beforeFeedDenial = requestCount;
  await assert.rejects(viewer.action(discover, discoveryArgs));
  await assert.rejects(owner.action(discover, { ...discoveryArgs, societyId: fixture.ids.societyB }));
  await fixture.native.run(ctx => ctx.db.patch(fixture.ids.societyA, { disabledModules: ["grants"] }));
  await assert.rejects(owner.action(discover, discoveryArgs), /disabled/);
  assert.equal(requestCount, beforeFeedDenial);
  assert.equal((await fixture.native.run(ctx => ctx.db.query("grantOpportunityCandidates").collect())).length, 1);
  pass("grant Viewer, foreign workspace and disabled-module denial make zero outbound calls or candidate writes");
  await fixture.native.run(ctx => ctx.db.patch(fixture.ids.societyA, { disabledModules: [] }));
  for (const failure of ["failure", "malformed", "network"]) {
    mode = failure;
    await assert.rejects(owner.action(discover, discoveryArgs));
    assert.equal((await fixture.native.run(ctx => ctx.db.query("grantOpportunityCandidates").collect())).length, 1);
  }
  mode = "ok"; assert.equal((await owner.action(discover, discoveryArgs)).inserted, 0);
  pass("grant provider/network/malformed failures preserve reviewed queue; retry remains deduplicated");
  // A demo record deliberately colliding with the external subscription ID must never receive a real invoice update.
  const demoId = await fixture.native.run(ctx => ctx.db.insert("memberSubscriptions", { societyId: fixture.ids.societyB, planId, email: "demo@example.test", fullName: "Collision fixture", status: "pending", startedAtISO: new Date().toISOString(), demo: true, stripeSubscriptionId: "sub_fixture_paid" }));
  await fixture.native.mutation(event, { type: "invoice.paid", payload: JSON.stringify({ subscription: "sub_fixture_paid", amount_paid: 1800 }), eventId: "evt_fixture_collision" });
  assert.equal((await fixture.native.run(ctx => ctx.db.get(demoId)))?.status, "pending");
  assert.equal((await fixture.native.run(ctx => ctx.db.get(liveSub._id)))?.lastPaymentCents, 1800);
  pass("real provider events never mutate a colliding demo or foreign subscription record");
  await fixture.native.run(ctx => ctx.db.insert("members", { societyId: fixture.ids.societyA, firstName: "Fixture", lastName: "Recipient", email: "recipient@example.test", status: "Active", membershipClass: "Regular", joinedAt: "2026-01-01", votingRights: true }));
  const campaign = makeFunctionReference<"action">("communications:sendCampaign");
  const campaignArgs = { societyId: fixture.ids.societyA, audience: "all_members", kind: "notice", channel: "email", subject: "Fixture notice", bodyText: "Fixture delivery body" };
  delete process.env.RESEND_API_KEY;
  const beforeUnconfiguredMail = requestCount;
  const missingMail = await owner.action(campaign, campaignArgs);
  assert.equal(missingMail.deliveredCount, 0); assert.equal(missingMail.bouncedCount, 1);
  assert.equal(requestCount, beforeUnconfiguredMail);
  let deliveries = await fixture.native.run(ctx => ctx.db.query("communicationDeliveries").collect());
  assert.equal(deliveries.length, 1); assert.equal(deliveries[0].status, "failed");
  assert.ok(!deliveries[0].proofOfNotice);
  pass("actual native unconfigured mail campaign records failure, zero delivery and no proof of notice");
  const beforeCampaignDenial = requestCount;
  const initialCampaigns = (await fixture.native.run(ctx => ctx.db.query("communicationCampaigns").collect())).length;
  await assert.rejects(viewer.action(campaign, campaignArgs));
  await assert.rejects(owner.action(campaign, { ...campaignArgs, societyId: fixture.ids.societyB }));
  await fixture.native.run(ctx => ctx.db.patch(fixture.ids.societyA, { disabledModules: ["communications"] }));
  await assert.rejects(owner.action(campaign, campaignArgs), /disabled/);
  assert.equal(requestCount, beforeCampaignDenial);
  assert.equal((await fixture.native.run(ctx => ctx.db.query("communicationCampaigns").collect())).length, initialCampaigns);
  pass("mail Viewer, foreign workspace and disabled feature deny before delivery calls or campaign writes");
  process.env.STRIPE_WEBHOOK_SECRET = privateToken;
  const signedBody = JSON.stringify({ id: "evt_fixture_http", type: "invoice.paid", data: { object: { subscription: "sub_fixture_paid", amount_paid: 2000 } } });
  const signature = (body: string) => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    return `t=${timestamp},v1=${createHmac("sha256", privateToken).update(`${timestamp}.${body}`).digest("hex")}`;
  };
  const beforeUnsigned = await fixture.native.run(ctx => ctx.db.get(liveSub._id));
  assert.equal((await fixture.native.fetch("/stripe/webhook", { method: "POST", body: signedBody })).status, 400);
  assert.deepEqual(await fixture.native.run(ctx => ctx.db.get(liveSub._id)), beforeUnsigned);
  assert.equal((await fixture.native.fetch("/stripe/webhook", { method: "POST", body: "{invalid", headers: { "stripe-signature": signature("{invalid") } })).status, 400);
  assert.equal((await fixture.native.fetch("/stripe/webhook", { method: "POST", body: signedBody, headers: { "stripe-signature": signature(signedBody) } })).status, 200);
  assert.equal((await fixture.native.run(ctx => ctx.db.get(liveSub._id)))?.lastPaymentCents, 2000);
  const receiptCount = (await fixture.native.run(ctx => ctx.db.query("integrationSyncStates").collect())).length;
  assert.equal((await fixture.native.fetch("/stripe/webhook", { method: "POST", body: signedBody, headers: { "stripe-signature": signature(signedBody) } })).status, 200);
  assert.equal((await fixture.native.run(ctx => ctx.db.query("integrationSyncStates").collect())).length, receiptCount);
  pass("actual Convex HTTP Stripe route rejects unsigned/malformed events, verifies signed bytes and preserves idempotency on delivery retry");
  writeTrackedReport("artifacts/offline/provider-gap-qualification.json", JSON.stringify({ sourceBaseline: "66b8dcd", executedAt: new Date().toISOString(), fixtureOnly: true, externalProviderAccountsContacted: false, cases, count: cases.length, remaining: ["Real provider credentials and external delivery/payment/OCR qualification", "Live Stripe cancellation is performed in Stripe; verified webhook updates Societyer", "Google/Microsoft calendar import/feed exist; OAuth write-back is not implemented"] }, null, 2) + "\n");
  console.log(`Provider gap qualification: ${cases.length}/${cases.length} fixture groups passed; no external accounts contacted.`);
} finally {
  globalThis.fetch = originalFetch;
  for (const [name, value] of previousEnv) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  await new Promise<void>(resolve => server.close(() => resolve()));
}
