import assert from "node:assert/strict";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import { tables, society } from "../src/lib/staticConvexFixtures";
import * as inv from "../shared/functions/invoices";
import { actionPermission } from "../shared/functions/actionPolicy";
import { cleanInvoiceTemplate, cleanDocumentDesign, resolveDocumentDesign, DEFAULT_INVOICE_TEMPLATE, type DocumentDesign } from "../shared/invoiceCommerce";

const legacy = { ...DEFAULT_INVOICE_TEMPLATE, title: "Account invoice", footer: "A legacy footer", showDescription: false, layout: "compact" as const };
const legacyBefore = JSON.stringify(legacy);
const migrated = resolveDocumentDesign(legacy);
assert.equal(migrated.titles.invoice, "Account invoice");
assert.equal(migrated.footer.text, "A legacy footer");
assert.equal(migrated.table.columns.find((column) => column.key === "description")?.visible, false);
assert.equal(migrated.table.rowPadding, 5);
assert.equal(JSON.stringify(legacy), legacyBefore, "render normalization does not rewrite stored snapshots");
assert.deepEqual(cleanInvoiceTemplate(legacy), legacy, "legacy config remains valid without a migration");
const draft = resolveDocumentDesign(DEFAULT_INVOICE_TEMPLATE);
draft.page.orientation = "landscape";
draft.page.margins = { top: 28, right: 32, bottom: 40, left: 36 };
draft.logo = { width: 170, alignment: "right" };
draft.typography.table = { fontFamily: "mono", fontSize: 12, color: "#123456" };
draft.table.columns = draft.table.columns.reverse().map((column) => ({ ...column, width: column.width + 2 }));
draft.table.striped = true;
draft.footer = { text: "First page", continuationText: "Later pages", repeat: true, pageNumbers: true, pageNumberFormat: "page_of_total" };
draft.header = { text: "First header", continuationText: "Later header", repeat: true };
draft.titles.receipt = "Receipt copy";
draft.titles.work_order = "Service order";
draft.signature = { enabled: true, label: "Customer approval", name: "Authorized signer" };
draft.sections = ["header", "customer", "notes", "items", "totals", "paymentInstructions", "signature"];
const config = cleanInvoiceTemplate({ ...DEFAULT_INVOICE_TEMPLATE, name: "Shared design", design: draft });
assert.deepEqual(cleanInvoiceTemplate(JSON.parse(JSON.stringify(config))), config, "serialized designs roundtrip without losing settings");
const other = resolveDocumentDesign(DEFAULT_INVOICE_TEMPLATE);
assert.equal(other.logo.width, 200, "normalizing a draft does not mutate default shared objects");
assert.equal(other.page.margins.top, 42);
const invalid: unknown[] = [
  { version: 2 }, { page: { orientation: "diagonal" } }, { page: { margins: { top: Number.NaN } } },
  { page: { margins: { right: -1 } } }, { logo: { width: Number.POSITIVE_INFINITY } },
  { typography: { body: { fontSize: 0 } } }, { typography: { table: { fontFamily: "external-url" } } },
  { typography: { footer: { color: "red" } } }, { fields: { organization: "yes" } },
  { header: { html: "<script>alert(1)</script>" } }, { sections: ["header", "header"] },
  { table: { columns: [] } }, { table: { columns: draft.table.columns.map((column) => ({ ...column, visible: false })) } },
  { table: { columns: draft.table.columns.map((column) => ({ ...column, key: "item" })) } },
  { table: { columns: draft.table.columns.map((column) => ({ ...column, width: 0 })) } },
  { footer: { text: "x".repeat(2001) } }, { labels: { madeUp: "Unsupported" } },
];
for (const bad of invalid) assert.throws(() => cleanDocumentDesign(bad), undefined, `reject malformed settings: ${JSON.stringify(bad).slice(0, 120)}`);
assert.throws(() => cleanInvoiceTemplate({ ...config, unknown: true } as any), /Unknown template/);
assert.throws(() => cleanInvoiceTemplate({ ...config, design: null } as any), /object/);
assert.throws(() => cleanInvoiceTemplate([] as any), /valid/);
assert.throws(() => cleanInvoiceTemplate({ showLogo: "false" } as any), /true or false/);
assert.throws(() => cleanInvoiceTemplate({ logoVariant: "missing" } as any), /logo color/);
assert.throws(() => cleanInvoiceTemplate({ title: 42 } as any), /text/);
assert.equal(actionPermission("invoices:documentTemplates", "query"), "financials:read");

const seed: Record<string, any[]> = JSON.parse(JSON.stringify(tables));
seed.users = seed.users.map((user) => ({ ...user, status: "Active", authIssuer: "https://issuer.test", authSubject: `sub-${user._id}` }));
seed.societies = [JSON.parse(JSON.stringify(society)), { _id: "foreign_society", name: "Elsewhere" }];
const db = new MemoryDb({ seed });
const societyId = seed.users[0].societyId;
const ctx: any = { db, principal: { kind: "user", runtime: "test", assurance: "trusted-workspace", subject: `sub-${seed.users[0]._id}`, issuer: "https://issuer.test", userId: seed.users[0]._id, societyId }, capabilities: makeCapabilities({}) };
const templateId = await inv.upsertTemplatePortable(ctx, { societyId, config, makeDefault: true });
const templateCount = (await db.query("invoiceTemplates").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect()).length;
await assert.rejects(() => inv.upsertTemplatePortable(ctx, { societyId, config, active: false, makeDefault: true }), /active/);
assert.equal((await db.query("invoiceTemplates").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect()).length, templateCount, "invalid default creation has no writes even outside a transaction");
const lightweight = await inv.documentTemplatesPortable(ctx, { societyId });
assert.equal(lightweight.defaultTemplateId, templateId);
assert.deepEqual(lightweight.templates.find((template) => template._id === templateId)?.config, config);
assert.equal((lightweight as any).invoices, undefined, "report branding query does not expose billing records");
await db.patch(societyId, { logoStorageId: "workspace-logo-storage" });
const brandedContext = { ...ctx, capabilities: makeCapabilities({ storage: {
  createUploadUrl: async () => ({ uploadUrl: "https://assets.example.test/upload", storageKey: "new-logo" }),
  getDownloadUrl: async ({ storageKey }) => ({ url: `https://assets.example.test/${storageKey}` }),
  delete: async () => {},
} }) };
const workspaceBrand = await inv.documentTemplatesPortable(brandedContext, { societyId });
assert.equal(workspaceBrand.organization.logoUrl, "https://assets.example.test/workspace-logo-storage");
assert.equal((workspaceBrand.organization as any).logoStorageId, undefined, "branding exposes only the resolved organization logo URL");
await db.patch(societyId, { logoStorageId: undefined });
const settingsRow = await db.query("invoiceSettings").withIndex("by_society", (q) => q.eq("societyId", societyId)).first();
const originalReceivable = settingsRow?.receivableAccountId;
const usdReceivable = await db.insert("financialAccounts", { societyId, name: "Selected USD receivable", accountType: "Asset", currency: "USD" });
await db.patch(settingsRow!._id, { receivableAccountId: usdReceivable });
const metadataCurrency = await inv.documentTemplatesPortable(ctx, { societyId });
assert.equal(metadataCurrency.currency, "USD", "report branding metadata respects the configured receivable currency");
assert.ok(metadataCurrency.currencies.includes("USD"));
await db.patch(settingsRow!._id, { receivableAccountId: originalReceivable });
await db.delete(usdReceivable);
const foreignTemplate = await db.insert("invoiceTemplates", { societyId: "foreign_society", config, active: true, createdAtISO: "2026-01-01", updatedAtISO: "2026-01-01" });
await assert.rejects(() => inv.upsertTemplatePortable(ctx, { societyId, id: foreignTemplate, config }));
await assert.rejects(() => inv.documentTemplatesPortable({ ...ctx, principal: { ...ctx.principal, assurance: "verified-jwt" } }, { societyId: "foreign_society" }));
await assert.rejects(() => inv.upsertTemplatePortable(ctx, { societyId, config: { ...config, design: { ...draft, version: 2 } as unknown as DocumentDesign } }), /version/);
const today = (await inv.workspacePortable(ctx, { societyId })).today;
const invoiceId = await inv.upsertPortable(ctx, { societyId, partyKind: "custom", billToName: "Design test customer", shipToName: "Delivery desk", shipToAddress: "200 Service Avenue", issueDate: today, terms: "net_30", currency: "CAD", lines: [{ key: "part", item: "Part", sku: "PART-001", quantity: 1, unitPriceCents: 1200 }] });
const invoice = (await db.get(invoiceId))!;
assert.deepEqual(invoice.documentTemplate, config, "new invoices snapshot the default full design");
assert.equal(invoice.shipToName, "Delivery desk");
assert.equal(invoice.shipToAddress, "200 Service Avenue");
assert.equal(invoice.lines[0].sku, "PART-001");
const copy = (await db.get(await inv.duplicatePortable(ctx, { id: invoiceId })))!;
assert.equal(copy.shipToAddress, invoice.shipToAddress);
assert.equal(copy.lines[0].sku, "PART-001");
assert.deepEqual(copy.documentTemplate, config);
const seriesId = await inv.upsertSeriesPortable(ctx, { societyId, partyKind: "custom", billToName: invoice.billToName, name: "Design recurring", frequency: "monthly", startDate: today, endKind: "never", terms: "net_30", currency: "CAD", lines: invoice.lines, fromInvoiceId: invoiceId });
const series = (await db.get(seriesId!))!;
assert.equal(series.shipToAddress, invoice.shipToAddress);
assert.deepEqual(series.documentTemplate, config);
await inv.upsertTemplatePortable(ctx, { societyId, id: templateId, config: { ...config, name: "Changed", design: { ...draft, titles: { ...draft.titles, invoice: "Changed title" } } } });
assert.deepEqual((await db.get(invoiceId))!.documentTemplate, config, "editing the shared template does not rewrite issued snapshots");
const recurring = (await db.get(await inv.issueFromSeriesPortable(ctx, { id: seriesId! })))!;
assert.equal(recurring.shipToAddress, invoice.shipToAddress);
assert.equal(recurring.lines[0].sku, "PART-001");
assert.deepEqual(recurring.documentTemplate, config, "recurring invoices retain the series design after its template changes");
await inv.upsertTemplatePortable(ctx, { societyId, id: templateId, config, active: false });
const archived = await inv.documentTemplatesPortable(ctx, { societyId });
assert.equal(archived.defaultTemplateId, null, "archiving clears the workspace default");
assert.ok(!archived.templates.some((template) => template._id === templateId), "archived templates are omitted from document pickers");
const lateTemplates: string[] = [];
for (let index = 0; index < 205; index++) lateTemplates.push(await db.insert("invoiceTemplates", { societyId, config: { ...config, name: `Report design ${index + 1}` }, active: true, createdAtISO: "2026-01-01", updatedAtISO: "2026-01-01" }));
const lateDefault = lateTemplates.at(-1)!;
await inv.upsertTemplatePortable(ctx, { societyId, id: lateDefault, config: { ...config, name: "Late report default" }, makeDefault: true });
const lateMetadata = await inv.documentTemplatesPortable(ctx, { societyId });
assert.equal(lateMetadata.defaultTemplateId, lateDefault);
assert.equal(lateMetadata.selectedTemplate?._id, lateDefault, "default templates outside the initial metadata range resolve directly");
assert.ok(lateMetadata.templates.some((template) => template._id === lateDefault));
assert.ok(lateMetadata.templates.length <= 5, "branding metadata carries only a small initial range plus the direct default");
const explicitTemplate = lateTemplates[150];
const explicitMetadata = await inv.documentTemplatesPortable(ctx, { societyId, templateId: explicitTemplate });
assert.equal(explicitMetadata.selectedTemplate?._id, explicitTemplate, "explicit template IDs resolve independently of every list cap");
assert.deepEqual(explicitMetadata.selectedTemplate?.config, (await db.get(explicitTemplate))!.config);
await assert.rejects(() => inv.documentTemplatesPortable(ctx, { societyId, templateId: foreignTemplate }), /not found/i, "explicit template IDs must be owned by the same workspace");
await assert.rejects(() => inv.documentTemplatesPortable(ctx, { societyId, templateId: "missing_template" }), /not found/i);
await inv.upsertTemplatePortable(ctx, { societyId, id: explicitTemplate, config, active: false });
const archivedExplicit = await inv.documentTemplatesPortable(ctx, { societyId, templateId: explicitTemplate });
assert.equal(archivedExplicit.selectedTemplate?._id, explicitTemplate, "a previously selected archived schedule design is still available as its owned snapshot");
assert.ok(!archivedExplicit.templates.some((template) => template._id === explicitTemplate), "archived explicit designs never appear in active pickers");
console.log("Document template checks passed: versioned design, validation, legacy rendering, snapshots, SKU/shipping, duplicate/recurrence and workspace scope.");
