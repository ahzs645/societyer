import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CopyPlus, Percent, Sigma } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Banner } from "../../../components/ui";
import { useConfirm } from "../../../components/Modal";
import { useToast } from "../../../components/Toast";
import {
  EditableGrid,
  GridChangesetIsland,
  GridDrawer,
  cellError,
  isBlankRow,
  newRowKey,
  useBeforeUnloadGuard,
  useGridChangeset,
  type GridColumn,
  type GridRow,
  type GridSelectionInfo,
} from "../../../components/EditableGrid";

type BudgetGridRow = GridRow & {
  id?: string;
  category: string;
  plannedCents: number | null;
  notes: string;
};

const categoryKey = (value: unknown) => String(value ?? "").trim().toLowerCase();

/** "2025-2026" → "2024-2025", "FY2026" → "FY2025", "2026" → "2025". */
export function previousFiscalYear(fiscalYear: string) {
  return fiscalYear.replace(/\d{4}/g, (year) => String(Number(year) - 1));
}

function blankBudgetRow(): BudgetGridRow {
  return { key: newRowKey("budget"), category: "", plannedCents: null, notes: "" };
}

function toGridRows(rows: any[] | undefined): BudgetGridRow[] {
  return (rows ?? [])
    .filter((row) => !row.programCode && !row.accountId)
    .slice()
    .sort((a, b) => String(a.category).localeCompare(String(b.category)))
    .map((row) => ({
      key: String(row._id),
      id: String(row._id),
      category: String(row.category ?? ""),
      plannedCents: typeof row.plannedCents === "number" ? row.plannedCents : null,
      notes: String(row.notes ?? ""),
    }));
}

const EMPTY_SELECTION: GridSelectionInfo = { range: null, columnKeys: [], rowKeys: [] };

/**
 * Full-width spreadsheet editor for one fiscal year's category budget:
 * planned amount and notes per category, last year's plan and actuals
 * alongside, "Copy last year" / "+5%" / "Use actuals" helpers, and a pending
 * changeset saved atomically from the floating island.
 */
export function BudgetGridDrawer({ open, onClose, societyId, fiscalYear, canWrite }: {
  open: boolean;
  onClose: () => void;
  societyId: string;
  fiscalYear: string;
  canWrite: boolean;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const priorYear = previousFiscalYear(fiscalYear);
  const current = useQuery(api.financialHub.budgets, open ? { societyId, fiscalYear } : "skip") as any[] | undefined;
  const prior = useQuery(api.financialHub.budgets, open && priorYear !== fiscalYear ? { societyId, fiscalYear: priorYear } : "skip") as any[] | undefined;
  const hub = useQuery(api.financialHub.summary, open ? { societyId } : "skip") as any;
  const saveBudgetLines = useMutation(api.financialHub.saveBudgetLines);
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [generalErrors, setGeneralErrors] = useState<string[]>([]);
  const selectionRef = useRef<GridSelectionInfo>(EMPTY_SELECTION);

  const priorByCategory = useMemo(() => {
    const map = new Map<string, { plannedCents: number; notes?: string; category: string }>();
    for (const row of toGridRows(prior)) map.set(categoryKey(row.category), { plannedCents: row.plannedCents ?? 0, notes: row.notes, category: row.category });
    return map;
  }, [prior]);
  const actualByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of (hub?.budgetRows ?? []) as any[]) {
      if (typeof row.actualCents === "number") map.set(categoryKey(row.category), row.actualCents);
    }
    return map;
  }, [hub]);

  const columns = useMemo<GridColumn<BudgetGridRow>[]>(() => [
    {
      key: "category",
      header: "Category",
      type: "text",
      width: 240,
      required: true,
      placeholder: "e.g. Program supplies",
      validate: (value, row, rows) => {
        const key = categoryKey(value);
        return rows.some((other) => other.key !== row.key && categoryKey(other.category) === key)
          ? "Another line already uses this category."
          : null;
      },
    },
    {
      key: "plannedCents",
      header: "Planned",
      description: `Planned for FY ${fiscalYear}`,
      type: "money",
      width: 160,
      total: true,
      required: true,
      validate: (value) => (typeof value === "number" && value < 0 ? "Planned amounts cannot be negative." : null),
    },
    {
      key: "lastYear",
      header: `FY ${priorYear}`,
      type: "computed",
      valueType: "money",
      width: 140,
      total: true,
      description: `Planned for FY ${priorYear}`,
      compute: (row) => priorByCategory.get(categoryKey(row.category))?.plannedCents ?? null,
    },
    {
      key: "actual",
      header: "Actual to date",
      type: "computed",
      valueType: "money",
      width: 140,
      total: true,
      description: "Spending in synced transactions for this category",
      compute: (row) => actualByCategory.get(categoryKey(row.category)) ?? null,
    },
    { key: "notes", header: "Notes", type: "text", width: 300, placeholder: "Assumptions, sources" },
  ], [fiscalYear, priorYear, priorByCategory, actualByCategory]);

  const changeset = useGridChangeset<BudgetGridRow>([], columns);
  const { rebase, dirty } = changeset;
  const pendingRebase = useRef(true);
  const serverRows = useMemo(() => toGridRows(current), [current]);
  const serverRowsRef = useRef(serverRows);
  serverRowsRef.current = serverRows;

  // Load (and follow) the saved lines while there is nothing pending.
  useEffect(() => {
    if (current === undefined) return;
    if (pendingRebase.current || !dirty) {
      pendingRebase.current = false;
      rebase(serverRows.length ? serverRows : [blankBudgetRow()]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverRows]);

  // Start fresh each time the drawer opens.
  useEffect(() => {
    if (open) pendingRebase.current = true;
    else {
      setServerErrors({});
      setGeneralErrors([]);
    }
  }, [open]);

  useBeforeUnloadGuard(open && dirty);

  const rows = changeset.rows;
  const errorCount = rows.reduce((count, row) => count + columns.filter((col) => cellError(row, col, rows, columns)).length, 0);

  const targetRows = () => {
    const selection = selectionRef.current;
    const keys = selection.columnKeys.includes("plannedCents") && selection.rowKeys.length > 1 ? new Set(selection.rowKeys) : null;
    return { keys, scope: keys ? `${keys.size} selected lines` : "every line" };
  };

  const copyLastYear = () => {
    if (priorByCategory.size === 0) return;
    const next = rows.filter((row) => !isBlankRow(row, columns)).map((row) => {
      const match = priorByCategory.get(categoryKey(row.category));
      return match ? { ...row, plannedCents: match.plannedCents, notes: row.notes || match.notes || "" } : row;
    });
    const present = new Set(next.map((row) => categoryKey(row.category)));
    let added = 0;
    for (const [key, line] of priorByCategory) {
      if (present.has(key)) continue;
      next.push({ ...blankBudgetRow(), category: line.category, plannedCents: line.plannedCents, notes: line.notes ?? "" });
      added += 1;
    }
    changeset.apply(next, "Copy last year");
    toast.info(`Copied FY ${priorYear}`, `${priorByCategory.size - added} line${priorByCategory.size - added === 1 ? "" : "s"} updated, ${added} added. Undo puts the previous amounts back.`);
  };

  const scalePlanned = (factor: number) => {
    const { keys, scope } = targetRows();
    let changed = 0;
    const next = rows.map((row) => {
      if (keys && !keys.has(row.key)) return row;
      if (typeof row.plannedCents !== "number") return row;
      changed += 1;
      return { ...row, plannedCents: Math.round(row.plannedCents * factor) };
    });
    if (changed === 0) return;
    changeset.apply(next, `Increase by ${Math.round((factor - 1) * 100)}%`);
    toast.info(`Increased ${scope} by ${Math.round((factor - 1) * 100)}%`);
  };

  const applyActuals = () => {
    const { keys, scope } = targetRows();
    let changed = 0;
    const next = rows.map((row) => {
      if (keys && !keys.has(row.key)) return row;
      const actual = actualByCategory.get(categoryKey(row.category));
      if (actual === undefined || actual === row.plannedCents) return row;
      changed += 1;
      return { ...row, plannedCents: actual };
    });
    if (changed === 0) {
      toast.info("No actuals to copy", "None of these categories have synced spending yet.");
      return;
    }
    changeset.apply(next, "Use actuals");
    toast.info(`Set ${changed} planned amount${changed === 1 ? "" : "s"} to actuals`, `Applied to ${scope}.`);
  };

  const save = useCallback(async () => {
    if (!canWrite || saving) return;
    if (errorCount > 0) {
      toast.warn("Budget not saved", `Fix ${errorCount} cell${errorCount === 1 ? "" : "s"} first.`);
      return;
    }
    const { added, updated, removed } = changeset.changes;
    const upserts = [...updated, ...added].map((row) => ({
      key: row.key,
      line: {
        id: row.id as any,
        category: row.category.trim(),
        plannedCents: row.plannedCents ?? 0,
        notes: row.notes.trim() || undefined,
      },
    }));
    const removeIds = removed.map((row) => row.id).filter(Boolean) as string[];
    setSaving(true);
    setServerErrors({});
    setGeneralErrors([]);
    try {
      const result: any = await saveBudgetLines({ societyId, fiscalYear, upserts: upserts.map((u) => u.line), removeIds });
      if (!result?.ok) {
        const byRow: Record<string, string> = {};
        const general: string[] = [];
        for (const error of result?.rowErrors ?? []) {
          const key = upserts[error.index]?.key;
          if (key) byRow[key] = byRow[key] ? `${byRow[key]} ${error.message}` : error.message;
          else general.push(error.message);
        }
        setServerErrors(byRow);
        setGeneralErrors(general);
        toast.error("Budget not saved", "Nothing was changed. Fix the flagged lines and save again.");
        return;
      }
      pendingRebase.current = true;
      rebase(serverRowsRef.current.length ? serverRowsRef.current : [blankBudgetRow()]);
      const parts = [
        result.updated && `${result.updated} updated`,
        result.inserted && `${result.inserted} added`,
        result.removed && `${result.removed} removed`,
      ].filter(Boolean);
      toast.success(`FY ${fiscalYear} budget saved`, parts.join(", "));
    } catch (error: any) {
      setGeneralErrors([error?.data?.message ?? error?.message ?? "The budget could not be saved."]);
      toast.error("Budget not saved", error?.data?.message ?? error?.message);
    } finally {
      setSaving(false);
    }
  }, [canWrite, saving, errorCount, changeset.changes, saveBudgetLines, societyId, fiscalYear, rebase, toast]);

  const requestClose = async () => {
    if (dirty) {
      const discard = await confirm({
        title: "Discard budget changes?",
        message: `${changeset.changes.count} unsaved change${changeset.changes.count === 1 ? "" : "s"} to the FY ${fiscalYear} budget will be lost.`,
        confirmLabel: "Discard changes",
        tone: "warn",
      });
      if (!discard) return;
      changeset.discard();
    }
    onClose();
  };

  const visibleServerErrors = useMemo(() => {
    const keys = new Set(rows.map((row) => row.key));
    return Object.fromEntries(Object.entries(serverErrors).filter(([key]) => keys.has(key)));
  }, [serverErrors, rows]);
  const serverErrorList = Object.entries(visibleServerErrors).map(([key, message]) => {
    const index = rows.findIndex((row) => row.key === key);
    return `Line ${index + 1}${rows[index]?.category ? ` (${rows[index].category})` : ""}: ${message}`;
  });

  return (
    <GridDrawer
      open={open}
      onClose={() => void requestClose()}
      title={`Budget · FY ${fiscalYear}`}
      subtitle={`Category budget, with FY ${priorYear} and actuals to date alongside`}
      footer={<button className="btn" onClick={() => void requestClose()}>Close</button>}
    >
      <p className="muted grid-drawer__intro">
        Plan each category for FY {fiscalYear}. Type over cells or paste rows from a spreadsheet; nothing is saved until you choose Save.
      </p>
      {(generalErrors.length > 0 || serverErrorList.length > 0) && (
        <Banner tone="danger" title="The budget was not saved">
          <ul className="budget-grid__errors">
            {[...serverErrorList, ...generalErrors].map((message) => <li key={message}>{message}</li>)}
          </ul>
        </Banner>
      )}
      {current === undefined ? (
        <div className="muted budget-grid__loading">Loading budget…</div>
      ) : (
        <EditableGrid<BudgetGridRow>
          label={`FY ${fiscalYear} budget`}
          columns={columns}
          rows={rows}
          onRowsChange={changeset.apply}
          createRow={blankBudgetRow}
          history={changeset.history}
          frozenFirstColumn
          rowNoun="line"
          readOnly={!canWrite}
          rowErrors={visibleServerErrors}
          onSelectionChange={(selection) => { selectionRef.current = selection; }}
          onSaveShortcut={() => void save()}
          rowLabel={(row) => row.category}
          toolbar={canWrite && (
            <span className="egrid__toolbar-group">
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={copyLastYear}
                disabled={priorByCategory.size === 0}
                title={priorByCategory.size === 0 ? `No budget saved for FY ${priorYear}` : `Fill planned amounts from FY ${priorYear}`}
              >
                <CopyPlus size={14} /> Copy last year
              </button>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => scalePlanned(1.05)} title="Increase the selected planned amounts (or all) by 5%">
                <Percent size={14} /> +5%
              </button>
              <button type="button" className="btn btn--sm btn--ghost" onClick={applyActuals} title="Set planned amounts to actuals to date">
                <Sigma size={14} /> Use actuals
              </button>
            </span>
          )}
        />
      )}
      <GridChangesetIsland
        count={changeset.changes.count}
        saving={saving}
        onDiscard={() => { changeset.discard(); setServerErrors({}); setGeneralErrors([]); }}
        onSave={() => void save()}
        saveLabel="Save budget"
        blockedReason={errorCount > 0 ? `Fix ${errorCount} cell${errorCount === 1 ? "" : "s"}` : null}
      />
    </GridDrawer>
  );
}
