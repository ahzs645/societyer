/**
 * Register rows → display-ready record-table records. Every metadata field
 * (convex/recordTableBooksObjects.ts) is a plain value so search, filters,
 * sorts and export read the same thing the cells show; the original refs ride
 * along for the composite cells and drawers.
 */
import type { chartOfAccountsRegisterPortable, journalEntryRegisterPortable } from "../../../../shared/functions/accounting";
import type { JournalRegisterRow } from "../../../../shared/booksReports";
import { buildAccountTree, type AccountTreeNode } from "../../../../shared/accountHierarchy";
import { accountRefLabel, humanise } from "./registerModel";

/** What `accounting.journalEntryRegister` returns (the Convex wrapper is typed `any`). */
export type JournalRegisterView = Awaited<ReturnType<typeof journalEntryRegisterPortable>>;
/** One row of `accounting.chartOfAccountsRegister`. */
export type ChartRegisterRowView = Awaited<ReturnType<typeof chartOfAccountsRegisterPortable>>[number];

export type JournalRecord = JournalRegisterRow & {
  _id: string;
  debitAccountNames: string;
  creditAccountNames: string;
};

export function toJournalRecords(rows: readonly JournalRegisterRow[]): JournalRecord[] {
  return rows.map((row) => ({
    ...row,
    _id: row.entryId,
    memo: row.memo || "Journal entry",
    debitAccountNames: row.debitAccounts.map(accountRefLabel).join(", "),
    creditAccountNames: row.creditAccounts.map(accountRefLabel).join(", "),
  }));
}

export type ChartAccountRecord = ChartRegisterRowView & {
  _id: string;
  subtypeLabel: string;
  normalSide: "debit" | "credit";
  parentName: string;
  /** Position in the chart tree walk, so sub-accounts sit under their parent. */
  chartOrder: number;
};

export function toChartRecords(rows: readonly ChartRegisterRowView[]): ChartAccountRecord[] {
  const byId = new Map(rows.map((row) => [String(row._id), row]));
  const order = new Map<string, number>();
  const walk = (nodes: AccountTreeNode<ChartRegisterRowView>[]) => {
    for (const node of nodes) {
      order.set(String(node.account._id), order.size);
      walk(node.children);
    }
  };
  walk(buildAccountTree([...rows]));
  return rows.map((row) => {
    const parent = row.parentAccountId ? byId.get(String(row.parentAccountId)) : undefined;
    return {
      ...row,
      _id: String(row._id),
      subtypeLabel: humanise(row.subtype),
      normalSide: row.creditNormal ? "credit" : "debit",
      parentName: parent ? accountRefLabel({ code: parent.code ?? undefined, name: parent.name }) : "",
      chartOrder: order.get(String(row._id)) ?? order.size,
    };
  });
}
