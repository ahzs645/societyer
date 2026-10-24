import assert from "node:assert/strict";
import { getFunctionName } from "convex/server";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import { tables, society } from "../src/lib/staticConvexFixtures";
import * as automation from "../shared/functions/billingAutomation";
import * as invoices from "../shared/functions/invoices";
import * as reports from "../shared/functions/commerceReports";
import { billingWallTime, nextBillingDate } from "../shared/billingAutomation";
import { defaultCommerceReport } from "../shared/commerceReports";
import { sendBillingEmail, BillingEmailError } from "../convex/providers/billingEmail";
import { scan } from "../convex/billingAutomationActions";
import { dueWork } from "../convex/billingAutomation";
import { renderBillingDocument } from "../convex/lib/renderBillingDocument";
import { documentTemplateSample } from "../src/features/invoicing/documentTemplateSamples";
import { DEFAULT_INVOICE_TEMPLATE } from "../shared/invoiceCommerce";

assert.equal(billingWallTime("2026-01-31", "09:00", "America/Vancouver"), "2026-01-31T17:00:00.000Z");
assert.equal(billingWallTime("2026-03-08", "02:30", "America/Vancouver"), "2026-03-08T10:00:00.000Z", "nonexistent DST wall time advances to first valid time");
assert.equal(billingWallTime("2026-11-01", "01:30", "America/Vancouver"), "2026-11-01T08:30:00.000Z", "repeated DST time uses first occurrence exactly once");
assert.equal(nextBillingDate("2026-01-31", "monthly", 31), "2026-02-28");
assert.equal(nextBillingDate("2026-02-28", "monthly", 31), "2026-03-31");
assert.throws(() => billingWallTime("2026-02-30", "09:00", "UTC"));
assert.throws(() => billingWallTime("2026-01-01", "25:00", "UTC"));
assert.throws(() => billingWallTime("2026-01-01", "09:00", "Made/Up"));

const seed: Record<string, any[]> = structuredClone(tables);
seed.societies = [structuredClone(society), { _id: "foreign_society", name: "Foreign" }];
const db = new MemoryDb({ seed });
const societyId = seed.users[0].societyId, ownerId = seed.users[0]._id;
const ctx: any = { db, principal: { kind: "user", runtime: "test", assurance: "trusted-workspace", subject: `test:${ownerId}`, societyId, userId: ownerId }, capabilities: makeCapabilities({}), runQuery: async () => { throw new Error("Unexpected query"); }, runMutation: async () => { throw new Error("Unexpected mutation"); } };
const today = new Date().toISOString().slice(0, 10), time = "00:00", at = `${today}T23:59:00.000Z`;
const seriesId = await invoices.upsertSeriesPortable(ctx, { societyId, name: "Automation sample", frequency: "monthly", startDate: today, endKind: "after_count", endAfterCount: 1, autoSend: false, partyKind: "custom", billToName: "Sample customer", billToEmail: "customer@example.test", terms: "net_30", currency: "CAD", lines: [{ key: "line", item: "Sample service", quantity: 1, unitPriceCents: 2500 }] });
const recurring = { societyId, name: "Recurring delivery", kind: "recurring_invoice" as const, sourceId: seriesId, recipients: ["Customer@example.test", "customer@example.test"], recipientsConfirmed: true, timezone: "UTC", localTime: time, cadence: "monthly" as const, startDate: today };
// Old paused schedules must never hide a later active due schedule behind a list limit.
for (let index = 0; index < 205; index++) await db.insert("billingAutomationSchedules", { societyId, name: `Old paused ${index}`, kind: "recurring_invoice", sourceId: `old-source-${index}`, recipients: ["paused@example.test"], recipientsConfirmed: true, active: false, timezone: "UTC", localTime: "00:00", cadence: "monthly", anchorDay: 1, nextLocalDate: today, nextRunAtISO: `${today}T00:00:00.000Z`, createdByUserId: ownerId, createdAtISO: new Date().toISOString(), updatedAtISO: new Date().toISOString() });
const scheduleId = await automation.saveSchedulePortable(ctx, recurring);
assert.equal((await db.get(scheduleId))!.active, false, "new schedules start disabled");
assert.deepEqual(await automation.prepareDuePortable(ctx, { societyId, atISO: at }), [], "paused schedules do not issue invoices");
await assert.rejects(() => automation.saveSettingsPortable(ctx, { societyId, enabled: true, fromEmail: "billing@example.test", fromName: "Billing", senderConfirmed: false }), /Confirm sender/);
await automation.saveSettingsPortable(ctx, { societyId, enabled: false, fromEmail: "billing@example.test", fromName: "Billing", senderConfirmed: true });
await automation.setScheduleActivePortable(ctx, { societyId, id: scheduleId, active: true });
assert.deepEqual(await automation.prepareDuePortable(ctx, { societyId, atISO: at }), [], "workspace delivery disabled means no issuance");
await automation.saveSettingsPortable(ctx, { societyId, enabled: true, fromEmail: "billing@example.test", fromName: "Billing", senderConfirmed: true });
await invoices.setSeriesStatusPortable(ctx, { id: seriesId, status: "paused" });
assert.deepEqual(await automation.prepareDuePortable(ctx, { societyId, atISO: at }), [], "paused series do not issue invoices");
assert.equal((await db.get(scheduleId))!.active, true, "pausing a source does not discard the delivery schedule's own enable state");
await invoices.setSeriesStatusPortable(ctx, { id: seriesId, status: "active" });
const ids = await automation.prepareDuePortable(ctx, { societyId, atISO: at }); assert.equal(ids.length, 1);
const first = (await db.get(ids[0]))!;
assert.equal(first.deliveries.length, 1, "recipient deduplication");
assert.ok(first.invoiceId);
assert.equal((await db.get(seriesId))!.issuedCount, 1);
assert.equal((await db.get(scheduleId))!.nextRunAtISO.slice(0, 4), "9999", "final occurrence still remains deliverable");
const again = await automation.prepareDuePortable(ctx, { societyId, atISO: at });
assert.deepEqual(again, ids); assert.equal((await db.get(seriesId))!.issuedCount, 1, "overlapping cron scan reuses occurrence and invoice");
const claimed = await automation.claimRunPortable(ctx, { societyId, id: first._id, atISO: at }); assert.ok(claimed);
assert.equal(await automation.claimRunPortable(ctx, { societyId, id: first._id, atISO: at }), null, "only one live lease");
await assert.rejects(() => automation.workerUpdatePortable(ctx, { societyId, id: first._id, token: "stale", event: "accepted", patch: { status: "accepted" } }), /lease/);
await db.patch(first._id, { status: "queued", leaseToken: undefined, leaseUntilISO: undefined, nextAttemptAtISO: new Date().toISOString() });
const blocked = await automation.deliverLocalPortable(ctx, { societyId, id: first._id });
assert.equal(blocked.status, "blocked");
assert.match((await db.get(first._id))!.lastError, /native email service/);
assert.equal((await db.get(first.deliveries[0].pendingEmailId))!.status, "ready", "blocked transport never marks email sent");
const viewer = { ...ctx, principal: { ...ctx.principal, userId: await db.insert("users", { societyId, name: "Reader", role: "Viewer", status: "Active" }) } };
await assert.rejects(() => automation.saveSettingsPortable(viewer, { societyId, enabled: true, fromEmail: "reader@example.test", fromName: "Reader", senderConfirmed: true }));
const foreignInvoice = await db.insert("invoices", { societyId: "foreign_society", number: "OTHER", status: "sent" });
await assert.rejects(() => automation.saveSchedulePortable(ctx, { ...recurring, kind: "invoice_reminder", sourceId: foreignInvoice }), /not found/);
await assert.rejects(() => automation.getRunPortable(ctx, { societyId: "foreign_society", id: first._id }));
await assert.rejects(() => automation.saveSchedulePortable(ctx, { ...recurring, id: scheduleId, active: true, recipientsConfirmed: false }), /recipient authorization/);
await assert.rejects(() => automation.deliverLocalPortable({ ...ctx, principal: { ...ctx.principal, runtime: "convex-hosted" } }, { societyId, id: first._id }), /server action/);

const sample = documentTemplateSample(DEFAULT_INVOICE_TEMPLATE, "invoice", { today, currency: "CAD" });
const pdf = await renderBillingDocument({ ...sample, organization: { name: "Sample Workshop" } });
const parsed = await getDocument({ data: pdf.slice(), useSystemFonts: true }).promise;
const text = (await (await parsed.getPage(1)).getTextContent()).items.map((r: any) => r.str ?? "").join(" ");
assert.ok(text.includes("INV-SAMPLE-001"), `actual Node PDF has invoice text: ${text}`); assert.ok(text.includes("Professional service")); await parsed.destroy();
const base64 = Buffer.from(pdf).toString("base64");

const resendEnv = { SOCIETYER_EMAIL_PROVIDER: "resend", RESEND_API_KEY: "mock-key", RESEND_FROM_EMAIL: "billing@example.test" };
const transportInput = { to: "customer@example.test", from: "billing@example.test", subject: "Sample invoice", text: "Attached sample", idempotencyKey: "sample-run:0", pdfBase64: base64, fileName: "sample-invoice.pdf" };
let submissions = 0, captured: any;
const accepted = await sendBillingEmail(transportInput, { draft: async () => {}, submission: async () => { submissions++; } }, { env: resendEnv, fetch: (async (_url, init) => { captured = { headers: init?.headers, body: JSON.parse(String(init?.body)) }; return new Response(JSON.stringify({ id: "provider-sample-1" }), { status: 200 }); }) as typeof fetch });
assert.equal(accepted.accepted, true); assert.equal(submissions, 1);
assert.equal(captured.headers["Idempotency-Key"], transportInput.idempotencyKey);
assert.equal(captured.body.attachments[0].content, base64); assert.equal(captured.body.attachments[0].filename, "sample-invoice.pdf");
assert.equal(captured.body.attachments[0].content_type, "application/pdf");
await assert.rejects(() => sendBillingEmail(transportInput, { draft: async () => {}, submission: async () => {} }, { env: {}, fetch: (() => { throw new Error("must not send"); }) as any }), (e: any) => e instanceof BillingEmailError && e.blocked);
await assert.rejects(() => sendBillingEmail({ ...transportInput, from: "wrong@example.test" }, { draft: async () => {}, submission: async () => {} }, { env: resendEnv, fetch: (() => { throw new Error("must not send"); }) as any }), /Sender settings/);
await assert.rejects(() => sendBillingEmail({ ...transportInput, submissionStartedAtISO: "2020-01-01T00:00:00Z" }, { draft: async () => {}, submission: async () => {} }, { env: resendEnv, fetch: (() => { throw new Error("must not send"); }) as any }), (e: any) => e.uncertain === true);
await assert.rejects(() => sendBillingEmail({ ...transportInput, provider: "microsoft365", providerDraftId: "immutable-existing" }, { draft: async () => {}, submission: async () => {} }, { env: resendEnv, fetch: (() => { throw new Error("must not send through a changed provider"); }) as any }), /another provider/);
const graphEnv = { SOCIETYER_EMAIL_PROVIDER: "microsoft365", MICROSOFT_MAIL_TENANT_ID: "11111111-1111-1111-1111-111111111111", MICROSOFT_MAIL_CLIENT_ID: "22222222-2222-2222-2222-222222222222", MICROSOFT_MAIL_CLIENT_SECRET: "mock-secret", MICROSOFT_MAIL_SENDER: "billing@example.test" };
let graphRequests: Array<{ url: string; init: any }> = [], savedDraft: string | undefined, submissionAt: string | undefined;
const graphFetch = (async (url: any, init: any) => { graphRequests.push({ url: String(url), init }); if (String(url).includes("oauth2")) return new Response(JSON.stringify({ access_token: "mock-token", token_type: "Bearer" })); if (String(url).includes("?$filter")) return new Response(JSON.stringify({ value: [] })); if (String(url).endsWith("/messages")) { assert.equal(JSON.parse(init.body).attachments[0].contentBytes, base64); assert.equal(init.headers.Prefer, 'IdType="ImmutableId"'); return new Response(JSON.stringify({ id: "immutable-sample" }), { status: 201 }); } if (String(url).endsWith("/send")) throw new Error("mock response lost after acceptance"); if (String(url).includes("/messages/immutable-sample?")) return new Response(JSON.stringify({ id: "immutable-sample", isDraft: false })); throw new Error(`unexpected Graph route ${url}`); }) as typeof fetch;
const checkpoints = { draft: async (id: string) => { savedDraft = id; }, submission: async (at: string) => { submissionAt = at; } };
await assert.rejects(() => sendBillingEmail(transportInput, checkpoints, { env: graphEnv, fetch: graphFetch }), /timed out/);
assert.equal(savedDraft, "immutable-sample"); assert.ok(submissionAt);
const graphAccepted = await sendBillingEmail({ ...transportInput, providerDraftId: savedDraft, submissionStartedAtISO: submissionAt }, checkpoints, { env: graphEnv, fetch: graphFetch });
assert.equal(graphAccepted.id, "immutable-sample"); assert.equal(graphRequests.filter((r) => r.url.endsWith("/send")).length, 1, "ambiguous Graph submission probes existing immutable message without a second send");

// Exercise the real hosted cron worker with mock provider + storage and real PDF output.
await automation.retryRunPortable(ctx, { societyId, id: first._id });
await db.patch(first._id, { deliveries: [...first.deliveries, { to: "second@example.test", status: "queued", pendingEmailId: await db.insert("pendingEmails", { societyId, to: "second@example.test", subject: "Sample", body: "Sample", status: "ready", attachments: [], createdAtISO: new Date().toISOString() }) }] });
const blobs = new Map<string, Blob>(); let storageCounter = 0;
const workerCtx: any = {
 storage: { store: async (blob: Blob) => { const id = `blob-${++storageCounter}`; blobs.set(id, blob); return id; }, get: async (id: string) => blobs.get(id) ?? null },
 runQuery: async (reference: any, args: any) => {
   const name = getFunctionName(reference);
   if (name === "billingAutomation:dueWork") return { actors: [{ societyId, createdByUserId: ownerId }], isDone: true, continueCursor: "" };
   if (name === "billingAutomation:workerContext") return { organization: { name: "Sample Workshop" }, config: DEFAULT_INVOICE_TEMPLATE };
   if (name === "billingAutomation:reportSourceInternal") return reports.sourcePagePortable(ctx, args);
   throw new Error(`Unexpected worker query ${name}`);
 },
 runMutation: async (reference: any, args: any) => {
   const name = getFunctionName(reference);
   if (name === "billingAutomation:prepareInternal") return automation.prepareDuePortable(ctx, { societyId });
   if (name === "billingAutomation:claimInternal") return automation.claimRunPortable(ctx, args);
   if (name === "billingAutomation:updateInternal") return automation.workerUpdatePortable(ctx, args);
   if (name === "billingAutomation:outboxInternal") { const row = (await db.get(args.id))!; await db.patch(row.deliveries[args.index].pendingEmailId, args.patch); return null; }
   if (name === "billingAutomation:finalizeInternal") return automation.finalizeRunPortable(ctx, args);
   throw new Error(`Unexpected worker mutation ${name}`);
 }
};
const originalFetch = globalThis.fetch, originalEnv = { ...process.env };
let calls: Array<{ to: string; key: string; attachment: string }> = [], failSecond = true;
process.env.SOCIETYER_EMAIL_PROVIDER = "resend"; process.env.RESEND_API_KEY = "mock-key"; process.env.RESEND_FROM_EMAIL = "billing@example.test";
globalThis.fetch = (async (url: any, init: any) => { if (!String(url).includes("api.resend.com")) throw new Error(`No network allowed in test: ${url}`); const payload = JSON.parse(init.body); calls.push({ to: payload.to[0], key: init.headers["Idempotency-Key"], attachment: payload.attachments[0].content }); if (payload.to[0] === "second@example.test" && failSecond) return new Response(JSON.stringify({ error: "temporary" }), { status: 503 }); return new Response(JSON.stringify({ id: `accepted-${payload.to[0]}` })); }) as typeof fetch;
try {
  await (scan as any)._handler(workerCtx, {});
  let run = (await db.get(first._id))!;
  assert.equal(run.status, "retry"); assert.equal(run.deliveries[0].status, "accepted"); assert.equal(run.deliveries[1].status, "queued");
  assert.ok(run.snapshotStorageId && run.pdfStorageId && run.artifactHash, "snapshot and actual PDF persisted before transport");
  const frozenBytes = await blobs.get(run.pdfStorageId)!.arrayBuffer(); assert.equal(Buffer.from(frozenBytes).subarray(0, 5).toString(), "%PDF-");
  failSecond = false; await db.patch(run._id, { nextAttemptAtISO: new Date().toISOString() });
  await (scan as any)._handler(workerCtx, {});
  run = (await db.get(first._id))!; assert.equal(run.status, "accepted");
  assert.equal(calls.filter((c) => c.to === "customer@example.test").length, 1, "accepted recipient is never resent after partial failure");
  assert.equal(calls.filter((c) => c.to === "second@example.test").length, 2);
  assert.equal(calls[1].key, calls[2].key, "retry uses exact provider idempotency key"); assert.equal(calls[1].attachment, calls[2].attachment, "retry uses frozen PDF bytes");
  const before = calls.length; await (scan as any)._handler(workerCtx, {}); assert.equal(calls.length, before, "duplicate cron does not send accepted jobs");
  assert.equal((await db.get(seriesId))!.issuedCount, 1, "worker retries never issue a second recurring invoice");
  for (const d of run.deliveries) assert.equal((await db.get(d.pendingEmailId))!.providerState, "accepted");

  const definition = defaultCommerceReport("sales_items", today); definition.name = "Filtered scheduled sample"; definition.filters.currency = "CAD"; definition.filters.party = "Sample customer"; definition.filters.from = today; definition.filters.to = today;
  const definitionId = await reports.saveDefinitionPortable(ctx, { societyId, definition });
  const reportSchedule = await automation.saveSchedulePortable(ctx, { societyId, name: "Financial schedule", kind: "report", sourceId: definitionId, recipients: ["report@example.test"], recipientsConfirmed: true, timezone: "UTC", localTime: "00:00", cadence: "monthly", startDate: today, active: true });
  await (scan as any)._handler(workerCtx, {});
  const reportRun = (await db.query("billingAutomationRuns").withIndex("by_schedule_occurrence", q => q.eq("scheduleId", reportSchedule).eq("occurrenceKey", today)).unique())!;
  assert.equal(reportRun.status, "accepted");
  const frozen = JSON.parse(await blobs.get(reportRun.snapshotStorageId)!.text());
  assert.deepEqual(frozen.result.definition.filters, definition.filters, "scheduled attachment preserves exact saved date/basis/currency/dimension filters");
  assert.equal(frozen.result.title, definition.name);
  assert.deepEqual(frozen.result.definition.columns, definition.columns, "scheduled PDF consumes saved composition columns");
  const reportPdf = new Uint8Array(await blobs.get(reportRun.pdfStorageId)!.arrayBuffer());
  const reportParsed = await getDocument({ data: reportPdf.slice(), useSystemFonts: true }).promise;
  const reportText = (await (await reportParsed.getPage(1)).getTextContent()).items.map((r: any) => r.str ?? "").join(" ");
  assert.ok(reportText.includes("Filtered scheduled sample")); assert.ok(reportText.includes("Sample service")); await reportParsed.destroy();
} finally { globalThis.fetch = originalFetch; for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]; Object.assign(process.env, originalEnv); }
// A connected local host runs the same durable jobs and retains PDF bytes across retries.
await db.patch(first.invoiceId, { status: "sent", dueDate: today, paidCents: 0, totalCents: 2500 });
const nativeSchedule = await automation.saveSchedulePortable(ctx, { ...recurring, kind: "invoice_reminder", name: "Native sample reminder", sourceId: first.invoiceId, recipients: ["native-first@example.test", "native-second@example.test"], active: true });
await automation.prepareDuePortable(ctx, { societyId });
const nativeRun = (await db.query("billingAutomationRuns").withIndex("by_schedule_occurrence", q => q.eq("scheduleId", nativeSchedule).eq("occurrenceKey", today)).unique())!;
let nativeFail = true;
const nativeCalls: any[] = [];
const nativeCtx = { ...ctx, capabilities: makeCapabilities({ email: { supportsAttachments: true, supportsIdempotency: true, sendEmail: async (input: any) => { nativeCalls.push(input); if (input.to === "native-second@example.test" && nativeFail) throw new Error("Mock native connection interrupted"); return { id: `native-accepted-${input.to}`, accepted: true }; } } }) };
let nativeResult = await automation.deliverLocalPortable(nativeCtx, { societyId, id: nativeRun._id, pdfBase64: base64, fileName: "frozen-native.pdf" });
assert.equal(nativeResult.status, "blocked"); assert.equal(nativeResult.accepted, 1);
assert.equal((await db.get(nativeRun._id))!.localPdfBase64, base64);
assert.equal((await db.get(nativeRun._id))!.deliveries[0].status, "accepted");
await automation.retryRunPortable(ctx, { societyId, id: nativeRun._id }); nativeFail = false;
nativeResult = await automation.deliverLocalPortable(nativeCtx, { societyId, id: nativeRun._id, pdfBase64: "JVBERi0changed", fileName: "changed.pdf" });
assert.equal(nativeResult.status, "accepted"); assert.equal(nativeCalls.filter(c => c.to === "native-first@example.test").length, 1);
assert.equal(nativeCalls[1].idempotencyKey, nativeCalls[2].idempotencyKey);
assert.equal(nativeCalls[2].attachments[0].contentBase64, base64, "local retry retains frozen PDF bytes");
assert.equal(nativeCalls[2].attachments[0].filename, "frozen-native.pdf");
const paidSchedule = await automation.saveSchedulePortable(ctx, { ...recurring, kind: "invoice_reminder", name: "Paid invoice race", sourceId: first.invoiceId, recipients: ["paid-race@example.test"], active: true });
await automation.prepareDuePortable(ctx, { societyId });
const paidRun = (await db.query("billingAutomationRuns").withIndex("by_schedule_occurrence", q => q.eq("scheduleId", paidSchedule).eq("occurrenceKey", today)).unique())!;
await db.patch(first.invoiceId, { paidCents: 2500 });
assert.equal(await automation.claimRunPortable(ctx, { societyId, id: paidRun._id }), null, "payment after queuing suppresses delivery");
assert.equal((await db.get(paidRun._id))!.status, "skipped");
assert.equal((await db.get(paidRun.deliveries[0].pendingEmailId))!.status, "cancelled", "paid reminders are cancelled in the outbox too");
// A recurring invoice voided after preparation must never be emailed from its old snapshot.
const voidSeriesId = await invoices.upsertSeriesPortable(ctx, { societyId, name: "Voided queued sample", frequency: "monthly", startDate: today, endKind: "after_count", endAfterCount: 1, autoSend: false, partyKind: "custom", billToName: "Void sample customer", terms: "net_30", currency: "CAD", lines: [{ key: "void", item: "Sample service", quantity: 1, unitPriceCents: 100 }] });
const voidScheduleId = await automation.saveSchedulePortable(ctx, { ...recurring, sourceId: voidSeriesId, name: "Void cancellation check", active: true });
await automation.prepareDuePortable(ctx, { societyId });
const voidRun = (await db.query("billingAutomationRuns").withIndex("by_schedule_occurrence", q => q.eq("scheduleId", voidScheduleId).eq("occurrenceKey", today)).unique())!;
await db.patch(voidRun.invoiceId, { status: "void" });
assert.equal(await automation.claimRunPortable(ctx, { societyId, id: voidRun._id }), null);
assert.equal((await db.get(voidRun._id))!.status, "skipped");
assert.equal((await db.get(voidRun.deliveries[0].pendingEmailId))!.status, "cancelled");
// Source selectors page every eligible source type and resolve an older selected row independently.
const sourceCases: Array<{ kind: any; table: string; row: any }> = [
  { kind: "recurring_invoice", table: "invoiceSeries", row: { ...(await db.get(seriesId)), status: "paused", nextIssueDate: today } },
  { kind: "invoice_reminder", table: "invoices", row: { ...(await db.get(first.invoiceId)), status: "sent", paidCents: 0, totalCents: 2500 } },
  { kind: "report", table: "reportDefinitions", row: (await db.query("reportDefinitions").first())! },
  { kind: "template", table: "invoiceTemplates", row: { societyId, config: DEFAULT_INVOICE_TEMPLATE, active: true, createdAtISO: new Date().toISOString(), updatedAtISO: new Date().toISOString() } },
];
for (const source of sourceCases) {
  const { _id, _creationTime, ...value } = source.row;
  const olderId = await db.insert(source.table, value);
  for (let index = 0; index < 205; index++) await db.insert(source.table, value);
  let page = await automation.sourcePagePortable(ctx, { societyId, kind: source.kind, selectedId: olderId });
  assert.equal(page.selected?.id, olderId, "older selected source is resolved independently of the page");
  assert.equal(page.page.some(row => row.id === olderId), false); assert.equal(page.isDone, false); assert.ok(page.page.length <= 100);
  const selected = [...page.page];
  while (!page.isDone) { page = await automation.sourcePagePortable(ctx, { societyId, kind: source.kind, cursor: page.continueCursor }); assert.ok(page.page.length <= 100); selected.push(...page.page); }
  assert.ok(selected.some(row => row.id === olderId), `${source.kind}: full pagination includes older sources`);
  assert.ok(selected.length >= 206);
}
// Match the hosted constraint: an invocation may paginate only one collection.
let paginatedQueries = 0;
const singlePageDb = new Proxy(db, { get(target, property) {
  if (property === "query") return (table: string) => {
    const query = target.query(table), paginate = query.paginate.bind(query);
    query.paginate = async options => { assert.equal(++paginatedQueries, 1, "one paginated query per workspace invocation"); return paginate(options); };
    return query;
  };
  const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
} });
const singlePageCtx = { ...ctx, db: singlePageDb };
const defaultWorkspace = await automation.workspacePortable(singlePageCtx, { societyId });
assert.equal(paginatedQueries, 1); assert.ok(defaultWorkspace.settings); assert.ok(defaultWorkspace.schedules.length); assert.deepEqual(defaultWorkspace.runs, []);
paginatedQueries = 0;
const explicitSchedules = await automation.workspacePortable(singlePageCtx, { societyId, collection: "schedules" });
assert.equal(paginatedQueries, 1); assert.deepEqual(explicitSchedules.schedules, defaultWorkspace.schedules);
for (let index = 0; index < 55; index++) await db.insert("billingAutomationRuns", { societyId, scheduleId, occurrenceKey: `history-sample-${index}`, dueAtISO: at, status: "skipped", attempts: 0, nextAttemptAtISO: at, createdAtISO: at, updatedAtISO: at, createdByUserId: ownerId, snapshot: { kind: "sample", detail: "Do not return heavy snapshots in history pages." }, localPdfBase64: "sample-pdf-bytes", deliveries: [], history: [] });
paginatedQueries = 0;
let historyPage = await automation.workspacePortable(singlePageCtx, { societyId, collection: "runs" });
assert.equal(paginatedQueries, 1); assert.ok(historyPage.settings); assert.deepEqual(historyPage.schedules, []); assert.equal(historyPage.runs.length, 50); assert.equal(historyPage.runPagination.isDone, false);
const allHistory = [...historyPage.runs];
while (!historyPage.runPagination.isDone) {
  paginatedQueries = 0;
  historyPage = await automation.workspacePortable(singlePageCtx, { societyId, collection: "runs", runCursor: historyPage.runPagination.continueCursor });
  assert.equal(paginatedQueries, 1); allHistory.push(...historyPage.runs);
}
assert.equal(allHistory.length, (await db.query("billingAutomationRuns").withIndex("by_society", q => q.eq("societyId", societyId)).collect()).length, "history pages independently include every run");
assert.ok(allHistory.every(row => !Object.hasOwn(row, "snapshot") && !Object.hasOwn(row, "localPdfBase64")), "history pages omit large document and PDF payloads");
let schedulePage = await automation.workspacePortable(ctx, { societyId }); const allSchedules = [...schedulePage.schedules];
while (!schedulePage.schedulePagination.isDone) { schedulePage = await automation.workspacePortable(ctx, { societyId, scheduleCursor: schedulePage.schedulePagination.continueCursor }); allSchedules.push(...schedulePage.schedules); }
assert.equal(allSchedules.length, (await db.query("billingAutomationSchedules").withIndex("by_society", q => q.eq("societyId", societyId)).collect()).length, "schedule list explicitly pages beyond 200 rows");
const oldExisting = await automation.sourcePagePortable(ctx, { societyId, kind: "recurring_invoice", selectedId: seriesId });
assert.equal(oldExisting.existingSchedule?._id, scheduleId, "Configure automatic delivery can reopen its durable existing schedule");
// An active delivery schedule may remain enabled while its source is paused.
// Those schedules and legacy unconfirmed recipients must not starve later work.
{
  const fairnessSeed: Record<string, any[]> = structuredClone(tables);
  fairnessSeed.societies = [structuredClone(society)];
  let tick = Date.now();
  const fairnessDb = new MemoryDb({ seed: fairnessSeed, now: () => ++tick });
  const fairnessCtx: any = { ...ctx, db: fairnessDb };
  const dates = [today, nextBillingDate(today, "daily", 1)], clocks = dates.map(date => `${date}T23:59:00.000Z`);
  const settingsId = await automation.saveSettingsPortable(fairnessCtx, { societyId, enabled: true, fromEmail: "billing@example.test", fromName: "Fairness sample", senderConfirmed: true });
  const makeSeries = (name: string) => invoices.upsertSeriesPortable(fairnessCtx, { societyId, name, frequency: "monthly", startDate: today, endKind: "after_count", endAfterCount: 1, autoSend: false, partyKind: "custom", billToName: "Fairness sample customer", terms: "net_30", currency: "CAD", lines: [{ key: "sample", item: "Sample service", quantity: 1, unitPriceCents: 1000 }] });
  const baseSchedule = { societyId, name: "Fairness sample", recipients: ["fairness@example.test"], recipientsConfirmed: true, timezone: "UTC", localTime: "00:00", cadence: "monthly" as const, startDate: today, active: true };
  const definition = defaultCommerceReport("sales_items", today);
  definition.name = "Fairness report"; definition.filters.currency = "CAD";
  const definitionId = await reports.saveDefinitionPortable(fairnessCtx, { societyId, definition });
  // Created first, but never eligible under today's bounded due query.
  const futureId = await automation.saveSchedulePortable(fairnessCtx, { ...baseSchedule, name: "Future report", kind: "report", sourceId: definitionId, startDate: dates[1] });
  const pausedSources: Array<{ seriesId: string; scheduleId: string }> = [];
  for (let index = 0; index < 12; index++) {
    const seriesId = await makeSeries(`Paused source ${index}`);
    await invoices.setSeriesStatusPortable(fairnessCtx, { id: seriesId, status: "paused" });
    const scheduleId = await automation.saveSchedulePortable(fairnessCtx, { ...baseSchedule, name: `Paused source delivery ${index}`, kind: "recurring_invoice", sourceId: seriesId });
    pausedSources.push({ seriesId, scheduleId });
  }
  const unconfirmedIds: string[] = [];
  for (let index = 0; index < 11; index++) {
    const id = await automation.saveSchedulePortable(fairnessCtx, { ...baseSchedule, name: `Unconfirmed legacy delivery ${index}`, kind: "report", sourceId: definitionId, active: false, recipientsConfirmed: false });
    // Model an existing legacy row: public save correctly rejects this state.
    await fairnessDb.patch(id, { active: true }); unconfirmedIds.push(id);
  }
  const activeSeries = await makeSeries("Later active source");
  const activeSchedule = await automation.saveSchedulePortable(fairnessCtx, { ...baseSchedule, name: "Later active delivery", kind: "recurring_invoice", sourceId: activeSeries });
  const reminderInvoice = await invoices.upsertPortable(fairnessCtx, { societyId, partyKind: "custom", billToName: "Reminder sample", issueDate: today, terms: "due_on_receipt", currency: "CAD", lines: [{ key: "reminder", item: "Sample service", quantity: 1, unitPriceCents: 1200 }] });
  await invoices.markSentPortable(fairnessCtx, { societyId, ids: [reminderInvoice] });
  const reminderSchedule = await automation.saveSchedulePortable(fairnessCtx, { ...baseSchedule, name: "Later reminder", kind: "invoice_reminder", sourceId: reminderInvoice });
  const reportSchedule = await automation.saveSchedulePortable(fairnessCtx, { ...baseSchedule, name: "Later report", kind: "report", sourceId: definitionId });
  const scheduleScans: Array<{ cursor: string | null; bound: string; count: number; byteLimit: number | undefined }> = [];
  const rawQuery = fairnessDb.query.bind(fairnessDb);
  fairnessDb.query = ((table: string) => {
    const query = rawQuery(table);
    if (table !== "billingAutomationSchedules") return query;
    let bound = "";
    const withIndex = query.withIndex.bind(query), paginate = query.paginate.bind(query);
    query.withIndex = ((index: string, range: any) => {
      if (index === "by_society_active_due") {
        const recorder: any = { eq: () => recorder, lte: (field: string, value: string) => { if (field === "nextRunAtISO") bound = value; return recorder; } };
        range(recorder);
      }
      return withIndex(index, range);
    }) as any;
    query.paginate = async options => {
      const result = await paginate(options);
      scheduleScans.push({ cursor: options.cursor, bound, count: result.page.length, byteLimit: options.maximumBytesRead });
      return result;
    };
    return query;
  }) as any;
  assert.deepEqual(await automation.prepareDuePortable(fairnessCtx, { societyId, atISO: clocks[0] }), [], "ten enabled schedules with paused sources form an ineligible prefix");
  assert.ok((await fairnessDb.get(settingsId))!.dueScanCursor, "a durable cursor advances past the paused prefix");
  // Time progresses between cron invocations, but its paginated query stays fixed.
  assert.deepEqual(await automation.prepareDuePortable(fairnessCtx, { societyId, atISO: clocks[1] }), [], "remaining paused and unconfirmed sources do not issue anything");
  const later = await automation.prepareDuePortable(fairnessCtx, { societyId, atISO: clocks[1] });
  assert.equal(later.length, 3, "later recurring invoice, reminder and report progress past both ineligible prefixes");
  for (const scheduleId of [activeSchedule, reminderSchedule, reportSchedule]) {
    const run = await fairnessDb.query("billingAutomationRuns").withIndex("by_schedule_occurrence", q => q.eq("scheduleId", scheduleId).eq("occurrenceKey", today)).unique();
    assert.equal(run?.status, "queued", "eligible sources create real durable delivery jobs");
  }
  assert.equal((await fairnessDb.get(activeSeries))!.issuedCount, 1);
  assert.equal((await fairnessDb.get(settingsId))!.dueScanCursor, undefined, "completed scans reset for resumed sources and newly due work");
  assert.equal(await fairnessDb.query("billingAutomationRuns").withIndex("by_schedule_occurrence", q => q.eq("scheduleId", futureId)).first(), null, "a later clock cannot change the in-progress scan's due bound");
  assert.ok(scheduleScans.slice(0, 3).every(scan => scan.bound === clocks[0] && scan.count <= 10 && scan.byteLimit === 4_000_000), "each continuation retains its query bound and bounded reads");
  for (const source of pausedSources) {
    assert.equal((await fairnessDb.get(source.seriesId))!.issuedCount, 0);
    assert.equal((await fairnessDb.get(source.scheduleId))!.active, true, "delivery enable state survives a paused source");
    assert.equal((await fairnessDb.get(source.scheduleId))!.nextLocalDate, today);
  }
  assert.equal((await fairnessDb.query("billingAutomationRuns").collect()).some(run => unconfirmedIds.includes(run.scheduleId)), false, "unconfirmed recipients never get delivery jobs");
  await invoices.setSeriesStatusPortable(fairnessCtx, { id: pausedSources[0].seriesId, status: "active" });
  // Enough complete bounded scans cover numeric local cursors as rows move out
  // of the due set, as well as hosted cursors that retain their index position.
  for (let pass = 0; pass < 8; pass++) await automation.prepareDuePortable(fairnessCtx, { societyId, atISO: clocks[1] });
  assert.equal((await fairnessDb.get(pausedSources[0].seriesId))!.issuedCount, 1, "resuming a source issues its original occurrence once");
  assert.equal((await fairnessDb.query("billingAutomationRuns").withIndex("by_schedule_occurrence", q => q.eq("scheduleId", pausedSources[0].scheduleId)).collect()).length, 1, "repeated scans do not duplicate the resumed occurrence");
  assert.ok(await fairnessDb.query("billingAutomationRuns").withIndex("by_schedule_occurrence", q => q.eq("scheduleId", futureId).eq("occurrenceKey", dates[1])).unique(), "the next scan discovers newly due work");
  assert.ok(scheduleScans.every(scan => scan.count <= 10 && scan.byteLimit === 4_000_000));
  const outerPage = await (dueWork as any)._handler({ db: fairnessDb }, { scanAtISO: clocks[0] });
  assert.equal(outerPage.scanAtISO, clocks[0]); assert.equal(outerPage.isDone, false);
  const outerNext = await (dueWork as any)._handler({ db: fairnessDb }, { cursor: outerPage.continueCursor, scanAtISO: outerPage.scanAtISO });
  assert.equal(outerNext.scanAtISO, clocks[0], "the hosted outer query keeps its original clock across continuation pages");
  let continuation: any;
  await (scan as any)._handler({
    runQuery: async (_reference: any, args: any) => { assert.equal(args.scanAtISO, clocks[0]); return { actors: [], isDone: false, continueCursor: "next-hosted-page", scanAtISO: clocks[0] }; },
    scheduler: { runAfter: async (_delay: number, reference: any, args: any) => { assert.equal(getFunctionName(reference), "billingAutomationActions:scan"); continuation = args; } },
  }, { scanAtISO: clocks[0] });
  assert.deepEqual(continuation, { cursor: "next-hosted-page", scanAtISO: clocks[0] }, "the hosted worker durably carries its clock to the next action");
}
console.log("Billing automation checks passed: timezone/DST, disabled defaults, consent, ownership, issuance idempotency, durable leases, fair bounded due scans, single-page workspace queries, real native PDFs, frozen exact report filters, mocked Resend attachments/idempotency, Microsoft ambiguous-send recovery, partial failures and retries. No external messages sent.");
