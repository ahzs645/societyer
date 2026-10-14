import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowRight, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useFinancePermissions } from "@/hooks/useFinancePermissions";
import { useToast } from "../../../components/Toast";
import { pluralize } from "../../../lib/format";
import { PAYEE_ALIAS_MATCH_LABELS, countPayeeAliasMatches } from "../../../../shared/payeeAliases";
import type { RulesWorkspace } from "../rules/types";
import { PayeeRenameDialog, type PayeeRenameTarget } from "./PayeeRenameDialog";
import { usePayeeAliases } from "./usePayeeAliases";

/**
 * "Payee names" on the transaction rules page: the rename rules that show raw
 * bank payees under clearer names, with how many lines each renames.
 */
export function PayeeNamesSection({ societyId }: { societyId: string }) {
  const { canWrite } = useFinancePermissions();
  const { aliases, loaded } = usePayeeAliases(societyId);
  const workspace = useQuery(api.transactionRules.workspace, { societyId: societyId as any }) as RulesWorkspace | undefined;
  const upsert = useMutation(api.payeeAliases.upsert);
  const remove = useMutation(api.payeeAliases.remove);
  const toast = useToast();
  const [target, setTarget] = useState<PayeeRenameTarget | null>(null);
  const transactions = useMemo(() => workspace?.transactions ?? [], [workspace?.transactions]);

  if (!loaded) return null;

  const removeAlias = async (alias: (typeof aliases)[number]) => {
    try {
      await remove({ id: alias._id as any });
      toast.success(`Removed the name “${alias.displayName}”`, {
        duration: 10_000,
        action: {
          label: "Undo",
          onClick: () => {
            void upsert({ societyId: societyId as any, match: alias.match, matchType: alias.matchType, displayName: alias.displayName })
              .then(() => toast.info("Payee name restored"))
              .catch((error: any) => toast.error("Could not undo", error?.message));
          },
        },
      });
    } catch (error: any) {
      toast.error("Could not remove the payee name", error?.message);
    }
  };

  return (
    <section className="card payee-names" aria-labelledby="payee-names-title">
      <div className="card__head">
        <div>
          <h2 className="card__title" id="payee-names-title">Payee names</h2>
          <span className="card__subtitle">Show bank payees under clearer names in every past and future transaction.</span>
        </div>
        <button type="button" className="btn btn--sm" disabled={!canWrite} onClick={() => setTarget({ rawPayee: "" })}>
          <Plus size={12} aria-hidden="true" /> Rename a payee
        </button>
      </div>
      {aliases.length === 0 ? (
        <p className="card__body muted payee-names__empty">
          No payee names yet. Open a transaction and choose “Rename payee”, or add one here.
        </p>
      ) : (
        <ul className="payee-names__list">
          {aliases.map((alias) => (
            <li key={alias._id} className="payee-names__row">
              <div className="payee-names__rule">
                <span className="payee-names__match">
                  <span className="muted">Payee {PAYEE_ALIAS_MATCH_LABELS[alias.matchType]}</span> “{alias.match}”
                </span>
                <ArrowRight size={14} aria-hidden="true" className="payee-names__arrow" />
                <strong className="payee-names__display">{alias.displayName}</strong>
              </div>
              <span className="muted payee-names__count">{pluralize(countPayeeAliasMatches(alias, transactions), "transaction")}</span>
              <div className="payee-names__actions">
                <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label={`Edit the name ${alias.displayName}`} disabled={!canWrite} onClick={() => setTarget({ rawPayee: alias.match, alias })}>
                  <Pencil size={14} />
                </button>
                <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label={`Remove the name ${alias.displayName}`} disabled={!canWrite} onClick={() => void removeAlias(alias)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <PayeeRenameDialog target={target} societyId={societyId} transactions={transactions} canWrite={canWrite} onClose={() => setTarget(null)} />
    </section>
  );
}
