import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useToast } from "../../../components/Toast";
import { RuleEditorDrawer } from "../rules/RuleEditorDrawer";
import { draftFromRule, type RuleDraft } from "../rules/ruleDraft";
import type { RulesWorkspace } from "../rules/types";

export type RuleDrawerApi = {
  /** The rules workspace (rules, categories, funds), once loaded. */
  workspace: RulesWorkspace | undefined;
  /** Open the rule editor over the current page with a prefilled draft. */
  openDraft: (draft: RuleDraft) => void;
  /** Open an existing rule; `patch` changes the draft (e.g. a new category). Returns false when the rule is gone. */
  editRule: (ruleId: string, patch?: Partial<RuleDraft>) => boolean;
  /** Delete a rule, with an Undo toast that puts it back in the same place. */
  deleteRule: (ruleId: string) => Promise<void>;
  canWrite: boolean;
};

const RuleDrawerContext = createContext<RuleDrawerApi | null>(null);

/** The in-place rule editor, when the page provides one (Financials does). */
export function useRuleDrawer(): RuleDrawerApi | null {
  return useContext(RuleDrawerContext);
}

/**
 * Owns the transaction-rule editor drawer for a page, so rules can be created
 * or edited where the work happens (the transactions table, its panel, the
 * bulk island and the provenance popover) instead of on the rules page.
 */
export function useRuleDrawerHost(societyId: string | undefined, canWrite: boolean) {
  const workspace = useQuery(api.transactionRules.workspace, societyId ? { societyId: societyId as any } : "skip") as RulesWorkspace | undefined;
  const upsert = useMutation(api.transactionRules.upsert);
  const remove = useMutation(api.transactionRules.remove);
  const reorder = useMutation(api.transactionRules.reorder);
  const toast = useToast();
  const [draft, setDraft] = useState<RuleDraft | null>(null);

  const openDraft = useCallback((next: RuleDraft) => setDraft(next), []);
  const editRule = useCallback(
    (ruleId: string, patch?: Partial<RuleDraft>) => {
      const rule = workspace?.rules.find((row) => row._id === ruleId);
      if (!rule) return false;
      setDraft({ ...draftFromRule(rule), ...patch });
      return true;
    },
    [workspace],
  );

  const deleteRule = useCallback(
    async (ruleId: string) => {
      if (!societyId || !workspace) return;
      const rule = workspace.rules.find((row) => row._id === ruleId);
      if (!rule) return;
      const order = workspace.rules.map((row) => row._id);
      try {
        await remove({ id: ruleId as any });
      } catch (error: any) {
        toast.error("Could not delete the rule", error?.message);
        return;
      }
      toast.success(`Deleted rule “${rule.name}”`, {
        description: "Lines it already categorised keep their category.",
        duration: 10_000,
        action: {
          label: "Undo",
          onClick: () => {
            void (async () => {
              try {
                const newId = await upsert({
                  societyId: societyId as any,
                  name: rule.name,
                  enabled: rule.enabled,
                  conditions: rule.conditions as any,
                  actions: rule.actions as any,
                });
                // Put the rule back at its old priority.
                const orderedIds = order.map((id) => (id === ruleId ? String(newId) : id));
                await reorder({ societyId: societyId as any, orderedIds: orderedIds as any }).catch(() => undefined);
                toast.info(`Restored rule “${rule.name}”`);
              } catch (error: any) {
                toast.error("Could not restore the rule", error?.message);
              }
            })();
          },
        },
      });
    },
    [remove, reorder, societyId, toast, upsert, workspace],
  );

  const api_ = useMemo<RuleDrawerApi>(
    () => ({ workspace, openDraft, editRule, deleteRule, canWrite }),
    [workspace, openDraft, editRule, deleteRule, canWrite],
  );

  // The rules batch may add an `initialDraft` prop for prefilled new rules;
  // `initial` already accepts any draft, so it opens prefilled either way.
  const element =
    societyId && workspace ? (
      <RuleEditorDrawer
        open={draft !== null}
        initial={draft}
        workspace={workspace}
        societyId={societyId}
        canWrite={canWrite}
        onClose={() => setDraft(null)}
      />
    ) : null;

  return { api: api_, element };
}

export function RuleDrawerProvider({ value, children }: { value: RuleDrawerApi; children: ReactNode }) {
  return <RuleDrawerContext.Provider value={value}>{children}</RuleDrawerContext.Provider>;
}
