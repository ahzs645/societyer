import { useEffect, useMemo, useState, type DragEvent, type KeyboardEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowUp, GripVertical, MoreHorizontal, Pencil, Plus, Trash2, Wand2, Zap } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useFinancePermissions } from "@/hooks/useFinancePermissions";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { EmptyState } from "../components/ui";
import { Toggle } from "../components/Controls";
import { Menu } from "../components/Menu";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { formatMoney } from "../lib/money";
import { pluralize, relative } from "../lib/format";
import { describeCondition, type StarterRuleSuggestion } from "../../shared/transactionRules";
import { RuleEditorDrawer } from "../features/financials/rules/RuleEditorDrawer";
import { conditionToDraft, draftFromRule, emptyRuleDraft, type RuleDraft } from "../features/financials/rules/ruleDraft";
import type { RuleRow, RulesWorkspace } from "../features/financials/rules/types";
import { useUndoRuleBatch } from "../features/financials/rules/useUndoRuleBatch";

/**
 * Transaction categorisation rules: an ordered list ("If … then …") applied
 * on bank imports and on demand. Rules higher in the list win.
 */
export function TransactionRulesPage() {
  const society = useSociety();
  const { canWrite } = useFinancePermissions();
  const workspace = useQuery(api.transactionRules.workspace, society ? { societyId: society._id } : "skip") as RulesWorkspace | undefined;
  const reorder = useMutation(api.transactionRules.reorder);
  const setEnabled = useMutation(api.transactionRules.setEnabled);
  const removeRule = useMutation(api.transactionRules.remove);
  const applyRules = useMutation(api.transactionRules.applyToUncategorized);
  const confirm = useConfirm();
  const toast = useToast();
  const undoToast = useUndoRuleBatch(society?._id);
  const [searchParams, setSearchParams] = useSearchParams();
  const [editing, setEditing] = useState<RuleDraft | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const rules = useMemo(() => {
    const list = workspace?.rules ?? [];
    if (!order) return list;
    const byId = new Map(list.map((rule) => [rule._id, rule]));
    const ordered = order.map((id) => byId.get(id)).filter(Boolean) as RuleRow[];
    return ordered.length === list.length ? ordered : list;
  }, [workspace?.rules, order]);

  // Deep link from a transaction's provenance popover: ?rule=<id> opens the editor.
  const ruleParam = searchParams.get("rule");
  useEffect(() => {
    if (!ruleParam || !workspace) return;
    const rule = workspace.rules.find((row) => row._id === ruleParam);
    if (rule) setEditing(draftFromRule(rule));
    const next = new URLSearchParams(searchParams);
    next.delete("rule");
    setSearchParams(next, { replace: true });
  }, [ruleParam, workspace, searchParams, setSearchParams]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const accountName = (id: string) => workspace?.accounts.find((account) => account._id === id)?.name;
  const fundName = (id: string) => workspace?.fundRestrictions.find((fund) => fund._id === id)?.name;

  const commitOrder = async (ids: string[], movedName: string) => {
    setOrder(ids);
    const position = ids.findIndex((id) => rules.find((rule) => rule._id === id)?.name === movedName) + 1;
    setAnnouncement(`${movedName} moved to position ${position} of ${ids.length}.`);
    try {
      await reorder({ societyId: society._id, orderedIds: ids as any });
    } catch (error: any) {
      toast.error("Could not reorder rules", error?.message);
    } finally {
      setOrder(null);
    }
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= rules.length) return;
    const ids = rules.map((rule) => rule._id);
    const [moved] = ids.splice(index, 1);
    ids.splice(target, 0, moved);
    void commitOrder(ids, rules[index].name);
    // Keep keyboard focus on the moved rule's handle.
    window.requestAnimationFrame(() => document.getElementById(`rule-handle-${moved}`)?.focus());
  };

  const onHandleKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowUp") { event.preventDefault(); move(index, -1); }
    if (event.key === "ArrowDown") { event.preventDefault(); move(index, 1); }
  };

  const onDrop = (event: DragEvent<HTMLLIElement>, index: number) => {
    event.preventDefault();
    if (!dragId) return;
    const from = rules.findIndex((rule) => rule._id === dragId);
    setDragId(null);
    if (from < 0 || from === index) return;
    const ids = rules.map((rule) => rule._id);
    const [moved] = ids.splice(from, 1);
    ids.splice(index, 0, moved);
    void commitOrder(ids, rules[from].name);
  };

  const applyAll = async () => {
    if (!workspace) return;
    const ok = await confirm({
      title: `Apply rules to ${pluralize(workspace.pendingMatches, "transaction")}?`,
      message: "Uncategorised transactions that match a rule get that rule's category and actions. You can undo this right after.",
      confirmLabel: "Apply rules",
    });
    if (!ok) return;
    try {
      undoToast(await applyRules({ societyId: society._id }));
    } catch (error: any) {
      toast.error("Could not apply rules", error?.message);
    }
  };

  const fromSuggestion = (suggestion: StarterRuleSuggestion) => {
    const draft = emptyRuleDraft();
    draft.name = `${suggestion.label}${suggestion.suggestedCategory ? ` to ${suggestion.suggestedCategory.toLowerCase()}` : ""}`;
    draft.conditions = [conditionToDraft(suggestion.condition)];
    draft.category = suggestion.suggestedCategory ?? "";
    setEditing(draft);
  };

  const summary = (rule: RuleRow) => {
    const parts: string[] = [];
    if (rule.actions.category) parts.push(`category ${rule.actions.category}`);
    if (rule.actions.accountingAccountId) parts.push(`account ${accountName(rule.actions.accountingAccountId) ?? "(removed)"}`);
    if (rule.actions.fundRestrictionId) parts.push(`fund ${fundName(rule.actions.fundRestrictionId) ?? "(removed)"}`);
    if (rule.actions.markReviewed) parts.push("mark reviewed");
    return parts.join(", ");
  };

  const suggestions = workspace?.suggestions ?? [];

  return (
    <div className="page transaction-rules-page">
      <PageHeader
        title="Transaction rules"
        icon={<Zap size={16} />}
        iconColor="green"
        subtitle="Categorise recurring transactions automatically."
        info={
          <p>
            Rules run, top to bottom, on every bank CSV import and when you apply them to uncategorised
            transactions. The first rule that matches wins, so put specific rules above broad ones.
            Transactions a rule categorised show a bolt next to their category.
          </p>
        }
        actions={
          <>
            {(workspace?.rules.length ?? 0) > 0 && (
              <button className="btn-action" type="button" disabled={!canWrite || !workspace?.pendingMatches} onClick={() => void applyAll()}>
                <Wand2 size={12} aria-hidden="true" /> Apply to uncategorised{workspace?.pendingMatches ? ` (${workspace.pendingMatches})` : ""}
              </button>
            )}
            <button className="btn-action btn-action--primary" type="button" disabled={!canWrite} onClick={() => setEditing(emptyRuleDraft())}>
              <Plus size={12} aria-hidden="true" /> New rule
            </button>
          </>
        }
      />

      {workspace === undefined ? (
        <div className="card"><div className="card__body"><div className="record-table__loading">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="record-table__loading-row" />)}</div></div></div>
      ) : rules.length === 0 ? (
        <div className="card">
          <div className="card__body">
            <EmptyState
              icon={<Zap size={20} />}
              title="Categorise recurring transactions once"
              description="A rule reads like a sentence: if the payee contains “BC Hydro” and money goes out, set the category to Utilities. Rules run on every bank import and you can apply them to what's already here."
              action={
                <button className="btn btn--accent" type="button" disabled={!canWrite} onClick={() => setEditing(emptyRuleDraft())}>
                  <Plus size={12} aria-hidden="true" /> Create a rule
                </button>
              }
            />
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card__head">
            <div>
              <h2 className="card__title">Rules</h2>
              <span className="card__subtitle">
                {workspace.uncategorizedCount > 0
                  ? `${pluralize(workspace.uncategorizedCount, "uncategorised transaction")} · ${workspace.pendingMatches} match a rule`
                  : "Every transaction has a category."}
              </span>
            </div>
          </div>
          <p className="sr-only" aria-live="polite">{announcement}</p>
          <ol className="rule-list" aria-label="Rules in priority order">
            {rules.map((rule, index) => (
              <li
                key={rule._id}
                className={`rule-row${rule.enabled ? "" : " is-disabled"}${dragId === rule._id ? " is-dragging" : ""}`}
                draggable={canWrite}
                onDragStart={(event) => {
                  setDragId(rule._id);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", rule._id);
                }}
                onDragEnd={() => setDragId(null)}
                onDragOver={(event) => { if (dragId) event.preventDefault(); }}
                onDrop={(event) => onDrop(event, index)}
              >
                <button
                  id={`rule-handle-${rule._id}`}
                  type="button"
                  className="rule-row__handle"
                  aria-label={`Reorder ${rule.name}, position ${index + 1} of ${rules.length}. Use the up and down arrow keys.`}
                  disabled={!canWrite}
                  onKeyDown={(event) => onHandleKey(event, index)}
                >
                  <GripVertical size={14} aria-hidden="true" />
                  <span className="rule-row__priority">{index + 1}</span>
                </button>
                <button type="button" className="rule-row__body" onClick={() => setEditing(draftFromRule(rule))}>
                  <span className="rule-row__name">{rule.name}</span>
                  <span className="rule-row__sentence">
                    <span className="rule-row__kw">If</span>{" "}
                    {rule.conditions.map((condition, i) => (
                      <span key={i}>
                        {i > 0 && <span className="rule-row__kw"> and </span>}
                        {describeCondition(condition, { accountName, formatCents: (cents) => formatMoney(cents) })}
                      </span>
                    ))}{" "}
                    <span className="rule-row__kw">then</span> {summary(rule) || "nothing"}
                  </span>
                  <span className="rule-row__meta">
                    {pluralize(rule.matchCount, "matching transaction")}
                    {rule.pendingCount > 0 && <> · <strong>{rule.pendingCount} to apply</strong></>}
                    {rule.lastAppliedAtISO && <> · last applied {relative(rule.lastAppliedAtISO)}</>}
                  </span>
                </button>
                <div className="rule-row__controls">
                  <Toggle
                    size="sm"
                    checked={rule.enabled}
                    disabled={!canWrite}
                    onChange={async (enabled) => {
                      try {
                        await setEnabled({ id: rule._id as any, enabled });
                        toast.success(enabled ? `${rule.name} is on` : `${rule.name} is off`);
                      } catch (error: any) {
                        toast.error("Could not update the rule", error?.message);
                      }
                    }}
                  />
                  <Menu
                    align="right"
                    trigger={
                      <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label={`Actions for ${rule.name}`}>
                        <MoreHorizontal size={14} />
                      </button>
                    }
                    sections={[{ id: "rule", items: [
                      { id: "edit", label: "Edit", icon: <Pencil size={14} />, onSelect: () => setEditing(draftFromRule(rule)) },
                      { id: "up", label: "Move up", icon: <ArrowUp size={14} />, disabled: !canWrite || index === 0, onSelect: () => move(index, -1) },
                      { id: "down", label: "Move down", icon: <ArrowDown size={14} />, disabled: !canWrite || index === rules.length - 1, onSelect: () => move(index, 1) },
                      {
                        id: "apply",
                        label: rule.pendingCount ? `Apply to ${rule.pendingCount} uncategorised` : "Nothing to apply",
                        icon: <Wand2 size={14} />,
                        disabled: !canWrite || !rule.enabled || rule.pendingCount === 0,
                        onSelect: async () => {
                          try {
                            undoToast(await applyRules({ societyId: society._id, ruleId: rule._id as any }));
                          } catch (error: any) {
                            toast.error("Could not apply the rule", error?.message);
                          }
                        },
                      },
                      {
                        id: "delete",
                        label: "Delete",
                        icon: <Trash2 size={14} />,
                        destructive: true,
                        disabled: !canWrite,
                        onSelect: async () => {
                          const ok = await confirm({
                            title: `Delete “${rule.name}”?`,
                            message: "Transactions it already categorised keep their category.",
                            confirmLabel: "Delete rule",
                            tone: "danger",
                          });
                          if (!ok) return;
                          await removeRule({ id: rule._id as any });
                          toast.success("Rule deleted");
                        },
                      },
                    ] }]}
                  />
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {workspace && suggestions.length > 0 && (
        <section className="card rule-suggestions" aria-labelledby="rule-suggestions-title">
          <div className="card__head">
            <div>
              <h2 className="card__title" id="rule-suggestions-title">Suggested rules</h2>
              <span className="card__subtitle">Frequent payees that no rule covers yet.</span>
            </div>
          </div>
          <div className="card__body rule-suggestions__grid">
            {suggestions.map((suggestion) => (
              <div key={suggestion.key} className="rule-suggestion">
                <div className="rule-suggestion__title">{suggestion.label}</div>
                <div className="rule-suggestion__meta">
                  {pluralize(suggestion.count, "transaction")}
                  {suggestion.suggestedCategory ? ` · usually ${suggestion.suggestedCategory}` : ""}
                </div>
                <button type="button" className="btn btn--sm" disabled={!canWrite} onClick={() => fromSuggestion(suggestion)}>
                  Create rule from these {suggestion.count} transactions
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {workspace && (
        <p className="muted rule-footnote">
          Rules apply to new bank lines on <Link to="/app/financials?tab=transactions">CSV import</Link>. Editing a category by hand
          always wins over a rule.
        </p>
      )}

      {editing && workspace && (
        <RuleEditorDrawer
          open
          initial={editing}
          workspace={workspace}
          societyId={society._id}
          canWrite={canWrite}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

