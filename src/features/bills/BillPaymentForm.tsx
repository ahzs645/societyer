import { useMemo, useState } from "react";
import { Landmark } from "lucide-react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../convex/_generated/dataModel";
import { usePermissionedMutation } from "../../hooks/usePermissionedMutation";
import { Field } from "../../components/ui";
import { Select } from "../../components/Select";
import { DatePicker } from "../../components/DatePicker";
import { Money } from "../../components/Money";
import { useToast } from "../../components/Toast";
import { formatDate } from "../../lib/format";
import { formatMoney, parseMoneyInput } from "../../lib/money";
import { BILL_PAYMENT_METHODS, BILL_PAYMENT_METHOD_LABEL, isBillPaymentMethod, suggestBillPayments, type BillPaymentMethod } from "../../../shared/bills";
import { errorMessage, type BillRow, type BillsWorkspace, type MoneyOutTransaction } from "./types";

type Props = {
  bill: BillRow;
  workspace: BillsWorkspace;
  /** The vendor's usual payment method, preselected. */
  defaultMethod?: string;
  canWrite: boolean;
  onDone: () => void;
  onCancel: () => void;
};

/**
 * Record a full or partial payment. Linking a money-out bank line (suggested
 * by amount, date and payee) takes its date, amount and account, marks the
 * line matched to this bill and categorises it to Accounts payable.
 */
export function BillPaymentForm({ bill, workspace, defaultMethod, canWrite, onDone, onCancel }: Props) {
  const recordPayment = usePermissionedMutation(api.bills.recordPayment, canWrite);
  const toast = useToast();
  const available = useMemo(() => workspace.transactions.filter((txn) => !txn.linkedBillId && !txn.matchedElsewhere), [workspace.transactions]);
  const suggestions = useMemo(() => suggestBillPayments(bill, available), [bill, available]);
  const top = suggestions[0]?.exact ? suggestions[0] : undefined;
  const [amountInput, setAmountInput] = useState(((top ? -top.amountCents : bill.balanceCents) / 100).toFixed(2));
  const [date, setDate] = useState(top?.date ?? workspace.today);
  const [method, setMethod] = useState<BillPaymentMethod>(isBillPaymentMethod(defaultMethod) ? defaultMethod : "eft");
  const [reference, setReference] = useState("");
  const [cashAccountId, setCashAccountId] = useState(workspace.accounts.payment[0]?._id ?? "");
  const [txnId, setTxnId] = useState(top?._id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountCents = parseMoneyInput(amountInput);
  const linked = available.find((txn) => txn._id === txnId);
  const otherOptions = available
    .filter((txn) => -txn.amountCents <= bill.balanceCents && !suggestions.some((suggestion) => suggestion._id === txn._id))
    .slice(0, 80)
    .map((txn) => ({ value: txn._id, label: `${formatDate(txn.date)} · ${formatMoney(-txn.amountCents)} · ${txn.description || txn.counterparty || "Payment"}` }));

  const pick = (txn: MoneyOutTransaction | undefined) => {
    setTxnId(txn?._id ?? "");
    if (txn) {
      setDate(txn.date);
      setAmountInput((-txn.amountCents / 100).toFixed(2));
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!amountCents || amountCents <= 0) return setError("Enter an amount above zero.");
    if (amountCents > bill.balanceCents) return setError(`That's more than the ${formatMoney(bill.balanceCents)} balance.`);
    if (linked && -linked.amountCents !== amountCents) return setError(`A linked payment must match the bank transaction (${formatMoney(-linked.amountCents)}).`);
    if (!linked && !cashAccountId) return setError("Choose the account the bill was paid from.");
    setBusy(true);
    setError(null);
    try {
      await recordPayment({
        id: bill._id as Id<"bills">,
        date,
        amountCents,
        method,
        reference: reference.trim() || undefined,
        financialTransactionId: (linked?._id || undefined) as Id<"financialTransactions"> | undefined,
        cashAccountId: linked ? undefined : (cashAccountId as Id<"financialAccounts">),
      });
      const remaining = bill.balanceCents - amountCents;
      toast.success(remaining <= 0 ? "Bill paid in full" : `Payment of ${formatMoney(amountCents)} recorded`, remaining > 0 ? `${formatMoney(remaining)} still owed.` : linked ? "The bank transaction is matched to this bill." : undefined);
      onDone();
    } catch (err) {
      setError(errorMessage(err, "Couldn't record the payment."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="pay-form" onSubmit={submit} aria-label={`Record a payment for ${bill.vendorName ?? "this bill"}`}>
      <div className="pay-form__row">
        <Field label="Amount" hint={`Balance ${formatMoney(bill.balanceCents)}. Partial payments are fine.`}>
          <input className="input input--money" inputMode="decimal" value={amountInput} onChange={(event) => setAmountInput(event.target.value)} aria-invalid={amountCents == null || undefined} />
        </Field>
        <Field label="Date paid">
          <DatePicker value={date} clearable={false} onChange={(value) => value && setDate(value)} />
        </Field>
        <Field label="Method">
          <Select<BillPaymentMethod> value={method} onChange={setMethod} options={BILL_PAYMENT_METHODS.map((value) => ({ value, label: BILL_PAYMENT_METHOD_LABEL[value] }))} />
        </Field>
        <Field label="Reference">
          <input className="input" value={reference} placeholder="Cheque no., EFT or e-transfer ref…" onChange={(event) => setReference(event.target.value)} />
        </Field>
      </div>

      <fieldset className="pay-form__bank">
        <legend><Landmark size={14} aria-hidden="true" /> Match a bank payment <span className="muted">(optional)</span></legend>
        {suggestions.length > 0 ? (
          <ul className="pay-form__suggestions">
            {suggestions.map((txn) => (
              <li key={txn._id}>
                <label className={`pay-suggestion${txnId === txn._id ? " is-selected" : ""}`}>
                  <input type="radio" name={`bill-bank-${bill._id}`} checked={txnId === txn._id} onChange={() => pick(txn)} />
                  <span className="pay-suggestion__text">
                    <span className="pay-suggestion__desc">{txn.description || txn.counterparty || "Payment"}</span>
                    <span className="muted">{formatDate(txn.date)}{txn.accountLabel ? ` · ${txn.accountLabel}` : ""}{txn.reasons.length ? ` · ${txn.reasons.join(", ")}` : ""}</span>
                  </span>
                  <Money cents={txn.amountCents} tone="out" />
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted pay-form__none">No unmatched bank payments look like this bill.</p>
        )}
        <div className="pay-form__other">
          <Select
            value={linked && !suggestions.some((suggestion) => suggestion._id === linked._id) ? linked._id : ""}
            onChange={(value) => pick(available.find((txn) => txn._id === value))}
            options={otherOptions}
            placeholder="Choose another bank payment…"
            searchable
            clearable
            clearLabel="No bank match"
            aria-label="Choose another bank payment"
          />
          {txnId && <button type="button" className="btn btn--ghost btn--sm" onClick={() => setTxnId("")}>Don't match</button>}
        </div>
      </fieldset>

      {linked ? (
        <p className="muted bill-pay__from">Paid from {linked.accountLabel ?? "the bank account of the matched payment"}.</p>
      ) : (
        <Field label="Paid from" hint="The bank, card or cash account the money left.">
          <Select value={cashAccountId} onChange={setCashAccountId} options={workspace.accounts.payment.map((account) => ({ value: account._id, label: account.label }))} placeholder="Choose account" />
        </Field>
      )}

      {error && <p className="field__error" role="alert">{error}</p>}
      <div className="pay-form__actions">
        <button type="button" className="btn btn--sm" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn--sm btn--accent" disabled={busy || !canWrite}>
          Record {amountCents ? formatMoney(amountCents) : "payment"}
        </button>
      </div>
    </form>
  );
}
