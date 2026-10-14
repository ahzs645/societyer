import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { AlertTriangle, ArrowUpToLine, Check, Copy, Plus, Sparkles, X, Zap } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Drawer, Field } from "../../../components/ui";
import { Select } from "../../../components/Select";
import { Segmented } from "../../../components/primitives";
import { Money } from "../../../components/Money";
import { useConfirm } from "../../../components/Modal";
import { useToast } from "../../../components/Toast";
import { formatDate, pluralize } from "../../../lib/format";
import { formatMoney, parseMoneyInput } from "../../../lib/money";
import {
  autoRuleName,
  conditionMatches,
  describeCondition,
  describeRule,
  findDuplicateRule,
  isRecodeRule,
  isUncategorized,
  normalizeRuleText,
  ruleMatches,
  ruleProblems,
  shadowingFor,
  sortRules,
  transactionPayee,
  validateRule,
  type RuleTextOptions,
} from "../../../../shared/transactionRules";
import type { RuleDraft } from "./draftFromTransaction";
import {
  draftActions,
  draftSignature,
  draftToCondition,
  editorDraftFrom,
  emptyCondition,
  isConditionComplete,
  type ConditionDraft,
  type RuleEditorDraft,
} from "./ruleDraft";
import type { ApplyRulesResult, RulesWorkspace } from "./types";
import { skippedRulesNote, useUndoRuleBatch } from "./useUndoRuleBatch";
import { RuleConditionRow } from "./RuleConditionRow";

/** Distinct values of a field across the workspace's lines, most frequent first. */
function knownValues(transactions: RulesWorkspace["transactions"], pick: (txn: RulesWorkspace["transactions"][number]) => string): string[] {
  const counts = new Map<string, { value: string; count: number }>();
  for (const txn of transactions) {
    const value = pick(txn).replace(/\s+/g, " ").trim();
    const key = normalizeRuleText(value);
    if (!key) continue;
    const entry = counts.get(key) ?? { value, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)).map((entry) => entry.value);
}

function namesList(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

/**
 * Create or edit a categorisation rule. Open it with `initial` (editor state,
 * e.g. `draftFromRule(row)`) or with `initialDraft` (a plain `RuleDraft`, e.g.
 * `draftFromTransaction(txn, category)` from the transactions table).
 */
export function RuleEditorDrawer({
  open,
  initial,
  initialDraft,
  workspace,
  societyId,
  canWrite,
  onClose,
}: {
  open: boolean;
  initial?: RuleEditorDraft | null;
  /** A plain draft to prefill a new (or, with `id`, an existing) rule. Used when `initial` is not given. */
  initialDraft?: RuleDraft | null;
  workspace: RulesWorkspace;
  societyId: string;
  canWrite: boolean;
  onClose: () => void;
}) {
  const upsert = useMutation(api.transactionRules.upsert);
  const applyRules = useMutation(api.transactionRules.applyToUncategorized);
  const reorder = useMutation(api.transactionRules.reorder);
  const toast = useToast();
  const confirm = useConfirm();
  const undoToast = useUndoRuleBatch(societyId);

  // Callers may build `initialDraft` inline on every render; only a change in content resets the editor.
  const initialDraftKey = initialDraft ? JSON.stringify(initialDraft) : "";
  const start = useMemo<RuleEditorDraft | null>(
    () => initial ?? (initialDraft ? editorDraftFrom(initialDraft) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initial, initialDraftKey],
  );

  const [draft, setDraft] = useState<RuleEditorDraft | null>(start);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [placeFirst, setPlaceFirst] = useState(false);
  const [sample, setSample] = useState({ text: "", amount: "", direction: "out" as "in" | "out" });

  useEffect(() => {
    setDraft(start);
    setErrors([]);
    setPlaceFirst(false);
    setSample({ text: "", amount: "", direction: "out" });
  }, [start]);

  const accountName = useCallback((id: string) => workspace.accounts.find((account) => account._id === id)?.name, [workspace.accounts]);
  const fundName = useCallback(
    (id: string) => {
      const archived = workspace.archivedFunds?.find((fund) => fund._id === id);
      return workspace.fundRestrictions.find((fund) => fund._id === id)?.name ?? (archived ? `${archived.name} (archived)` : undefined);
    },
    [workspace.fundRestrictions, workspace.archivedFunds],
  );
  const textOptions: RuleTextOptions = useMemo(() => ({ accountName, fundName, formatCents: (cents: number) => formatMoney(cents) }), [accountName, fundName]);

  const conditions = useMemo(() => (draft?.conditions ?? []).map(draftToCondition), [draft]);
  const complete = useMemo(() => conditions.filter(isConditionComplete), [conditions]);
  const actions = useMemo(() => (draft ? draftActions(draft) : {}), [draft]);
  const matches = useMemo(
    () => (complete.length ? workspace.transactions.filter((txn) => complete.every((condition) => conditionMatches(condition, txn))) : []),
    [complete, workspace.transactions],
  );

  // Rules that can't run never take a line, here or on the server.
  const invalidIds = useMemo(() => new Set(workspace.rules.filter((rule) => (rule.problems ?? []).length > 0).map((rule) => rule._id)), [workspace.rules]);
  const orderedRules = useMemo(() => sortRules(workspace.rules), [workspace.rules]);
  const rulesAbove = useMemo(() => {
    if (placeFirst) return [];
    if (!draft?.id) return orderedRules;
    const index = orderedRules.findIndex((rule) => rule._id === draft.id);
    return index < 0 ? orderedRules : orderedRules.slice(0, index);
  }, [draft?.id, orderedRules, placeFirst]);
  const shadow = useMemo(() => shadowingFor(complete, rulesAbove, workspace.transactions, invalidIds), [complete, rulesAbove, workspace.transactions, invalidIds]);
  const duplicate = useMemo(
    () => (complete.length && complete.length === conditions.length ? findDuplicateRule(workspace.rules, complete, draft?.id) : null),
    [complete, conditions.length, workspace.rules, draft?.id],
  );
  const positionOf = (ruleId: string) => orderedRules.findIndex((rule) => rule._id === ruleId) + 1;

  // Lines "Save and apply" would change: uncategorised (or, for a re-code rule,
  // not hand-categorised) and not taken by an active rule above this one.
  const applicable = useMemo(() => {
    const recode = isRecodeRule({ conditions: complete });
    const above = rulesAbove.filter((rule) => rule.enabled && !invalidIds.has(rule._id));
    return matches.filter((txn) => {
      const eligible = isUncategorized(txn) || (recode && txn.categorizedBy !== "manual" && (!draft?.id || txn.ruleId !== draft.id));
      return eligible && !above.some((rule) => ruleMatches(rule, txn));
    }).length;
  }, [complete, matches, rulesAbove, invalidIds, draft?.id]);
  const uncategorizedMatches = matches.filter((txn) => isUncategorized(txn)).length;

  const problems = useMemo(
    () =>
      ruleProblems(
        { conditions: complete, actions },
        {
          accountIds: new Set(workspace.accounts.map((account) => account._id)),
          activeFundIds: new Set(workspace.fundRestrictions.map((fund) => fund._id)),
          archivedFundIds: new Set((workspace.archivedFunds ?? []).map((fund) => fund._id)),
        },
      ),
    [complete, actions, workspace.accounts, workspace.fundRestrictions, workspace.archivedFunds],
  );

  const payeeSuggestions = useMemo(() => knownValues(workspace.transactions, (txn) => transactionPayee(txn)), [workspace.transactions]);
  const descriptionSuggestions = useMemo(() => knownValues(workspace.transactions, (txn) => txn.description ?? ""), [workspace.transactions]);

  const sampleResult = useMemo(() => {
    if (!sample.text.trim() && !sample.amount.trim()) return null;
    const cents = Math.abs(parseMoneyInput(sample.amount) ?? 0);
    const txn = { description: sample.text, counterparty: "", amountCents: sample.direction === "in" ? cents : -cents };
    const failed = complete.findIndex((condition) => !conditionMatches(condition, txn));
    return { matches: complete.length > 0 && failed < 0, failed };
  }, [sample, complete]);

  // Closing asks first only when something changed since the drawer opened.
  const dirtyRef = useRef(false);
  dirtyRef.current = draftSignature(draft) !== draftSignature(start);
  const savingRef = useRef(false);
  savingRef.current = saving;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const requestClose = useCallback(async () => {
    if (dirtyRef.current && !savingRef.current) {
      const ok = await confirm({
        title: "Discard changes to this rule?",
        message: "Your edits haven't been saved.",
        confirmLabel: "Discard changes",
        cancelLabel: "Keep editing",
        tone: "danger",
      });
      if (!ok) return;
    }
    onCloseRef.current();
  }, [confirm]);
  // Stable, so the drawer's inspector registration doesn't churn on every keystroke.
  const handleClose = useCallback(() => void requestClose(), [requestClose]);

  if (!draft) return null;

  const bankAccounts = workspace.accounts.filter((account) => /bank|credit|cash/i.test(String(account.accountType ?? "")));
  const ledgerAccounts = workspace.accounts.filter((account) => !/bank|credit/i.test(String(account.accountType ?? "")));
  const accountLabel = (account: { code?: string; name: string }) => (account.code ? `${account.code} · ${account.name}` : account.name);
  const autoName = autoRuleName(complete, actions, textOptions);
  const sentenceReady = complete.length > 0 && Object.keys(actions).length > 0;

  const setCondition = (index: number, patch: Partial<ConditionDraft>) =>
    setDraft({ ...draft, conditions: draft.conditions.map((condition, i) => (i === index ? { ...condition, ...patch } : condition)) });
  const removeCondition = (index: number) => setDraft({ ...draft, conditions: draft.conditions.filter((_, i) => i !== index) });
  const save = async (applyNow: boolean) => {
    const problemsNow = validateRule({ name: draft.name, conditions, actions });
    setErrors(problemsNow);
    if (problemsNow.length) return;
    setSaving(true);
    try {
      const id = (await upsert({
        id: draft.id as any,
        societyId: societyId as any,
        name: draft.name.trim(),
        enabled: draft.enabled,
        conditions: conditions as any,
        actions: actions as any,
      })) as string;
      if (placeFirst) {
        const others = orderedRules.map((rule) => rule._id).filter((ruleId) => ruleId !== id);
        await reorder({ societyId: societyId as any, orderedIds: [id, ...others] as any });
      }
      if (applyNow && draft.enabled) {
        const result = (await applyRules({ societyId: societyId as any, ruleId: id as any })) as ApplyRulesResult;
        if (result.applied > 0) undoToast(result, `Rule saved and applied to ${pluralize(result.applied, "transaction")}`);
        else toast.success("Rule saved", skippedRulesNote(result) ?? "No uncategorised transactions were left for this rule to categorise.");
      } else {
        toast.success(draft.id ? "Rule updated" : "Rule created", placeFirst ? "It's now first in the list." : undefined);
      }
      onClose();
    } catch (error: any) {
      toast.error("Could not save the rule", error?.message);
    } finally {
      setSaving(false);
    }
  };

  const shadowNames = namesList(shadow.byRule.map((entry) => entry.rule.name));

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      size="wide"
      title={draft.id ? "Edit rule" : "New rule"}
      footer={
        <>
          <button className="btn" type="button" onClick={handleClose}>Cancel</button>
          <button className="btn" type="button" disabled={!canWrite || saving} onClick={() => void save(false)}>
            Save rule
          </button>
          <button className="btn btn--accent" type="button" disabled={!canWrite || saving || !draft.enabled || applicable === 0 || problems.length > 0} onClick={() => void save(true)}>
            <Zap size={12} aria-hidden="true" /> Save and apply to {applicable}
          </button>
        </>
      }
    >
      <div className="rule-editor">
        <p className={`rule-editor__sentence${sentenceReady ? "" : " is-empty"}`} aria-live="polite">
          <Sparkles size={14} aria-hidden="true" className="rule-editor__sentence-icon" />
          <span>
            {sentenceReady
              ? describeRule(complete, actions, textOptions)
              : "Add a condition and an action to read the rule as a sentence."}
          </span>
        </p>

        {problems.length > 0 && (
          <div className="rule-editor__notice rule-editor__notice--danger" role="alert">
            <AlertTriangle size={14} aria-hidden="true" />
            <span>Needs attention: {problems.join("; ")}. Choose another one or clear it, then save.</span>
          </div>
        )}

        <Field label="Rule name" hint="Optional. Leave it blank and the rule is named for you.">
          <input
            className="input"
            value={draft.name}
            placeholder={complete.length || Object.keys(actions).length ? autoName : "e.g. BC Hydro → Utilities"}
            maxLength={120}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </Field>

        <section className="rule-editor__block" aria-labelledby="rule-editor-if">
          <h3 className="rule-editor__block-title" id="rule-editor-if">If a transaction matches</h3>
          <ol className="rule-editor__conditions">
            {draft.conditions.map((condition, index) => (
              <RuleConditionRow
                key={condition.key}
                condition={condition}
                index={index}
                count={draft.conditions.length}
                onChange={(patch) => setCondition(index, patch)}
                onRemove={() => removeCondition(index)}
                bankAccountOptions={bankAccounts.map((account) => ({ value: account._id, label: accountLabel(account) }))}
                categories={workspace.categories}
                payeeSuggestions={payeeSuggestions}
                descriptionSuggestions={descriptionSuggestions}
              />
            ))}
          </ol>
          <button type="button" className="btn btn--ghost btn--sm" disabled={draft.conditions.length >= 12} onClick={() => setDraft({ ...draft, conditions: [...draft.conditions, emptyCondition("amount")] })}>
            <Plus size={12} aria-hidden="true" /> Add condition
          </button>
          {draft.conditions.some((condition) => condition.field === "payee") && (
            <p className="rule-editor__hint">Payee matches the counterparty, or the bank description when a line has no counterparty. Text matching ignores capitals.</p>
          )}
          {draft.conditions.some((condition) => condition.field === "category") && (
            <p className="rule-editor__hint">A “category is” rule also updates lines that already have that category, unless someone set it by hand.</p>
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
          {(workspace.fundRestrictions.length > 0 || draft.fundRestrictionId) && (
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
                options={[
                  ...workspace.fundRestrictions.map((fund) => ({ value: fund._id, label: fund.name })),
                  // Keep an archived fund the rule still tags visible, so the trigger names it.
                  ...(workspace.archivedFunds ?? []).filter((fund) => fund._id === draft.fundRestrictionId).map((fund) => ({ value: fund._id, label: `${fund.name} (archived)` })),
                ]}
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

        {duplicate && (
          <div className="rule-editor__notice rule-editor__notice--warn" role="status">
            <Copy size={14} aria-hidden="true" />
            <span>A rule with the same conditions already exists (rule {positionOf(duplicate._id)}: {duplicate.name}). Saving keeps both.</span>
          </div>
        )}

        {shadow.taken > 0 ? (
          <div className="rule-editor__notice rule-editor__notice--warn" role="status">
            <AlertTriangle size={14} aria-hidden="true" />
            <span>
              {shadow.taken === shadow.matches
                ? `All ${pluralize(shadow.matches, "match", "matches")} already go to a higher rule: ${shadowNames}. This rule would never apply in its current place.`
                : `${shadow.taken} of these ${shadow.matches} matches already go to a higher rule: ${shadowNames}.`}
            </span>
            {canWrite && (
              <button type="button" className="btn btn--sm rule-editor__notice-action" onClick={() => setPlaceFirst(true)}>
                <ArrowUpToLine size={12} aria-hidden="true" /> Place this rule first
              </button>
            )}
          </div>
        ) : placeFirst ? (
          <div className="rule-editor__notice rule-editor__notice--info" role="status">
            <ArrowUpToLine size={14} aria-hidden="true" />
            <span>This rule moves to the top of the list when you save, so it wins over every other rule.</span>
            <button type="button" className="btn btn--sm btn--ghost rule-editor__notice-action" onClick={() => setPlaceFirst(false)}>
              Keep its place
            </button>
          </div>
        ) : null}

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
