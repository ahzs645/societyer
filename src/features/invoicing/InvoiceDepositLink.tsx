import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../convex/_generated/dataModel";
import { Select } from "../../components/Select";
import { Money } from "../../components/Money";
import { useToast } from "../../components/Toast";
import { formatDate } from "../../lib/format";
import { formatMoney } from "../../lib/money";
import { suggestPaymentTransactions } from "../../../shared/invoicing";
import type { InvoicePaymentView, InvoiceRow, MoneyInTransaction } from "./types";

type Props = {
  invoice: InvoiceRow;
  payment: InvoicePaymentView;
  transactions: MoneyInTransaction[];
  onDone: () => void;
};

/**
 * Link a recorded payment to its bank deposit (or another one, or none): the
 * deposit is matched to the invoice and categorised to Accounts receivable,
 * and the payment's entry moves to the deposit's bank account.
 */
export function InvoiceDepositLink({ invoice, payment, transactions, onDone }: Props) {
  const linkDeposit = useMutation(api.invoices.linkDeposit);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const available = useMemo(() => transactions.filter((txn) => !txn.matchedElsewhere && (!txn.linkedInvoiceId || txn._id === payment.financialTransactionId)), [transactions, payment.financialTransactionId]);
  const suggestions = useMemo(
    () => suggestPaymentTransactions({ ...invoice, issueDate: invoice.issueDate, balanceCents: payment.amountCents, totalCents: payment.amountCents }, available.filter((txn) => txn._id !== payment.financialTransactionId)),
    [invoice, payment.amountCents, payment.financialTransactionId, available],
  );
  const options = available
    .filter((txn) => txn._id !== payment.financialTransactionId)
    .slice(0, 80)
    .map((txn) => ({ value: txn._id, label: `${formatDate(txn.date)} · ${formatMoney(txn.amountCents)} · ${txn.description ?? txn.counterparty ?? "Deposit"}` }));

  const link = async (transactionId?: string) => {
    setBusy(true);
    try {
      await linkDeposit({ id: invoice._id as Id<"invoices">, paymentKey: payment.key, financialTransactionId: transactionId ? (transactionId as Id<"financialTransactions">) : undefined });
      toast.success(transactionId ? "Payment linked to the deposit" : "Deposit unlinked");
      onDone();
    } catch (err) {
      toast.error("Could not change the deposit", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="invoice-deposit-link" role="group" aria-label={`Bank deposit for the ${formatMoney(payment.amountCents)} payment`}>
      {suggestions.length > 0 && (
        <ul className="pay-form__suggestions">
          {suggestions.map((txn) => (
            <li key={txn._id}>
              <button type="button" className="pay-suggestion" disabled={busy} onClick={() => void link(txn._id)}>
                <span className="pay-suggestion__text">
                  <span className="pay-suggestion__desc">{txn.description ?? txn.counterparty ?? "Deposit"}</span>
                  <span className="muted">{formatDate(txn.date)}{txn.exact ? " · matches the payment" : ""}</span>
                </span>
                <Money cents={txn.amountCents} tone="in" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="pay-form__other">
        <Select value="" onChange={(value) => value && void link(value)} options={options} placeholder="Choose a deposit…" searchable disabled={busy} aria-label="Choose a bank deposit" />
        {payment.financialTransactionId && <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void link(undefined)}>Unlink deposit</button>}
        <button type="button" className="btn btn--ghost btn--sm" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}
