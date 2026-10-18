import { useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { Modal } from "../../../components/Modal";
import { Field } from "../../../components/ui";
import { Segmented } from "../../../components/primitives";
import { useToast } from "../../../components/Toast";
import { pluralize } from "../../../lib/format";
import {
  countPayeeAliasMatches,
  payeeAliasMatches,
  validatePayeeAlias,
  type PayeeAliasMatchType,
} from "../../../../shared/payeeAliases";
import { transactionPayee, type RuleTransaction } from "../../../../shared/transactionRules";
import type { PayeeAliasRow } from "./usePayeeAliases";

export type PayeeRenameTarget = {
  /** The raw payee to rename (counterparty, or the bank description). */
  rawPayee: string;
  /** An existing rename rule to edit instead of creating one. */
  alias?: PayeeAliasRow;
};

/**
 * "Rename payee for all past and future transactions": match the raw bank
 * payee exactly or by contained text, choose the name to show, and preview
 * how many existing lines it renames before saving.
 */
export function PayeeRenameDialog({
  target,
  societyId,
  transactions,
  canWrite,
  onClose,
}: {
  target: PayeeRenameTarget | null;
  societyId: string;
  transactions: readonly RuleTransaction[];
  canWrite: boolean;
  onClose: () => void;
}) {
  const upsert = useMutation(api.payeeAliases.upsert);
  const remove = useMutation(api.payeeAliases.remove);
  const toast = useToast();
  const [match, setMatch] = useState("");
  const [matchType, setMatchType] = useState<PayeeAliasMatchType>("exact");
  const [displayName, setDisplayName] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!target) return;
    setMatch(target.alias?.match ?? target.rawPayee);
    setMatchType(target.alias?.matchType ?? "exact");
    setDisplayName(target.alias?.displayName ?? "");
    setErrors([]);
  }, [target]);

  const draft = useMemo(() => ({ match, matchType, displayName }), [match, matchType, displayName]);
  const count = useMemo(() => (match.trim() ? countPayeeAliasMatches(draft, transactions) : 0), [draft, match, transactions]);
  const samples = useMemo(() => {
    if (!match.trim()) return [];
    const seen = new Set<string>();
    for (const txn of transactions) {
      const raw = transactionPayee(txn);
      if (payeeAliasMatches(draft, raw)) seen.add(raw);
      if (seen.size >= 4) break;
    }
    return [...seen];
  }, [draft, match, transactions]);

  if (!target) return null;

  const save = async () => {
    const problems = validatePayeeAlias(draft);
    setErrors(problems);
    if (problems.length) return;
    setSaving(true);
    try {
      const id = await upsert({
        id: target.alias?._id as any,
        societyId: societyId as any,
        match: match.trim(),
        matchType,
        displayName: displayName.trim(),
      });
      const previous = target.alias;
      toast.success(count > 0 ? `Renamed ${pluralize(count, "transaction")} to ${displayName.trim()}` : `Saved the payee name ${displayName.trim()}`, {
        description: count > 0 ? "New imports from this payee get the new name too." : "New imports from this payee get the new name.",
        duration: 10_000,
        action: {
          label: "Undo",
          onClick: () => {
            const undo = previous
              ? upsert({ id: previous._id as any, societyId: societyId as any, match: previous.match, matchType: previous.matchType, displayName: previous.displayName })
              : remove({ id: id as any });
            void Promise.resolve(undo)
              .then(() => toast.info("Payee name restored"))
              .catch((error: any) => toast.error("Could not undo", error?.message));
          },
        },
      });
      onClose();
    } catch (error: any) {
      toast.error("Could not rename the payee", error?.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={target.alias ? "Edit payee name" : "Rename payee"}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn--accent" disabled={!canWrite || saving} onClick={() => void save()}>
            {target.alias ? "Save name" : "Rename payee"}
          </button>
        </>
      }
    >
      <div className="payee-rename">
        <p className="payee-rename__lede">Show this payee under a clearer name in every past and future transaction. The bank description stays as it is.</p>
        <Field label="When the payee">
          <div className="payee-rename__match">
            <Segmented
              value={matchType}
              onChange={setMatchType}
              items={[{ id: "exact", label: "is exactly" }, { id: "contains", label: "contains" }]}
            />
            <input className="input" aria-label="Payee text to match" value={match} onChange={(event) => setMatch(event.target.value)} />
          </div>
        </Field>
        <Field label="Show it as" required>
          <input
            className="input"
            value={displayName}
            placeholder="e.g. Noor Ahmadi"
            autoFocus
            onChange={(event) => setDisplayName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                // Held or repeated Enter while saving would add the rename twice.
                if (!event.repeat && !saving) void save();
              }
            }}
          />
        </Field>
        <div className="payee-rename__preview" role="status" aria-live="polite">
          {match.trim() ? (
            <>
              <strong>{count === 0 ? "No existing transactions match" : `Renames ${pluralize(count, "existing transaction")}`}</strong>
              {samples.length > 0 && (
                <ul className="payee-rename__samples">
                  {samples.map((sample) => <li key={sample}>{sample}</li>)}
                </ul>
              )}
            </>
          ) : (
            <span className="muted">Enter the payee text to see which transactions it renames.</span>
          )}
        </div>
        {errors.length > 0 && (
          <div className="payee-rename__errors" role="alert">
            {errors.map((error) => <div key={error}>{error}</div>)}
          </div>
        )}
      </div>
    </Modal>
  );
}
