import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { Divide, Plus, Scissors, Trash2, Undo2 } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Money } from "../../../components/Money";
import { Select, type SelectOption } from "../../../components/Select";
import { useToast } from "../../../components/Toast";
import { formatMoney, parseMoneyInput } from "../../../lib/money";
import {
  isSplitTransaction,
  linesRemainderCents,
  splitEvenlyCents,
  transactionLines,
  validateTransactionLines,
  type TransactionLine,
} from "../../../../shared/transactionLines";
import { TagChips, TagPicker } from "./TagPicker";
import type { FinanceTagsApi } from "./useFinanceTags";
import { booksLockedNote } from "./booksLockNote";

export type LineEditorTransaction = {
  _id: string;
  amountCents: number;
  category?: string;
  accountingAccountId?: string;
  fundRestrictionId?: string;
  tagIds?: string[];
  lines?: TransactionLine[];
};

type AccountOption = { _id: string; name: string; code?: string; accountType?: string };
type FundOption = { _id: string; name: string; purpose?: string };

type DraftLine = {
  id: string;
  /** Typed amount in the transaction's direction (a deposit's fee line is negative). */
  amount: string;
  category: string;
  accountingAccountId: string;
  fundRestrictionId: string;
  memo: string;
  tagIds: string[];
};

type SaveResult = { split: boolean; journal: string; previous: Array<{ id: string; values: Record<string, unknown> }> };

const BANK_TYPES = new Set(["Bank", "Credit"]);

let lineSequence = 0;
const newLineId = () => `line-${Date.now().toString(36)}-${(lineSequence += 1)}`;

/** Typed amount in cents ("12.50", "(12.00)", "−5", "CAD 5"…), or null when it isn't one. */
const centsFromText = (text: string): number | null => parseMoneyInput(text) ?? null;

const textFromCents = (cents: number) => (cents / 100).toFixed(2);

function toDraft(line: TransactionLine, direction: number): DraftLine {
  return {
    id: line.id,
    amount: textFromCents(line.amountCents * direction),
    category: line.category ?? "",
    accountingAccountId: line.accountingAccountId ?? "",
    fundRestrictionId: line.fundRestrictionId ?? "",
    memo: line.memo ?? "",
    tagIds: [...(line.tagIds ?? [])],
  };
}

function fromDraft(line: DraftLine, direction: number): TransactionLine {
  return {
    id: line.id,
    amountCents: (centsFromText(line.amount) ?? Number.NaN) * direction,
    ...(line.category.trim() ? { category: line.category.trim() } : {}),
    ...(line.accountingAccountId ? { accountingAccountId: line.accountingAccountId } : {}),
    ...(line.fundRestrictionId ? { fundRestrictionId: line.fundRestrictionId } : {}),
    ...(line.memo.trim() ? { memo: line.memo.trim() } : {}),
    ...(line.tagIds.length ? { tagIds: line.tagIds } : {}),
  };
}

/**
 * Line items on the transaction panel. One line edits like a plain category
 * (saved on blur, with the rule prompt), plus its fund and tags; "Split"
 * turns it into several lines with their own category or ledger account,
 * amount, fund, memo and tags, saved together once they add up. The total
 * and what is left to allocate show as you type; "Split evenly" and
 * "Remainder here" fill the amounts in. Every save offers Undo.
 */
export function TransactionLinesEditor({
  record,
  canWrite,
  categories,
  accounts,
  funds,
  tags,
  societyId,
  onCommitCategory,
  onDraftDirtyChange,
}: {
  record: LineEditorTransaction;
  canWrite: boolean;
  categories: readonly string[];
  accounts: readonly AccountOption[];
  funds: readonly FundOption[];
  tags: FinanceTagsApi;
  societyId: string;
  /** A single line's category, saved through the table's update (rule prompt and provenance). */
  onCommitCategory: (category: string) => void;
  /** Whether lines are being edited with changes that aren't saved yet. */
  onDraftDirtyChange?: (dirty: boolean) => void;
}) {
  const toast = useToast();
  const save = useMutation(api.transactionLines.save);
  const restore = useMutation(api.financialHub.restoreTransactions);
  const listId = useId();
  const direction = record.amountCents < 0 ? -1 : 1;
  const lines = useMemo(() => transactionLines(record), [record]);
  const [draft, setDraft] = useState<DraftLine[] | null>(null);
  // The lines "Edit lines" started from; a new split has none (unsaved from the start).
  const [draftStart, setDraftStart] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = draft !== null && JSON.stringify(draft) !== draftStart;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => onDraftDirtyChange?.(dirty), [dirty, onDraftDirtyChange]);
  useEffect(() => () => onDraftDirtyChange?.(false), [onDraftDirtyChange]);

  const openDraft = (next: DraftLine[], saved: boolean) => {
    setDraft(next);
    setDraftStart(saved ? JSON.stringify(next) : null);
  };

  // The panel holds its own ways off the row while lines are unsaved; a row
  // picked in the table still moves, so say what was dropped.
  useEffect(() => {
    if (dirtyRef.current) toast.info("Unsaved line items discarded", "The split you were editing on the previous transaction wasn't saved.");
    setDraft(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record._id]);

  const accountOptions = useMemo<SelectOption[]>(
    () => [
      { value: "", label: "From the category" },
      ...accounts
        .filter((account) => !BANK_TYPES.has(String(account.accountType ?? "")))
        .map((account) => ({ value: account._id, label: `${account.code ? `${account.code} ` : ""}${account.name}`, hint: account.accountType })),
    ],
    [accounts],
  );
  const fundOptions = useMemo<SelectOption[]>(
    () => [{ value: "", label: "Unrestricted" }, ...funds.map((fund) => ({ value: fund._id, label: fund.name, hint: fund.purpose }))],
    [funds],
  );
  const fundLabel = (id?: string) => funds.find((fund) => fund._id === id)?.name;

  const persist = async (next: TransactionLine[], message: string) => {
    setBusy(true);
    try {
      const result = (await save({ id: record._id, lines: next })) as SaveResult;
      setDraft(null);
      toast.success(message, {
        description: result.journal === "reposted" ? "The posted journal entry was updated." : undefined,
        duration: 10_000,
        action: {
          label: "Undo",
          onClick: () => {
            void restore({ societyId, rows: result.previous })
              .then((undone) => (undone?.skippedLocked ? toast.warn("Not restored", booksLockedNote(undone.skippedLocked)) : toast.info("Restored the previous lines")))
              .catch((error: unknown) => toast.error("Could not undo", error instanceof Error ? error.message : undefined));
          },
        },
      });
    } catch (error) {
      toast.error("Could not save the lines", error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const datalist = (
    <datalist id={listId}>
      {categories.map((option) => <option key={option} value={option} />)}
    </datalist>
  );

  if (draft) {
    return (
      <>
        {datalist}
        <LinesDraft
          amountCents={record.amountCents}
          direction={direction}
          draft={draft}
          onChange={setDraft}
          busy={busy}
          listId={listId}
          accountOptions={accountOptions}
          fundOptions={fundOptions}
          tags={tags}
          onCancel={() => setDraft(null)}
          onSave={(parsed) => void persist(parsed, parsed.length > 1 ? `Split into ${parsed.length} lines` : "Saved the line")}
        />
      </>
    );
  }

  if (isSplitTransaction(record)) {
    return (
      <SplitSummary
        amountCents={record.amountCents}
        lines={lines}
        canWrite={canWrite}
        busy={busy}
        tags={tags}
        accountLabel={(id) => accountOptions.find((option) => option.value === id)?.label ?? "Removed account"}
        fundLabel={(id) => fundLabel(id) ?? "Fund"}
        onEdit={() => openDraft(lines.map((line) => toDraft(line, direction)), true)}
        onRemoveSplit={() => void persist([{ ...lines[0], amountCents: record.amountCents, memo: undefined }], "Removed the split")}
      />
    );
  }

  const only = lines[0];
  return (
    <div className="txn-lines">
      <SingleCategoryInput category={record.category ?? ""} recordId={record._id} listId={listId} disabled={!canWrite} onCommit={onCommitCategory} />
      {datalist}
      <div className="txn-lines__grid">
        <Select
          size="sm"
          aria-label="Fund"
          value={only.fundRestrictionId ?? ""}
          disabled={!canWrite || busy}
          // A single line's fund or tags save at once and keep its categorisation.
          onChange={(value) => void persist([{ ...only, fundRestrictionId: value || undefined }], value ? `Assigned to ${fundLabel(value) ?? "the fund"}` : "Removed the fund")}
          options={fundOptions}
        />
        {canWrite && (
          <button
            type="button"
            className="btn btn--sm"
            disabled={busy}
            onClick={() => openDraft(splitEvenlyCents(record.amountCents, 2).map((amountCents, index) => toDraft({ ...only, id: index === 0 ? only.id : newLineId(), amountCents, memo: undefined }, direction)), false)}
          >
            <Scissors size={12} aria-hidden="true" /> Split transaction
          </button>
        )}
      </div>
      <TagPicker tagIds={only.tagIds} tags={tags} disabled={!canWrite || busy} onChange={(tagIds) => void persist([{ ...only, tagIds }], "Tags updated")} />
    </div>
  );
}

/** The plain category of an unsplit transaction: saved on blur or Enter, Escape reverts. */
function SingleCategoryInput({ category, recordId, listId, disabled, onCommit }: { category: string; recordId: string; listId: string; disabled: boolean; onCommit: (category: string) => void }) {
  const [value, setValue] = useState(category);
  useEffect(() => setValue(category), [recordId, category]);
  const commit = () => {
    const next = value.trim();
    if (next !== category) onCommit(next);
  };
  return (
    <input
      className="input"
      aria-label="Category"
      list={listId}
      value={value}
      placeholder="Uncategorised"
      disabled={disabled}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          // A held Enter would save (and prompt for a rule) once per repeat.
          if (!event.repeat) commit();
        }
        if (event.key === "Escape") setValue(category);
      }}
    />
  );
}

/** A saved split, read-only: each line, the total, and Edit / Remove split. */
function SplitSummary({
  amountCents,
  lines,
  canWrite,
  busy,
  tags,
  accountLabel,
  fundLabel,
  onEdit,
  onRemoveSplit,
}: {
  amountCents: number;
  lines: readonly TransactionLine[];
  canWrite: boolean;
  busy: boolean;
  tags: FinanceTagsApi;
  accountLabel: (accountId: string) => string;
  fundLabel: (fundId: string) => string;
  onEdit: () => void;
  onRemoveSplit: () => void;
}) {
  return (
    <div className="txn-lines">
      <ol className="txn-lines__list txn-lines__list--read">
        {lines.map((line, index) => (
          <li key={line.id} className="txn-lines__read">
            <div className="txn-lines__row">
              <span className="txn-lines__number" aria-hidden="true">{index + 1}</span>
              <span className="txn-lines__read-category">
                {line.category || <span className="muted">Uncategorised</span>}
                {line.accountingAccountId && <small> · {accountLabel(line.accountingAccountId)}</small>}
              </span>
              <Money cents={line.amountCents} tone={line.amountCents > 0 ? "in" : "auto"} />
            </div>
            {(line.memo || line.fundRestrictionId || line.tagIds?.length) && (
              <div className="txn-lines__read-meta">
                {line.memo && <span>{line.memo}</span>}
                {line.fundRestrictionId && <span>{fundLabel(line.fundRestrictionId)}</span>}
                <TagChips tagIds={line.tagIds} tags={tags} />
              </div>
            )}
          </li>
        ))}
      </ol>
      <div className="txn-lines__totals">
        <span>Total <Money cents={amountCents} signDisplay="exceptZero" /></span>
        <span className="txn-lines__remainder is-balanced">Balanced</span>
      </div>
      {canWrite && (
        <div className="txn-lines__actions">
          <button type="button" className="btn btn--sm" onClick={onEdit}>
            <Scissors size={12} aria-hidden="true" /> Edit lines
          </button>
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={onRemoveSplit} title={`Keep one line in ${lines[0]?.category || "no category"}`}>
            <Undo2 size={12} aria-hidden="true" /> Remove split
          </button>
        </div>
      )}
    </div>
  );
}

/** Editing lines: per-line category, amount, ledger account, fund, memo and tags, with the running remainder. */
function LinesDraft({
  amountCents,
  direction,
  draft,
  onChange,
  busy,
  listId,
  accountOptions,
  fundOptions,
  tags,
  onCancel,
  onSave,
}: {
  amountCents: number;
  direction: number;
  draft: DraftLine[];
  onChange: (next: DraftLine[]) => void;
  busy: boolean;
  listId: string;
  accountOptions: SelectOption[];
  fundOptions: SelectOption[];
  tags: FinanceTagsApi;
  onCancel: () => void;
  onSave: (lines: TransactionLine[]) => void;
}) {
  const parsed = draft.map((line) => fromDraft(line, direction));
  const amountsValid = parsed.every((line) => Number.isFinite(line.amountCents));
  const remainder = amountsValid ? linesRemainderCents(amountCents, parsed) : null;
  const errors = amountsValid ? validateTransactionLines(amountCents, parsed, { groupOf: tags.groupOf }) : ["Enter an amount on every line."];
  const update = (index: number, patch: Partial<DraftLine>) => onChange(draft.map((line, at) => (at === index ? { ...line, ...patch } : line)));
  const evenly = () => {
    const amounts = splitEvenlyCents(amountCents, draft.length);
    onChange(draft.map((line, index) => ({ ...line, amount: textFromCents(amounts[index] * direction) })));
  };
  const remainderOn = (index: number) => {
    if (remainder === null) return;
    update(index, { amount: textFromCents((centsFromText(draft[index].amount) ?? 0) + remainder * direction) });
  };
  return (
    <div className="txn-lines txn-lines--editing">
      <ol className="txn-lines__list">
        {draft.map((line, index) => (
          <li key={line.id} className="txn-lines__line">
            <div className="txn-lines__row">
              <span className="txn-lines__number" aria-hidden="true">{index + 1}</span>
              <input
                className="input txn-lines__category"
                aria-label={`Line ${index + 1} category`}
                list={listId}
                value={line.category}
                placeholder="Category"
                onChange={(event) => update(index, { category: event.target.value })}
              />
              <input
                className="input txn-lines__amount"
                aria-label={`Line ${index + 1} amount`}
                inputMode="decimal"
                value={line.amount}
                onChange={(event) => update(index, { amount: event.target.value })}
                onBlur={() => {
                  const cents = centsFromText(line.amount);
                  if (cents !== null) update(index, { amount: textFromCents(cents) });
                }}
              />
              <button
                type="button"
                className="btn btn--ghost btn--sm btn--icon"
                aria-label={`Remove line ${index + 1}`}
                title="Remove line"
                disabled={draft.length <= 1}
                onClick={() => onChange(draft.filter((_, at) => at !== index))}
              >
                <Trash2 size={12} aria-hidden="true" />
              </button>
            </div>
            <div className="txn-lines__grid">
              <Select size="sm" aria-label={`Line ${index + 1} ledger account`} value={line.accountingAccountId} onChange={(value) => update(index, { accountingAccountId: value })} options={accountOptions} searchable />
              <Select size="sm" aria-label={`Line ${index + 1} fund`} value={line.fundRestrictionId} onChange={(value) => update(index, { fundRestrictionId: value })} options={fundOptions} />
            </div>
            <input
              className="input txn-lines__memo"
              aria-label={`Line ${index + 1} memo`}
              value={line.memo}
              placeholder="Memo"
              onChange={(event) => update(index, { memo: event.target.value })}
            />
            <div className="txn-lines__line-foot">
              <TagPicker tagIds={line.tagIds} tags={tags} onChange={(tagIds) => update(index, { tagIds })} />
              {remainder !== null && remainder !== 0 && (
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => remainderOn(index)}>
                  Remainder here
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
      <div className="txn-lines__totals" aria-live="polite">
        <span>
          Total <Money cents={amountsValid ? amountCents - (remainder ?? 0) : 0} signDisplay="exceptZero" /> of <Money cents={amountCents} signDisplay="exceptZero" />
        </span>
        {remainder !== null && (
          <span className={`txn-lines__remainder${remainder === 0 ? " is-balanced" : ""}`}>
            {remainder === 0 ? "Balanced" : `${formatMoney(Math.abs(remainder))} ${Math.sign(remainder) === Math.sign(amountCents) ? "left to allocate" : "over"}`}
          </span>
        )}
      </div>
      {errors.length > 0 && remainder === 0 && <p className="txn-lines__error" role="alert">{errors[0]}</p>}
      <div className="txn-lines__actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange([...draft, toDraft({ id: newLineId(), amountCents: 0 }, direction)])}>
          <Plus size={12} aria-hidden="true" /> Add line
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={evenly}>
          <Divide size={12} aria-hidden="true" /> Split evenly
        </button>
        <span className="txn-lines__spacer" />
        <button type="button" className="btn btn--sm" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn--sm btn--accent" disabled={busy || errors.length > 0} onClick={() => onSave(parsed)}>
          Save lines
        </button>
      </div>
    </div>
  );
}
