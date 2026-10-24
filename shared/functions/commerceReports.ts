import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireSocietyMembership, principalUserId } from "./access";
import { cleanCommerceDefinition, commerceSourceTables, defaultCommerceReport, type CommerceReportDefinition, type CommerceReportSource, type CommerceSourcePageArgs, type CommerceSourceTable } from "../commerceReports";
import { loadCommerceReport } from "../commerceReportSources";
const now = () => new Date().toISOString();
const SOURCE_TABLES: CommerceSourceTable[] = ["invoices", "bills", "repairJobs", "repairOperations", "repairTimeEntries", "journalEntries", "journalLines", "financialAccounts", "fundRestrictions", "financeTags", "accountingCounterparties", "users", "financialTransactions", "budgets"];
const FIELDS: Record<CommerceSourceTable, string[]> = {
  invoices: ["number", "status", "counterpartyId", "memberId", "billToName", "issueDate", "dueDate", "currency", "lines", "discount", "money", "totalCents", "payments", "repairJobId", "voidedAtISO"],
  bills: ["billNumber", "status", "vendorId", "vendorName", "billDate", "dueDate", "currency", "lines", "totalCents", "payments", "canceledAtISO"],
  repairJobs: ["number", "status", "billToName", "counterpartyId", "memberId", "asset", "receivedDate", "targetDate", "currency", "lines", "timeline"],
  repairOperations: ["repairJobId", "technicianUserId", "scheduledDate", "estimatedMinutes", "approvalRequired", "approvalStatus", "approvalDecisionAtISO"],
  repairTimeEntries: ["repairJobId", "technicianUserId", "startAtISO", "endAtISO", "durationMinutes", "costRateCents", "billingRateCents", "billable"],
  financialTransactions: ["date", "amountCents", "currency", "accountId", "connectionId", "externalId", "description", "category", "counterparty", "counterpartyExternalId", "counterpartyResourceType", "reconciledAtISO", "reconciledByName", "matchedKind", "matchedId", "reconciliationNote", "categorizedBy", "ruleId", "ruleApplication", "accountingAccountId", "fundRestrictionId", "reviewedAtISO", "status", "method", "memo", "receiptStatus", "receiptDocumentId", "lines", "tagIds", "spendBudgetId", "createdAtISO", "updatedAtISO"],
  journalEntries: ["date", "status", "source", "basis", "memo", "entryNumber", "voidedAtISO", "reviewFlags"],
  journalLines: ["journalEntryId", "accountId", "lineOrder", "amountCents", "side", "description", "programCode", "counterpartyId", "fundRestrictionId", "tagIds", "financialTransactionId"],
  budgets: ["fiscalYear", "category", "plannedCents", "programCode", "accountId", "currency", "notes"],
  financialAccounts: ["balanceCents", "isRestricted", "restrictedPurpose", "connectionId", "externalId", "sourceSystem", "code", "name", "accountType", "subtype", "currency", "normalBalance", "parentAccountId", "cashFlowClass"],
  fundRestrictions: ["name", "status"], financeTags: ["name", "groupId", "archived"], accountingCounterparties: ["name", "kind"], users: ["name", "displayName"],
};
const pick = (row: Record<string, any>, fields: readonly string[]) => Object.fromEntries(fields.filter((field) => row[field] !== undefined).map((field) => [field, row[field]]));
const INVOICE_LINE_FIELDS = ["key", "item", "sku", "quantity", "unitPriceCents", "taxRatePercent", "taxLabel", "taxMode", "programCode", "fundRestrictionId", "tagIds"];
const BILL_LINE_FIELDS = ["key", "amountCents", "programCode", "fundRestrictionId", "tagIds"];
const BANK_LINE_FIELDS = ["id", "amountCents", "category", "accountingAccountId", "fundRestrictionId", "tagIds", "memo"];
const PAYMENT_FIELDS = ["key", "kind", "date", "amountCents", "reversedDate"];
/** Reports need amounts, identifiers and dimensions, never artwork, attachments or reversible bank snapshots. */
export function projectCommerceSourceRow(table: CommerceSourceTable, row: Record<string, any>) {
  const projected: Record<string, any> = { _id: row._id, ...pick(row, FIELDS[table]) };
  if (Array.isArray(projected.lines)) {
    const fields = table === "bills" ? BILL_LINE_FIELDS : table === "financialTransactions" ? BANK_LINE_FIELDS : INVOICE_LINE_FIELDS;
    projected.lines = projected.lines.map((line: Record<string, any>) => pick(line, fields));
  }
  if (Array.isArray(projected.payments)) projected.payments = projected.payments.map((payment: Record<string, any>) => pick(payment, PAYMENT_FIELDS));
  if (projected.discount) projected.discount = pick(projected.discount, ["kind", "value"]);
  if (projected.money) {
    const money = pick(projected.money, ["taxMode"]);
    if (projected.money.shipping) money.shipping = pick(projected.money.shipping, ["amountCents", "taxRatePercent", "taxLabel", "taxMode"]);
    if (projected.money.withholding) money.withholding = pick(projected.money.withholding, ["kind", "value"]);
    projected.money = money;
  }
  if (Array.isArray(projected.timeline)) projected.timeline = projected.timeline.filter((event: Record<string, any>) => event.kind === "status").map((event: Record<string, any>) => ({ ...pick(event, ["atISO", "kind"]), ...(/completed/i.test(String(event.status ?? event.label ?? "")) ? { status: "completed" } : {}) }));
  if (projected.ruleApplication) projected.ruleApplication = pick(projected.ruleApplication, ["ruleName", "batchId", "appliedAtISO"]);
  return projected;
}
export async function sourcePagePortable(ctx: PortableQueryCtx, args: CommerceSourcePageArgs & { societyId: string; source?: CommerceReportSource }) {
  await requireSocietyMembership(ctx, args.societyId);
  if (!SOURCE_TABLES.includes(args.sourceTable) || (args.source && !commerceSourceTables(args.source).includes(args.sourceTable))) throw new Error("Unsupported report source table.");
  if (!Number.isInteger(args.pageSize) || args.pageSize < 1 || args.pageSize > 200) throw new Error("Report pages contain 1–200 source records.");
  const result = await ctx.db.query(args.sourceTable).withIndex(args.sourceTable === "budgets" ? "by_society_fy" : "by_society", (q) => q.eq("societyId", args.societyId)).paginate({ numItems: args.pageSize, cursor: args.cursor, maximumBytesRead: 8_000_000 });
  return { ...result, page: result.page.map((row) => projectCommerceSourceRow(args.sourceTable, row)) };
}
export async function listDefinitionsPortable(ctx: PortableQueryCtx, { societyId, archived = false, cursor = null }: { societyId: string; archived?: boolean; cursor?: string | null }) {
  await requireSocietyMembership(ctx, societyId); return ctx.db.query("reportDefinitions").withIndex("by_society_archived", (q) => q.eq("societyId", societyId).eq("archived", archived)).order("desc").paginate({ numItems: 100, cursor });
}
export async function getDefinitionPortable(ctx: PortableQueryCtx, { societyId, id }: { societyId: string; id: string }) { await requireSocietyMembership(ctx, societyId); return getOwned(ctx, "reportDefinitions", id, societyId); }
export async function saveDefinitionPortable(ctx: PortableMutationCtx, { societyId, id, definition }: { societyId: string; id?: string; definition: CommerceReportDefinition }) {
  await requireSocietyMembership(ctx, societyId); const cleaned = cleanCommerceDefinition(definition), updatedAtISO = now();
  if (id) { const existing = await getOwned(ctx, "reportDefinitions", id, societyId); if (!existing) throw new Error("Report definition not found."); await ctx.db.patch(id, { definition: cleaned, updatedAtISO }); return id; }
  return ctx.db.insert("reportDefinitions", { societyId, definition: cleaned, archived: false, createdByUserId: await principalUserId(ctx, societyId), createdAtISO: updatedAtISO, updatedAtISO });
}
export async function duplicateDefinitionPortable(ctx: PortableMutationCtx, { societyId, id }: { societyId: string; id: string }) { const existing = await getDefinitionPortable(ctx, { societyId, id }); if (!existing) throw new Error("Report definition not found."); return saveDefinitionPortable(ctx, { societyId, definition: { ...existing.definition, name: `${existing.definition.name.slice(0, 114)} copy` } }); }
export async function archiveDefinitionPortable(ctx: PortableMutationCtx, { societyId, id, archived }: { societyId: string; id: string; archived: boolean }) { const existing = await getDefinitionPortable(ctx, { societyId, id }); if (!existing) throw new Error("Report definition not found."); await ctx.db.patch(id, { archived, updatedAtISO: now() }); return id; }
export async function listPresetsPortable(ctx: PortableQueryCtx, { societyId, source, cursor = null }: { societyId: string; source: CommerceReportSource; cursor?: string | null }) { await requireSocietyMembership(ctx, societyId); return ctx.db.query("reportFilterPresets").withIndex("by_society_source", (q) => q.eq("societyId", societyId).eq("source", source)).order("desc").paginate({ numItems: 100, cursor }); }
export async function savePresetPortable(ctx: PortableMutationCtx, { societyId, source, name, filters }: { societyId: string; source: CommerceReportSource; name: string; filters: CommerceReportDefinition["filters"] }) { await requireSocietyMembership(ctx, societyId); const cleaned = cleanCommerceDefinition({ ...defaultCommerceReport(source), filters }); const label = String(name).trim(); if (!label || label.length > 120) throw new Error("Name this filter preset (up to 120 characters)."); const at = now(); return ctx.db.insert("reportFilterPresets", { societyId, source, name: label, filters: cleaned.filters, createdByUserId: await principalUserId(ctx, societyId), createdAtISO: at, updatedAtISO: at }); }
export async function removePresetPortable(ctx: PortableMutationCtx, { societyId, id }: { societyId: string; id: string }) { await requireSocietyMembership(ctx, societyId); await getOwned(ctx, "reportFilterPresets", id, societyId); await ctx.db.delete(id); return id; }
/** Suitable for background actions: fetchQuery MUST invoke independent bounded sourcePage queries. */
export async function runReportPortable(fetchQuery: <T = any>(name: string, args: Record<string, any>) => Promise<T>, { societyId, definitionId, definition }: { societyId: string; definitionId?: string; definition?: CommerceReportDefinition }) {
  let config = definition;
  if (definitionId) { const saved = await fetchQuery("commerceReports:getDefinition", { societyId, id: definitionId }); if (!saved || saved.archived) throw new Error("Saved report is missing or archived."); config = saved.definition; }
  if (!config) throw new Error("Choose a report definition.");
  return loadCommerceReport(config, (page) => fetchQuery("commerceReports:sourcePage", { societyId, source: config!.source, ...page }));
}
