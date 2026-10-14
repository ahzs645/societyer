/**
 * PORTABLE FUNCTIONS: invoicing (receivables).
 *
 * workspace / upsert / markSent / voidInvoices / restoreVoided / duplicate /
 * remove / recordPayment / removePayment / revertToUnpaid / sendReminders /
 * billMemberDues / generateDuesInvoices / undoDuesBatch /
 * upsertCatalogItem / setCatalogItemActive / removeCatalogItem /
 * upsertSeries / setSeriesStatus / issueFromSeries / saveSettings.
 *
 * Invoices store their lifecycle (draft | sent | void) and payments; paid,
 * partially paid and overdue are derived on read from the balance and the due
 * date against the organisation's local today (shared/invoicing.ts).
 * Reminders and "mark sent with an email" create Outbox drafts
 * (pendingEmails); nothing is sent from here.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, principalUserId, requireOwnedRow, requireSocietyMembership } from "./access";
import { resolutionCalendarDate, resolutionTimeZone } from "../writtenResolutionEvidence";
import {
  INVOICE_TERMS,
  PAYMENT_METHODS,
  SERIES_FREQUENCIES,
  addDays,
  computeInvoiceTotals,
  daysOverdue,
  deriveInvoiceStatus,
  dueDateForTerms,
  formatInvoiceNumber,
  isCalendarDate,
  isOpenStatus,
  monthBounds,
  nextInvoiceSequence,
  normalizeInvoicePrefix,
  paidCents as sumPaid,
  seriesNextIssueDate,
  summarizeCustomers,
  validateInvoiceLines,
  type InvoiceDiscount,
  type InvoiceLine,
  type InvoiceStatus,
} from "../invoicing";

type Row = { _id: string; societyId: string; [key: string]: any };

const DEFAULT_TERMS = "net_30";

function nowISO() {
  return new Date().toISOString();
}

function randomKey(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function organizationToday(ctx: PortableQueryCtx, societyId: string) {
  const organization = await ctx.db.get(societyId, "societies");
  const iso = nowISO();
  return resolutionCalendarDate(iso, resolutionTimeZone(organization as any)) ?? iso.slice(0, 10);
}

async function actorName(ctx: PortableQueryCtx, societyId: string): Promise<string | undefined> {
  try {
    const user: any = await requireSocietyMembership(ctx, societyId);
    return user.displayName ?? user.name ?? undefined;
  } catch {
    return undefined;
  }
}

async function loadInvoices(ctx: PortableQueryCtx, societyId: string): Promise<Row[]> {
  return (await ctx.db.query("invoices").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect()) as Row[];
}

async function loadSettings(ctx: PortableQueryCtx, societyId: string): Promise<Row | null> {
  return ((await ctx.db.query("invoiceSettings").withIndex("by_society", (q) => q.eq("societyId", societyId)).first()) as Row | null) ?? null;
}

function settingsView(row: Row | null, invoices: Row[]) {
  const prefix = normalizeInvoicePrefix(row?.prefix);
  const nextNumber = nextInvoiceSequence(invoices, row?.nextNumber);
  return {
    _id: row?._id,
    prefix,
    nextNumber,
    nextNumberPreview: formatInvoiceNumber(prefix, nextNumber),
    defaultTerms: row?.defaultTerms ?? DEFAULT_TERMS,
    paymentInstructions: row?.paymentInstructions,
    defaultMemo: row?.defaultMemo,
    replyToEmail: row?.replyToEmail,
  };
}

/** Allocate the next number and remember it, creating the settings row on first use. */
async function allocateNumber(ctx: PortableMutationCtx, societyId: string) {
  const [settings, invoices] = await Promise.all([loadSettings(ctx, societyId), loadInvoices(ctx, societyId)]);
  const prefix = normalizeInvoicePrefix(settings?.prefix);
  const sequence = nextInvoiceSequence(invoices, settings?.nextNumber);
  if (settings) await ctx.db.patch(settings._id, { nextNumber: sequence + 1, updatedAtISO: nowISO() });
  else await ctx.db.insert("invoiceSettings", { societyId, prefix, nextNumber: sequence + 1, defaultTerms: DEFAULT_TERMS, updatedAtISO: nowISO() });
  return { sequence, number: formatInvoiceNumber(prefix, sequence) };
}

function cleanText(value: unknown, max = 2000): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, max) : undefined;
}

function cleanLines(lines: any[]): InvoiceLine[] {
  return (lines ?? []).slice(0, 100).map((raw, index) => {
    const line: InvoiceLine = {
      key: cleanText(raw?.key, 60) ?? `line_${index + 1}`,
      item: String(raw?.item ?? "").trim().slice(0, 200),
      quantity: Math.round(Number(raw?.quantity) * 1000) / 1000,
      unitPriceCents: Math.round(Number(raw?.unitPriceCents)),
    };
    const description = cleanText(raw?.description, 1000);
    if (description) line.description = description;
    if (raw?.catalogItemId) line.catalogItemId = String(raw.catalogItemId);
    const rate = Number(raw?.taxRatePercent);
    if (Number.isFinite(rate) && rate > 0) {
      line.taxRatePercent = Math.round(rate * 1000) / 1000;
      line.taxLabel = cleanText(raw?.taxLabel, 20) ?? "Tax";
    }
    return line;
  });
}

function cleanDiscount(discount: any): InvoiceDiscount | undefined {
  if (!discount) return undefined;
  const value = Number(discount.value);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  if (discount.kind === "percent") {
    if (value > 100) throw new Error("A percentage discount cannot exceed 100%.");
    return { kind: "percent", value: Math.round(value * 100) / 100 };
  }
  return { kind: "amount", value: Math.round(value) };
}

type PartyArgs = {
  partyKind: string;
  memberId?: string;
  counterpartyId?: string;
  billToName: string;
  billToEmail?: string;
  billToAddress?: string;
};

async function cleanParty(ctx: PortableQueryCtx, societyId: string, args: PartyArgs) {
  const partyKind = ["member", "organization", "custom"].includes(args.partyKind) ? args.partyKind : "custom";
  const party: Record<string, any> = { partyKind, memberId: undefined, counterpartyId: undefined };
  if (partyKind === "member") {
    if (!args.memberId) throw new Error("Choose who to bill.");
    await getOwned(ctx, "members", args.memberId, societyId);
    party.memberId = args.memberId;
  } else if (partyKind === "organization") {
    if (!args.counterpartyId) throw new Error("Choose who to bill.");
    await getOwned(ctx, "accountingCounterparties", args.counterpartyId, societyId);
    party.counterpartyId = args.counterpartyId;
  }
  const billToName = cleanText(args.billToName, 200);
  if (!billToName) throw new Error("Add who the invoice is for.");
  const billToEmail = cleanText(args.billToEmail, 200);
  if (billToEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billToEmail)) throw new Error("The email address doesn't look right.");
  return { ...party, billToName, billToEmail, billToAddress: cleanText(args.billToAddress, 500) };
}

async function assertCatalogRefs(ctx: PortableQueryCtx, societyId: string, lines: InvoiceLine[]) {
  for (const id of new Set(lines.map((line) => line.catalogItemId).filter(Boolean) as string[])) {
    await getOwned(ctx, "invoiceCatalogItems", id, societyId);
  }
}

function event(kind: string, label: string, actor?: string, amountCents?: number) {
  const row: Record<string, any> = { atISO: nowISO(), kind, label };
  if (actor) row.actorName = actor;
  if (amountCents != null) row.amountCents = amountCents;
  return row;
}

type DecoratedInvoice = Row & { status: InvoiceStatus; totalCents: number; paidCents: number; balanceCents: number; issueDate: string; sequence: number; number: string; billToName: string };

function decorate(row: Row, today: string, seriesById: Map<string, Row>, txnById: Map<string, Row>): DecoratedInvoice {
  const totals = computeInvoiceTotals(row.lines ?? [], row.discount);
  const paid = sumPaid(row.payments);
  const status = deriveInvoiceStatus({ status: row.status, dueDate: row.dueDate, totalCents: totals.totalCents, payments: row.payments }, today);
  const balanceCents = row.status === "void" ? 0 : totals.totalCents - paid;
  return {
    ...(row as DecoratedInvoice),
    lifecycle: row.status,
    status,
    totals,
    totalCents: totals.totalCents,
    paidCents: paid,
    balanceCents,
    daysOverdue: status === "overdue" ? daysOverdue(row.dueDate, today) : 0,
    seriesName: row.seriesId ? seriesById.get(row.seriesId)?.name : undefined,
    payments: (row.payments ?? []).map((payment: any) => {
      const txn = payment.financialTransactionId ? txnById.get(payment.financialTransactionId) : undefined;
      return txn
        ? { ...payment, transaction: { _id: txn._id, date: txn.date, description: txn.description, amountCents: txn.amountCents } }
        : payment;
    }),
  };
}

/** Everything the Invoices page needs in one read. */
export async function workspacePortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const today = await organizationToday(ctx, societyId);
  const [organization, invoices, settings, catalog, series, members, counterparties, transactions, subscriptions, plans, feePeriods, identifiers] = await Promise.all([
    ctx.db.get(societyId, "societies"),
    loadInvoices(ctx, societyId),
    loadSettings(ctx, societyId),
    ctx.db.query("invoiceCatalogItems").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("invoiceSeries").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("members").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("accountingCounterparties").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("financialTransactions").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("memberSubscriptions").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("subscriptionPlans").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("membershipFeePeriods").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("organizationIdentifiers").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  const seriesById = new Map((series as Row[]).map((row) => [row._id, row]));
  const txnById = new Map((transactions as Row[]).map((row) => [row._id, row]));
  const decorated = invoices
    .map((row) => decorate(row, today, seriesById, txnById))
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.sequence - a.sequence);

  const linked = new Map<string, { invoiceId: string; number: string }>();
  for (const invoice of decorated) {
    for (const payment of invoice.payments ?? []) {
      if (payment.financialTransactionId) linked.set(payment.financialTransactionId, { invoiceId: invoice._id, number: invoice.number });
    }
  }
  const since = addDays(today, -400);
  const moneyIn = (transactions as Row[])
    .filter((txn) => Number(txn.amountCents) > 0 && String(txn.date) >= since)
    .map((txn) => ({
      _id: txn._id,
      date: txn.date,
      amountCents: txn.amountCents,
      description: txn.description,
      counterparty: txn.counterparty,
      category: txn.category,
      linkedInvoiceId: linked.get(txn._id)?.invoiceId,
      linkedInvoiceNumber: linked.get(txn._id)?.number,
    }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const paidSince = addDays(today, -30);
  const summary = { outstandingCents: 0, outstandingCount: 0, overdueCents: 0, overdueCount: 0, paidLast30Cents: 0, paidLast30Count: 0, draftCents: 0, draftCount: 0 };
  for (const invoice of decorated) {
    if (isOpenStatus(invoice.status)) {
      summary.outstandingCents += invoice.balanceCents;
      summary.outstandingCount += 1;
    }
    if (invoice.status === "overdue") {
      summary.overdueCents += invoice.balanceCents;
      summary.overdueCount += 1;
    }
    if (invoice.status === "draft") {
      summary.draftCents += invoice.totalCents;
      summary.draftCount += 1;
    }
    if (invoice.status !== "void") {
      const recent = (invoice.payments ?? []).filter((payment: any) => payment.date >= paidSince && payment.date <= today);
      if (recent.length) {
        summary.paidLast30Cents += recent.reduce((sum: number, payment: any) => sum + payment.amountCents, 0);
        summary.paidLast30Count += 1;
      }
    }
  }

  const activePlans = (plans as Row[]).filter((plan) => plan.active !== false);
  const duesCandidates = buildDuesCandidates(today, subscriptions as Row[], activePlans, feePeriods as Row[], members as Row[], decorated);
  const gst = (identifiers as Row[]).find((row) => row.kind === "gst" && row.status !== "inactive")
    ?? (identifiers as Row[]).find((row) => row.kind === "business_number" && row.status !== "inactive" && /RT\d{4}/i.test(String(row.number)));

  return {
    today,
    settings: settingsView(settings, invoices),
    organization: {
      name: (organization as any)?.name,
      entityType: (organization as any)?.entityType,
      address: (organization as any)?.mailingAddress ?? (organization as any)?.registeredOfficeAddress,
      registrationNumber: (organization as any)?.incorporationNumber,
      email: (organization as any)?.publicContactEmail ?? (organization as any)?.officialEmail ?? (organization as any)?.primaryContactEmail,
      gstNumber: gst?.number,
    },
    invoices: decorated,
    catalog: (catalog as Row[]).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)),
    series: (series as Row[])
      .map((row): Row => {
        const issued = decorated.filter((invoice) => invoice.seriesId === row._id);
        return {
          ...row,
          totalCents: computeInvoiceTotals(row.lines ?? [], row.discount).totalCents,
          invoiceCount: issued.length,
          outstandingCents: issued.filter((invoice) => isOpenStatus(invoice.status)).reduce((sum, invoice) => sum + invoice.balanceCents, 0),
          lastInvoiceId: issued[0]?._id,
          due: Boolean(row.status === "active" && row.nextIssueDate && row.nextIssueDate <= today),
        };
      })
      .sort((a, b) => String(a.nextIssueDate ?? "9999").localeCompare(String(b.nextIssueDate ?? "9999"))),
    parties: {
      members: (members as Row[])
        .filter((member) => member.status !== "Removed")
        .map((member) => ({
          _id: member._id,
          name: member.memberKind === "organization" && member.organizationName ? member.organizationName : `${member.firstName} ${member.lastName}`.trim(),
          email: member.email,
          address: member.address,
          membershipClass: member.membershipClass,
          status: member.status,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      organizations: (counterparties as Row[])
        .map((row) => ({ _id: row._id, name: row.name, email: row.email, kind: row.kind }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    },
    customers: summarizeCustomers(decorated),
    transactions: moneyIn,
    plans: activePlans.map((plan) => ({ _id: plan._id, name: plan.name, priceCents: plan.priceCents, interval: plan.interval, membershipClass: plan.membershipClass, currency: plan.currency })),
    duesCandidates,
    summary,
  };
}

function feeForPlan(plan: Row, feePeriods: Row[], onDate: string): number {
  const period = feePeriods
    .filter((row) => row.planId === plan._id && row.status !== "retired" && String(row.effectiveFrom) <= onDate && (!row.effectiveTo || String(row.effectiveTo) >= onDate))
    .sort((a, b) => String(b.effectiveFrom).localeCompare(String(a.effectiveFrom)))[0];
  return Number(period?.priceCents ?? plan.priceCents ?? 0);
}

function planLineItem(plan: Row, priceCents: number, renewalDate?: string): InvoiceLine {
  const period = plan.interval === "month" ? "Monthly" : plan.interval === "year" ? "Annual" : plan.interval === "semester" ? "Term" : "";
  return {
    key: randomKey("line"),
    item: `${period ? `${period} ` : ""}membership dues`.replace(/^m/, "M"),
    description: renewalDate ? `${plan.name} · renewal ${renewalDate}` : plan.name,
    quantity: 1,
    unitPriceCents: priceCents,
  };
}

/** Subscriptions renewing in today's month that have no dues invoice for that renewal yet. */
function buildDuesCandidates(today: string, subscriptions: Row[], plans: Row[], feePeriods: Row[], members: Row[], invoices: Array<Record<string, any>>) {
  const { start, end } = monthBounds(today);
  const planById = new Map(plans.map((plan) => [plan._id, plan]));
  const memberById = new Map(members.map((member) => [member._id, member]));
  return subscriptions
    .filter((sub) => ["active", "past_due"].includes(String(sub.status)) && sub.currentPeriodEndISO)
    .map((sub) => {
      const renewalDate = String(sub.currentPeriodEndISO).slice(0, 10);
      const plan = planById.get(sub.planId);
      if (!plan || renewalDate < start || renewalDate > end) return null;
      const member = sub.memberId ? memberById.get(sub.memberId) : undefined;
      const existing = invoices.find((invoice) => invoice.subscriptionId === sub._id && invoice.duesPeriodEnd === renewalDate && invoice.status !== "void");
      return {
        subscriptionId: sub._id,
        memberId: sub.memberId,
        name: sub.fullName || (member ? `${member.firstName} ${member.lastName}` : "Unknown"),
        email: sub.email || member?.email,
        planName: plan.name,
        priceCents: feeForPlan(plan, feePeriods, renewalDate),
        currency: plan.currency ?? "CAD",
        renewalDate,
        existingInvoiceId: existing?._id,
        existingInvoiceNumber: existing?.number,
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => a.renewalDate.localeCompare(b.renewalDate) || a.name.localeCompare(b.name));
}

type InvoiceArgs = PartyArgs & {
  id?: string;
  societyId: string;
  issueDate: string;
  terms: string;
  dueDate?: string;
  reference?: string;
  currency?: string;
  lines: any[];
  discount?: any;
  memo?: string;
};

async function invoiceFields(ctx: PortableQueryCtx, args: InvoiceArgs) {
  if (!isCalendarDate(args.issueDate)) throw new Error("Choose an issue date.");
  const terms = (INVOICE_TERMS as readonly string[]).includes(args.terms) ? args.terms : DEFAULT_TERMS;
  if (terms === "custom" && !isCalendarDate(args.dueDate)) throw new Error("Choose a due date.");
  const dueDate = dueDateForTerms(args.issueDate, terms, args.dueDate);
  if (dueDate < args.issueDate) throw new Error("The due date can't be before the issue date.");
  const lines = cleanLines(args.lines);
  const problem = validateInvoiceLines(lines);
  if (problem) throw new Error(problem);
  await assertCatalogRefs(ctx, args.societyId, lines);
  const discount = cleanDiscount(args.discount);
  const totals = computeInvoiceTotals(lines, discount);
  if (totals.totalCents < 0) throw new Error("The discount is larger than the invoice.");
  const party = await cleanParty(ctx, args.societyId, args);
  return {
    ...party,
    issueDate: args.issueDate,
    terms,
    dueDate,
    reference: cleanText(args.reference, 100),
    currency: (cleanText(args.currency, 3) ?? "CAD").toUpperCase(),
    lines,
    discount,
    memo: cleanText(args.memo, 4000),
    totalCents: totals.totalCents,
  };
}

/** Create a draft or save changes. Returns the invoice id. */
export async function upsertPortable(ctx: PortableMutationCtx, args: InvoiceArgs & { actingUserId?: string }) {
  await requireSocietyMembership(ctx, args.societyId);
  const fields = await invoiceFields(ctx, args);
  const actor = await actorName(ctx, args.societyId);
  const at = nowISO();
  if (args.id) {
    const existing = await getOwned<Row>(ctx, "invoices", args.id, args.societyId);
    if (existing.status === "void") throw new Error("A void invoice can't be edited. Restore it first.");
    const paid = sumPaid(existing.payments);
    if (fields.totalCents < paid) throw new Error("The new total is less than what has already been paid.");
    await ctx.db.patch(args.id, { ...fields, paidCents: paid, updatedAtISO: at });
    return args.id;
  }
  const { sequence, number } = await allocateNumber(ctx, args.societyId);
  return ctx.db.insert("invoices", {
    societyId: args.societyId,
    sequence,
    number,
    status: "draft",
    ...fields,
    paidCents: 0,
    payments: [],
    timeline: [event("created", "Draft created", actor)],
    source: "manual",
    createdByUserId: await principalUserId(ctx, args.societyId).catch(() => undefined),
    createdAtISO: at,
    updatedAtISO: at,
  });
}

async function ownedInvoices(ctx: PortableQueryCtx, societyId: string, ids: string[]) {
  await requireSocietyMembership(ctx, societyId);
  const unique = [...new Set(ids ?? [])].slice(0, 500);
  // Resolve every id first so a foreign or missing id stops the batch before any write.
  return Promise.all(unique.map((id) => getOwned<Row>(ctx, "invoices", id, societyId)));
}

function outboxBody(invoice: Row, organizationName: string, kind: "invoice" | "reminder", balanceCents: number, paymentInstructions?: string) {
  const amount = `$${(balanceCents / 100).toFixed(2)}`;
  const lines = [
    `Hello ${invoice.billToName},`,
    "",
    kind === "reminder"
      ? `This is a friendly reminder that invoice ${invoice.number} from ${organizationName} has ${amount} outstanding, due ${invoice.dueDate}.`
      : `Please find invoice ${invoice.number} from ${organizationName} for ${amount}, due ${invoice.dueDate}.`,
  ];
  if (paymentInstructions) lines.push("", "How to pay:", paymentInstructions);
  lines.push("", "Thank you,", organizationName);
  return lines.join("\n");
}

async function draftOutboxEmail(ctx: PortableMutationCtx, invoice: Row, kind: "invoice" | "reminder", balanceCents: number) {
  const [organization, settings] = await Promise.all([ctx.db.get(invoice.societyId, "societies"), loadSettings(ctx, invoice.societyId)]);
  const organizationName = String((organization as any)?.name ?? "our organization");
  await ctx.db.insert("pendingEmails", {
    societyId: invoice.societyId,
    fromName: organizationName,
    replyTo: settings?.replyToEmail,
    to: invoice.billToEmail,
    subject: kind === "reminder" ? `Reminder: invoice ${invoice.number} from ${organizationName}` : `Invoice ${invoice.number} from ${organizationName}`,
    body: outboxBody(invoice, organizationName, kind, balanceCents, settings?.paymentInstructions),
    attachments: [],
    status: "draft",
    createdAtISO: nowISO(),
    createdByUserId: await principalUserId(ctx, invoice.societyId).catch(() => undefined),
    notes: `Created from invoice ${invoice.number}. Attach a PDF from the invoice's Print / Save as PDF before sending.`,
  });
}

/** Mark drafts as sent (optionally drafting an Outbox email for each). */
export async function markSentPortable(ctx: PortableMutationCtx, { societyId, ids, draftEmail }: { societyId: string; ids: string[]; draftEmail?: boolean }) {
  const rows = await ownedInvoices(ctx, societyId, ids);
  const actor = await actorName(ctx, societyId);
  let sent = 0;
  let emailed = 0;
  let skipped = 0;
  for (const row of rows) {
    if (row.status !== "draft") { skipped += 1; continue; }
    const at = nowISO();
    await ctx.db.patch(row._id, { status: "sent", sentAtISO: at, updatedAtISO: at, timeline: [...(row.timeline ?? []), event("sent", draftEmail && row.billToEmail ? "Marked as sent · email drafted in Outbox" : "Marked as sent", actor)] });
    sent += 1;
    if (draftEmail && row.billToEmail) {
      await draftOutboxEmail(ctx, row, "invoice", row.totalCents - sumPaid(row.payments));
      emailed += 1;
    }
  }
  return { sent, emailed, skipped };
}

export async function voidInvoicesPortable(ctx: PortableMutationCtx, { societyId, ids, reason }: { societyId: string; ids: string[]; reason?: string }) {
  const rows = await ownedInvoices(ctx, societyId, ids);
  const actor = await actorName(ctx, societyId);
  let voided = 0;
  let skippedPaid = 0;
  let skipped = 0;
  for (const row of rows) {
    if (row.status === "void") { skipped += 1; continue; }
    if (sumPaid(row.payments) > 0) { skippedPaid += 1; continue; }
    const at = nowISO();
    const why = cleanText(reason, 300);
    await ctx.db.patch(row._id, { status: "void", voidedAtISO: at, voidReason: why, updatedAtISO: at, timeline: [...(row.timeline ?? []), event("voided", why ? `Voided: ${why}` : "Voided", actor)] });
    voided += 1;
  }
  return { voided, skippedPaid, skipped };
}

export async function restoreVoidedPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const row = await requireOwnedRow<Row>(ctx, "invoices", id);
  if (row.status !== "void") return id;
  const actor = await actorName(ctx, row.societyId);
  await ctx.db.patch(id, { status: row.sentAtISO ? "sent" : "draft", voidedAtISO: undefined, voidReason: undefined, updatedAtISO: nowISO(), timeline: [...(row.timeline ?? []), event("restored", "Restored from void", actor)] });
  return id;
}

export async function duplicatePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const row = await requireOwnedRow<Row>(ctx, "invoices", id);
  const today = await organizationToday(ctx, row.societyId);
  const actor = await actorName(ctx, row.societyId);
  const { sequence, number } = await allocateNumber(ctx, row.societyId);
  const at = nowISO();
  const terms = row.terms === "custom" ? DEFAULT_TERMS : row.terms;
  return ctx.db.insert("invoices", {
    societyId: row.societyId,
    sequence,
    number,
    status: "draft",
    partyKind: row.partyKind,
    memberId: row.memberId,
    counterpartyId: row.counterpartyId,
    billToName: row.billToName,
    billToEmail: row.billToEmail,
    billToAddress: row.billToAddress,
    issueDate: today,
    terms,
    dueDate: dueDateForTerms(today, terms),
    reference: row.reference,
    currency: row.currency,
    lines: (row.lines ?? []).map((line: any) => ({ ...line, key: randomKey("line") })),
    discount: row.discount,
    memo: row.memo,
    totalCents: computeInvoiceTotals(row.lines ?? [], row.discount).totalCents,
    paidCents: 0,
    payments: [],
    timeline: [event("duplicated", `Duplicated from ${row.number}`, actor)],
    source: "duplicate",
    createdByUserId: await principalUserId(ctx, row.societyId).catch(() => undefined),
    createdAtISO: at,
    updatedAtISO: at,
  });
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const row = await requireOwnedRow<Row>(ctx, "invoices", id);
  if (row.status !== "draft" || (row.payments ?? []).length) throw new Error("Only unpaid drafts can be deleted. Void a sent invoice instead.");
  await ctx.db.delete(id);
}

export async function recordPaymentPortable(
  ctx: PortableMutationCtx,
  args: { id: string; date: string; amountCents: number; method: string; reference?: string; note?: string; financialTransactionId?: string },
) {
  const row = await requireOwnedRow<Row>(ctx, "invoices", args.id);
  if (row.status === "void") throw new Error("A void invoice can't take payments.");
  if (!isCalendarDate(args.date)) throw new Error("Choose the payment date.");
  const amountCents = Math.round(Number(args.amountCents));
  if (!(amountCents > 0)) throw new Error("Enter an amount above zero.");
  const total = computeInvoiceTotals(row.lines ?? [], row.discount).totalCents;
  const balance = total - sumPaid(row.payments);
  if (amountCents > balance) throw new Error(`That's more than the ${(balance / 100).toFixed(2)} balance.`);
  if (args.financialTransactionId) {
    const txn = await getOwned<Row>(ctx, "financialTransactions", args.financialTransactionId, row.societyId);
    if (!(Number(txn.amountCents) > 0)) throw new Error("Only money-in bank transactions can be linked to a payment.");
    const invoices = await loadInvoices(ctx, row.societyId);
    const alreadyLinked = invoices.some((invoice) => (invoice.payments ?? []).some((payment: any) => payment.financialTransactionId === args.financialTransactionId));
    if (alreadyLinked) throw new Error("That bank transaction is already linked to an invoice payment.");
  }
  const actor = await actorName(ctx, row.societyId);
  const method = (PAYMENT_METHODS as readonly string[]).includes(args.method) ? args.method : "other";
  const payment: Record<string, any> = { key: randomKey("pay"), date: args.date, amountCents, method, recordedAtISO: nowISO() };
  const reference = cleanText(args.reference, 100);
  const note = cleanText(args.note, 500);
  if (reference) payment.reference = reference;
  if (note) payment.note = note;
  if (args.financialTransactionId) payment.financialTransactionId = args.financialTransactionId;
  if (actor) payment.recordedByName = actor;
  const payments = [...(row.payments ?? []), payment];
  const remaining = total - sumPaid(payments);
  const at = nowISO();
  const timeline = [...(row.timeline ?? [])];
  if (row.status === "draft") timeline.push(event("sent", "Marked as sent", actor));
  timeline.push(event("payment", remaining <= 0 ? "Paid in full" : "Partial payment recorded", actor, amountCents));
  await ctx.db.patch(row._id, {
    status: "sent",
    sentAtISO: row.sentAtISO ?? at,
    payments,
    paidCents: sumPaid(payments),
    totalCents: total,
    updatedAtISO: at,
    timeline,
  });
  return payment.key;
}

// The payment is addressed by its key inside the invoice (named `paymentKey`, not an id: it is not a row).
export async function removePaymentPortable(ctx: PortableMutationCtx, { id, paymentKey }: { id: string; paymentKey: string }) {
  const row = await requireOwnedRow<Row>(ctx, "invoices", id);
  const payment = (row.payments ?? []).find((entry: any) => entry.key === paymentKey);
  if (!payment) throw new Error("That payment is no longer on this invoice.");
  const payments = (row.payments ?? []).filter((entry: any) => entry.key !== paymentKey);
  const actor = await actorName(ctx, row.societyId);
  await ctx.db.patch(id, { payments, paidCents: sumPaid(payments), updatedAtISO: nowISO(), timeline: [...(row.timeline ?? []), event("payment_removed", "Payment removed", actor, payment.amountCents)] });
}

export async function revertToUnpaidPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const row = await requireOwnedRow<Row>(ctx, "invoices", id);
  if (!(row.payments ?? []).length) return id;
  const actor = await actorName(ctx, row.societyId);
  await ctx.db.patch(id, { payments: [], paidCents: 0, updatedAtISO: nowISO(), timeline: [...(row.timeline ?? []), event("reverted", "Reverted to unpaid", actor, sumPaid(row.payments))] });
  return id;
}

/** Draft a reminder email in the Outbox for each open invoice with an email address. */
export async function sendRemindersPortable(ctx: PortableMutationCtx, { societyId, ids }: { societyId: string; ids: string[] }) {
  const rows = await ownedInvoices(ctx, societyId, ids);
  const today = await organizationToday(ctx, societyId);
  const actor = await actorName(ctx, societyId);
  let created = 0;
  let skippedNoEmail = 0;
  let skippedNotOpen = 0;
  for (const row of rows) {
    const total = computeInvoiceTotals(row.lines ?? [], row.discount).totalCents;
    const status = deriveInvoiceStatus({ status: row.status, dueDate: row.dueDate, totalCents: total, payments: row.payments }, today);
    if (!isOpenStatus(status)) { skippedNotOpen += 1; continue; }
    if (!row.billToEmail) { skippedNoEmail += 1; continue; }
    const balance = total - sumPaid(row.payments);
    await draftOutboxEmail(ctx, row, "reminder", balance);
    const at = nowISO();
    await ctx.db.patch(row._id, { lastReminderAtISO: at, updatedAtISO: at, timeline: [...(row.timeline ?? []), event("reminder", "Reminder drafted in Outbox", actor)] });
    created += 1;
  }
  return { created, skippedNoEmail, skippedNotOpen };
}

async function membershipContext(ctx: PortableQueryCtx, societyId: string) {
  const [subscriptions, plans, feePeriods] = await Promise.all([
    ctx.db.query("memberSubscriptions").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("subscriptionPlans").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("membershipFeePeriods").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  return { subscriptions: subscriptions as Row[], plans: (plans as Row[]).filter((plan) => plan.active !== false), feePeriods: feePeriods as Row[] };
}

async function insertDuesDraft(
  ctx: PortableMutationCtx,
  societyId: string,
  input: { member?: Row; subscription?: Row; plan: Row; priceCents: number; issueDate: string; renewalDate?: string; batch?: string; actor?: string },
) {
  const settings = await loadSettings(ctx, societyId);
  const terms = settings?.defaultTerms ?? DEFAULT_TERMS;
  const lines = [planLineItem(input.plan, input.priceCents, input.renewalDate)];
  const { sequence, number } = await allocateNumber(ctx, societyId);
  const at = nowISO();
  const member = input.member;
  const name = member
    ? (member.memberKind === "organization" && member.organizationName ? member.organizationName : `${member.firstName} ${member.lastName}`.trim())
    : String(input.subscription?.fullName ?? "Member");
  return ctx.db.insert("invoices", {
    societyId,
    sequence,
    number,
    status: "draft",
    partyKind: member ? "member" : "custom",
    memberId: member?._id,
    billToName: name,
    billToEmail: member?.email ?? input.subscription?.email,
    billToAddress: member?.address,
    issueDate: input.issueDate,
    terms,
    dueDate: dueDateForTerms(input.issueDate, terms),
    currency: input.plan.currency ?? "CAD",
    lines,
    memo: settings?.defaultMemo,
    totalCents: computeInvoiceTotals(lines).totalCents,
    paidCents: 0,
    payments: [],
    timeline: [event("created", input.batch ? "Draft created from membership renewals" : "Draft created from fee tier", input.actor)],
    source: "dues",
    subscriptionId: input.subscription?._id,
    duesPeriodEnd: input.renewalDate,
    duesBatch: input.batch,
    createdByUserId: await principalUserId(ctx, societyId).catch(() => undefined),
    createdAtISO: at,
    updatedAtISO: at,
  });
}

/** Create a draft dues invoice for one member from their fee tier. */
export async function billMemberDuesPortable(ctx: PortableMutationCtx, { societyId, memberId }: { societyId: string; memberId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const member = await getOwned<Row>(ctx, "members", memberId, societyId);
  const today = await organizationToday(ctx, societyId);
  const { subscriptions, plans, feePeriods } = await membershipContext(ctx, societyId);
  const subscription = subscriptions.find((sub) => sub.memberId === memberId && ["active", "past_due", "pending", "trialing"].includes(String(sub.status)));
  const byClass = (cls: string) => plans.filter((plan) => String(plan.membershipClass ?? "").toLowerCase() === cls.toLowerCase());
  const plan = (subscription && plans.find((row) => row._id === subscription.planId))
    ?? byClass(String(member.membershipClass ?? "")).find((row) => row.interval === "year")
    ?? byClass(String(member.membershipClass ?? ""))[0];
  if (!plan) throw new Error(`No active fee tier matches the ${member.membershipClass || "member's"} class. Add one on Membership & billing.`);
  return insertDuesDraft(ctx, societyId, { member, subscription, plan, priceCents: feeForPlan(plan, feePeriods, today), issueDate: today, actor: await actorName(ctx, societyId) });
}

/** Draft dues invoices for the chosen renewals; returns a batch key for Undo. */
export async function generateDuesInvoicesPortable(ctx: PortableMutationCtx, { societyId, subscriptionIds }: { societyId: string; subscriptionIds: string[] }) {
  await requireSocietyMembership(ctx, societyId);
  // Resolve against this workspace's subscriptions (scoped read) so an id from
  // anywhere else is simply not found, before anything is written.
  const { subscriptions, plans, feePeriods } = await membershipContext(ctx, societyId);
  const owned = new Map(subscriptions.map((sub) => [sub._id, sub]));
  const subs = [...new Set(subscriptionIds ?? [])].slice(0, 500).map((id) => {
    const sub = owned.get(id);
    if (!sub) throw new Error("memberSubscriptions not found.");
    return sub;
  });
  const today = await organizationToday(ctx, societyId);
  const invoices = await loadInvoices(ctx, societyId);
  const actor = await actorName(ctx, societyId);
  const batch = randomKey("dues");
  let created = 0;
  let skipped = 0;
  for (const sub of subs) {
    const plan = plans.find((row) => row._id === sub.planId);
    const renewalDate = String(sub.currentPeriodEndISO ?? "").slice(0, 10);
    const already = invoices.some((invoice) => invoice.subscriptionId === sub._id && invoice.duesPeriodEnd === renewalDate && invoice.status !== "void");
    if (!plan || !isCalendarDate(renewalDate) || already) { skipped += 1; continue; }
    const member = sub.memberId ? await ctx.db.get(sub.memberId, "members") : null;
    await insertDuesDraft(ctx, societyId, {
      member: member && (member as Row).societyId === societyId ? (member as Row) : undefined,
      subscription: sub,
      plan,
      priceCents: feeForPlan(plan, feePeriods, renewalDate),
      issueDate: today,
      renewalDate,
      batch,
      actor,
    });
    created += 1;
  }
  return { created, skipped, batch };
}

export async function undoDuesBatchPortable(ctx: PortableMutationCtx, { societyId, batch }: { societyId: string; batch: string }) {
  await requireSocietyMembership(ctx, societyId);
  if (!batch) throw new Error("Nothing to undo.");
  const invoices = await loadInvoices(ctx, societyId);
  const inBatch = invoices.filter((invoice) => invoice.duesBatch === batch);
  const removable = inBatch.filter((invoice) => invoice.status === "draft" && !(invoice.payments ?? []).length);
  for (const invoice of removable) await ctx.db.delete(invoice._id);
  // Give the numbers back when nothing was numbered after the batch.
  const removedSeq = removable.map((invoice) => invoice.sequence);
  const remaining = invoices.filter((invoice) => !removable.includes(invoice));
  const highestRemaining = remaining.reduce((max, invoice) => Math.max(max, invoice.sequence), 0);
  if (removedSeq.length && Math.min(...removedSeq) > highestRemaining) {
    const settings = await loadSettings(ctx, societyId);
    if (settings) await ctx.db.patch(settings._id, { nextNumber: Math.min(...removedSeq), updatedAtISO: nowISO() });
  }
  return { removed: removable.length, kept: inBatch.length - removable.length };
}

export async function upsertCatalogItemPortable(
  ctx: PortableMutationCtx,
  args: { id?: string; societyId: string; name: string; description?: string; unitPriceCents: number; taxRatePercent?: number; taxLabel?: string; category?: string; accountingAccountId?: string; active?: boolean },
) {
  await requireSocietyMembership(ctx, args.societyId);
  const name = cleanText(args.name, 200);
  if (!name) throw new Error("Give the item a name.");
  const unitPriceCents = Math.round(Number(args.unitPriceCents));
  if (!Number.isFinite(unitPriceCents) || unitPriceCents < 0) throw new Error("Enter a price of zero or more.");
  const rate = Number(args.taxRatePercent ?? 0);
  if (!Number.isFinite(rate) || rate < 0 || rate > 30) throw new Error("Tax rate must be between 0 and 30%.");
  if (args.accountingAccountId) await getOwned(ctx, "financialAccounts", args.accountingAccountId, args.societyId);
  const fields = {
    name,
    description: cleanText(args.description, 1000),
    unitPriceCents,
    taxRatePercent: rate > 0 ? rate : undefined,
    taxLabel: rate > 0 ? cleanText(args.taxLabel, 20) ?? "Tax" : undefined,
    category: cleanText(args.category, 100),
    accountingAccountId: args.accountingAccountId || undefined,
    active: args.active ?? true,
    updatedAtISO: nowISO(),
  };
  if (args.id) {
    await getOwned(ctx, "invoiceCatalogItems", args.id, args.societyId);
    await ctx.db.patch(args.id, fields);
    return args.id;
  }
  return ctx.db.insert("invoiceCatalogItems", { societyId: args.societyId, ...fields, createdAtISO: nowISO() });
}

export async function setCatalogItemActivePortable(ctx: PortableMutationCtx, { id, active }: { id: string; active: boolean }) {
  await requireOwnedRow(ctx, "invoiceCatalogItems", id);
  await ctx.db.patch(id, { active, updatedAtISO: nowISO() });
}

export async function removeCatalogItemPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  await requireOwnedRow(ctx, "invoiceCatalogItems", id);
  await ctx.db.delete(id);
}

type SeriesArgs = PartyArgs & {
  id?: string;
  societyId: string;
  name: string;
  frequency: string;
  startDate: string;
  endKind: string;
  endAfterCount?: number;
  endDate?: string;
  autoSend?: boolean;
  terms: string;
  reference?: string;
  currency?: string;
  lines: any[];
  discount?: any;
  memo?: string;
  fromInvoiceId?: string;
};

export async function upsertSeriesPortable(ctx: PortableMutationCtx, args: SeriesArgs) {
  await requireSocietyMembership(ctx, args.societyId);
  const name = cleanText(args.name, 200);
  if (!name) throw new Error("Give the series a name.");
  if (!(SERIES_FREQUENCIES as readonly string[]).includes(args.frequency)) throw new Error("Choose how often to invoice.");
  if (!isCalendarDate(args.startDate)) throw new Error("Choose the first issue date.");
  const endKind = ["never", "after_count", "on_date"].includes(args.endKind) ? args.endKind : "never";
  const endAfterCount = endKind === "after_count" ? Math.max(1, Math.min(240, Math.round(Number(args.endAfterCount) || 0))) : undefined;
  if (endKind === "after_count" && !endAfterCount) throw new Error("Choose how many invoices to send.");
  if (endKind === "on_date" && (!isCalendarDate(args.endDate) || args.endDate! < args.startDate)) throw new Error("Choose an end date after the first issue date.");
  const lines = cleanLines(args.lines);
  const problem = validateInvoiceLines(lines);
  if (problem) throw new Error(problem);
  await assertCatalogRefs(ctx, args.societyId, lines);
  const party = await cleanParty(ctx, args.societyId, args);
  const terms = (INVOICE_TERMS as readonly string[]).includes(args.terms) && args.terms !== "custom" ? args.terms : DEFAULT_TERMS;
  const schedule = { frequency: args.frequency, startDate: args.startDate, endKind, endAfterCount, endDate: endKind === "on_date" ? args.endDate : undefined };
  let issuedCount = 0;
  let existing: Row | null = null;
  if (args.id) {
    existing = await getOwned<Row>(ctx, "invoiceSeries", args.id, args.societyId);
    issuedCount = Number(existing.issuedCount) || 0;
  }
  let source: Row | null = null;
  if (args.fromInvoiceId) {
    source = await getOwned<Row>(ctx, "invoices", args.fromInvoiceId, args.societyId);
    if (source.seriesId && source.seriesId !== args.id) throw new Error("This invoice already belongs to a series.");
    if (!existing) issuedCount = source.issueDate === args.startDate ? 1 : 0;
  }
  const nextIssueDate = seriesNextIssueDate(schedule, issuedCount);
  const status = existing?.status === "paused" ? "paused" : nextIssueDate ? "active" : "ended";
  const fields = {
    name,
    ...schedule,
    nextIssueDate: nextIssueDate ?? undefined,
    issuedCount,
    autoSend: Boolean(args.autoSend),
    status,
    ...party,
    terms,
    reference: cleanText(args.reference, 100),
    currency: (cleanText(args.currency, 3) ?? "CAD").toUpperCase(),
    lines,
    discount: cleanDiscount(args.discount),
    memo: cleanText(args.memo, 4000),
    updatedAtISO: nowISO(),
  };
  let seriesId = args.id;
  if (args.id) await ctx.db.patch(args.id, fields);
  else seriesId = await ctx.db.insert("invoiceSeries", { societyId: args.societyId, ...fields, createdAtISO: nowISO() });
  if (source && seriesId) await ctx.db.patch(source._id, { seriesId, updatedAtISO: nowISO() });
  return seriesId;
}

export async function setSeriesStatusPortable(ctx: PortableMutationCtx, { id, status }: { id: string; status: string }) {
  const series = await requireOwnedRow<Row>(ctx, "invoiceSeries", id);
  if (!["active", "paused"].includes(status)) throw new Error("Unknown series status.");
  if (status === "active" && !series.nextIssueDate) throw new Error("This series has ended. Edit its end to continue it.");
  await ctx.db.patch(id, { status, updatedAtISO: nowISO() });
}

/** Issue the next invoice of a series as a draft dated its scheduled issue date. */
export async function issueFromSeriesPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const series = await requireOwnedRow<Row>(ctx, "invoiceSeries", id);
  if (!series.nextIssueDate || series.status === "ended") throw new Error("This series has no more invoices to issue.");
  const actor = await actorName(ctx, series.societyId);
  const issueDate = series.nextIssueDate;
  const { sequence, number } = await allocateNumber(ctx, series.societyId);
  const at = nowISO();
  const invoiceId = await ctx.db.insert("invoices", {
    societyId: series.societyId,
    sequence,
    number,
    status: "draft",
    partyKind: series.partyKind,
    memberId: series.memberId,
    counterpartyId: series.counterpartyId,
    billToName: series.billToName,
    billToEmail: series.billToEmail,
    billToAddress: series.billToAddress,
    issueDate,
    terms: series.terms,
    dueDate: dueDateForTerms(issueDate, series.terms),
    reference: series.reference,
    currency: series.currency,
    lines: (series.lines ?? []).map((line: any) => ({ ...line, key: randomKey("line") })),
    discount: series.discount,
    memo: series.memo,
    totalCents: computeInvoiceTotals(series.lines ?? [], series.discount).totalCents,
    paidCents: 0,
    payments: [],
    timeline: [event("issued_from_series", `Issued from ${series.name}`, actor)],
    seriesId: series._id,
    source: "series",
    createdByUserId: await principalUserId(ctx, series.societyId).catch(() => undefined),
    createdAtISO: at,
    updatedAtISO: at,
  });
  const issuedCount = (Number(series.issuedCount) || 0) + 1;
  const next = seriesNextIssueDate(series as any, issuedCount);
  await ctx.db.patch(series._id, { issuedCount, nextIssueDate: next ?? undefined, status: next ? series.status : "ended", lastIssuedAtISO: at, updatedAtISO: at });
  return invoiceId;
}

export async function saveSettingsPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; prefix: string; nextNumber: number; defaultTerms: string; paymentInstructions?: string; defaultMemo?: string; replyToEmail?: string },
) {
  await requireSocietyMembership(ctx, args.societyId);
  const [settings, invoices] = await Promise.all([loadSettings(ctx, args.societyId), loadInvoices(ctx, args.societyId)]);
  const highest = invoices.reduce((max, invoice) => Math.max(max, Number(invoice.sequence) || 0), 0);
  const nextNumber = Math.floor(Number(args.nextNumber));
  if (!Number.isFinite(nextNumber) || nextNumber < 1) throw new Error("The next number must be 1 or more.");
  if (nextNumber <= highest) throw new Error(`The next number must be above ${highest}, the highest number already used.`);
  const replyToEmail = cleanText(args.replyToEmail, 200);
  if (replyToEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyToEmail)) throw new Error("The reply-to email doesn't look right.");
  const fields = {
    prefix: normalizeInvoicePrefix(args.prefix),
    nextNumber,
    defaultTerms: (INVOICE_TERMS as readonly string[]).includes(args.defaultTerms) && args.defaultTerms !== "custom" ? args.defaultTerms : DEFAULT_TERMS,
    paymentInstructions: cleanText(args.paymentInstructions, 2000),
    defaultMemo: cleanText(args.defaultMemo, 2000),
    replyToEmail,
    updatedAtISO: nowISO(),
  };
  if (settings) {
    await ctx.db.patch(settings._id, fields);
    return settings._id;
  }
  return ctx.db.insert("invoiceSettings", { societyId: args.societyId, ...fields });
}
