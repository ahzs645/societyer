import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { Field } from "../../components/ui";
import { Select } from "../../components/Select";
import { Money } from "../../components/Money";
import { parseMoneyInput } from "../../lib/money";
import { formatDate } from "../../lib/format";
import { useToast } from "../../components/Toast";
import { errorMessage, type BillRow, type BillsWorkspace } from "./types";

type AdjustmentKind = "credit" | "write_off" | "refund";
const KIND_LABELS = { credit: "Vendor credit", write_off: "Write-off", refund: "Vendor refund" };

export function BillAdjustments({ bill, workspace, canWrite }: { bill: BillRow; workspace: BillsWorkspace; canWrite: boolean }) {
  const record = useMutation(api.bills.recordAdjustment), reverse = useMutation(api.bills.reverseAdjustment), toast = useToast();
  const [open, setOpen] = useState(false), [kind, setKind] = useState<AdjustmentKind>("credit");
  const [amount, setAmount] = useState(""), [date, setDate] = useState(workspace.today), [reason, setReason] = useState(""), [reference, setReference] = useState("");
  const [accountId, setAccountId] = useState(bill.lines[0]?.accountId ?? ""), [cashAccountId, setCashAccountId] = useState(""), [sourceKey, setSourceKey] = useState("");
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID()), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [reverseKey, setReverseKey] = useState(""), [reverseDate, setReverseDate] = useState(workspace.today), [reverseReason, setReverseReason] = useState("");
  const allowsAdjustment = ["approved", "scheduled"].includes(bill.lifecycle);
  const adjustments = bill.payments.filter((payment) => payment.kind && payment.kind !== "payment");
  const sources = bill.payments.filter((payment) => (!payment.kind || payment.kind === "payment") && !payment.reversedDate).map((payment) => ({
    ...payment, refundableCents: payment.amountCents + bill.payments.filter((refund) => refund.kind === "refund" && refund.sourcePaymentKey === payment.key && !refund.reversedDate).reduce((sum, refund) => sum + refund.amountCents, 0),
  })).filter((payment) => payment.refundableCents > 0);
  const paymentAccounts = workspace.accounts.payment.filter((account) => !account.currency || account.currency === bill.currency);
  const adjustmentAccounts = (workspace.accounts.adjustment ?? workspace.accounts.expense).filter((account) => !account.currency || account.currency === bill.currency);
  const money = (cents: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: bill.currency }).format(cents / 100);
  const chooseSource = (key: string) => {
    setSourceKey(key);
    const source = sources.find((payment) => payment.key === key);
    setCashAccountId(paymentAccounts.some((account) => account._id === source?.cashAccountId) ? source!.cashAccountId! : paymentAccounts[0]?._id ?? "");
  };
  const start = () => {
    setOpen(true); setError(""); setRequestKey(crypto.randomUUID()); setAmount(""); setReason(""); setReference("");
    setKind(bill.balanceCents > 0 ? "credit" : "refund"); chooseSource(sources[0]?.key ?? "");
    if (!adjustmentAccounts.some((account) => account._id === accountId)) setAccountId(adjustmentAccounts[0]?._id ?? "");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const amountCents = parseMoneyInput(amount);
      if (!amountCents || amountCents <= 0) throw new Error("Enter an amount above zero.");
      if (!reason.trim()) throw new Error("Explain the adjustment.");
      if (kind === "refund" ? !sourceKey || !cashAccountId : !accountId) throw new Error(kind === "refund" ? "Choose the original payment and the account receiving its refund." : "Choose the adjustment account.");
      await record({ id: bill._id, kind, date, amountCents, reason, reference: reference || undefined, idempotencyKey: requestKey,
        adjustmentAccountId: kind === "refund" ? undefined : accountId,
        sourcePaymentKey: kind === "refund" ? sourceKey : undefined,
        cashAccountId: kind === "refund" ? cashAccountId : undefined });
      toast.success("Vendor adjustment recorded"); setOpen(false); setAmount(""); setReason(""); setRequestKey(crypto.randomUUID());
    } catch (error) { setError(errorMessage(error, "Could not record adjustment.")); }
    finally { setBusy(false); }
  };
  const postReversal = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try { await reverse({ id: bill._id, paymentKey: reverseKey, date: reverseDate, reason: reverseReason }); toast.success("Vendor adjustment reversed"); setReverseKey(""); }
    catch (error) { setError(errorMessage(error, "Could not reverse adjustment.")); }
    finally { setBusy(false); }
  };
  return <section className="claim-drawer__section" aria-label="Vendor credits and refunds">
    <h3>Vendor credits and refunds</h3>
    <p className="muted">Credits and write-offs settle the bill without cash. A vendor refund returns a recorded payment and reopens that amount. Each adjustment retains its reason and dated ledger entries.</p>
    {adjustments.map((payment) => <div className="form-stack" key={payment.key} data-testid="bill-adjustment">
      <p><strong>{KIND_LABELS[payment.kind as AdjustmentKind]}</strong> · {formatDate(payment.date)} · <Money cents={payment.amountCents} currency={bill.currency} />{payment.reversedDate ? ` · Reversed ${formatDate(payment.reversedDate)}` : ""}</p>
      <p className="muted">{payment.note}{payment.reference ? ` · ${payment.reference}` : ""}{payment.cashAccountLabel ? ` · received into ${payment.cashAccountLabel}` : ""}</p>
      {canWrite && allowsAdjustment && !payment.reversedDate && <button className="btn btn--sm" disabled={busy} onClick={() => { setReverseKey(payment.key); setReverseDate(payment.date > workspace.today ? payment.date : workspace.today); setReverseReason(""); setError(""); setOpen(false); }}>Reverse adjustment</button>}
    </div>)}
    {canWrite && allowsAdjustment && (bill.balanceCents > 0 || sources.length > 0) && !open && !reverseKey && <button className="btn btn--sm" onClick={start}>Add vendor adjustment</button>}
    {open && canWrite && allowsAdjustment && <form className="form-stack" aria-label="Record vendor adjustment" onSubmit={submit}>
      <Field label="Adjustment type"><Select value={kind} onChange={(value) => setKind(value as AdjustmentKind)} options={[...(bill.balanceCents > 0 ? [{ value: "credit", label: KIND_LABELS.credit }, { value: "write_off", label: KIND_LABELS.write_off }] : []), ...(sources.length ? [{ value: "refund", label: KIND_LABELS.refund }] : [])]} /></Field>
      <Field label="Adjustment amount" hint={kind === "refund" ? `Available to refund: ${money(sources.find((payment) => payment.key === sourceKey)?.refundableCents ?? 0)}` : `Open bill balance: ${money(bill.balanceCents)}`}><input className="input" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
      <Field label="Adjustment date"><input type="date" className="input" value={date} min={bill.billDate} onChange={(event) => setDate(event.target.value)} /></Field>
      {kind === "refund" ? <><Field label="Original vendor payment"><Select value={sourceKey} onChange={chooseSource} options={sources.map((payment) => ({ value: payment.key, label: `${payment.date} · ${money(payment.amountCents)} · ${money(payment.refundableCents)} refundable` }))} /></Field><Field label="Refund received into"><Select value={cashAccountId} onChange={setCashAccountId} options={paymentAccounts.map((account) => ({ value: account._id, label: account.label }))} /></Field></> : <Field label="Adjustment account"><Select value={accountId} onChange={setAccountId} options={adjustmentAccounts.map((account) => ({ value: account._id, label: account.label }))} /></Field>}
      <Field label="Adjustment reference"><input className="input" maxLength={100} value={reference} onChange={(event) => setReference(event.target.value)} /></Field>
      <Field label="Adjustment reason"><textarea className="input textarea" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} /></Field>
      <div className="pay-form__actions"><button className="btn" type="button" disabled={busy} onClick={() => setOpen(false)}>Cancel adjustment</button><button className="btn btn--accent" type="submit" disabled={!canWrite || busy}>Record adjustment</button></div>
    </form>}
    {reverseKey && canWrite && allowsAdjustment && <form className="form-stack" aria-label="Reverse vendor adjustment" onSubmit={postReversal}>
      <Field label="Reversal date"><input className="input" type="date" value={reverseDate} onChange={(event) => setReverseDate(event.target.value)} /></Field>
      <Field label="Reversal reason"><textarea className="input textarea" maxLength={1000} value={reverseReason} onChange={(event) => setReverseReason(event.target.value)} /></Field>
      <div className="pay-form__actions"><button className="btn" type="button" disabled={busy} onClick={() => setReverseKey("")}>Cancel reversal</button><button className="btn btn--accent" type="submit" disabled={busy || !canWrite}>Post reversal</button></div>
    </form>}
    {error && <p className="field__error" role="alert">{error}</p>}
  </section>;
}
