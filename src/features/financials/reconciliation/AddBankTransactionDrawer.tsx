import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { Drawer, Field } from "../../../components/ui";
import { Select } from "../../../components/Select";
import { DatePicker } from "../../../components/DatePicker";
import { useToast } from "../../../components/Toast";
import { todayDateOnly } from "../../../../shared/dateOnly";

const emptyForm = () => ({ date: todayDateOnly(), description: "", amountDollars: "", direction: "out" as "in" | "out", counterparty: "", category: "" });

/** Record a bank line by hand so it can be reconciled when no Wave or browser-connector sync is set up. */
export function AddBankTransactionDrawer({ open, societyId, canWrite, onClose }: { open: boolean; societyId: string; canWrite: boolean; onClose: () => void }) {
  const addManualTxn = useMutation(api.reconciliation.addManualTransaction);
  const toast = useToast();
  const [txnForm, setTxnForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const saveManualTxn = async () => {
    // A second click while the first save runs would add the line twice.
    if (savingRef.current) return;
    const dollars = Number(txnForm.amountDollars);
    if (!txnForm.description.trim() || !Number.isFinite(dollars) || dollars <= 0) {
      toast.warn("Enter a description and a positive amount");
      return;
    }
    const cents = Math.round(dollars * 100) * (txnForm.direction === "out" ? -1 : 1);
    savingRef.current = true;
    setSaving(true);
    try {
      await addManualTxn({
        societyId,
        date: txnForm.date,
        description: txnForm.description.trim(),
        amountCents: cents,
        counterparty: txnForm.counterparty.trim() || undefined,
        category: txnForm.category.trim() || undefined,
      });
    } catch (error) {
      toast.error("Could not add the transaction", error instanceof Error ? error.message : undefined);
      return;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    toast.success("Transaction added");
    onClose();
    setTxnForm(emptyForm());
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Add bank transaction"
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--accent" onClick={() => void saveManualTxn()} disabled={!canWrite || saving} aria-busy={saving || undefined}>
            {saving ? "Adding…" : "Add transaction"}
          </button>
        </>
      }
    >
      <div className="muted" style={{ marginBottom: 12, fontSize: "var(--fs-sm)" }}>
        Manually record a bank line so it can be reconciled when no Wave/browser-connector sync is configured.
      </div>
      <Field label="Date"><DatePicker value={txnForm.date} onChange={(v) => setTxnForm({ ...txnForm, date: v })} /></Field>
      <Field label="Description"><input className="input" value={txnForm.description} onChange={(e) => setTxnForm({ ...txnForm, description: e.target.value })} /></Field>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Direction">
          <Select
            value={txnForm.direction}
            onChange={(v) => setTxnForm({ ...txnForm, direction: v as "in" | "out" })}
            options={[{ value: "out", label: "Money out" }, { value: "in", label: "Money in" }]}
          />
        </Field>
        <Field label="Amount"><input className="input" type="number" min="0" step="0.01" value={txnForm.amountDollars} onChange={(e) => setTxnForm({ ...txnForm, amountDollars: e.target.value })} /></Field>
      </div>
      <Field label="Counterparty"><input className="input" value={txnForm.counterparty} onChange={(e) => setTxnForm({ ...txnForm, counterparty: e.target.value })} placeholder="e.g. BC Registries, a donor, a vendor" /></Field>
      <Field label="Category"><input className="input" value={txnForm.category} onChange={(e) => setTxnForm({ ...txnForm, category: e.target.value })} placeholder="Optional" /></Field>
    </Drawer>
  );
}
