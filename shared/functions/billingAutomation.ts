import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { requireSocietyMembership, principalUserId } from "./access";
import { requirePermissionPortable } from "./permissions";
import { issueFromSeriesPortable, markSentPortable } from "./invoices";
import { cleanInvoiceTemplate } from "../invoiceCommerce";
import { billingRetryAt, billingWallTime, cleanBillingEmail, cleanBillingRecipients, nextBillingDate, validateBillingTimezone, automationError, type BillingAutomationKind, type BillingCadence } from "../billingAutomation";

const now = () => new Date().toISOString();
const owned = async (ctx: PortableQueryCtx, table: string, id: string, societyId: string) => { const row = await ctx.db.get(id, table); if (!row || row.societyId !== societyId) throw new Error(`${table} not found.`); return row; };
const writer = async (ctx: PortableQueryCtx, societyId: string) => requirePermissionPortable(ctx, societyId, "financials:write");
const settingsFor = (ctx: PortableQueryCtx, societyId: string) => ctx.db.query("billingAutomationSettings").withIndex("by_society", (q) => q.eq("societyId", societyId)).first();
function history(run: any, event: string, detail?: string) { return [...(run.history ?? []), { atISO: now(), event, ...(detail ? { detail: detail.slice(0, 1500) } : {}) }].slice(-150); }
function senderBlock(settings: any, schedule: any) { return !settings?.enabled ? "Enable automatic delivery in Sender settings." : !settings.senderConfirmed ? "Confirm that this workspace may send from this address." : !schedule.recipientsConfirmed ? "Confirm that these recipients may receive this document." : !schedule.active ? "This schedule is paused." : null; }

export async function workspacePortable(ctx: PortableQueryCtx, { societyId, collection = "schedules", scheduleCursor = null, runCursor = null }: { societyId: string; collection?: "schedules" | "runs"; scheduleCursor?: string | null; runCursor?: string | null }) {
  await requireSocietyMembership(ctx, societyId);
  if (collection !== "schedules" && collection !== "runs") throw new Error("Unknown delivery workspace collection.");
  // Convex permits a single paginated query per invocation. Keep schedule and
  // history subscriptions independent so either collection can grow safely.
  const [settings, result] = await Promise.all([
    settingsFor(ctx, societyId),
    collection === "schedules"
      ? ctx.db.query("billingAutomationSchedules").withIndex("by_society", (q) => q.eq("societyId", societyId)).order("desc").paginate({ numItems: 50, cursor: scheduleCursor, maximumBytesRead: 4_000_000 })
      : ctx.db.query("billingAutomationRuns").withIndex("by_society", (q) => q.eq("societyId", societyId)).order("desc").omitFields("snapshot", "localPdfBase64").paginate({ numItems: 50, cursor: runCursor, maximumBytesRead: 4_000_000 }),
  ]);
  const pagination = { isDone: result.isDone, continueCursor: result.continueCursor }, empty = { isDone: true, continueCursor: "" };
  return { settings, schedules: collection === "schedules" ? result.page : [], runs: collection === "runs" ? result.page.map(({ snapshot: _snapshot, localPdfBase64: _localPdf, ...row }) => row) : [], schedulePagination: collection === "schedules" ? pagination : empty, runPagination: collection === "runs" ? pagination : empty };
}
export type BillingAutomationSourceKind = BillingAutomationKind | "template";
export async function sourcePagePortable(ctx: PortableQueryCtx, { societyId, kind, cursor = null, selectedId }: { societyId: string; kind: BillingAutomationSourceKind; cursor?: string | null; selectedId?: string }) {
  await requireSocietyMembership(ctx, societyId);
  const table = kind === "recurring_invoice" ? "invoiceSeries" : kind === "invoice_reminder" ? "invoices" : kind === "report" ? "reportDefinitions" : kind === "template" ? "invoiceTemplates" : null;
  if (!table) throw new Error("Unknown delivery source type.");
  const convert = (r: any): { id: string; name: string; email?: string } | null => {
    if (kind === "template") return r.active ? { id: r._id, name: String(r.config?.name ?? "Document template") } : null;
    if (kind === "report") return !r.archived ? { id: r._id, name: String(r.definition?.name ?? "Saved report") } : null;
    if (kind === "invoice_reminder") return !["void", "draft"].includes(r.status) && Number(r.totalCents) > Number(r.paidCents ?? 0) ? { id: r._id, name: `${r.number} · ${r.billToName}`, ...(r.billToEmail ? { email: r.billToEmail } : {}) } : null;
    return r.status !== "ended" && r.nextIssueDate ? { id: r._id, name: String(r.name), ...(r.billToEmail ? { email: r.billToEmail } : {}) } : null;
  };
  const result = await ctx.db.query(table).withIndex("by_society", q => q.eq("societyId", societyId)).order("desc").paginate({ numItems: 100, cursor, maximumBytesRead: 4_000_000 });
  const selected = selectedId ? convert(await owned(ctx, table, selectedId, societyId)) : null;
  const existingSchedule = kind === "recurring_invoice" && selectedId ? await ctx.db.query("billingAutomationSchedules").withIndex("by_society_kind_source", q => q.eq("societyId", societyId).eq("kind", "recurring_invoice").eq("sourceId", selectedId)).first() : null;
  return { ...result, page: result.page.map(convert).filter((row) => row !== null), selected, existingSchedule };
}
export async function saveSettingsPortable(ctx: PortableMutationCtx, args: { societyId: string; enabled: boolean; fromEmail: string; fromName: string; replyTo?: string; senderConfirmed: boolean }) {
  await writer(ctx, args.societyId);
  if (args.enabled && !args.senderConfirmed) throw new Error("Confirm sender authorization before enabling delivery.");
  const row = { societyId: args.societyId, enabled: args.enabled, fromEmail: cleanBillingEmail(args.fromEmail), fromName: args.fromName.trim().slice(0, 120), replyTo: args.replyTo?.trim() ? cleanBillingEmail(args.replyTo) : undefined, senderConfirmed: args.senderConfirmed, updatedAtISO: now(), updatedByUserId: await principalUserId(ctx, args.societyId) };
  const old = await settingsFor(ctx, args.societyId);
  if (old) { await ctx.db.patch(old._id, row); return old._id; }
  return ctx.db.insert("billingAutomationSettings", row);
}
export type SaveBillingScheduleArgs = { societyId: string; id?: string; name: string; kind: BillingAutomationKind; sourceId: string; templateId?: string; recipients: string[]; recipientsConfirmed: boolean; timezone: string; localTime: string; cadence: BillingCadence; startDate: string; active?: boolean };
export async function saveSchedulePortable(ctx: PortableMutationCtx, args: SaveBillingScheduleArgs) {
  await writer(ctx, args.societyId);
  const old = args.id ? await owned(ctx, "billingAutomationSchedules", args.id, args.societyId) : null;
  if (!args.name.trim() || args.name.length > 150) throw new Error("Enter a schedule name of 150 characters or fewer.");
  if (!["recurring_invoice", "invoice_reminder", "report"].includes(args.kind) || !["daily", "weekly", "monthly"].includes(args.cadence)) throw new Error("Unknown schedule type or cadence.");
  const source = await owned(ctx, args.kind === "report" ? "reportDefinitions" : args.kind === "recurring_invoice" ? "invoiceSeries" : "invoices", args.sourceId, args.societyId);
  if (args.kind === "report" && source.archived) throw new Error("Choose an active saved report.");
  if (args.kind === "invoice_reminder" && ["draft", "void"].includes(source.status)) throw new Error("Reminders require an issued invoice.");
  if (args.templateId) await owned(ctx, "invoiceTemplates", args.templateId, args.societyId);
  if (args.kind === "recurring_invoice") { const duplicate = (await ctx.db.query("billingAutomationSchedules").withIndex("by_society_kind_source", q => q.eq("societyId", args.societyId).eq("kind", "recurring_invoice").eq("sourceId", args.sourceId)).take(2)).find(row => row._id !== args.id); if (duplicate) throw new Error("This recurring series already has a delivery schedule. Edit its existing schedule in Invoices → Automation."); }
  const active = args.active ?? old?.active ?? false;
  if (active && !args.recipientsConfirmed) throw new Error("Confirm recipient authorization before enabling this schedule.");
  const timezone = validateBillingTimezone(args.timezone), recipients = cleanBillingRecipients(args.recipients);
  const nextLocalDate = args.kind === "recurring_invoice" ? String(source.nextIssueDate ?? "") : args.startDate;
  const row = { societyId: args.societyId, name: args.name.trim(), kind: args.kind, sourceId: args.sourceId, templateId: args.templateId, recipients, recipientsConfirmed: args.recipientsConfirmed, active, timezone, localTime: args.localTime, cadence: args.cadence, anchorDay: Number(args.startDate.slice(8)), nextLocalDate, nextRunAtISO: billingWallTime(nextLocalDate, args.localTime, timezone), createdByUserId: old?.createdByUserId ?? await principalUserId(ctx, args.societyId), createdAtISO: old?.createdAtISO ?? now(), updatedAtISO: now() };
  if (old) { await ctx.db.patch(old._id, row); return old._id; }
  return ctx.db.insert("billingAutomationSchedules", row);
}
export async function setScheduleActivePortable(ctx: PortableMutationCtx, { societyId, id, active }: { societyId: string; id: string; active: boolean }) {
  await writer(ctx, societyId); const schedule = await owned(ctx, "billingAutomationSchedules", id, societyId);
  if (active && !schedule.recipientsConfirmed) throw new Error("Confirm recipient authorization by editing this schedule first.");
  await ctx.db.patch(id, { active, updatedAtISO: now() }); return null;
}
async function invoiceSnapshot(ctx: PortableQueryCtx, invoice: any, templateId?: string) {
  const society = await ctx.db.get(invoice.societyId, "societies");
  const template = templateId ? await owned(ctx, "invoiceTemplates", templateId, invoice.societyId) : null;
  const settings = await ctx.db.query("invoiceSettings").withIndex("by_society", (q) => q.eq("societyId", invoice.societyId)).first();
  const { _id, _creationTime, societyId, ...document } = invoice;
  return { kind: "invoice", invoice: { ...document, status: document.status === "draft" ? "sent" : document.status, documentTemplate: cleanInvoiceTemplate(template?.config ?? invoice.documentTemplate) }, organization: { name: society?.name ?? "Organization", address: society?.mailingAddress ?? society?.registeredOfficeAddress, email: society?.publicContactEmail ?? society?.officialEmail, registrationNumber: society?.incorporationNumber, logoStorageId: society?.logoStorageId }, paymentInstructions: settings?.paymentInstructions };
}
/** Atomic issuance and occurrence recording: overlapping cron scans cannot duplicate an invoice. */
export async function prepareDuePortable(ctx: PortableMutationCtx, { societyId, atISO }: { societyId: string; atISO?: string }) {
  await writer(ctx, societyId); const clock = atISO ?? now();
  if (ctx.principal.runtime !== "test" && atISO) throw new Error("The delivery clock is controlled by the runtime.");
  if (!Number.isFinite(Date.parse(clock))) throw new Error("Invalid delivery clock.");
  const at = new Date(clock).toISOString(), settings = await settingsFor(ctx, societyId);
  let schedules: Record<string, any>[] = [];
  if (settings?.enabled && settings.senderConfirmed) {
    // Persist both the cursor and its clock bound: a continuation must use the
    // same indexed query even when a later cron invocation has a newer clock.
    // Advance the page before examining sources so paused/unconfirmed schedules
    // cannot monopolize the due prefix. A completed scan revisits resumed sources.
    const continuing = settings.dueScanAtISO && settings.dueScanAtISO <= at;
    const scanAt = continuing ? settings.dueScanAtISO : at;
    const page = await ctx.db.query("billingAutomationSchedules").withIndex("by_society_active_due", (q) => q.eq("societyId", societyId).eq("active", true).lte("nextRunAtISO", scanAt)).paginate({ numItems: 10, cursor: continuing ? settings.dueScanCursor ?? null : null, maximumBytesRead: 4_000_000 });
    await ctx.db.patch(settings._id, { dueScanCursor: page.isDone ? undefined : page.continueCursor, dueScanAtISO: page.isDone ? undefined : scanAt });
    schedules = page.page;
  }
  const prepared: string[] = [];
  for (const schedule of schedules) {
    if (senderBlock(settings, schedule)) continue;
    // Revalidate the schedule owner every time, including service/cron execution.
    const ownerCtx = ctx.principal.assurance === "trusted-workspace" ? ctx : { ...ctx, principal: { kind: "service" as const, runtime: ctx.principal.runtime, assurance: "trusted-internal" as const, subject: "billing-automation", societyId, actorUserId: schedule.createdByUserId, scopes: ["financials:write"] } };
    try { await writer(ownerCtx, societyId); } catch { await ctx.db.patch(schedule._id, { active: false, updatedAtISO: now() }); continue; }
    const occurrenceKey = schedule.nextLocalDate;
    let run = await ctx.db.query("billingAutomationRuns").withIndex("by_schedule_occurrence", (q) => q.eq("scheduleId", schedule._id).eq("occurrenceKey", occurrenceKey)).unique();
    let invoiceId: string | undefined, snapshot: any, skip: string | undefined;
    if (!run) {
      if (schedule.kind === "recurring_invoice") {
        const series = await owned(ctx, "invoiceSeries", schedule.sourceId, societyId);
        if (series.status === "paused") continue;
        if (series.status !== "active" || !series.nextIssueDate) { await ctx.db.patch(schedule._id, { active: false, updatedAtISO: now() }); continue; }
        if (series.nextIssueDate !== schedule.nextLocalDate) { await ctx.db.patch(schedule._id, { nextLocalDate: series.nextIssueDate, nextRunAtISO: billingWallTime(series.nextIssueDate, schedule.localTime, schedule.timezone), updatedAtISO: now() }); continue; }
        invoiceId = await issueFromSeriesPortable(ownerCtx, { id: series._id });
        snapshot = await invoiceSnapshot(ctx, await ctx.db.get(invoiceId, "invoices"), schedule.templateId);
      } else if (schedule.kind === "invoice_reminder") {
        const invoice = await owned(ctx, "invoices", schedule.sourceId, societyId); invoiceId = invoice._id;
        if (["draft", "void"].includes(invoice.status) || Number(invoice.totalCents) <= Number(invoice.paidCents ?? 0)) skip = "Invoice is paid, void or unissued.";
        else if (invoice.dueDate > schedule.nextLocalDate) skip = "Invoice is not due yet.";
        snapshot = await invoiceSnapshot(ctx, invoice, schedule.templateId);
      } else {
        const definition = await owned(ctx, "reportDefinitions", schedule.sourceId, societyId);
        if (definition.archived) skip = "Saved report was archived.";
        snapshot = { kind: "report", definition: JSON.parse(JSON.stringify(definition)), templateId: schedule.templateId };
      }
      const deliveries: Array<{ to: string; status: string; pendingEmailId: string }> = [];
      for (const to of schedule.recipients) {
        const pendingEmailId = await ctx.db.insert("pendingEmails", { societyId, to, fromName: settings?.fromName, fromEmail: settings?.fromEmail, replyTo: settings?.replyTo, subject: `${schedule.kind === "invoice_reminder" ? "Payment reminder: " : ""}${snapshot?.invoice?.number ?? schedule.name}`, body: `Please find the attached ${schedule.kind === "report" ? "financial report" : "invoice"}.`, attachments: [], status: skip ? "cancelled" : "ready", createdAtISO: at, automationScheduleId: schedule._id, providerState: skip ? "skipped" : "queued" });
        deliveries.push({ to, status: skip ? "skipped" : "queued", pendingEmailId });
      }
      const id = await ctx.db.insert("billingAutomationRuns", { societyId, scheduleId: schedule._id, occurrenceKey, dueAtISO: schedule.nextRunAtISO, status: skip ? "skipped" : "queued", attempts: 0, nextAttemptAtISO: at, createdAtISO: at, updatedAtISO: at, createdByUserId: schedule.createdByUserId, invoiceId, snapshot, deliveries, history: [{ atISO: at, event: skip ? "skipped" : "queued", ...(skip ? { detail: skip } : {}) }] });
      for (const delivery of deliveries) await ctx.db.patch(delivery.pendingEmailId, { automationRunId: id });
      run = (await ctx.db.get(id))!;
    }
    if (schedule.kind === "recurring_invoice") {
      const series = await ctx.db.get(schedule.sourceId, "invoiceSeries");
      await ctx.db.patch(schedule._id, series?.nextIssueDate && series.status === "active" ? { nextLocalDate: series.nextIssueDate, nextRunAtISO: billingWallTime(series.nextIssueDate, schedule.localTime, schedule.timezone), updatedAtISO: at } : { nextRunAtISO: "9999-12-31T23:59:00.000Z", updatedAtISO: at });
    } else { const date = nextBillingDate(schedule.nextLocalDate, schedule.cadence, schedule.anchorDay); await ctx.db.patch(schedule._id, { nextLocalDate: date, nextRunAtISO: billingWallTime(date, schedule.localTime, schedule.timezone), updatedAtISO: at }); }
    prepared.push(run._id);
  }
  const runs = (await Promise.all(["queued", "retry", "blocked", "working", "accepted"].map((status) => ctx.db.query("billingAutomationRuns").withIndex(status === "accepted" ? "by_society_status_finalized_retry" : "by_society_status_retry", (q) => { const base = q.eq("societyId", societyId).eq("status", status); return (status === "accepted" ? base.eq("finalizedAtISO", undefined) : base).lte("nextAttemptAtISO", at); }).take(20)))).flat();
  return [...new Set([...prepared, ...runs.filter((r) => (["queued", "retry", "blocked", "working"].includes(r.status) || (r.status === "accepted" && !r.finalizedAtISO)) && r.nextAttemptAtISO <= at && (!r.leaseUntilISO || r.leaseUntilISO <= at)).map((r) => r._id)])].slice(0, 20);
}
export type ClaimedBillingRun = Record<string, any> & { leaseToken: string; alreadyAccepted?: boolean; schedule: Record<string, any>; settings: Record<string, any> | null };
export async function claimRunPortable(ctx: PortableMutationCtx, { societyId, id, atISO }: { societyId: string; id: string; atISO?: string }): Promise<ClaimedBillingRun | null> {
  await writer(ctx, societyId); const run = await owned(ctx, "billingAutomationRuns", id, societyId), at = atISO && ctx.principal.runtime === "test" ? atISO : now();
  const schedule = await owned(ctx, "billingAutomationSchedules", run.scheduleId, societyId), settings = await settingsFor(ctx, societyId);
  if (run.status === "accepted" && !run.finalizedAtISO) return { ...run, alreadyAccepted: true, leaseToken: run.leaseToken, schedule, settings };
  if (["accepted", "skipped", "failed", "uncertain"].includes(run.status) || run.nextAttemptAtISO > at || (run.leaseUntilISO && run.leaseUntilISO > at)) return null;
  const blocked = senderBlock(settings, schedule);
  if (blocked) { await ctx.db.patch(id, { status: "blocked", lastError: blocked, nextAttemptAtISO: billingRetryAt(at, 1), updatedAtISO: at }); return null; }
  if (run.invoiceId) {
    const invoice = await ctx.db.get(run.invoiceId, "invoices");
    if (!invoice || invoice.societyId !== societyId || invoice.status === "void" || (schedule.kind === "invoice_reminder" && (invoice.status === "draft" || Number(invoice.totalCents) <= Number(invoice.paidCents ?? 0)))) {
      const deliveries = run.deliveries.map((delivery: any) => delivery.status === "accepted" ? delivery : { ...delivery, status: "skipped" });
      for (const delivery of deliveries) if (delivery.status === "skipped" && delivery.pendingEmailId) await ctx.db.patch(delivery.pendingEmailId, { status: "cancelled", providerState: "skipped", notes: "Invoice no longer requires this delivery (paid reminder, void or deleted invoice)." });
      await ctx.db.patch(id, { status: "skipped", deliveries, lastError: "Invoice no longer requires this delivery (paid reminder, void or deleted invoice).", history: history(run, "skipped", "Invoice no longer requires this delivery (paid reminder, void or deleted invoice)."), updatedAtISO: at }); return null;
    }
  }
  const token = crypto.randomUUID();
  await ctx.db.patch(id, { status: "working", leaseToken: token, leaseUntilISO: new Date(Date.parse(at) + 12 * 60_000).toISOString(), attempts: run.attempts + 1, updatedAtISO: at, history: history(run, "claimed") });
  return { ...run, status: "working", attempts: run.attempts + 1, leaseToken: token, schedule, settings };
}
/** Worker-only state transitions. Hosted wrappers expose this ONLY as internal mutations. */
export async function workerUpdatePortable(ctx: PortableMutationCtx, args: { societyId: string; id: string; token: string; event: string; patch: Record<string, any> }) {
  const run = await owned(ctx, "billingAutomationRuns", args.id, args.societyId);
  if (run.leaseToken !== args.token) throw new Error("This delivery lease has expired.");
  await ctx.db.patch(args.id, { ...args.patch, updatedAtISO: now(), history: history(run, args.event, args.patch.lastError) }); return null;
}
export async function finalizeRunPortable(ctx: PortableMutationCtx, { societyId, id }: { societyId: string; id: string }) {
  const run = await owned(ctx, "billingAutomationRuns", id, societyId);
  if (run.status !== "accepted" || run.finalizedAtISO) return null;
  if (run.invoiceId) {
    const schedule = await owned(ctx, "billingAutomationSchedules", run.scheduleId, societyId);
    if (schedule.kind === "recurring_invoice") await markSentPortable(ctx, { societyId, ids: [run.invoiceId], draftEmail: false });
    else await ctx.db.patch(run.invoiceId, { lastReminderAtISO: now() });
  }
  await ctx.db.patch(id, { finalizedAtISO: now(), history: history(run, "finalized"), lastError: undefined }); return null;
}
export async function retryRunPortable(ctx: PortableMutationCtx, { societyId, id }: { societyId: string; id: string }) {
  await writer(ctx, societyId); const run = await owned(ctx, "billingAutomationRuns", id, societyId);
  if (["accepted", "skipped"].includes(run.status)) return null;
  if (run.leaseUntilISO && run.leaseUntilISO > now()) throw new Error("This delivery is still running.");
  if (run.status === "uncertain" && !run.deliveries.filter((d: any) => d.status !== "accepted").every((d: any) => d.providerDraftId && d.submissionStartedAtISO)) throw new Error("Provider acceptance is uncertain and its idempotency window expired. Reconcile the message in the original provider before creating another delivery.");
  await ctx.db.patch(id, { status: "queued", attempts: 0, nextAttemptAtISO: now(), leaseToken: undefined, leaseUntilISO: undefined, history: history(run, run.status === "uncertain" ? "provider_probe_requested" : "retry_requested"), updatedAtISO: now() }); return null;
}
export async function getRunPortable(ctx: PortableQueryCtx, { societyId, id }: { societyId: string; id: string }) { await writer(ctx, societyId); return owned(ctx, "billingAutomationRuns", id, societyId); }

/** Local workspaces use the same durable jobs, with a real native email adapter. No simulated acceptance. */
export async function deliverLocalPortable(ctx: PortableMutationCtx, args: { societyId: string; id: string; pdfBase64?: string; fileName?: string; documentSnapshot?: any }) {
  if (ctx.principal.runtime === "convex-hosted") throw new Error("Hosted delivery must run in the server action.");
  const claimed = await claimRunPortable(ctx, args); if (!claimed) return { accepted: 0, status: "not_due" };
  if (claimed.alreadyAccepted) { await finalizeRunPortable(ctx, args); return { accepted: claimed.deliveries.length, status: "accepted" }; }
  const patch = (event: string, value: Record<string, any>) => workerUpdatePortable(ctx, { societyId: args.societyId, id: args.id, token: claimed.leaseToken, event, patch: value });
  const deliveries = claimed.deliveries.map((d: any) => ({ ...d }));
  try {
    if (!ctx.capabilities.has("email") || !ctx.capabilities.email.supportsAttachments || !ctx.capabilities.email.supportsIdempotency) throw new Error("Connect a native email service supporting PDF attachments and idempotent delivery, or run this schedule on a hosted Societyer workspace.");
    const pdfBase64 = claimed.localPdfBase64 ?? args.pdfBase64;
    if (!pdfBase64 || pdfBase64.length > 20_000_000 || !pdfBase64.startsWith("JVBERi0")) throw new Error("Generate the document PDF before delivery.");
    if (!claimed.localPdfBase64) await patch("document_frozen", { localPdfBase64: pdfBase64, fileName: args.fileName ?? "document.pdf", snapshot: args.documentSnapshot ?? claimed.snapshot });
    for (const delivery of deliveries) {
      if (delivery.status === "accepted") continue;
      const outbox = await ctx.db.get(delivery.pendingEmailId, "pendingEmails");
      delivery.envelope ??= { from: claimed.settings!.fromEmail, replyTo: claimed.settings!.replyTo, subject: outbox?.subject ?? claimed.schedule.name, text: outbox?.body ?? "Please find the attached document." };
      await patch("provider_submission_started", { deliveries });
      const accepted = await ctx.capabilities.email.sendEmail({ ...delivery.envelope, to: delivery.to, idempotencyKey: `${claimed._id}:${delivery.to}`, attachments: [{ filename: claimed.fileName ?? args.fileName ?? "document.pdf", contentType: "application/pdf", contentBase64: pdfBase64 }] });
      if (!accepted.accepted || !accepted.id) throw new Error("The email service did not confirm provider acceptance.");
      Object.assign(delivery, { status: "accepted", providerId: accepted.id, provider: "native", acceptedAtISO: now() });
      await ctx.db.patch(delivery.pendingEmailId, { status: "sent", providerState: "accepted", providerMessageId: accepted.id, sentAtISO: now(), sentChannel: "native", notes: "Email provider accepted this message. Delivery to the recipient is not confirmed." });
      await patch("provider_accepted", { deliveries });
    }
    await patch("accepted", { status: "accepted", leaseUntilISO: undefined, lastError: undefined });
    try { await finalizeRunPortable(ctx, args); } catch (error) { await ctx.db.patch(args.id, { lastError: `Provider accepted; invoice bookkeeping needs attention: ${automationError(error)}` }); }
    return { accepted: deliveries.length, status: "accepted" };
  } catch (error) { await patch("blocked", { status: "blocked", lastError: automationError(error), leaseUntilISO: undefined, nextAttemptAtISO: billingRetryAt(now(), claimed.attempts) }); return { accepted: deliveries.filter((d: any) => d.status === "accepted").length, status: "blocked" }; }
}
