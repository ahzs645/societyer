import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "@/lib/convexApi";
import { Drawer, Field } from "../../../components/ui";
import { Select } from "../../../components/Select";
import { DatePicker } from "../../../components/DatePicker";
import { useToast } from "../../../components/Toast";
import { DocumentPreviewByIdButton } from "../../../components/DocumentFilePreview";
import { formatMoney } from "../../../lib/money";
import { todayDateOnly } from "../../../../shared/dateOnly";
import { convertExpense, parseExpenseAmount } from "../../../../shared/expenseCurrency";
import type { InboxItem } from "../receipts/types";
import type { BankAccountsOverview } from "../banking/types";
import type { CardRow } from "../../businessRegisters/types";

function initialForm(receipt?: InboxItem) {
  const currency = receipt?.currency ?? "CAD";
  return {
    date: receipt?.date ?? todayDateOnly(),
    description: receipt?.merchant ? `${receipt.merchant} expense` : "",
    amount: receipt?.amountCents === undefined ? "" : (receipt.amountCents / 100).toFixed(2),
    currency,
    direction: "out" as "in" | "out",
    counterparty: receipt?.merchant ?? "",
    category: "",
    accountId: "",
    convert: false,
    targetCurrency: currency === "CAD" ? "" : "CAD",
    rate: "",
    memo: "",
  };
}

export function AddBankTransactionDrawer({
  open, societyId, canWrite, expense = false, receipt, onClose, onSaved,
}: {
  open: boolean;
  societyId: string;
  canWrite: boolean;
  expense?: boolean;
  receipt?: InboxItem;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const addManualTxn = useMutation(api.reconciliation.addManualTransaction);
  const accounts = useQuery(api.bankAccounts.overview, open ? { societyId } : "skip") as BankAccountsOverview | undefined;
  const cardWorkspace = useQuery(api.corporateCards.workspace, open && receipt ? { societyId } : "skip") as { cards: CardRow[] } | undefined;
  const toast = useToast();
  const [form, setForm] = useState(() => initialForm(receipt));
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));
  const amount = parseExpenseAmount(form.amount);
  const signed = amount === undefined ? 0 : form.direction === "out" ? -amount : amount;
  const conversion = form.convert ? { currency: form.targetCurrency, rate: form.rate } : undefined;
  let preview: ReturnType<typeof convertExpense> | undefined;
  let validation: string | undefined;
  try {
    preview = convertExpense(signed, form.currency, conversion);
  } catch (error) {
    validation = error instanceof Error ? error.message : "Check the amount and currencies.";
  }
  const recordedCurrency = (form.convert ? form.targetCurrency : form.currency).trim().toUpperCase();
  const matchingAccounts = (accounts?.rows ?? []).filter((account) => !account.archived && account.currency === recordedCurrency && (!receipt || account.accountType.toLowerCase() === "credit"));
  const matchingCards = (cardWorkspace?.cards ?? []).filter((card) => card.status === "active" && matchingAccounts.some((account) => account._id === card.financialAccountId));
  const selectedCard = matchingCards.find((card) => card._id === form.accountId);
  const selectedAccount = selectedCard?.financialAccountId ?? (matchingAccounts.some((account) => account._id === form.accountId) ? form.accountId : "");
  const accountOptions = [
    ...matchingCards.map((card) => ({ value: card._id, label: `${card.nickname ?? card.issuer} ••${card.last4}` })),
    ...matchingAccounts.filter((account) => !matchingCards.some((card) => card.financialAccountId === account._id)).map((account) => ({ value: account._id, label: account.name })),
  ];

  const close = () => {
    if (savingRef.current) return;
    setForm(initialForm(receipt));
    onClose();
  };

  const saveManualTxn = async () => {
    if (!canWrite || savingRef.current) return;
    if (validation || !form.description.trim() || !form.date) {
      toast.warn(validation ?? "Enter a date and description.");
      return;
    }
    if (receipt && !selectedAccount) {
      toast.warn("Choose the company credit card that paid this expense.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    let id: string;
    try {
      id = await addManualTxn({
        societyId,
        date: form.date,
        description: form.description.trim(),
        amountCents: signed,
        currency: form.currency,
        conversion,
        accountId: selectedAccount || undefined,
        counterparty: form.counterparty.trim() || undefined,
        category: form.category.trim() || undefined,
        receiptInboxItemId: receipt?._id,
        corporateCardId: selectedCard?._id,
        memo: form.memo.trim() || undefined,
      });
    } catch (error) {
      toast.error(expense ? "Could not record the expense" : "Could not add the transaction", error instanceof Error ? error.message : undefined);
      return;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    toast.success(expense ? "Expense recorded" : "Transaction added");
    close();
    onSaved?.(id);
  };

  return (
    <Drawer
      open={open}
      onClose={close}
      title={receipt ? "Record company card charge" : expense ? "Record expense" : "Add bank transaction"}
      footer={
        <>
          <button className="btn" type="button" onClick={close} disabled={saving}>Cancel</button>
          <button className="btn btn--accent" type="button" onClick={() => void saveManualTxn()} disabled={!canWrite || saving} aria-busy={saving || undefined}>
            {saving ? "Saving…" : expense ? "Record expense" : "Add transaction"}
          </button>
        </>
      }
    >
      {receipt && <>
        <p className="muted">Receipt: {receipt.fileName}{receipt.candidates.length > 0 ? " If the payment is already listed in the inbox suggestions, match it there instead of recording it again." : ""}</p>
        <DocumentPreviewByIdButton documentId={receipt.documentId} label="Preview receipt" />
      </>}
      <Field label="Date" required><DatePicker value={form.date} onChange={(date) => set({ date })} /></Field>
      <Field label="Description" required><input className="input" value={form.description} onChange={(event) => set({ description: event.target.value })} /></Field>
      {!expense && <Field label="Direction">
        <Select value={form.direction} onChange={(direction) => set({ direction: direction as "in" | "out" })}
          options={[{ value: "out", label: "Money out" }, { value: "in", label: "Money in" }]} />
      </Field>}
      <div className="row" style={{ gap: 12 }}>
        <Field label="Original amount" required><input className="input" inputMode="decimal" value={form.amount} onChange={(event) => set({ amount: event.target.value })} placeholder="0.00" /></Field>
        <Field label="Original currency" hint="Three-letter code" required><input className="input" maxLength={3} autoCapitalize="characters" value={form.currency} onChange={(event) => set({ currency: event.target.value.toUpperCase(), accountId: "" })} /></Field>
      </div>
      <label className="field__label">
        <input type="checkbox" checked={form.convert} onChange={(event) => set({ convert: event.target.checked, accountId: "" })} /> Convert to another currency
      </label>
      {form.convert && (
        <>
          <div className="row" style={{ gap: 12 }}>
            <Field label="Convert to" required><input className="input" maxLength={3} autoCapitalize="characters" value={form.targetCurrency} onChange={(event) => set({ targetCurrency: event.target.value.toUpperCase(), accountId: "" })} /></Field>
            <Field label="Exchange rate" hint={`1 ${form.currency || "original unit"} = this many ${form.targetCurrency || "destination units"}`} required>
              <input className="input" inputMode="decimal" value={form.rate} onChange={(event) => set({ rate: event.target.value })} placeholder="e.g. 1.375" />
            </Field>
          </div>
          {preview && <p className="muted" role="status">Recorded amount: {formatMoney(Math.abs(preview.amountCents), { currency: preview.currency })} {preview.currency}. The original amount and rate stay on the transaction.</p>}
        </>
      )}
      <Field label={receipt ? "Company card" : "Payment account"} hint={receipt ? "Use the currency on the card statement. Enter a conversion if it differs from the receipt." : `Leave blank to use manual entries in ${recordedCurrency || "the recorded currency"}.`}>
        <Select value={selectedAccount ? form.accountId : ""} onChange={(accountId) => set({ accountId })} options={[{ value: "", label: receipt ? "Choose a card" : "Manual entries" }, ...accountOptions]} />
      </Field>
      {receipt && accounts && !accountOptions.length && <p className="muted">No company credit card account in {recordedCurrency || "this currency"}. <Link to="/app/corporate-cards">Manage credit cards</Link></p>}
      <Field label={expense ? "Merchant" : "Counterparty"}><input className="input" value={form.counterparty} onChange={(event) => set({ counterparty: event.target.value })} /></Field>
      <Field label="Category"><input className="input" value={form.category} onChange={(event) => set({ category: event.target.value })} placeholder={expense ? "e.g. Web hosting" : "Optional"} /></Field>
      {expense && <Field label="Memo"><textarea className="input" rows={3} value={form.memo} onChange={(event) => set({ memo: event.target.value })} /></Field>}
    </Drawer>
  );
}
