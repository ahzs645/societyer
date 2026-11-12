import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Pencil, PiggyBank, Trash2 } from "lucide-react";
import { FIELD_TYPES, RecordListTable, RecordTableEmpty, RecordTablePhoneCard, staticRecordTable } from "@/platform/record-engine";
import { Money } from "../../../components/Money";
import { budgetVariance } from "../../../lib/money";
import { inferBudgetKind } from "../lib/budgetKind";
import { transactionFilterHref } from "../insights/transactionFilterLink";
import { VarianceCell } from "./VarianceCell";

/** An annual budget line as the finance summary returns it. */
export type BudgetLine = {
  _id: string;
  category: string;
  plannedCents: number;
  actualCents: number;
  currency?: string;
  accountId?: string;
};

type BudgetEvidence = Parameters<typeof inferBudgetKind>[1];

const BUDGET_LINES_TABLE = staticRecordTable({
  id: "financials:budget-lines",
  nameSingular: "budgetLine",
  namePlural: "budgetLines",
  labelSingular: "Budget line",
  labelPlural: "Budget lines",
  labelIdentifierFieldName: "category",
  viewName: "All budget lines",
  fields: [
    { name: "category", label: "Category", fieldType: FIELD_TYPES.TEXT, size: 220, config: { groupable: false } },
    {
      name: "kind",
      label: "Type",
      fieldType: FIELD_TYPES.SELECT,
      size: 110,
      isVisible: false,
      config: { options: [{ value: "expense", label: "Expense", color: "gray" }, { value: "revenue", label: "Revenue", color: "green" }] },
    },
    { name: "plannedCents", label: "Planned", fieldType: FIELD_TYPES.CURRENCY, size: 130, config: { isCents: true }, aggregate: "sum" },
    { name: "actualCents", label: "Actual", fieldType: FIELD_TYPES.CURRENCY, size: 130, config: { isCents: true }, aggregate: "sum" },
    { name: "varianceCents", label: "Variance", fieldType: FIELD_TYPES.CURRENCY, size: 150, config: { isCents: true } },
  ],
});

type BudgetLineRecord = {
  _id: string;
  category: string;
  kind: "expense" | "revenue";
  plannedCents: number;
  actualCents: number;
  /** Positive is favourable: under budget for expenses, over for revenue. */
  varianceCents: number;
  line: BudgetLine;
};

/**
 * Financials → Overview's "Budget vs actuals": planned and actual per
 * category with the variance and the column totals. A line opens its
 * planned-amount editor; its actual opens the category's transactions.
 */
export function BudgetLinesTable({
  rows,
  evidence,
  canWrite,
  onEdit,
  onDelete,
}: {
  rows: BudgetLine[];
  /** Accounts and transactions that tell a revenue line from an expense line. */
  evidence: BudgetEvidence;
  canWrite: boolean;
  onEdit: (line: BudgetLine) => void;
  onDelete: (line: BudgetLine) => void;
}) {
  const records = useMemo<BudgetLineRecord[]>(
    () =>
      rows.map((line) => {
        const kind = inferBudgetKind(line, evidence);
        return {
          _id: line._id,
          category: line.category,
          kind,
          plannedCents: line.plannedCents ?? 0,
          actualCents: line.actualCents ?? 0,
          varianceCents: budgetVariance(line.plannedCents, line.actualCents, kind).cents,
          line,
        };
      }),
    [rows, evidence],
  );
  return (
    <RecordListTable<BudgetLineRecord>
      variant="card"
      showTotals={records.length > 1}
      table={BUDGET_LINES_TABLE}
      tableId="financials-budget-lines"
      label="Budget lines"
      icon={<PiggyBank size={14} />}
      records={records}
      onOpen={canWrite ? (record) => onEdit(record.line) : undefined}
      renderCell={({ record, field }) => {
        if (field.name === "category")
          return (
            <>
              {record.category}
              {record.kind === "revenue" && <span className="table__sub"> · revenue</span>}
            </>
          );
        if (field.name === "actualCents")
          return (
            <Link to={transactionFilterHref({ field: "category", value: record.category })} title={`Transactions in ${record.category}`}>
              <Money cents={record.actualCents} />
            </Link>
          );
        if (field.name === "varianceCents") return <VarianceCell variance={budgetVariance(record.plannedCents, record.actualCents, record.kind)} />;
        return undefined;
      }}
      rowMenuSections={(record) => [
        {
          id: "budget-actions",
          items: [
            { id: "edit", label: "Edit planned amount", icon: <Pencil size={14} />, disabled: !canWrite, onSelect: () => onEdit(record.line) },
            { id: "delete", label: "Delete budget line", icon: <Trash2 size={14} />, destructive: true, disabled: !canWrite, onSelect: () => onDelete(record.line) },
          ],
        },
      ]}
      renderPhoneCard={(record, { open, selecting }) => (
        <RecordTablePhoneCard
          title={record.category}
          badge={<VarianceCell variance={budgetVariance(record.plannedCents, record.actualCents, record.kind)} />}
          meta={[<span key="actual"><Money cents={record.actualCents} /> of <Money cents={record.plannedCents} /></span>, record.kind === "revenue" ? "Revenue" : ""]}
          onOpen={canWrite ? open : undefined}
          selecting={selecting}
        />
      )}
      emptyState={<RecordTableEmpty title="No budget lines yet" description="Add a category to start tracking variance." />}
    />
  );
}
