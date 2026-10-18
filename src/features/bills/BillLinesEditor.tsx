import { Plus, X } from "lucide-react";
import { Select, type SelectOption } from "../../components/Select";
import { Money } from "../../components/Money";
import { parseMoneyInput } from "../../lib/money";

/** One editable bill line. New per-line attributes (tags) join here and in the row below. */
export type LineDraft = { key: string; accountId: string; memo: string; fundRestrictionId: string; amount: string };

let lineCounter = 0;
export function newLine(accountId = ""): LineDraft {
  lineCounter += 1;
  return { key: `line_${Date.now().toString(36)}_${lineCounter}`, accountId, memo: "", fundRestrictionId: "", amount: "" };
}

export function lineCents(line: LineDraft): number {
  return parseMoneyInput(line.amount) ?? 0;
}

export function hasBadAmount(lines: readonly LineDraft[]): boolean {
  return lines.some((line) => line.amount.trim() !== "" && parseMoneyInput(line.amount) == null);
}

/**
 * The bill's lines: the account each cost goes to, a memo, the restricted
 * fund (when the workspace has any) and the amount, with the running total.
 */
export function BillLinesEditor({
  lines,
  onChange,
  accountOptions,
  fundOptions,
  newLineAccountId,
  disabled,
  showErrors,
}: {
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  accountOptions: SelectOption[];
  fundOptions: SelectOption[];
  /** The account a newly added line starts on (the vendor's default). */
  newLineAccountId: string;
  disabled: boolean;
  /** Mark lines with an amount but no account once a save was attempted. */
  showErrors: boolean;
}) {
  const funds = fundOptions.length > 0;
  const rowClass = `bill-lines__row${funds ? " bill-lines__row--funds" : ""}`;
  const setLine = (key: string, patch: Partial<LineDraft>) => onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const total = lines.reduce((sum, line) => sum + lineCents(line), 0);

  return (
    <>
      <div className="bill-lines__grid" role="table" aria-label="Bill lines">
        <div className={`${rowClass} bill-lines__row--head`} role="row">
          <span role="columnheader">Account</span>
          <span role="columnheader">Memo</span>
          {funds && <span role="columnheader">Fund</span>}
          <span role="columnheader" className="num">Amount</span>
          <span role="columnheader"><span className="sr-only">Remove</span></span>
        </div>
        {lines.map((line, index) => (
          <div key={line.key} className={rowClass} role="row">
            <span role="cell">
              <Select
                value={line.accountId}
                onChange={(accountId) => setLine(line.key, { accountId })}
                options={accountOptions}
                placeholder="Choose account"
                searchable
                disabled={disabled}
                aria-label={`Account for line ${index + 1}`}
                aria-invalid={showErrors && !line.accountId && lineCents(line) > 0 ? true : undefined}
              />
            </span>
            <span role="cell">
              <input className="input" value={line.memo} onChange={(event) => setLine(line.key, { memo: event.target.value })} disabled={disabled} placeholder="What it's for" aria-label={`Memo for line ${index + 1}`} />
            </span>
            {funds && (
              <span role="cell">
                <Select
                  value={line.fundRestrictionId}
                  onChange={(fundRestrictionId) => setLine(line.key, { fundRestrictionId })}
                  options={fundOptions}
                  placeholder="Unrestricted"
                  clearable
                  clearLabel="Unrestricted"
                  disabled={disabled}
                  aria-label={`Fund for line ${index + 1}`}
                />
              </span>
            )}
            <span role="cell">
              <input
                className="input input--money"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                value={line.amount}
                onChange={(event) => setLine(line.key, { amount: event.target.value })}
                disabled={disabled}
                aria-label={`Amount for line ${index + 1}`}
                aria-invalid={line.amount.trim() !== "" && parseMoneyInput(line.amount) == null ? true : undefined}
              />
            </span>
            <span role="cell">
              <button
                type="button"
                className="btn btn--ghost btn--sm btn--icon"
                aria-label={`Remove line ${index + 1}`}
                disabled={disabled || lines.length === 1}
                onClick={() => onChange(lines.filter((row) => row.key !== line.key))}
              >
                <X size={14} />
              </button>
            </span>
          </div>
        ))}
      </div>
      <div className="bill-lines__foot">
        <button type="button" className="btn btn--sm btn--ghost" disabled={disabled || lines.length >= 100} onClick={() => onChange([...lines, newLine(newLineAccountId)])}>
          <Plus size={12} aria-hidden="true" /> Add line
        </button>
        <span className="bill-lines__total">
          Total <Money cents={total} />
        </span>
      </div>
    </>
  );
}
