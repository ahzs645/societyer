import { useCallback, useMemo } from "react";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import {
  EditableGrid,
  cellError,
  isBlankRow,
  newRowKey,
  useGridChangeset,
  type GridColumn,
  type GridOption,
  type GridRow,
} from "../../../components/EditableGrid";
import { formatMoney } from "../../../lib/money";

export type JournalGridRow = GridRow & {
  accountId: string;
  description: string;
  debit: number | null;
  credit: number | null;
  programCode: string;
  fundRestrictionId: string;
  counterpartyId: string;
  grantId: string;
};

export type JournalLineInput = {
  accountId: string;
  side: "debit" | "credit";
  amountCents: number;
  description?: string;
  programCode?: string;
  fundRestrictionId?: string;
  counterpartyId?: string;
  grantId?: string;
};

type LinkOption = { value: string; label: string };

type Options = {
  accounts: any[];
  /** "journal" shows program, counterparty and grant; "opening" keeps it to accounts, amounts and funds. */
  variant?: "journal" | "opening";
  fundRestrictions?: LinkOption[];
  counterparties?: LinkOption[];
  grants?: LinkOption[];
};

export function blankJournalRow(): JournalGridRow {
  return {
    key: newRowKey("line"),
    accountId: "",
    description: "",
    debit: null,
    credit: null,
    programCode: "",
    fundRestrictionId: "",
    counterpartyId: "",
    grantId: "",
  };
}

const positive = (value: unknown) => typeof value === "number" && value > 0;

function linkOptions(rows: LinkOption[]): GridOption[] {
  return rows.map((row) => ({ value: row.value, label: row.label }));
}

/**
 * Journal-line grid state: columns, the pending lines, debit/credit totals and
 * the balance check that blocks posting.
 */
export function useJournalLinesGrid({ accounts, variant = "journal", fundRestrictions = [], counterparties = [], grants = [] }: Options) {
  const columns = useMemo<GridColumn<JournalGridRow>[]>(() => {
    const accountOptions: GridOption[] = accounts.map((account) => ({
      value: String(account._id),
      label: account.code ? `${account.code} · ${account.name}` : account.name,
      hint: account.accountType,
      keywords: [account.code, account.name].filter(Boolean),
    }));
    const amountRule = (other: "debit" | "credit") => (value: unknown, row: JournalGridRow) => {
      if (typeof value === "number" && value < 0) return `Amounts are positive — enter it in the ${other === "credit" ? "Credit" : "Debit"} column instead.`;
      if (positive(value) && positive(row[other])) return "Enter a debit or a credit on a line, not both.";
      return null;
    };
    const cols: GridColumn<JournalGridRow>[] = [
      { key: "accountId", header: "Account", type: "select", width: 220, required: true, options: accountOptions, placeholder: "Choose account" },
      { key: "description", header: "Description", type: "text", width: 200, placeholder: "Line memo" },
      {
        key: "debit",
        header: "Debit",
        type: "money",
        width: 120,
        total: true,
        validate: (value, row) => {
          const rule = amountRule("credit")(value, row);
          if (rule) return rule;
          if (!positive(value) && !positive(row.credit)) return "Enter a debit or a credit amount.";
          return null;
        },
      },
      { key: "credit", header: "Credit", type: "money", width: 120, total: true, validate: amountRule("debit") },
    ];
    if (variant === "journal") {
      cols.push({ key: "programCode", header: "Program", type: "text", width: 150, placeholder: "Unallocated", description: "Program or project code, e.g. 100 - OPERATIONS" });
    }
    if (fundRestrictions.length > 0) {
      cols.push({ key: "fundRestrictionId", header: "Fund", type: "select", width: 180, options: linkOptions(fundRestrictions), placeholder: "Unrestricted" });
    }
    if (variant === "journal" && counterparties.length > 0) {
      cols.push({ key: "counterpartyId", header: "Counterparty", type: "select", width: 170, options: linkOptions(counterparties), placeholder: "None" });
    }
    if (variant === "journal" && grants.length > 0) {
      cols.push({ key: "grantId", header: "Grant", type: "select", width: 170, options: linkOptions(grants), placeholder: "None" });
    }
    return cols;
  }, [accounts, variant, fundRestrictions, counterparties, grants]);

  const initial = useMemo(() => [blankJournalRow(), blankJournalRow()], []);
  const changeset = useGridChangeset<JournalGridRow>(initial, columns);
  const rows = changeset.rows;

  const lines = rows.filter((row) => !isBlankRow(row, columns));
  const debitCents = lines.reduce((sum, row) => sum + (positive(row.debit) ? (row.debit as number) : 0), 0);
  const creditCents = lines.reduce((sum, row) => sum + (positive(row.credit) ? (row.credit as number) : 0), 0);
  const differenceCents = debitCents - creditCents;
  const errorCount = rows.reduce((count, row) => count + columns.filter((col) => cellError(row, col, rows, columns)).length, 0);

  let blockedReason: string | null = null;
  if (errorCount > 0) blockedReason = `Fix ${errorCount} cell${errorCount === 1 ? "" : "s"} first`;
  else if (lines.length < 2) blockedReason = "Add at least two lines";
  else if (differenceCents !== 0) blockedReason = `Out of balance by ${formatMoney(Math.abs(differenceCents))}`;
  else if (debitCents === 0) blockedReason = "Enter the amounts";

  const toLines = useCallback((): JournalLineInput[] =>
    rows
      .filter((row) => !isBlankRow(row, columns))
      .map((row) => {
        const debit = positive(row.debit);
        return {
          accountId: row.accountId,
          side: debit ? "debit" : "credit",
          amountCents: (debit ? row.debit : row.credit) as number,
          description: row.description?.trim() || undefined,
          programCode: row.programCode?.trim() || undefined,
          fundRestrictionId: row.fundRestrictionId || undefined,
          counterpartyId: row.counterpartyId || undefined,
          grantId: row.grantId || undefined,
        };
      }), [rows, columns]);

  const reset = useCallback(() => changeset.rebase([blankJournalRow(), blankJournalRow()]), [changeset]);

  return { columns, changeset, debitCents, creditCents, differenceCents, lineCount: lines.length, blockedReason, toLines, reset };
}

export type JournalLinesGridState = ReturnType<typeof useJournalLinesGrid>;

export function JournalBalance({ grid }: { grid: JournalLinesGridState }) {
  if (grid.lineCount === 0) return null;
  if (grid.differenceCents === 0 && grid.debitCents > 0) {
    return (
      <span className="egrid-balance egrid-balance--ok" role="status">
        <CheckCircle2 size={14} aria-hidden="true" /> Balanced · {formatMoney(grid.debitCents)} each side
      </span>
    );
  }
  if (grid.differenceCents === 0) return null;
  const heavier = grid.differenceCents > 0 ? "debits" : "credits";
  return (
    <span className="egrid-balance egrid-balance--off" role="status">
      <AlertTriangle size={14} aria-hidden="true" /> Out of balance by {formatMoney(Math.abs(grid.differenceCents))} ({heavier} are higher)
    </span>
  );
}

/** Spreadsheet editor for journal or opening-balance lines. */
export function JournalLinesGrid({ grid, label, onSaveShortcut, readOnly }: {
  grid: JournalLinesGridState;
  label: string;
  onSaveShortcut?: () => void;
  readOnly?: boolean;
}) {
  return (
    <EditableGrid<JournalGridRow>
      label={label}
      columns={grid.columns}
      rows={grid.changeset.rows}
      onRowsChange={grid.changeset.apply}
      createRow={blankJournalRow}
      history={grid.changeset.history}
      frozenFirstColumn
      minRows={2}
      rowNoun="line"
      readOnly={readOnly}
      onSaveShortcut={onSaveShortcut}
      summary={<JournalBalance grid={grid} />}
      rowLabel={(row) => grid.columns[0].options && Array.isArray(grid.columns[0].options)
        ? grid.columns[0].options.find((o) => o.value === row.accountId)?.label ?? ""
        : ""}
    />
  );
}
