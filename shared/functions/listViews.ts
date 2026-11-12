/**
 * PORTABLE FUNCTIONS: named views of the in-memory lists (`RecordListTable`),
 * shared with the whole workspace.
 *
 * A view is a name and a `stateJson` (shared/listViewState.ts) for one list,
 * keyed by the list's `tableId`. The action policy lets every member read a
 * list's views (society:read) and settings writers (settings:write, as for
 * the object tables' saved views) create, update, rename and delete them.
 * `stateJson` is never trusted: it is size-capped, parsed, rebuilt from known
 * keys and stored in canonical form.
 *
 * `importInvoiceViews` is the one-time move of the invoice list's old saved
 * views (`billingInvoiceViews`) into list views; it marks each old row
 * `migratedAtISO` so running it again changes nothing.
 */
import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, principalUserId } from "./access";
import { requireFunctionAction } from "./actionPolicy";
import {
  LIST_VIEWS_PER_TABLE_MAX,
  canonicalListViewStateJson,
  cleanListViewName,
  cleanListViewTableId,
} from "../listViewState";
import { cleanInvoiceListView } from "../billingPricing";
import { INVOICE_LIST_TABLE_ID, invoiceListViewToListViewState } from "../invoiceListViewMigration";

type ListViewRow = {
  _id: string;
  societyId: string;
  tableId: string;
  name: string;
  stateJson: string;
  createdByUserId?: string;
  createdAtISO: string;
  updatedAtISO: string;
};

async function viewsOf(ctx: PortableQueryCtx, societyId: string, tableId: string): Promise<ListViewRow[]> {
  return ctx.db
    .query<ListViewRow>("listViews")
    .withIndex("by_society_table", (q) => q.eq("societyId", societyId).eq("tableId", tableId))
    .collect();
}

function assertUniqueName(views: ListViewRow[], name: string, exceptId?: string) {
  const key = name.toLocaleLowerCase();
  if (views.some((view) => view._id !== exceptId && view.name.toLocaleLowerCase() === key)) {
    throw new Error(`A view named "${name}" already exists for this list.`);
  }
}

export async function listPortable(ctx: PortableQueryCtx, args: { societyId: string; tableId: string }) {
  await requireFunctionAction(ctx, "listViews:list", "query", args);
  const tableId = cleanListViewTableId(args.tableId);
  const views = await viewsOf(ctx, args.societyId, tableId);
  return views
    .sort((a, b) => a.name.localeCompare(b.name) || String(a._id).localeCompare(String(b._id)))
    .map((view) => ({
      _id: view._id,
      name: view.name,
      stateJson: view.stateJson,
      createdByUserId: view.createdByUserId ?? null,
      createdAtISO: view.createdAtISO,
      updatedAtISO: view.updatedAtISO,
    }));
}

export async function createPortable(ctx: PortableMutationCtx, args: { societyId: string; tableId: string; name: string; stateJson: string }) {
  await requireFunctionAction(ctx, "listViews:create", "mutation", args);
  const tableId = cleanListViewTableId(args.tableId);
  const name = cleanListViewName(args.name);
  const stateJson = canonicalListViewStateJson(args.stateJson);
  const userId = await principalUserId(ctx, args.societyId);
  const views = await viewsOf(ctx, args.societyId, tableId);
  if (views.length >= LIST_VIEWS_PER_TABLE_MAX) throw new Error(`A list holds at most ${LIST_VIEWS_PER_TABLE_MAX} saved views.`);
  assertUniqueName(views, name);
  const now = new Date().toISOString();
  return ctx.db.insert("listViews", { societyId: args.societyId, tableId, name, stateJson, createdByUserId: userId, createdAtISO: now, updatedAtISO: now });
}

export async function updatePortable(ctx: PortableMutationCtx, args: { societyId: string; id: string; name?: string; stateJson?: string }) {
  await requireFunctionAction(ctx, "listViews:update", "mutation", args);
  const view = await getOwned<ListViewRow>(ctx, "listViews", args.id, args.societyId);
  const patch: { name?: string; stateJson?: string; updatedAtISO: string } = { updatedAtISO: new Date().toISOString() };
  if (args.name !== undefined) {
    patch.name = cleanListViewName(args.name);
    assertUniqueName(await viewsOf(ctx, args.societyId, view.tableId), patch.name, view._id);
  }
  if (args.stateJson !== undefined) patch.stateJson = canonicalListViewStateJson(args.stateJson);
  await ctx.db.patch(view._id, patch);
  return null;
}

export async function removePortable(ctx: PortableMutationCtx, args: { societyId: string; id: string }) {
  await requireFunctionAction(ctx, "listViews:remove", "mutation", args);
  const view = await getOwned<ListViewRow>(ctx, "listViews", args.id, args.societyId);
  await ctx.db.delete(view._id);
  return null;
}

type LegacyInvoiceViewRow = { _id: string; societyId: string; userId: string; name: string; config: unknown; updatedAtISO: string; migratedAtISO?: string };

/**
 * Moves the workspace's old saved invoice views (every member's) into the
 * invoice list's views. Idempotent: converted rows are marked, never touched
 * again, and kept so nothing is lost; a name already taken gets " (2)" and so
 * on. Rows that no longer validate are marked and skipped.
 */
export async function importInvoiceViewsPortable(ctx: PortableMutationCtx, args: { societyId: string }) {
  await requireFunctionAction(ctx, "listViews:importInvoiceViews", "mutation", args);
  const legacy = (await ctx.db
    .query<LegacyInvoiceViewRow>("billingInvoiceViews")
    .withIndex("by_society_userId", (q) => q.eq("societyId", args.societyId))
    .collect())
    .filter((row) => !row.migratedAtISO)
    .sort((a, b) => String(a.updatedAtISO).localeCompare(String(b.updatedAtISO)) || String(a._id).localeCompare(String(b._id)));
  if (!legacy.length) return { imported: 0, skipped: 0 };
  const existing = await viewsOf(ctx, args.societyId, INVOICE_LIST_TABLE_ID);
  const taken = new Set(existing.map((view) => view.name.toLocaleLowerCase()));
  const now = new Date().toISOString();
  let imported = 0;
  let skipped = 0;
  for (const row of legacy) {
    let stateJson: string;
    let name: string;
    try {
      const { state } = invoiceListViewToListViewState(cleanInvoiceListView(row.config));
      stateJson = canonicalListViewStateJson(JSON.stringify(state));
      name = cleanListViewName(row.name);
    } catch {
      skipped++;
      await ctx.db.patch(row._id, { migratedAtISO: now });
      continue;
    }
    if (existing.length + imported >= LIST_VIEWS_PER_TABLE_MAX) {
      skipped++;
      await ctx.db.patch(row._id, { migratedAtISO: now });
      continue;
    }
    let unique = name;
    for (let copy = 2; taken.has(unique.toLocaleLowerCase()); copy++) unique = `${name.slice(0, 90)} (${copy})`;
    taken.add(unique.toLocaleLowerCase());
    await ctx.db.insert("listViews", {
      societyId: args.societyId,
      tableId: INVOICE_LIST_TABLE_ID,
      name: unique,
      stateJson,
      createdByUserId: row.userId,
      createdAtISO: row.updatedAtISO || now,
      updatedAtISO: now,
    });
    await ctx.db.patch(row._id, { migratedAtISO: now });
    imported++;
  }
  return { imported, skipped };
}
