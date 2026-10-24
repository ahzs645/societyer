import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireOwnedRow, principalUserId } from "./access";
import { requirePermissionPortable } from "./permissions";
import { cleanInvoiceTemplate, invoiceCurrency, REPAIR_TRANSITIONS, type RepairStatus } from "../invoiceCommerce";
import { computeInvoiceTotals, isCalendarDate, validateInvoiceLines } from "../invoicing";
import { buildCustomerStatement, QUOTE_STATUSES, type QuoteFields, type QuoteStatus } from "../billingDocuments";
import { upsertPortable, upsertRepairJobPortable, invoiceRepairJobPortable, setRepairStatusPortable } from "./invoices";
import { assertRepairApprovalPortable, repairApprovalScope } from "./repairOperationsGuard";
import { cleanInvoiceMoney } from "../invoiceMoney";
import { loadInvoiceLedgerContext } from "./invoiceLedger";
import { resolutionCalendarDate, resolutionTimeZone } from "../writtenResolutionEvidence";

type Ctx = PortableQueryCtx;
type Row = { _id: string; societyId: string; [key: string]: any };
const now = () => new Date().toISOString();
async function calendarToday(ctx: Ctx, societyId: string) { const organization: any = await ctx.db.get(societyId, "societies"); const iso = now(); return resolutionCalendarDate(iso, resolutionTimeZone(organization)) ?? iso.slice(0, 10); }
const text = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);
async function read(ctx: Ctx, societyId: string) { return requirePermissionPortable(ctx, societyId, "financials:read"); }
async function write(ctx: Ctx, societyId: string) { return requirePermissionPortable(ctx, societyId, "financials:write"); }
async function rows(ctx: Ctx, table: string, societyId: string, limit = 10000) {
  const found = await ctx.db.query<Row>(table).withIndex("by_society", (q) => q.eq("societyId", societyId)).take(limit + 1);
  if (found.length > limit) throw new Error(`This ${table} result exceeds ${limit} records. Narrow the data before generating this document.`);
  return found;
}
async function actor(ctx: Ctx, societyId: string) { return principalUserId(ctx, societyId); }
async function quote(ctx: Ctx, id: string) { const found = await requireOwnedRow<Row>(ctx, "billingQuotes", id); await read(ctx, found.societyId); return found; }
async function repair(ctx: Ctx, id: string) { const found = await requireOwnedRow<Row>(ctx, "repairJobs", id); await write(ctx, found.societyId); return found; }
async function operations(ctx: Ctx, id: string) { return ctx.db.query<Row>("repairOperations").withIndex("by_repair_job", (q) => q.eq("repairJobId", id)).first(); }
async function operationEvent(ctx: PortableMutationCtx, job: Row, kind: string, label: string, details?: string) {
  await ctx.db.insert("repairOperationEvents", { societyId: job.societyId, repairJobId: job._id, kind, label, actorUserId: await actor(ctx, job.societyId), atISO: now(), ...(details ? { details } : {}) });
}
async function updateOperations(ctx: PortableMutationCtx, job: Row, patch: Record<string, any>) {
  const found = await operations(ctx, job._id);
  if (found) { await ctx.db.patch(found._id, { ...patch, updatedAtISO: now() }); return found._id; }
  return ctx.db.insert("repairOperations", { societyId: job.societyId, repairJobId: job._id, approvalRequired: false, approvalStatus: "not_required", ...patch, updatedAtISO: now() });
}
async function technician(ctx: Ctx, societyId: string, userId: string) {
  const user: any = await getOwned(ctx, "users", userId, societyId);
  if (user.status && user.status !== "Active") throw new Error("Choose an active technician.");
  return user;
}
function rate(value: number) { if (!Number.isSafeInteger(value) || value < 0 || value > 100_000_000) throw new Error("Hourly rates must be non-negative integer cents."); return value; }

async function cleanQuoteFields(ctx: Ctx, societyId: string, input: QuoteFields): Promise<QuoteFields> {
  if (!["member", "organization", "custom"].includes(input.partyKind)) throw new Error("Choose a customer type.");
  if (!text(input.billToName, 200)) throw new Error("Choose a quote customer.");
  if (!isCalendarDate(input.issueDate) || !isCalendarDate(input.validUntil) || input.validUntil < input.issueDate) throw new Error("Choose a valid quote issue date and expiry date.");
  if (!Array.isArray(input.lines) || input.lines.length > 500) throw new Error("A quote supports up to 500 item lines.");
  const problem = validateInvoiceLines(input.lines);
  if (problem) throw new Error(problem);
  const catalogRefs = new Set<string>(), tagRefs = new Map<string, any>();
  for (const line of input.lines) {
    if (!line.key || !Number.isSafeInteger(line.unitPriceCents)) throw new Error("Quote lines require unique keys and integer-cent prices.");
    if (line.catalogItemId && !catalogRefs.has(line.catalogItemId)) { await getOwned(ctx, "invoiceCatalogItems", line.catalogItemId, societyId); catalogRefs.add(line.catalogItemId); }
    if ((line.tagIds?.length ?? 0) > 10 || new Set(line.tagIds ?? []).size !== (line.tagIds?.length ?? 0)) throw new Error("Choose up to ten distinct tags per quote line.");
    const groups = new Set<string>();
    for (const tagId of line.tagIds ?? []) { let tag = tagRefs.get(tagId); if (!tag) { tag = await getOwned(ctx, "financeTags", tagId, societyId); tagRefs.set(tagId, tag); } if (tag.archivedAtISO || groups.has(tag.groupId)) throw new Error("Choose one active tag per group on each quote line."); groups.add(tag.groupId); }
  }
  if (new Set(input.lines.map((line) => line.key)).size !== input.lines.length) throw new Error("Quote line keys must be unique.");
  if (input.partyKind === "member") { if (!input.memberId) throw new Error("Choose a member."); await getOwned(ctx, "members", input.memberId, societyId); }
  if (input.partyKind === "organization") { if (!input.counterpartyId) throw new Error("Choose a saved customer."); await getOwned(ctx, "accountingCounterparties", input.counterpartyId, societyId); }
  if (input.discount && (!["percent", "amount"].includes(input.discount.kind) || !Number.isFinite(input.discount.value) || input.discount.value < 0 || (input.discount.kind === "percent" && input.discount.value > 100))) throw new Error("Choose a valid quote discount.");
  const { workspaceCurrency } = await loadInvoiceLedgerContext(ctx, societyId);
  const money = cleanInvoiceMoney(input.money, invoiceCurrency(input.currency), workspaceCurrency);
  const total = computeInvoiceTotals(input.lines, input.discount, money).totalCents;
  if (!Number.isSafeInteger(total) || total < 0) throw new Error("The quote total must be a non-negative integer-cent amount.");
  const cleaned = { ...input, billToName: text(input.billToName, 200), billToEmail: text(input.billToEmail, 200) || undefined, billToAddress: text(input.billToAddress, 2000) || undefined,
    shipToName: text(input.shipToName, 200) || undefined, shipToAddress: text(input.shipToAddress, 2000) || undefined,
    currency: invoiceCurrency(input.currency), memo: text(input.memo, 4000) || undefined, termsAndConditions: text(input.termsAndConditions, 12000) || undefined,
    memberId: input.partyKind === "member" ? input.memberId : undefined, counterpartyId: input.partyKind === "organization" ? input.counterpartyId : undefined,
    money, documentTemplate: cleanInvoiceTemplate(input.documentTemplate), lines: input.lines.map((line) => ({ ...line, item: text(line.item, 200), description: text(line.description, 4000) || undefined })) };
  if (new TextEncoder().encode(JSON.stringify(cleaned)).byteLength > 800000) throw new Error("The quote content exceeds the snapshot size limit; shorten descriptions or reduce the item count.");
  return cleaned;
}
async function snapshotQuote(ctx: PortableMutationCtx, value: Row) {
  const existing = await ctx.db.query("billingQuoteRevisions").withIndex("by_quote_revision", (q) => q.eq("quoteId", value._id).eq("revision", value.revision)).first();
  if (existing) return;
  await ctx.db.insert("billingQuoteRevisions", { societyId: value.societyId, quoteId: value._id, revision: value.revision, status: value.status, fields: value.fields, totalCents: value.totalCents, createdByUserId: await actor(ctx, value.societyId), createdAtISO: now() });
}

type WorkspaceArgs = { societyId: string; collection?: "quotes" | "quote" | "statements" | "revisions"; quoteId?: string; status?: "all" | QuoteStatus; customerKey?: string; currency?: string; cursor?: string | null };
type DocumentCursor = { scope: string; phase?: "stored_expired"; cursor: string | null };
export async function workspacePortable(ctx: Ctx, args: WorkspaceArgs) {
  const { societyId, quoteId } = args;
  await read(ctx, societyId);
  const collection = args.collection ?? (quoteId ? "quote" : "quotes"), status = args.status ?? "all";
  if (!["quotes", "quote", "statements", "revisions"].includes(collection) || !["all", ...QUOTE_STATUSES].includes(status)) throw new Error("Choose a supported document collection and status.");
  const today = await calendarToday(ctx, societyId);
  const effective = (row: Row) => ({ ...row, effectiveStatus: row.status === "sent" && row.fields.validUntil < today ? "expired" : row.status });
  const empty = { quotes: [] as Row[], revisions: [] as Row[], statements: [] as Row[], quote: null as ReturnType<typeof effective> | null, isDone: true, continueCursor: "" };
  if (collection === "quote" || collection === "revisions") {
    if (!quoteId) throw new Error("Choose a quote.");
    const value = await getOwned<Row>(ctx, "billingQuotes", quoteId, societyId);
    if (collection === "quote") return { ...empty, quote: effective(value) };
  }
  const scope = JSON.stringify([societyId, collection, status, quoteId ?? "", args.customerKey ?? "", args.currency ?? ""]);
  let cursor: DocumentCursor = { scope, cursor: null };
  if (args.cursor) {
    try { cursor = JSON.parse(args.cursor); } catch { throw new Error("Invalid document page. Return to the first page."); }
    if (!cursor || cursor.scope !== scope || (cursor.cursor !== null && typeof cursor.cursor !== "string") || (cursor.phase !== undefined && cursor.phase !== "stored_expired")) throw new Error("This page belongs to another document selection. Return to the first page.");
  }
  let query;
  if (collection === "revisions") query = ctx.db.query<Row>("billingQuoteRevisions").withIndex("by_quote", (q) => q.eq("quoteId", quoteId));
  else if (collection === "statements") query = args.customerKey && args.currency
    ? ctx.db.query<Row>("customerStatementSnapshots").withIndex("by_society_customer_currency", (q) => q.eq("societyId", societyId).eq("customerKey", args.customerKey).eq("statement.currency", args.currency))
    : args.customerKey ? ctx.db.query<Row>("customerStatementSnapshots").withIndex("by_society_and_customer", (q) => q.eq("societyId", societyId).eq("customerKey", args.customerKey))
      : ctx.db.query<Row>("customerStatementSnapshots").withIndex("by_society", (q) => q.eq("societyId", societyId));
  else if (status === "sent" || (status === "expired" && cursor.phase !== "stored_expired")) query = ctx.db.query<Row>("billingQuotes").withIndex("by_society_status_valid_until", (q) => status === "sent" ? q.eq("societyId", societyId).eq("status", "sent").gte("fields.validUntil", today) : q.eq("societyId", societyId).eq("status", "sent").lt("fields.validUntil", today));
  else if (status !== "all") query = ctx.db.query<Row>("billingQuotes").withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", status));
  else query = ctx.db.query<Row>("billingQuotes").withIndex("by_society", (q) => q.eq("societyId", societyId));
  // A quote/template can contain large embedded artwork. Four records bound
  // both read and response bytes, with exactly one native pagination per call.
  const result = await query.order("desc").paginate({ numItems: 4, cursor: cursor.cursor });
  const nextPhase = collection === "quotes" && status === "expired" && cursor.phase !== "stored_expired" && result.isDone;
  const isDone = result.isDone && !nextPhase;
  return { ...empty, [collection]: collection === "quotes" ? result.page.map(effective) : result.page, isDone, continueCursor: isDone ? "" : JSON.stringify({ scope, ...(nextPhase || cursor.phase ? { phase: "stored_expired" } : {}), cursor: nextPhase ? null : result.continueCursor }) };
}
export async function upsertQuotePortable(ctx: PortableMutationCtx, args: { societyId: string; id?: string; fields: QuoteFields }) {
  await write(ctx, args.societyId);
  const old = args.id ? await getOwned<Row>(ctx, "billingQuotes", args.id, args.societyId) : null;
  if (old && (old.status !== "draft" || old.convertedInvoiceId)) throw new Error("Published quotes are immutable. Create a new revision before editing.");
  const fields = await cleanQuoteFields(ctx, args.societyId, args.fields);
  const patch = { fields, totalCents: computeInvoiceTotals(fields.lines, fields.discount, fields.money).totalCents, updatedAtISO: now() };
  if (old) { await ctx.db.patch(old._id, patch); return old._id; }
  const id = await ctx.db.insert("billingQuotes", { societyId: args.societyId, number: "", revision: 1, status: "draft", ...patch, createdByUserId: await actor(ctx, args.societyId), createdAtISO: now(), timeline: [{ atISO: now(), actorUserId: await actor(ctx, args.societyId), action: "Quote created" }] });
  await ctx.db.patch(id, { number: `Q-${id.slice(-10).toUpperCase()}` }); return id;
}
export async function setQuoteStatusPortable(ctx: PortableMutationCtx, args: { id: string; status: QuoteStatus; note?: string }) {
  const value = await quote(ctx, args.id); await write(ctx, value.societyId);
  if (value.convertedInvoiceId) throw new Error("This quote is already converted to an invoice.");
  if (value.status === args.status) return value._id;
  if (!(QUOTE_STATUSES as readonly string[]).includes(args.status)) throw new Error("Choose a quote status.");
  const transitions: Record<string, string[]> = { draft: ["sent"], sent: ["accepted", "declined", "expired"], accepted: [], declined: [], expired: [] };
  if (!transitions[value.status]?.includes(args.status)) throw new Error("That quote transition is not available; create a new revision to change a published offer.");
  const today = await calendarToday(ctx, value.societyId);
  if (["sent", "accepted"].includes(args.status) && (value.fields.validUntil < today || value.fields.issueDate > today)) throw new Error("This quote is future-dated or expired. Create a revision with a current validity date.");
  if (args.status === "expired" && value.fields.validUntil >= today) throw new Error("This quote has not expired yet.");
  if (["accepted", "declined"].includes(args.status) && !text(args.note, 2000)) throw new Error("Record the customer decision and its evidence.");
  await snapshotQuote(ctx, args.status === "sent" ? { ...value, status: "sent" } : value);
  await ctx.db.patch(value._id, { status: args.status, updatedAtISO: now(), timeline: [...value.timeline, { atISO: now(), actorUserId: await actor(ctx, value.societyId), action: `Quote ${args.status}`, note: text(args.note, 2000) || undefined }] }); return value._id;
}
export async function reviseQuotePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const value = await quote(ctx, id); await write(ctx, value.societyId);
  if (value.convertedInvoiceId) throw new Error("A converted quote cannot be revised; duplicate its invoice or create a new quote.");
  if (value.status === "draft") return id;
  await snapshotQuote(ctx, value);
  await ctx.db.patch(id, { revision: value.revision + 1, status: "draft", updatedAtISO: now(), timeline: [...value.timeline, { atISO: now(), actorUserId: await actor(ctx, value.societyId), action: `Revision ${value.revision + 1} started` }] }); return id;
}
export async function convertQuotePortable(ctx: PortableMutationCtx, { id, issueDate, terms = "net_30" }: { id: string; issueDate: string; terms?: string }) {
  const value = await quote(ctx, id); await write(ctx, value.societyId);
  if (value.convertedInvoiceId) { await getOwned(ctx, "invoices", value.convertedInvoiceId, value.societyId); return value.convertedInvoiceId; }
  if (value.status !== "accepted") throw new Error("Record customer acceptance before converting the quote.");
  const fields = await cleanQuoteFields(ctx, value.societyId, value.fields);
  const invoiceId = await upsertPortable(ctx, { societyId: value.societyId, ...fields, issueDate, terms, documentExtras: { termsAndConditions: fields.termsAndConditions }, reference: `${value.number} · revision ${value.revision}` });
  await ctx.db.patch(id, { convertedInvoiceId: invoiceId, updatedAtISO: now(), timeline: [...value.timeline, { atISO: now(), actorUserId: await actor(ctx, value.societyId), action: "Converted to invoice" }] }); return invoiceId;
}
export async function customerStatementPortable(ctx: Ctx, args: { societyId: string; customerKey: string; currency: string; from: string; to: string; templateId?: string }) {
  await read(ctx, args.societyId);
  const invoices = await rows(ctx, "invoices", args.societyId);
  const statement = buildCustomerStatement(invoices, { ...args, currency: invoiceCurrency(args.currency) });
  const settings: any = await ctx.db.query("invoiceSettings").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).first();
  const templateId = args.templateId ?? settings?.defaultTemplateId;
  const template: any = templateId ? await getOwned(ctx, "invoiceTemplates", templateId, args.societyId) : null;
  if (template && !template.active) throw new Error("Choose an active document template.");
  return { ...statement, documentTemplate: cleanInvoiceTemplate(template?.config) };
}
export async function saveStatementSnapshotPortable(ctx: PortableMutationCtx, args: { societyId: string; customerKey: string; currency: string; from: string; to: string; templateId?: string }) {
  await requirePermissionPortable(ctx, args.societyId, "exports:download");
  const statement = await customerStatementPortable(ctx, args);
  if (new TextEncoder().encode(JSON.stringify(statement)).byteLength > 800000) throw new Error("The statement is too large to save as one snapshot; use a shorter date range.");
  return ctx.db.insert("customerStatementSnapshots", { societyId: args.societyId, customerKey: args.customerKey, statement, createdByUserId: await actor(ctx, args.societyId), createdAtISO: now() });
}

export async function repairOperationsPortable(ctx: Ctx, { societyId, repairJobId }: { societyId: string; repairJobId?: string }) {
  await read(ctx, societyId);
  if (repairJobId) await getOwned(ctx, "repairJobs", repairJobId, societyId);
  const byRepair = async (table: string, limit: number) => { const result = await ctx.db.query<Row>(table).withIndex("by_repair_job", (q) => q.eq("repairJobId", repairJobId)).take(limit + 1); if (result.length > limit) throw new Error(`This repair's ${table} history exceeds ${limit} rows.`); return result; };
  const [ops, entries, events, users, jobs] = await Promise.all([repairJobId ? byRepair("repairOperations", 1) : rows(ctx, "repairOperations", societyId, 10000), repairJobId ? byRepair("repairTimeEntries", 10000) : Promise.resolve([]), repairJobId ? byRepair("repairOperationEvents", 1000) : Promise.resolve([]), rows(ctx, "users", societyId, 1000), repairJobId ? Promise.all([getOwned<Row>(ctx, "repairJobs", repairJobId, societyId)]) : Promise.resolve([])]);
  const technicians = users.filter((user) => !user.status || user.status === "Active").map((user) => ({ _id: user._id, name: user.displayName || user.name || user.email || user._id }));
  return { operations: ops.map((op) => ({ ...op, approvalStale: Boolean(repairJobId && op.approvalRequired && op.approvalScope !== repairApprovalScope(jobs.find((job) => job._id === op.repairJobId) ?? {})) })), entries, events: events.sort((a, b) => b.atISO.localeCompare(a.atISO)), technicians };
}
export async function saveRepairDispatchPortable(ctx: PortableMutationCtx, args: { id: string; technicianUserId?: string; scheduledDate?: string; estimatedMinutes?: number; approvalRequired: boolean }) {
  const job = await repair(ctx, args.id);
  if (args.technicianUserId) await technician(ctx, job.societyId, args.technicianUserId);
  if (args.scheduledDate && (!isCalendarDate(args.scheduledDate) || args.scheduledDate < job.receivedDate)) throw new Error("Choose a schedule date on or after intake.");
  if (args.estimatedMinutes !== undefined && (!Number.isFinite(args.estimatedMinutes) || args.estimatedMinutes < 0 || args.estimatedMinutes > 100000)) throw new Error("Choose a valid workload estimate in minutes.");
  const previous = await operations(ctx, job._id);
  if (previous?.approvalRequired && !args.approvalRequired) throw new Error("Required customer approval cannot be disabled on this repair.");
  await updateOperations(ctx, job, { technicianUserId: args.technicianUserId, scheduledDate: args.scheduledDate || undefined, estimatedMinutes: args.estimatedMinutes, approvalRequired: args.approvalRequired, approvalStatus: args.approvalRequired ? previous?.approvalRequired ? previous.approvalStatus : "requested" : "not_required", ...(args.approvalRequired && !previous?.approvalRequired ? { approvalScope: repairApprovalScope(job), approvalRequestedAtISO: now() } : {}) });
  await operationEvent(ctx, job, "dispatch", "Dispatch updated", JSON.stringify(args)); return job._id;
}
export async function requestRepairApprovalPortable(ctx: PortableMutationCtx, { id, note }: { id: string; note?: string }) {
  const job = await repair(ctx, id);
  if (["completed", "cancelled"].includes(job.status)) throw new Error("This repair is closed.");
  await updateOperations(ctx, job, { approvalRequired: true, approvalStatus: "requested", approvalScope: repairApprovalScope(job), approvedAmountCents: undefined, approvalRequestedAtISO: now(), approvalDecisionAtISO: undefined, approvalDecidedByUserId: undefined, approvalCustomerName: undefined, approvalNote: text(note, 2000) || undefined });
  await operationEvent(ctx, job, "approval_requested", "Customer approval requested", text(note, 2000)); return id;
}
export async function decideRepairApprovalPortable(ctx: PortableMutationCtx, args: { id: string; decision: "approved" | "rejected"; customerName: string; note: string }) {
  const job = await repair(ctx, args.id), op = await operations(ctx, job._id);
  if (!op || op.approvalStatus !== "requested" || op.approvalScope !== repairApprovalScope(job)) throw new Error("Request approval for the current scope before recording a decision.");
  if (!text(args.customerName, 200) || !text(args.note, 2000)) throw new Error("Record the customer's name and evidence of their decision.");
  await updateOperations(ctx, job, { approvalStatus: args.decision, approvedAmountCents: args.decision === "approved" ? computeInvoiceTotals(job.lines ?? []).totalCents : undefined, approvalDecisionAtISO: now(), approvalDecidedByUserId: await actor(ctx, job.societyId), approvalCustomerName: text(args.customerName, 200), approvalNote: text(args.note, 2000) });
  await operationEvent(ctx, job, `approval_${args.decision}`, `Customer ${args.decision} repair`, `${text(args.customerName, 200)}: ${text(args.note, 2000)}`); return job._id;
}
export async function startRepairTimerPortable(ctx: PortableMutationCtx, args: { id: string; technicianUserId: string; costRateCents: number; billingRateCents: number; billable: boolean; note?: string }) {
  const job = await repair(ctx, args.id); await technician(ctx, job.societyId, args.technicianUserId); await assertRepairApprovalPortable(ctx, job._id);
  if (["completed", "cancelled"].includes(job.status)) throw new Error("This repair is closed.");
  const active = await ctx.db.query("repairTimeEntries").withIndex("by_society_and_technician", (q) => q.eq("societyId", job.societyId).eq("technicianUserId", args.technicianUserId)).take(10001);
  if (active.length > 10000) throw new Error("Archive this technician's time history before adding more entries.");
  if (active.some((entry) => !entry.endAtISO)) throw new Error("This technician already has a running repair timer.");
  const entryId = await ctx.db.insert("repairTimeEntries", { societyId: job.societyId, repairJobId: job._id, technicianUserId: args.technicianUserId, startAtISO: now(), costRateCents: rate(args.costRateCents), billingRateCents: rate(args.billingRateCents), billable: args.billable, note: text(args.note, 2000), createdByUserId: await actor(ctx, job.societyId), updatedAtISO: now() });
  await operationEvent(ctx, job, "timer_started", "Repair timer started", entryId); return entryId;
}
export async function stopRepairTimerPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const entry = await requireOwnedRow<Row>(ctx, "repairTimeEntries", id); await write(ctx, entry.societyId);
  if (entry.endAtISO) return id;
  const job = await getOwned<Row>(ctx, "repairJobs", entry.repairJobId, entry.societyId), endAtISO = now();
  const durationMinutes = Math.max(0, Math.round((Date.parse(endAtISO) - Date.parse(entry.startAtISO)) / 60) / 1000);
  await ctx.db.patch(id, { endAtISO, durationMinutes, updatedAtISO: endAtISO }); await operationEvent(ctx, job, "timer_stopped", "Repair timer stopped", `${durationMinutes} minutes`); return id;
}
export async function saveRepairTimePortable(ctx: PortableMutationCtx, args: { id?: string; repairJobId: string; technicianUserId: string; date: string; durationMinutes: number; costRateCents: number; billingRateCents: number; billable: boolean; note: string }) {
  const job = await repair(ctx, args.repairJobId); await technician(ctx, job.societyId, args.technicianUserId); await assertRepairApprovalPortable(ctx, job._id);
  if (!isCalendarDate(args.date) || args.date < job.receivedDate || args.date > await calendarToday(ctx, job.societyId)) throw new Error("Choose a work date between intake and today.");
  if (!Number.isFinite(args.durationMinutes) || args.durationMinutes <= 0 || args.durationMinutes > 1440) throw new Error("Manual time must be above zero and at most 24 hours.");
  if (!text(args.note, 2000)) throw new Error("Describe the work performed.");
  if (args.id) { const old = await getOwned<Row>(ctx, "repairTimeEntries", args.id, job.societyId); if (old.repairJobId !== job._id || !old.endAtISO) throw new Error("Stop this repair's running timer before editing it."); }
  const startAtISO = `${args.date}T00:00:00.000Z`, endAtISO = new Date(Date.parse(startAtISO) + args.durationMinutes * 60000).toISOString();
  const fields = { technicianUserId: args.technicianUserId, startAtISO, endAtISO, durationMinutes: args.durationMinutes, costRateCents: rate(args.costRateCents), billingRateCents: rate(args.billingRateCents), billable: args.billable, note: text(args.note, 2000), updatedAtISO: now() };
  const id = args.id ?? await ctx.db.insert("repairTimeEntries", { societyId: job.societyId, repairJobId: job._id, ...fields, createdByUserId: await actor(ctx, job.societyId) });
  if (args.id) await ctx.db.patch(id, fields); await operationEvent(ctx, job, "time_saved", "Repair time recorded", `${args.durationMinutes} minutes · ${fields.note}`); return id;
}
export async function removeRepairTimePortable(ctx: PortableMutationCtx, { id }: { id: string }) { const entry = await requireOwnedRow<Row>(ctx, "repairTimeEntries", id); await write(ctx, entry.societyId); const job = await getOwned<Row>(ctx, "repairJobs", entry.repairJobId, entry.societyId); await operationEvent(ctx, job, "time_removed", "Repair time removed", JSON.stringify({ id, minutes: entry.durationMinutes, note: entry.note })); await ctx.db.delete(id); return id; }
export async function syncRepairTimeChargesPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const job = await repair(ctx, id);
  const entries: any[] = await ctx.db.query("repairTimeEntries").withIndex("by_repair_job", (q) => q.eq("repairJobId", id)).take(10001);
  if (entries.length > 10000) throw new Error("This repair's time history exceeds the billing limit.");
  if (entries.some((entry) => !entry.endAtISO)) throw new Error("Stop running timers before adding logged time to the estimate.");
  const lines = [...(job.lines ?? []).filter((line: any) => !line.key.startsWith("repair-time:")), ...entries.filter((entry) => entry.billable && entry.durationMinutes > 0).map((entry) => ({ key: `repair-time:${entry._id}`, item: "Repair labour", description: entry.note, quantity: entry.durationMinutes / 60, unit: "hour", unitPriceCents: entry.billingRateCents }))];
  await upsertRepairJobPortable(ctx, { ...job, id: job._id, lines } as any);
  await operationEvent(ctx, job, "time_charges_synced", "Logged labour copied to repair estimate", `${entries.filter((entry) => entry.billable).length} billable entries`); return id;
}
export async function setRepairStatusGuardedPortable(ctx: PortableMutationCtx, args: { id: string; status: RepairStatus }) { const job = await repair(ctx, args.id); if (["in_progress", "ready", "completed"].includes(args.status)) await assertRepairApprovalPortable(ctx, job._id); if (!REPAIR_TRANSITIONS[job.status as RepairStatus]?.includes(args.status) && job.status !== args.status) throw new Error("That repair status transition is not available."); return setRepairStatusPortable(ctx, args); }
export async function invoiceRepairGuardedPortable(ctx: PortableMutationCtx, args: { id: string }) { const job = await repair(ctx, args.id); await assertRepairApprovalPortable(ctx, job._id); const running = await ctx.db.query("repairTimeEntries").withIndex("by_repair_job", (q) => q.eq("repairJobId", job._id)).take(10001); if (running.some((entry) => !entry.endAtISO)) throw new Error("Stop running timers before billing the repair."); return invoiceRepairJobPortable(ctx, args); }
