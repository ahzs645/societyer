import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { Modal } from "../../components/Modal";
import { Checkbox } from "../../components/Controls";
import { EmptyState } from "../../components/ui";
import { Money } from "../../components/Money";
import { useUndoableAction } from "../../hooks/useUndoableAction";
import { formatDate, pluralize } from "../../lib/format";
import type { DuesCandidate } from "./types";

type Props = {
  open: boolean;
  onClose: () => void;
  candidates: DuesCandidate[];
  societyId: string;
  monthLabel: string;
  onOpenInvoice: (id: string) => void;
};

/**
 * Preview and create draft dues invoices for memberships renewing this
 * month, priced from each member's fee tier. Creating offers Undo, which
 * removes the drafts again (and gives their numbers back).
 */
export function DuesGeneratorModal({ open, onClose, candidates, societyId, monthLabel, onOpenInvoice }: Props) {
  const generate = useMutation(api.invoices.generateDuesInvoices);
  const undoBatch = useMutation(api.invoices.undoDuesBatch);
  const undoable = useUndoableAction();
  const fresh = useMemo(() => candidates.filter((c) => !c.existingInvoiceId), [candidates]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(fresh.map((c) => c.subscriptionId)));
  const [busy, setBusy] = useState(false);

  const chosen = fresh.filter((c) => selected.has(c.subscriptionId));
  const total = chosen.reduce((sum, c) => sum + c.priceCents, 0);
  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const create = async () => {
    if (!chosen.length) return;
    setBusy(true);
    let batch = "";
    const ok = await undoable({
      message: `${pluralize(chosen.length, "dues draft")} created`,
      description: "Review them in Drafts, then mark them as sent.",
      run: async () => {
        const result: any = await generate({ societyId: societyId as any, subscriptionIds: chosen.map((c) => c.subscriptionId) as any });
        batch = result.batch;
        if (!result.created) throw new Error("Those renewals already have invoices.");
      },
      undo: async () => {
        if (batch) await undoBatch({ societyId: societyId as any, batch });
      },
      undoneMessage: "Dues drafts removed",
      duration: 12000,
    });
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Dues invoices for ${monthLabel} renewals`}
      size="lg"
      footer={
        <>
          <span className="muted dues-modal__total">{chosen.length ? <>{pluralize(chosen.length, "draft")} · <Money cents={total} /></> : "Nothing selected"}</span>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn--accent" disabled={busy || !chosen.length} onClick={() => void create()}>
            Create {chosen.length ? pluralize(chosen.length, "draft") : "drafts"}
          </button>
        </>
      }
    >
      {candidates.length === 0 ? (
        <EmptyState title="No renewals this month" description="Memberships with a renewal date this month appear here, priced from their fee tier." variant="caught-up" />
      ) : (
        <>
          <p className="muted dues-modal__intro">
            Drafts are dated today and priced from each member's fee tier on the renewal date. Nothing is sent until you mark the invoices as sent.
          </p>
          <ul className="dues-list">
            {candidates.map((candidate) => {
              const done = Boolean(candidate.existingInvoiceId);
              return (
                <li key={candidate.subscriptionId} className={`dues-list__row${done ? " is-done" : ""}`}>
                  {done ? (
                    <span className="dues-list__check" aria-hidden="true" />
                  ) : (
                    <span className="dues-list__check">
                      <Checkbox bare checked={selected.has(candidate.subscriptionId)} onChange={() => toggle(candidate.subscriptionId)} ariaLabel={`Bill ${candidate.name}`} />
                    </span>
                  )}
                  <span className="dues-list__main">
                    <span className="dues-list__name">{candidate.name}</span>
                    <span className="muted">{candidate.planName} · renews {formatDate(candidate.renewalDate)}{candidate.email ? "" : " · no email"}</span>
                  </span>
                  {done ? (
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => onOpenInvoice(candidate.existingInvoiceId!)}>{candidate.existingInvoiceNumber}</button>
                  ) : (
                    <Money cents={candidate.priceCents} currency={candidate.currency} />
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Modal>
  );
}
