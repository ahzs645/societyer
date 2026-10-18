import { useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import type { InlineEditRecord, RecordTableCellEdit, RecordTableInlineEdit } from "@/platform/record-engine";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { GridOption } from "../../../components/EditableGrid/types";
import { isSplitTransaction, transactionLines, type TransactionLine } from "../../../../shared/transactionLines";
import { categoryAccountOptions, transactionRowLock, type InlineEditAccount, type InlineEditFund, type TransactionRow } from "./transactionInlineEditRules";

/**
 * Spreadsheet editing for the Financials transactions table (RecordTable grid
 * mode): Date, Description, Notes, Category (a chart account) and Fund. Tags
 * stay in the panel. Rows that are split, reconciled or inside the books close
 * date are read-only. Every edit goes through the existing update paths:
 * date, description and notes through `financialHub.updateTransaction`;
 * category and fund through `transactionLines.save` on the single line, which
 * stamps manual provenance on a recode and re-posts the journal entry, and a
 * category change then offers the "create or update a rule?" prompt.
 */
export function useTransactionInlineEdit({
  societyId,
  canWrite,
  transactions,
  accounts,
  funds,
  onCategorised,
}: {
  societyId: string | undefined;
  canWrite: boolean;
  transactions: readonly TransactionRow[] | undefined;
  accounts: readonly InlineEditAccount[];
  funds: readonly InlineEditFund[];
  /** The rule prompt after a manual category change. */
  onCategorised: (previous: TransactionRow, category: string) => void;
}) {
  const updateTransaction = useMutation(api.financialHub.updateTransaction);
  const saveLines = useMutation(api.transactionLines.save);
  const settings = useQuery(api.accounting.booksSettings, societyId ? { societyId: societyId as Id<"societies"> } : "skip") as { closeDate: string | null } | undefined;
  const closeDate = settings?.closeDate ?? null;

  const categoryOptions = useMemo(() => categoryAccountOptions(accounts), [accounts]);
  const fundOptions = useMemo<GridOption[]>(() => funds.map((fund) => ({ value: fund._id, label: fund.name, hint: fund.purpose })), [funds]);
  /** Account name for a category cell showing an account id while its save settles. */
  const accountLabels = useMemo(() => new Map(categoryOptions.map((option) => [option.value, option.label])), [categoryOptions]);

  const inlineEdit = useMemo<RecordTableInlineEdit | undefined>(() => {
    if (!canWrite) return undefined;
    const readOnly = (record: InlineEditRecord) => transactionRowLock(record as TransactionRow, closeDate) !== null;
    const saveSingleLine = async (row: TransactionRow, patch: Partial<TransactionLine>) => {
      if (isSplitTransaction(row)) throw new Error("This transaction is split. Change its lines in the transaction panel.");
      const [line] = transactionLines(row);
      const next = { ...line, ...patch };
      await saveLines({
        id: row._id as Id<"financialTransactions">,
        lines: [{
          id: next.id,
          amountCents: next.amountCents,
          ...(next.category ? { category: next.category } : {}),
          ...(next.accountingAccountId ? { accountingAccountId: next.accountingAccountId as Id<"financialAccounts"> } : {}),
          ...(next.fundRestrictionId ? { fundRestrictionId: next.fundRestrictionId as Id<"fundRestrictions"> } : {}),
          ...(next.memo ? { memo: next.memo } : {}),
          ...(next.tagIds?.length ? { tagIds: next.tagIds as Id<"financeTags">[] } : {}),
        }],
      });
    };
    return {
      columns: {
        date: {
          editor: "date",
          required: true,
          readOnly,
          validate: (value) => (closeDate && typeof value === "string" && value <= closeDate ? `The books are closed through ${closeDate}. Choose a later date.` : null),
        },
        description: { editor: "text", required: true, readOnly },
        memo: { editor: "text", readOnly, placeholder: "Add a note" },
        category: { editor: "relation", options: categoryOptions, readOnly, placeholder: "Choose a ledger account" },
        fundRestrictionId: { editor: "relation", options: fundOptions, readOnly, placeholder: "Unrestricted" },
      },
      onCommit: async ({ recordId, fieldName, value }: RecordTableCellEdit) => {
        const row = (transactions ?? []).find((candidate) => String(candidate._id) === String(recordId));
        if (!row) throw new Error("This transaction is no longer in the list.");
        const lock = transactionRowLock(row, closeDate);
        if (lock) throw new Error(lock);
        const text = typeof value === "string" ? value : "";
        if (fieldName === "category") {
          const account = accounts.find((candidate) => candidate._id === text);
          if (text && !account) throw new Error("Choose a ledger account from the list.");
          await saveSingleLine(row, { category: account?.name, accountingAccountId: account?._id });
          if (account) onCategorised(row, account.name);
          return;
        }
        if (fieldName === "fundRestrictionId") {
          await saveSingleLine(row, { fundRestrictionId: text || undefined });
          return;
        }
        if (fieldName === "date" || fieldName === "description" || fieldName === "memo") {
          await updateTransaction({ id: row._id as Id<"financialTransactions">, patch: { [fieldName]: text } });
          return;
        }
        throw new Error("This column can't be edited here.");
      },
    };
  }, [accounts, canWrite, categoryOptions, closeDate, fundOptions, onCategorised, saveLines, transactions, updateTransaction]);

  return { inlineEdit, closeDate, accountLabels };
}
