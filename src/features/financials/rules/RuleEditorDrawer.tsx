import { useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { Check, Plus, X, Zap } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Drawer, Field } from "../../../components/ui";
import { Select } from "../../../components/Select";
import { Segmented } from "../../../components/primitives";
import { Money } from "../../../components/Money";
import { useToast } from "../../../components/Toast";
import { formatDate, pluralize } from "../../../lib/format";
import { parseMoneyInput } from "../../../lib/money";
import {
  AMOUNT_OPERATOR_LABELS,
  TEXT_OPERATOR_LABELS,
  conditionMatches,
  describeCondition,
  isUncategorized,
  validateRule,
  type AmountOperator,
  type TextOperator,
} from "../../../../shared/transactionRules";
import {
  draftActions,
  draftToCondition,
  emptyCondition,
  isConditionComplete,
  type ConditionDraft,
  type ConditionField,
  type RuleDraft,
} from "./ruleDraft";
import type { RulesWorkspace } from "./types";
import { useUndoRuleBatch } from "./useUndoRuleBatch";

const FIELD_OPTIONS: { value: ConditionField; label: string }[] = [
  { value: "payee", label: "Payee" },
  { value: "description", label: "Description" },
  { value: "amount", label: "Amount" },
  { value: "direction", label: "Direction" },
  { value: "account", label: "Bank account" },
];

const TEXT_OPTIONS = (Object.keys(TEXT_OPERATOR_LABELS) as TextOperator[]).map((value) => ({ value, label: TEXT_OPERATOR_LABELS[value] }));
const AMOUNT_OPTIONS = (Object.keys(AMOUNT_OPERATOR_LABELS) as AmountOperator[]).map((value) => ({ value, label: AMOUNT_OPERATOR_LABELS[value] }));

export function RuleEditorDrawer({
  open,
  initial,
  workspace,
  societyId,
  canWrite,
  onClose,
}: {
  open: boolean;
  initial: RuleDraft | null;
  workspace: RulesWorkspace;
  societyId: string;
  canWrite: boolean;
  onClose: () => void;
}) {
  const upsert = useMutation(api.transactionRules.upsert);
  const applyRules = useMutation(api.transactionRules.applyToUncategorized);
  const toast = useToast();
  const undoToast = useUndoRuleBatch(societyId);
  const [draft, setDraft] = useState<RuleDraft | null>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [sample, setSample] = useState({ text: "", amount: "", direction: "out" as "in" | "out" });

  useEffect(() => {
    setDraft(initial);
    setErrors([]);
    setSample({ text: "", amount: "", direction: "out" });
  }, [initial]);

  const conditions = useMemo(() => (draft?.conditions ?? []).map(draftToCondition), [draft]);
  const complete = useMemo(() => conditions.filter(isConditionComplete), [conditions]);
  const matches = useMemo(
    () => (complete.length ? workspace.transactions.filter((txn) => complete.every((condition) => conditionMatches(condition, txn))) : []),
    [complete, workspace.transactions],
  );
  const uncategorizedMatches = matches.filter((txn) => isUncategorized(txn)).length;

  const sampleResult = useMemo(() => {
    if (!sample.text.trim() && !sample.amount.trim()) return null;
    const cents = Math.abs(parseMoneyInput(sample.amount) ?? 0);
    const txn = { description: sample.text, counterparty: "", amountCents: sample.direction === "in" ? cents : -cents };
    const failed = complete.findIndex((condition) => !conditionMatches(condition, txn));
    return { matches: complete.length > 0 && failed < 0, failed };
  }, [sample, complete]);

  if (!draft) return null;

  const bankAccounts = workspace.accounts.filter((account) => /bank|credit|cash/i.test(String(account.accountType ?? "")));
  const ledgerAccounts = workspace.accounts.filter((account) => !/bank|credit/i.test(String(account.accountType ?? "")));
  const accountLabel = (account: { code?: string; name: string }) => (account.code ? `${account.code} · ${account.name}` : account.name);

  const setCondition = (index: number, patch: Partial<ConditionDraft>) =>
    setDraft({ ...draft, conditions: draft.conditions.map((condition, i) => (i === index ? { ...condition, ...patch } : condition)) });
  const removeCondition = (index: number) => setDraft({ ...draft, conditions: draft.conditions.filter((_, i) => i !== index) });

  const save = async (applyNow: boolean) => {
    const actions = draftActions(draft);
    const problems = validateRule({ name: draft.name, conditions, actions });
    setErrors(problems);
    if (problems.length) return;
    setSaving(true);
    try {
      const id = await upsert({
        id: draft.id as any,
        societyId: societyId as any,
        name: draft.name.trim(),
        enabled: draft.enabled,
        conditions: conditions as any,
        actions: actions as any,
      });
      if (applyNow && draft.enabled) {
        const result = await applyRules({ societyId: societyId as any, ruleId: id as any });
        if (result.applied > 0) undoToast(result, `Rule saved and applied to ${pluralize(result.applied, "transaction")}`);
        else toast.success("Rule saved", "No uncategorised transactions were left for this rule to categorise.");
      } else {
        toast.success(draft.id ? "Rule updated" : "Rule created");
      }
      onClose();
    } catch (error: any) {
      toast.error("Could not save the rule", error?.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size="wide"
      title={draft.id ? "Edit rule" : "New rule"}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          <button className="btn" type="button" disabled={!canWrite || saving} onClick={() => void save(false)}>
            Save rule
          </button>
          <button className="btn btn--accent" type="button" disabled={!canWrite || saving || !draft.enabled || uncategorizedMatches === 0} onClick={() => void save(true)}>
            <Zap size={12} aria-hidden="true" /> Save and apply to {uncategorizedMatches}
          </button>
        </>
      }
    >
      <div className="rule-editor">
        <Field label="Rule name" required>
          <input
            className="input"
            value={draft.name}
            placeholder="e.g. BC Hydro to utilities"
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </Field>

        <section className="rule-editor__block" aria-labelledby="rule-editor-if">
          <h3 className="rule-editor__block-title" id="rule-editor-if">If a transaction matches</h3>
          <ol className="rule-editor__conditions">
            {draft.conditions.map((condition, index) => (
              <li key={condition.key} className="rule-editor__condition">
                <span className="rule-editor__joiner" aria-hidden="true">{index === 0 ? "If" : "and"}</span>
                <div className="rule-editor__condition-fields">
                  <Select
                    size="sm"
                    className="rule-editor__select rule-editor__select--field"
                    aria-label={`Condition ${index + 1} field`}
                    value={condition.field}
                    onChange={(field) => setCondition(index, { field })}
                    options={FIELD_OPTIONS}
                  />
                  {(condition.field === "payee" || condition.field === "description") && (
                    <>
                      <Select size="sm" className="rule-editor__select rule-editor__select--op" aria-label={`Condition ${index + 1} comparison`} value={condition.textOperator} onChange={(textOperator) => setCondition(index, { textOperator })} options={TEXT_OPTIONS} />
                      <input
                        className="input input--sm rule-editor__grow"
                        aria-label={`Condition ${index + 1} text`}
                        value={condition.text}
                        placeholder={condition.field === "payee" ? "e.g. BC Hydro" : "e.g. account fee"}
                        onChange={(event) => setCondition(index, { text: event.target.value })}
                      />
                    </>
                  )}
                  {condition.field === "amount" && (
                    <>
                      <Select size="sm" className="rule-editor__select rule-editor__select--op" aria-label={`Condition ${index + 1} comparison`} value={condition.amountOperator} onChange={(amountOperator) => setCondition(index, { amountOperator })} options={AMOUNT_OPTIONS} />
                      <input
                        className="input input--sm rule-editor__amount"
                        inputMode="decimal"
                        aria-label={condition.amountOperator === "between" ? `Condition ${index + 1} lower amount` : `Condition ${index + 1} amount`}
                        value={condition.amount}
                        placeholder="$0.00"
                        onChange={(event) => setCondition(index, { amount: event.target.value })}
                      />
                      {condition.amountOperator === "between" && (
                        <>
                          <span className="rule-editor__word">and</span>
                          <input
                            className="input input--sm rule-editor__amount"
                            inputMode="decimal"
                            aria-label={`Condition ${index + 1} upper amount`}
                            value={condition.amountMax}
                            placeholder="$0.00"
                            onChange={(event) => setCondition(index, { amountMax: event.target.value })}
                          />
                        </>
                      )}
                    </>
                  )}
                  {condition.field === "direction" && (
                    <Select
                      size="sm"
                      className="rule-editor__select rule-editor__select--op"
                      aria-label={`Condition ${index + 1} direction`}
                      value={condition.direction}
                      onChange={(direction) => setCondition(index, { direction })}
                      options={[{ value: "out", label: "is money out" }, { value: "in", label: "is money in" }]}
                    />
                  )}
                  {condition.field === "account" && (
                    <Select
                      size="sm"
                      className="rule-editor__grow"
                      aria-label={`Condition ${index + 1} bank account`}
                      value={condition.accountId}
                      placeholder="Choose account"
                      onChange={(accountId) => setCondition(index, { accountId })}
                      options={bankAccounts.map((account) => ({ value: account._id, label: accountLabel(account) }))}
                    />
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon btn--sm rule-editor__remove"
                  aria-label={`Remove condition ${index + 1}`}
                  disabled={draft.conditions.length === 1}
                  onClick={() => removeCondition(index)}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ol>
          <button type="button" className="btn btn--ghost btn--sm" disabled={draft.conditions.length >= 12} onClick={() => setDraft({ ...draft, conditions: [...draft.conditions, emptyCondition("amount")] })}>
            <Plus size={12} aria-hidden="true" /> Add condition
          </button>
          {draft.conditions.some((condition) => condition.field === "payee") && (
            <p className="rule-editor__hint">Payee matches the counterparty, or the bank description when a line has no counterparty. Text matching ignores capitals.</p>
          )}
        </section>

        <section className="rule-editor__block" aria-labelledby="rule-editor-then">
          <h3 className="rule-editor__block-title" id="rule-editor-then">Then</h3>
          <div className="rule-editor__action">
            <label className="rule-editor__action-label" htmlFor="rule-category">Set category to</label>
            <input
              id="rule-category"
              className="input input--sm rule-editor__grow"
              list="rule-category-options"
              value={draft.category}
              placeholder="e.g. Utilities"
              onChange={(event) => setDraft({ ...draft, category: event.target.value })}
            />
            <datalist id="rule-category-options">
              {workspace.categories.map((category) => <option key={category} value={category} />)}
            </datalist>
          </div>
          <div className="rule-editor__action">
            <span className="rule-editor__action-label">Code to account</span>
            <Select
              size="sm"
              className="rule-editor__grow"
              aria-label="Accounting account"
              value={draft.accountingAccountId}
              clearable
              clearLabel="No account"
              placeholder="No account"
              searchable
              onChange={(accountingAccountId) => setDraft({ ...draft, accountingAccountId })}
              options={ledgerAccounts.map((account) => ({ value: account._id, label: accountLabel(account) }))}
            />
          </div>
          {workspace.fundRestrictions.length > 0 && (
            <div className="rule-editor__action">
              <span className="rule-editor__action-label">Assign to fund</span>
              <Select
                size="sm"
                className="rule-editor__grow"
                aria-label="Fund or restriction"
                value={draft.fundRestrictionId}
                clearable
                clearLabel="No fund"
                placeholder="No fund"
                onChange={(fundRestrictionId) => setDraft({ ...draft, fundRestrictionId })}
                options={workspace.fundRestrictions.map((fund) => ({ value: fund._id, label: fund.name }))}
              />
            </div>
          )}
          <label className="rule-editor__check">
            <input type="checkbox" checked={draft.markReviewed} onChange={(event) => setDraft({ ...draft, markReviewed: event.target.checked })} />
            Mark as reviewed
          </label>
          <label className="rule-editor__check">
            <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />
            Rule is on (applies to imports and “Apply rules”)
          </label>
        </section>

        {errors.length > 0 && (
          <div className="rule-editor__errors" role="alert">
            {errors.map((error) => <div key={error}>{error}</div>)}
          </div>
        )}

        <section className="rule-editor__preview" aria-live="polite">
          <div className="rule-editor__preview-head">
            {complete.length === 0 ? (
              <span className="muted">Complete a condition to see which transactions match.</span>
            ) : (
              <>
                <strong>Matches {pluralize(matches.length, "existing transaction")}</strong>
                <span className="muted"> · {uncategorizedMatches} uncategorised</span>
              </>
            )}
          </div>
          {matches.length > 0 && (
            <ul className="rule-editor__matches">
              {matches.slice(0, 5).map((txn) => (
                <li key={txn._id}>
                  <span className="rule-editor__match-desc">{txn.description}</span>
                  <span className="muted rule-editor__match-date">{formatDate(txn.date)}</span>
                  <Money cents={txn.amountCents} tone={txn.amountCents < 0 ? "out" : "in"} signDisplay="exceptZero" />
                </li>
              ))}
              {matches.length > 5 && <li className="muted">and {matches.length - 5} more</li>}
            </ul>
          )}
        </section>

        <section className="rule-editor__block" aria-labelledby="rule-editor-test">
          <h3 className="rule-editor__block-title" id="rule-editor-test">Test against a sample</h3>
          <div className="rule-editor__sample">
            <input
              className="input input--sm rule-editor__grow"
              aria-label="Sample description"
              placeholder="Description, e.g. BC HYDRO 0046 PAYMENT"
              value={sample.text}
              onChange={(event) => setSample({ ...sample, text: event.target.value })}
            />
            <input
              className="input input--sm rule-editor__amount"
              aria-label="Sample amount"
              inputMode="decimal"
              placeholder="$0.00"
              value={sample.amount}
              onChange={(event) => setSample({ ...sample, amount: event.target.value })}
            />
            <Segmented
              value={sample.direction}
              onChange={(direction) => setSample({ ...sample, direction })}
              items={[{ id: "out", label: "Out" }, { id: "in", label: "In" }]}
            />
          </div>
          {sampleResult && (
            <p className={`rule-editor__sample-result${sampleResult.matches ? " is-match" : ""}`} role="status">
              {sampleResult.matches ? <Check size={14} aria-hidden="true" /> : <X size={14} aria-hidden="true" />}
              {sampleResult.matches
                ? "This rule would categorise it."
                : complete.length === 0
                  ? "Complete a condition first."
                  : `No match: ${describeCondition(complete[sampleResult.failed])} isn't true for this sample.`}
            </p>
          )}
        </section>
      </div>
    </Drawer>
  );
}
