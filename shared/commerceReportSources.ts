import { allocateProportionally, computeInvoiceTotals, daysBetween } from "./invoicing";
import { entryCountsForBasis } from "./booksReports";
import { COMMERCE_REPORT_CATALOG, cleanCommerceDefinition, composeCommerceReport, commerceSourceTables, type CommerceDataset, type CommerceFilters, type CommerceRecord, type CommerceReportDefinition, type CommerceReportResult, type CommerceSourcePage, type CommerceSourcePageArgs, type CommerceSourceTable } from "./commerceReports";

type Row = Record<string, any>;
export type CommerceSourceData = Partial<Record<CommerceSourceTable, Row[]>>;
const isoDate = (value: unknown) => String(value ?? "").slice(0, 10);
const dateIn = (date: string, f: CommerceFilters) => date >= f.from && date <= f.to && date <= f.asOf;
const activeAt = (row: Row, f: CommerceFilters, payable = false) => {
  const issueDate = payable ? row.billDate : row.issueDate;
  if (!issueDate || issueDate > f.asOf) return false;
  const cancelled = payable ? "canceled" : "void", when = isoDate(payable ? row.canceledAtISO : row.voidedAtISO);
  if (row.status === cancelled && (!when || when <= f.asOf)) return false;
  return f.includeDrafts || (payable ? !["draft", "awaiting_approval"].includes(row.status) : row.status !== "draft");
};
export function historicalSettlements(payments: Row[] = [], asOf: string): number { return payments.filter((payment) => payment.date <= asOf && (!payment.reversedDate || payment.reversedDate > asOf)).reduce((sum, payment) => sum + Math.round(payment.amountCents || 0), 0); }
function partyMatches(row: Row, filters: CommerceFilters, payable = false) { const name = payable ? row.vendorName : row.billToName; return !filters.party || [String(row.counterpartyId ?? row.memberId ?? row.vendorId ?? ""), String(name ?? "")].some((value) => value.toLowerCase().includes(filters.party.toLowerCase())); }
function lineMatches(line: Row, f: CommerceFilters) { return (!f.programCode || line.programCode === f.programCode) && (!f.fundId || line.fundRestrictionId === f.fundId) && (!f.tagIds.length || f.tagIds.every((tag) => (line.tagIds ?? []).includes(tag))); }
function documentShare(row: Row, f: CommerceFilters, payable: boolean) { if (!f.programCode && !f.fundId && !f.tagIds.length) return 1; const lines: Row[] = row.lines ?? [], weights = lines.map((line) => payable ? Number(line.amountCents) || 0 : (Number(line.quantity) || 0) * (Number(line.unitPriceCents) || 0)); const total = weights.reduce((a, b) => a + Math.max(0, b), 0); return total ? lines.reduce((sum, line, index) => sum + (lineMatches(line, f) ? Math.max(0, weights[index]) : 0), 0) / total : 0; }
export function agingRows(records: Row[], f: CommerceFilters, payable = false): CommerceRecord[] {
  return records.flatMap((row) => {
    if (row.currency !== f.currency || !activeAt(row, f, payable) || !partyMatches(row, f, payable)) return [];
    const share = documentShare(row, f, payable); if (!share) return [];
    const total = Math.round((Number(row.totalCents) || 0) * share), settled = Math.round(historicalSettlements(row.payments, f.asOf) * share), balance = total - settled;
    if (!balance) return [];
    const age = Math.max(0, daysBetween(row.dueDate, f.asOf)), open = Math.max(0, balance), credit = Math.max(0, -balance);
    const status = credit ? "credit_balance" : age ? "overdue" : "current"; if (f.status && f.status !== status) return [];
    return [{ id: row._id, values: { documentNumber: row.number ?? row.billNumber ?? row._id, party: row.billToName ?? row.vendorName ?? "Unspecified", issueDate: row.issueDate ?? row.billDate, dueDate: row.dueDate, ageDays: age, totalCents: total, settledCents: settled, currentCents: !age ? open : 0, days1to30Cents: age > 0 && age <= 30 ? open : 0, days31to60Cents: age > 30 && age <= 60 ? open : 0, days61to90Cents: age > 60 && age <= 90 ? open : 0, days91plusCents: age > 90 ? open : 0, openCents: open, unappliedCreditCents: credit, netBalanceCents: balance }, links: [{ label: row.number ?? row.billNumber ?? "Open document", url: payable ? `/app/financials/bills?bill=${encodeURIComponent(row._id)}` : `/app/invoices?invoice=${encodeURIComponent(row._id)}` }] }];
  });
}
function salesRows(records: Row[], f: CommerceFilters): CommerceRecord[] {
  const rows: CommerceRecord[] = [];
  for (const invoice of records) {
    if (invoice.currency !== f.currency || !activeAt(invoice, f) || !partyMatches(invoice, f)) continue;
    const totals = computeInvoiceTotals(invoice.lines ?? [], invoice.discount, invoice.money), lines: Row[] = [...(invoice.lines ?? [])];
    const net = [...totals.lineNetCents], discounts = [...totals.lineDiscountCents], gross = [...totals.lineAmounts];
    if (totals.shippingCents) { lines.push({ item: "Shipping", quantity: 1, key: "__shipping" }); net.push(totals.shippingCents); discounts.push(0); gross.push(totals.shippingCents); }
    const totalNet = net.reduce((a, b) => a + b, 0);
    const events: Array<{ id: string; date: string; amount: number; original: boolean }> = [];
    if (f.basis === "accrual") {
      if (dateIn(invoice.issueDate, f)) events.push({ id: "issue", date: invoice.issueDate, amount: totalNet, original: true });
      for (const payment of invoice.payments ?? []) {
        if (payment.kind !== "credit") continue;
        const amount = -Math.round((payment.amountCents || 0) * totalNet / (totals.totalCents || 1));
        if (dateIn(payment.date, f)) events.push({ id: payment.key, date: payment.date, amount, original: false });
        if (payment.reversedDate && dateIn(payment.reversedDate, f)) events.push({ id: `${payment.key}-reversal`, date: payment.reversedDate, amount: -amount, original: false });
      }
    } else {
      const eventsAll = (invoice.payments ?? []).filter((payment: Row) => !payment.kind || ["payment", "refund"].includes(payment.kind)).flatMap((payment: Row) => [{ id: payment.key, date: payment.date, amount: payment.amountCents || 0 }, ...(payment.reversedDate ? [{ id: `${payment.key}-reversal`, date: payment.reversedDate, amount: -(payment.amountCents || 0) }] : [])]).sort((a: Row, b: Row) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
      let cumulative = 0, recognized = 0;
      for (const payment of eventsAll) { cumulative += payment.amount; const next = Math.max(0, Math.min(totalNet, Math.round(cumulative * totalNet / (totals.totalCents || 1)))), amount = next - recognized; recognized = next; if (dateIn(payment.date, f)) events.push({ id: payment.id, date: payment.date, amount, original: false }); }
    }
    for (const event of events) {
      const amounts = allocateProportionally(event.amount, net.map((value) => Math.max(0, value)));
      lines.forEach((line, index) => { if (!lineMatches(line, f)) return; const proportion = event.original ? 1 : totalNet ? event.amount / totalNet : 0; rows.push({ id: `${invoice._id}:${event.id}:${line.key ?? index}`, values: { documentNumber: invoice.number, party: invoice.billToName, item: line.item, sku: line.sku ?? "", issueDate: invoice.issueDate, recognitionDate: event.date, month: event.date.slice(0, 7), quantity: (line.quantity || 0) * proportion, grossCents: event.original ? gross[index] : amounts[index], discountCents: event.original ? discounts[index] : 0, revenueCents: amounts[index], lineCount: event.original ? 1 : 0 }, links: [{ label: invoice.number, url: `/app/invoices?invoice=${encodeURIComponent(invoice._id)}` }] }); });
    }
  }
  return rows;
}
function repairRows(data: CommerceSourceData, f: CommerceFilters): CommerceRecord[] {
  const operations = new Map((data.repairOperations ?? []).map((row) => [row.repairJobId, row])), users = new Map((data.users ?? []).map((row) => [row._id, row.displayName ?? row.name ?? row._id]));
  const time = new Map<string, Row[]>(), invoices = new Map<string, Row[]>();
  for (const row of data.repairTimeEntries ?? []) { const list = time.get(row.repairJobId) ?? []; list.push(row); time.set(row.repairJobId, list); }
  for (const row of data.invoices ?? []) if (row.repairJobId && activeAt(row, f)) { const list = invoices.get(row.repairJobId) ?? []; list.push(row); invoices.set(row.repairJobId, list); }
  return (data.repairJobs ?? []).flatMap((job) => {
    if (job.currency !== f.currency || !dateIn(job.receivedDate, f) || !partyMatches(job, f) || (f.status && job.status !== f.status) || !documentShare(job, f, false)) return [];
    const op = operations.get(job._id), entries = (time.get(job._id) ?? []).filter((row) => isoDate(row.startAtISO) <= f.asOf && row.endAtISO && isoDate(row.endAtISO) <= f.asOf);
    let minutes = 0, billable = 0, cost = 0, billing = 0;
    for (const entry of entries) { const duration = Number(entry.durationMinutes ?? Math.max(0, (Date.parse(entry.endAtISO) - Date.parse(entry.startAtISO)) / 60000)); if (!Number.isFinite(duration)) continue; minutes += duration; if (entry.billable) { billable += duration; billing += Math.round(duration * (entry.billingRateCents || 0) / 60); } cost += Math.round(duration * (entry.costRateCents || 0) / 60); }
    let billed = 0, outstanding = 0;
    for (const invoice of invoices.get(job._id) ?? []) { const totals = computeInvoiceTotals(invoice.lines ?? [], invoice.discount, invoice.money); if (f.basis === "cash") { const paid = (invoice.payments ?? []).filter((payment: Row) => (!payment.kind || ["payment", "refund"].includes(payment.kind)) && payment.date <= f.asOf && (!payment.reversedDate || payment.reversedDate > f.asOf)).reduce((sum: number, payment: Row) => sum + payment.amountCents, 0); billed += Math.round(paid * (totals.subtotalCents - totals.discountCents + totals.shippingCents) / (totals.totalCents || 1)); } else { const net = totals.subtotalCents - totals.discountCents + totals.shippingCents, credits = historicalSettlements((invoice.payments ?? []).filter((payment: Row) => payment.kind === "credit"), f.asOf); billed += net - Math.round(credits * net / (totals.totalCents || 1)); } outstanding += totals.totalCents - historicalSettlements(invoice.payments, f.asOf); }
    const completed = (job.timeline ?? []).filter((event: Row) => event.kind === "status" && /completed/i.test(event.status ?? event.label ?? "") && isoDate(event.atISO) <= f.asOf).at(-1);
    return [{ id: job._id, values: { documentNumber: job.number, party: job.billToName, asset: job.asset, status: job.status, technician: op?.technicianUserId ? users.get(op.technicianUserId) ?? op.technicianUserId : "Unassigned", approvalStatus: op?.approvalStatus ?? "not_required", receivedDate: job.receivedDate, month: job.receivedDate.slice(0, 7), jobCount: 1, elapsedDays: Math.max(0, daysBetween(job.receivedDate, completed ? isoDate(completed.atISO) : f.asOf)), minutes, billableMinutes: billable, labourCostCents: cost, estimatedBillingCents: billing, billedCents: billed, outstandingCents: outstanding, marginCents: billed - cost }, links: [{ label: job.number, url: `/app/invoices?tab=repairs&repair=${encodeURIComponent(job._id)}` }] }];
  });
}
function ledgerRows(data: CommerceSourceData, f: CommerceFilters): CommerceRecord[] {
  const entries = new Map((data.journalEntries ?? []).filter((row) => row.status === "posted" && dateIn(row.date, f) && entryCountsForBasis(row, f.basis)).map((row) => [row._id, row]));
  const accounts = new Map((data.financialAccounts ?? []).map((row) => [row._id, row])), funds = new Map((data.fundRestrictions ?? []).map((row) => [row._id, row.name])), tags = new Map((data.financeTags ?? []).map((row) => [row._id, row.name])), parties = new Map((data.accountingCounterparties ?? []).map((row) => [row._id, row.name]));
  return (data.journalLines ?? []).flatMap((line) => { const entry = entries.get(line.journalEntryId), account = accounts.get(line.accountId); if (!entry || !account || account.currency !== f.currency || !lineMatches(line, f) || (f.accountId && line.accountId !== f.accountId)) return []; const party = parties.get(line.counterpartyId) ?? ""; if (f.party && !`${party} ${line.counterpartyId ?? ""}`.toLowerCase().includes(f.party.toLowerCase())) return []; const debit = line.side === "debit" ? line.amountCents : 0, credit = line.side === "credit" ? line.amountCents : 0; return [{ id: line._id, values: { date: entry.date, month: entry.date.slice(0, 7), documentNumber: entry.entryNumber ?? entry._id, account: `${account.code ? `${account.code} · ` : ""}${account.name}`, party, description: [entry.memo, line.description].filter(Boolean).join(" — "), programCode: line.programCode ?? "", fund: funds.get(line.fundRestrictionId) ?? "", tags: (line.tagIds ?? []).map((id: string) => tags.get(id) ?? id).join(", "), debitCents: debit, creditCents: credit, netCents: debit - credit, lineCount: 1 }, links: [{ label: entry.entryNumber ?? "Journal entry", url: `/app/financials/accounting?entry=${encodeURIComponent(entry._id)}` }] }]; });
}
export function commerceDataset(data: CommerceSourceData, definition: CommerceReportDefinition, generatedAtISO = new Date().toISOString()): CommerceDataset {
  const { source, filters } = cleanCommerceDefinition(definition), rows = source === "ar_aging" ? agingRows(data.invoices ?? [], filters) : source === "ap_aging" ? agingRows(data.bills ?? [], filters, true) : source.startsWith("sales") ? salesRows(data.invoices ?? [], filters) : source === "repair_analytics" ? repairRows(data, filters) : ledgerRows(data, filters);
  const currencies = [...new Set(Object.values(data).flatMap((records) => (records ?? []).map((row) => row.currency).filter((currency): currency is string => /^[A-Z]{3}$/.test(currency ?? ""))))].sort();
  const warnings = ["Currencies are reported separately. No currency conversion is applied."];
  if (source.endsWith("aging")) warnings.push("Aging is the outstanding obligation as of the selected date and is independent of the cash/accrual display preference. Credit balances remain separate and are not automatically offset against other documents.");
  if (source.startsWith("sales")) warnings.push("Sales exclude tax and include shipping as its own item. Credits are allocated proportionally to invoice lines; write-offs are not sales reductions. Cash sales follow dated payments and refunds.");
  if (filters.includeDrafts && source !== "ledger") warnings.push("Draft/unapproved documents are included by explicit selection; these are not posted-ledger financial statements.");
  if ((filters.fundId || filters.programCode || filters.tagIds.length) && source.endsWith("aging")) warnings.push("Document debts and settlements are allocated proportionally to matching line amounts for the selected dimensions.");
  if (source === "repair_analytics") warnings.push("Running timers are excluded. Repair and approval status reflect the current workflow; recorded time and billing are cut off at the selected as-of date.");
  const filterLabels = Object.fromEntries([...(data.fundRestrictions ?? []).map((row) => [`fund:${row._id}`, String(row.name)]), ...(data.financeTags ?? []).map((row) => [`tag:${row._id}`, String(row.name)]), ...(data.financialAccounts ?? []).map((row) => [`account:${row._id}`, `${row.code ? `${row.code} · ` : ""}${row.name}`])]);
  return { filterLabels, source, columns: COMMERCE_REPORT_CATALOG[source].columns.map((column) => ({ ...column })), rows, warnings, currencies, generatedAtISO };
}
/** Each fetch is a separate bounded transaction; every source page participates in the same rendered/exported result. */
export async function loadCommerceReport(input: CommerceReportDefinition, fetchPage: (args: CommerceSourcePageArgs) => Promise<CommerceSourcePage>, onProgress?: (count: number) => void, shouldCancel?: () => boolean): Promise<CommerceReportResult> {
  const definition = cleanCommerceDefinition(input), data: CommerceSourceData = {}; let count = 0;
  for (const sourceTable of commerceSourceTables(definition.source)) { const rows: Row[] = []; let cursor: string | null = null; const seen = new Set<string>(); do { if (shouldCancel?.()) throw new Error("Report loading cancelled."); const page = await fetchPage({ sourceTable, cursor, pageSize: 200 }); rows.push(...page.page); count += page.page.length; onProgress?.(count); if (page.isDone) break; if (!page.continueCursor || seen.has(page.continueCursor)) throw new Error("Report pagination did not advance. Retry the report."); seen.add(page.continueCursor); cursor = page.continueCursor; } while (true); data[sourceTable] = rows; }
  return composeCommerceReport(commerceDataset(data, definition), definition);
}
