import assert from "node:assert/strict";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import { tables, society } from "../src/lib/staticConvexFixtures";
import * as listViews from "../shared/functions/listViews";
import * as preferences from "../shared/functions/invoicePreferences";
import { actionPermission } from "../shared/functions/actionPolicy";
import { DEFAULT_INVOICE_LIST_VIEW, cleanInvoiceListView } from "../shared/billingPricing";
import { LIST_VIEW_STATE_MAX_BYTES, parseListViewStateJson, staticFieldId } from "../shared/listViewState";
import { invoiceListViewToListViewState } from "../shared/invoiceListViewMigration";

type Row = Record<string, unknown> & { _id: string };
type UserRow = Row & { societyId: string; authIssuer: string; authSubject: string };

const seed: Record<string, Row[]> = JSON.parse(JSON.stringify(tables));
seed.users = seed.users.map((user) => ({ ...user, status: "Active", authIssuer: "https://issuer.test", authSubject: `sub-${user._id}` }));
seed.societies = [JSON.parse(JSON.stringify(society)), { _id: "foreign_society", name: "Elsewhere" }];
const db = new MemoryDb({ seed });
const owner = seed.users[0] as UserRow;
const societyId = owner.societyId;
const context = (user: UserRow) => ({
  db,
  principal: { kind: "user" as const, runtime: "test", assurance: "trusted-workspace" as const, subject: user.authSubject, issuer: user.authIssuer, userId: user._id, societyId },
  capabilities: makeCapabilities({}),
  runQuery: async () => { throw new Error("unused"); },
  runMutation: async () => { throw new Error("unused"); },
});
// The portable ctx types are wider than this harness needs; the handlers only use db and principal.
const ctx = context(owner) as unknown as Parameters<typeof listViews.createPortable>[0];

assert.equal(actionPermission("listViews:list", "query"), "society:read");
assert.equal(actionPermission("listViews:create", "mutation"), "settings:write");
assert.equal(actionPermission("listViews:importInvoiceViews", "mutation"), "settings:write");

const state = {
  version: 1,
  columns: [{ fieldMetadataId: "policies:field:title", position: 0, size: 240, isVisible: true, aggregateOperation: null }],
  sorts: [{ fieldMetadataId: "policies:field:title", direction: "asc" }],
  filters: [{ id: "f1", fieldMetadataId: "policies:field:status", operator: "in", value: ["active"], extra: "dropped" }],
  filterGroups: [],
  groups: [{ id: "display", fieldValue: "", position: -2, isVisible: true, display: { mode: "pages", pageSize: 25 } }],
  density: "compact",
  searchTerm: "board",
};
const id = await listViews.createPortable(ctx, { societyId, tableId: "policies", name: "Active policies", stateJson: JSON.stringify(state) });
let views = await listViews.listPortable(ctx, { societyId, tableId: "policies" });
assert.equal(views.length, 1);
assert.equal(views[0].name, "Active policies");
const stored = parseListViewStateJson(views[0].stateJson);
assert.equal("extra" in stored.filters[0], false, "unknown keys are not stored");
assert.equal(stored.searchTerm, "board");
assert.equal(views[0].createdByUserId, owner._id);
assert.deepEqual(await listViews.listPortable(ctx, { societyId, tableId: "invoices" }), [], "views are per list");

await assert.rejects(() => listViews.createPortable(ctx, { societyId, tableId: "policies", name: "active POLICIES", stateJson: JSON.stringify(state) }), /already exists/);
await assert.rejects(() => listViews.createPortable(ctx, { societyId, tableId: "policies", name: "Bad", stateJson: "{" }), /valid saved view/);
await assert.rejects(() => listViews.createPortable(ctx, { societyId, tableId: "policies", name: "Bad", stateJson: JSON.stringify({ ...state, density: "huge" }) }), /valid saved view/);
await assert.rejects(() => listViews.createPortable(ctx, { societyId, tableId: "policies", name: "Bad", stateJson: JSON.stringify({ ...state, filters: [{ ...state.filters[0], operator: "eval" }] }) }), /valid saved view/);
await assert.rejects(() => listViews.createPortable(ctx, { societyId, tableId: "policies", name: "Big", stateJson: " ".repeat(LIST_VIEW_STATE_MAX_BYTES + 1) }), /too large/);
await assert.rejects(() => listViews.createPortable(ctx, { societyId, tableId: "<script>", name: "Bad", stateJson: JSON.stringify(state) }), /valid list/);
await assert.rejects(() => listViews.createPortable(ctx, { societyId, tableId: "policies", name: " ", stateJson: JSON.stringify(state) }), /Name the view/);

await listViews.updatePortable(ctx, { societyId, id, name: "Board policies" });
await listViews.updatePortable(ctx, { societyId, id, stateJson: JSON.stringify({ ...state, density: "comfortable" }) });
views = await listViews.listPortable(ctx, { societyId, tableId: "policies" });
assert.equal(views[0].name, "Board policies");
assert.equal(parseListViewStateJson(views[0].stateJson).density, "comfortable");

// Readers choose views; only settings writers change them.
const viewerId = await db.insert("users", { societyId, name: "Report viewer", role: "Viewer", status: "Active", authIssuer: "https://issuer.test", authSubject: "viewer-sub" });
const viewer = (await db.get(viewerId)) as UserRow;
const viewerCtx = context(viewer) as unknown as Parameters<typeof listViews.createPortable>[0];
assert.equal((await listViews.listPortable(viewerCtx, { societyId, tableId: "policies" })).length, 1);
await assert.rejects(() => listViews.createPortable(viewerCtx, { societyId, tableId: "policies", name: "Mine", stateJson: JSON.stringify(state) }), /settings:write/);
await assert.rejects(() => listViews.updatePortable(viewerCtx, { societyId, id, name: "Renamed" }), /settings:write/);
await assert.rejects(() => listViews.removePortable(viewerCtx, { societyId, id }), /settings:write/);
// Another workspace's view is never reachable through this one.
const foreignId = await db.insert("listViews", { societyId: "foreign_society", tableId: "policies", name: "Theirs", stateJson: JSON.stringify(state), createdAtISO: "2026-01-01T00:00:00.000Z", updatedAtISO: "2026-01-01T00:00:00.000Z" });
await assert.rejects(() => listViews.updatePortable(ctx, { societyId, id: foreignId, name: "Ours now" }), /not found/i);
await assert.rejects(() => listViews.removePortable(ctx, { societyId, id: foreignId }), /not found/i);
assert.equal((await listViews.listPortable(ctx, { societyId, tableId: "policies" })).some((view) => view._id === foreignId), false);

await listViews.removePortable(ctx, { societyId, id });
assert.equal((await listViews.listPortable(ctx, { societyId, tableId: "policies" })).length, 0);

// The invoice list's old saved views convert once.
const legacy = cleanInvoiceListView({
  ...DEFAULT_INVOICE_LIST_VIEW,
  tab: "overdue",
  search: "acme",
  fromDate: "2026-01-01",
  dueTo: "2026-03-31",
  minimumBalanceCents: 1000,
  sortKey: "balance",
  sortDirection: "asc",
  customerKey: "name:acme",
  columns: [...DEFAULT_INVOICE_LIST_VIEW.columns].reverse().map((column) => ({ ...column, width: 150, label: column.key === "number" ? "Doc" : column.label })),
});
const conversion = invoiceListViewToListViewState(legacy);
const field = (name: string) => staticFieldId("invoices", name);
assert.deepEqual(conversion.state.sorts, [{ id: "balanceCents", fieldMetadataId: field("balanceCents"), direction: "asc" }]);
assert.equal(conversion.state.searchTerm, "acme");
assert.deepEqual(conversion.state.filters.map((filter) => [filter.fieldMetadataId, filter.operator, filter.value]), [
  [field("status"), "in", ["overdue"]],
  [field("issueDate"), "between", { preset: "custom", start: "2026-01-01" }],
  [field("dueDate"), "between", { preset: "custom", end: "2026-03-31" }],
  [field("balanceCents"), "gte", 1000],
]);
assert.equal(conversion.state.columns[0].fieldMetadataId, field("reference"));
assert.equal(conversion.state.columns.length, 13, "newer columns are added hidden");
assert.deepEqual(conversion.dropped.sort(), ["column labels", "customer"]);

await preferences.saveViewPortable(ctx, { societyId, name: "Overdue follow up", config: legacy });
await preferences.saveViewPortable(viewerCtx, { societyId, name: "Overdue follow up", config: DEFAULT_INVOICE_LIST_VIEW });
await assert.rejects(() => listViews.importInvoiceViewsPortable(viewerCtx, { societyId }), /settings:write/);
assert.deepEqual(await listViews.importInvoiceViewsPortable(ctx, { societyId }), { imported: 2, skipped: 0 });
assert.deepEqual(await listViews.importInvoiceViewsPortable(ctx, { societyId }), { imported: 0, skipped: 0 }, "a second run changes nothing");
const invoiceViews = await listViews.listPortable(ctx, { societyId, tableId: "invoices" });
assert.deepEqual(invoiceViews.map((view) => view.name), ["Overdue follow up", "Overdue follow up (2)"]);
assert.deepEqual(parseListViewStateJson(invoiceViews[0].stateJson), parseListViewStateJson(JSON.stringify(conversion.state)));
// Deleting a converted view doesn't bring it back.
await listViews.removePortable(ctx, { societyId, id: invoiceViews[1]._id });
assert.deepEqual(await listViews.importInvoiceViewsPortable(ctx, { societyId }), { imported: 0, skipped: 0 });
assert.equal((await listViews.listPortable(ctx, { societyId, tableId: "invoices" })).length, 1);
// The old functions still answer until nothing reads them.
assert.equal((await preferences.workspacePortable(ctx, { societyId })).views.length, 1);

console.log("List view checks passed: shape and size validation, workspace sharing and settings:write, per-list scope, and the one-time invoice view import.");
