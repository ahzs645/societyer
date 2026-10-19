import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { Landmark } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Field } from "../../components/ui";
import { Select } from "../../components/Select";
import { DatePicker } from "../../components/DatePicker";
import { Money } from "../../components/Money";
import { useToast } from "../../components/Toast";
import { formatDate } from "../../lib/format";
import { formatMoney, parseMoneyInput } from "../../lib/money";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, suggestPaymentTransactions } from "../../../shared/invoicing";
import type { Id } from "../../../convex/_generated/dataModel";
import type { InvoiceRow, LedgerAccountOption, MoneyInTransaction } from "./types";

type Props = {
  invoice: InvoiceRow;
  transactions: MoneyInTransaction[];
  today: string;
  /** Where an unlinked payment can be deposited in the books, and what is used when none is chosen. */
  depositAccounts: LedgerAccountOption[];
  defaultDepositLabel: string;
  onDone: () => void;
  onCancel: () => void;
};

/** Record a full or partial payment, optionally linked to a money-in bank line. */
export function RecordPaymentForm({ invoice, transactions, today, depositAccounts, defaultDepositLabel, onDone, onCancel }: Props) {
  const recordPayment = useMutation(api.invoices.recordPayment);
  const toast = useToast();
  const unlinked = useMemo(() => transactions.filter((txn) => !txn.linkedInvoiceId && !txn.matchedElsewhere), [transactions]);
  const suggestions = useMemo(() => suggestPaymentTransactions(invoice, unlinked), [invoice, unlinked]);
  const [amountInput, setAmountInput] = useState((invoice.balanceCents / 100).toFixed(2));
  const [date, setDate] = useState(suggestions[0]?.date && suggestions[0].exact ? suggestions[0].date : today);
  const [method, setMethod] = useState<string>("e_transfer");
  const [reference, setReference] = useState("");
  const [txnId, setTxnId] = useState<string>(suggestions[0]?.exact ? suggestions[0]._id : "");
  const [depositAccountId, setDepositAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountCents = parseMoneyInput(amountInput);
  const linked = unlinked.find((txn) => txn._id === txnId);
  const otherOptions = unlinked
    .filter((txn) => !suggestions.some((s) => s._id === txn._id))
    .slice(0, 60)
    .map((txn) => ({ value: txn._id, label: `${formatDate(txn.date)} · ${formatMoney(txn.amountCents)} · ${txn.description ?? txn.counterparty ?? "Deposit"}` }));

  const pick = (txn: MoneyInTransaction | undefined) => {
    setTxnId(txn?._id ?? "");
    if (txn) {
      setDate(txn.date);
      if (txn.amountCents <= invoice.balanceCents) setAmountInput((txn.amountCents / 100).toFixed(2));
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!amountCents || amountCents <= 0) return setError("Enter an amount above zero.");
    if (amountCents > invoice.balanceCents) return setError(`That's more than the ${formatMoney(invoice.balanceCents)} balance.`);
    setBusy(true);
    setError(null);
    try {
      await recordPayment({
        id: invoice._id as any,
        date,
        amountCents,
        method,
        reference: reference || undefined,
        financialTransactionId: txnId ? (txnId as Id<"financialTransactions">) : undefined,
        depositAccountId: !txnId && depositAccountId ? (depositAccountId as Id<"financialAccounts">) : undefined,
      });
      const remaining = invoice.balanceCents - amountCents;
      toast.success(remaining <= 0 ? `${invoice.number} paid in full` : `Payment of ${formatMoney(amountCents)} recorded`, remaining > 0 ? `${formatMoney(remaining)} still due.` : undefined);
      onDone();
    } catch (err: any) {
      setError(err?.message ?? "Could not record the payment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="pay-form" onSubmit={submit} aria-label={`Record a payment for ${invoice.number}`}>
      <div className="pay-form__row">
        <Field label="Amount" hint={`Balance ${formatMoney(invoice.balanceCents)}. Partial payments are fine.`}>
          <input className="input num" inputMode="decimal" value={amountInput} onChange={(e) => setAmountInput(e.target.value)} aria-invalid={amountCents == null || undefined} />
        </Field>
        <Field label="Date received">
          <DatePicker value={date} clearable={false} onChange={(value) => value && setDate(value)} />
        </Field>
        <Field label="Method">
          <Select value={method} onChange={setMethod} options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))} />
        </Field>
        <Field label="Reference">
          <input className="input" value={reference} placeholder="Cheque no., e-transfer ref…" onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>

      <fieldset className="pay-form__bank">
        <legend><Landmark size={14} aria-hidden="true" /> Link a bank deposit <span className="muted">(optional)</span></legend>
        {suggestions.length > 0 ? (
          <ul className="pay-form__suggestions">
            {suggestions.map((txn) => (
              <li key={txn._id}>
                <label className={`pay-suggestion${txnId === txn._id ? " is-selected" : ""}`}>
                  <input type="radio" name={`bank-${invoice._id}`} checked={txnId === txn._id} onChange={() => pick(txn)} />
                  <span className="pay-suggestion__text">
                    <span className="pay-suggestion__desc">{txn.description ?? txn.counterparty ?? "Deposit"}</span>
                    <span className="muted">{formatDate(txn.date)}{txn.exact ? " · matches the balance" : ""}</span>
                  </span>
                  <Money cents={txn.amountCents} tone="in" />
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted pay-form__none">No unlinked deposits match this invoice.</p>
        )}
        <div className="pay-form__other">
          <Select
            value={linked && !suggestions.some((s) => s._id === linked._id) ? linked._id : ""}
            onChange={(value) => pick(unlinked.find((txn) => txn._id === value))}
            options={otherOptions}
            placeholder="Choose another deposit…"
            searchable
            clearable
            clearLabel="No bank link"
            aria-label="Choose another bank deposit"
          />
          {txnId && <button type="button" className="btn btn--ghost btn--sm" onClick={() => setTxnId("")}>Don't link</button>}
        </div>
        {!txnId && (
          <Field label="Deposited to" hint="Without a bank deposit, the payment waits here in the books until you link one.">
            <Select
              value={depositAccountId}
              onChange={setDepositAccountId}
              options={depositAccounts.map((account) => ({ value: account._id, label: account.label }))}
              placeholder={defaultDepositLabel}
              clearable
              clearLabel={defaultDepositLabel}
            />
          </Field>
        )}
      </fieldset>

      {error && <p className="field__error" role="alert">{error}</p>}
      <div className="pay-form__actions">
        <button type="button" className="btn btn--sm" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn--sm btn--accent" disabled={busy}>
          Record {amountCents ? formatMoney(amountCents) : "payment"}
        </button>
      </div>
    </form>
  );
}
