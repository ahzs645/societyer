import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { api } from "@/lib/convexApi";
import { usePermissionedMutation } from "../../hooks/usePermissionedMutation";
import { Drawer, Field, InspectorNote } from "../../components/ui";
import { Select } from "../../components/Select";
import { DatePicker } from "../../components/DatePicker";
import { Money } from "../../components/Money";
import { useToast } from "../../components/Toast";
import { formatDate, formatDateTime, pluralize } from "../../lib/format";
import { addDays, containsCardNumber, isValidCardLast4, monthEnd, monthStart, STATEMENT_STATUS_LABEL } from "../../../shared/businessRegisters";
import { centsToInput, FieldRow, inputToCents, MoneyField } from "./formHelpers";
import type { CardRow, PayrollEmployee, StatementRow } from "./types";

type DocumentOption = { _id: string; title: string };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.replace(/^.*Uncaught Error:\s*/, "").split("\n")[0] : "Something went wrong.";
}

/* --------------------------------------------------------------------- card */

export function CardDrawer({
  open,
  onClose,
  societyId,
  card,
  accounts,
  documents,
  employees,
  canWrite,
}: {
  open: boolean;
  onClose: () => void;
  societyId: string;
  card: CardRow | null;
  accounts: Array<{ _id: string; name: string }>;
  documents: DocumentOption[];
  employees: PayrollEmployee[];
  canWrite: boolean;
}) {
  const toast = useToast();
  const save = usePermissionedMutation(api.corporateCards.upsertCard, canWrite);
  const remove = usePermissionedMutation(api.corporateCards.removeCard, canWrite);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setForm({
      nickname: card?.nickname ?? "",
      cardholderName: card?.cardholderName ?? "",
      employeeId: card?.employeeId ?? "",
      last4: card?.last4 ?? "",
      issuer: card?.issuer ?? "",
      network: card?.network ?? "Visa",
      limit: centsToInput(card?.limitCents),
      financialAccountId: card?.financialAccountId ?? accounts[0]?._id ?? "",
      agreementDocumentId: card?.agreementDocumentId ?? "",
      status: card?.status ?? "active",
      openedOn: card?.openedOn ?? "",
      closedOn: card?.closedOn ?? "",
      notes: card?.notes ?? "",
    });
  }, [open, card, accounts]);

  const last4Error = form.last4 && !isValidCardLast4(form.last4) ? "Enter exactly 4 digits." : undefined;
  const fullNumberIn = ["nickname", "cardholderName", "issuer", "notes"].some((key) => containsCardNumber(form[key]));

  const submit = async () => {
    setBusy(true);
    try {
      await save({
        ...(card ? { id: card._id } : {}),
        societyId,
        nickname: form.nickname || undefined,
        cardholderName: form.cardholderName,
        employeeId: form.employeeId || undefined,
        last4: form.last4,
        issuer: form.issuer,
        network: form.network || undefined,
        limitCents: inputToCents(form.limit),
        financialAccountId: form.financialAccountId || undefined,
        agreementDocumentId: form.agreementDocumentId || undefined,
        status: form.status,
        openedOn: form.openedOn || undefined,
        closedOn: form.status === "closed" ? form.closedOn || undefined : undefined,
        notes: form.notes || undefined,
      });
      toast.success(card ? "Card saved" : "Card added");
      onClose();
    } catch (error) {
      toast.error("Couldn't save the card", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const del = async () => {
    if (!card) return;
    setBusy(true);
    try {
      await remove({ id: card._id });
      toast.success("Card removed");
      onClose();
    } catch (error) {
      toast.error("Couldn't remove the card", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={card ? `${card.nickname ?? card.issuer} ••${card.last4}` : "New card"}
      footer={
        <>
          {card && canWrite && <button className="btn btn--ghost btn--danger-text" onClick={del} disabled={busy}>Remove</button>}
          <span className="register-drawer__spacer" />
          <button className="btn" onClick={onClose}>{canWrite ? "Cancel" : "Close"}</button>
          {canWrite && <button className="btn btn--accent" onClick={submit} disabled={busy || Boolean(last4Error) || fullNumberIn}>Save</button>}
        </>
      }
    >
      <InspectorNote title="Only the last 4 digits">
        Societyer never stores a full card number. Card spending comes from the card account in your bank feed.
      </InspectorNote>
      <Field label="Card name" hint="e.g. Organization Visa"><input className="input" value={form.nickname ?? ""} onChange={(event) => setForm({ ...form, nickname: event.target.value })} disabled={!canWrite} /></Field>
      {employees.length > 0 && (
        <Field label="Cardholder on staff">
          <Select
            value={form.employeeId ?? ""}
            onChange={(employeeId) => setForm({ ...form, employeeId, cardholderName: employees.find((row) => row._id === employeeId)?.name ?? form.cardholderName })}
            options={employees.map((employee) => ({ value: employee._id, label: employee.name }))}
            clearable
            clearLabel="Not on staff"
            disabled={!canWrite}
          />
        </Field>
      )}
      <Field label="Cardholder" required><input className="input" value={form.cardholderName ?? ""} onChange={(event) => setForm({ ...form, cardholderName: event.target.value })} disabled={!canWrite} /></Field>
      <FieldRow>
        <Field label="Last 4 digits" required error={last4Error}>
          <input className="input input--last4" inputMode="numeric" autoComplete="off" maxLength={4} value={form.last4 ?? ""} onChange={(event) => setForm({ ...form, last4: event.target.value.replace(/\D/g, "").slice(0, 4) })} disabled={!canWrite} />
        </Field>
        <Field label="Network">
          <Select value={form.network ?? "Visa"} onChange={(network) => setForm({ ...form, network })} options={["Visa", "Mastercard", "American Express", "Other"].map((value) => ({ value, label: value }))} disabled={!canWrite} />
        </Field>
      </FieldRow>
      <FieldRow>
        <Field label="Issuer" required><input className="input" value={form.issuer ?? ""} onChange={(event) => setForm({ ...form, issuer: event.target.value })} disabled={!canWrite} /></Field>
        <MoneyField label="Credit limit" value={form.limit ?? ""} onChange={(limit) => setForm({ ...form, limit })} disabled={!canWrite} />
      </FieldRow>
      <Field label="Card account in the bank feed" hint="Statements are reconciled against this account's lines.">
        <Select value={form.financialAccountId ?? ""} onChange={(financialAccountId) => setForm({ ...form, financialAccountId })} options={accounts.map((account) => ({ value: account._id, label: account.name }))} clearable clearLabel="Not linked" disabled={!canWrite} />
      </Field>
      <Field label="Cardholder agreement">
        <Select value={form.agreementDocumentId ?? ""} onChange={(agreementDocumentId) => setForm({ ...form, agreementDocumentId })} options={documents.map((doc) => ({ value: doc._id, label: doc.title }))} searchable clearable clearLabel="None" placeholder="Choose a document" disabled={!canWrite} />
      </Field>
      <FieldRow>
        <Field label="Status">
          <Select value={form.status ?? "active"} onChange={(status) => setForm({ ...form, status })} options={[{ value: "active", label: "Active" }, { value: "closed", label: "Closed" }]} disabled={!canWrite} />
        </Field>
        <Field label="Opened"><DatePicker value={form.openedOn ?? ""} onChange={(openedOn) => setForm({ ...form, openedOn })} disabled={!canWrite} /></Field>
        {form.status === "closed" && <Field label="Closed"><DatePicker value={form.closedOn ?? ""} onChange={(closedOn) => setForm({ ...form, closedOn })} disabled={!canWrite} /></Field>}
      </FieldRow>
      <Field label="Notes" error={fullNumberIn ? "Remove the card number. Keep only the last 4 digits." : undefined}>
        <textarea className="textarea" rows={2} value={form.notes ?? ""} onChange={(event) => setForm({ ...form, notes: event.target.value })} disabled={!canWrite} />
      </Field>
    </Drawer>
  );
}

/* ---------------------------------------------------------------- statement */

export function StatementDrawer({
  open,
  onClose,
  societyId,
  statement,
  cards,
  documents,
  canWrite,
  today,
}: {
  open: boolean;
  onClose: () => void;
  societyId: string;
  statement: StatementRow | null;
  cards: CardRow[];
  documents: DocumentOption[];
  canWrite: boolean;
  today: string;
}) {
  const toast = useToast();
  const save = usePermissionedMutation(api.corporateCards.upsertStatement, canWrite);
  const remove = usePermissionedMutation(api.corporateCards.removeStatement, canWrite);
  const setReconciled = usePermissionedMutation(api.corporateCards.setStatementReconciled, canWrite);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const lastMonth = monthStart(addDays(monthStart(today || "2026-01-01"), -1));
    const card = cards.find((row) => row._id === statement?.cardId) ?? cards.find((row) => row.status === "active") ?? cards[0];
    setForm({
      cardId: statement?.cardId ?? card?._id ?? "",
      periodStart: statement?.periodStart ?? lastMonth,
      periodEnd: statement?.periodEnd ?? monthEnd(lastMonth),
      statementDate: statement?.statementDate ?? "",
      paymentDueDate: statement?.paymentDueDate ?? "",
      previous: centsToInput(statement?.previousBalanceCents),
      balance: centsToInput(statement?.statementBalanceCents),
      documentId: statement?.documentId ?? "",
      notes: statement?.notes ?? "",
    });
  }, [open, statement, cards, today]);

  const run = async (action: () => Promise<unknown>, success: string, failure: string, closeAfter = true) => {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      if (closeAfter) onClose();
    } catch (error) {
      toast.error(failure, errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const submit = () => run(() => save({
    ...(statement ? { id: statement._id } : {}),
    societyId,
    cardId: form.cardId,
    periodStart: form.periodStart,
    periodEnd: form.periodEnd,
    statementDate: form.statementDate || undefined,
    paymentDueDate: form.paymentDueDate || undefined,
    previousBalanceCents: inputToCents(form.previous) ?? 0,
    statementBalanceCents: inputToCents(form.balance) ?? 0,
    documentId: form.documentId || undefined,
    notes: form.notes || undefined,
  }), statement ? "Statement saved" : "Statement added", "Couldn't save the statement");

  const recon = statement;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={statement ? `Statement: ${statement.cardLabel}` : "New statement"}
      size="wide"
      footer={
        <>
          {statement && canWrite && <button className="btn btn--ghost btn--danger-text" onClick={() => void run(() => remove({ id: statement._id }), "Statement removed", "Couldn't remove the statement")} disabled={busy}>Remove</button>}
          <span className="register-drawer__spacer" />
          <button className="btn" onClick={onClose}>{canWrite ? "Cancel" : "Close"}</button>
          {canWrite && <button className="btn btn--accent" onClick={() => void submit()} disabled={busy || !form.cardId}>Save</button>}
        </>
      }
    >
      {recon && (
        <section className={`register-recon register-recon--${recon.status}`} aria-label="Reconciliation">
          <div className="register-recon__head">
            <h3 className="register-section__title">{STATEMENT_STATUS_LABEL[recon.status]}</h3>
            {canWrite && recon.status === "balanced" && (
              <button className="btn btn--accent btn--sm" disabled={busy} onClick={() => void run(() => setReconciled({ id: recon._id, reconciled: true }), "Statement reconciled", "Couldn't reconcile the statement", false)}>
                <CheckCircle2 size={12} /> Mark reconciled
              </button>
            )}
            {canWrite && recon.status === "reconciled" && (
              <button className="btn btn--sm" disabled={busy} onClick={() => void run(() => setReconciled({ id: recon._id, reconciled: false }), "Statement reopened", "Couldn't reopen the statement", false)}>
                <RotateCcw size={12} /> Reopen
              </button>
            )}
          </div>
          <dl className="register-summary register-summary--recon">
            <div><dt>Previous balance</dt><dd><Money cents={recon.previousBalanceCents} /></dd></div>
            <div><dt>Charges</dt><dd><Money cents={recon.purchasesCents} /></dd></div>
            <div><dt>Refunds and credits</dt><dd><Money cents={-recon.creditsCents} /></dd></div>
            <div><dt>Payments</dt><dd><Money cents={-recon.paymentsCents} /></dd></div>
            <div><dt>Feed balance</dt><dd><Money cents={recon.expectedBalanceCents} /></dd></div>
            <div><dt>Statement balance</dt><dd><Money cents={recon.statementBalanceCents} /></dd></div>
            <div className="register-summary__total"><dt>Difference</dt><dd><Money cents={recon.differenceCents} tone={recon.differenceCents === 0 ? "neutral" : "out"} signDisplay="exceptZero" /></dd></div>
          </dl>
          <p className="register-hint">
            {pluralize(recon.transactionCount, "card line")} in the feed for {formatDate(recon.periodStart)} to {formatDate(recon.periodEnd)}
            {recon.pendingCount ? `, plus ${pluralize(recon.pendingCount, "pending line")} not counted yet` : ""}.
            {" "}{recon.receiptsMissing ? <><strong>{pluralize(recon.receiptsMissing, "receipt")} missing.</strong> </> : "Every charge has a receipt. "}
            <Link to="/app/financials?tab=transactions">Open transactions</Link>
          </p>
          {recon.status === "difference" && (
            <InspectorNote tone="warn" title="Find the difference first">
              The statement is <Money cents={Math.abs(recon.differenceCents)} /> {recon.differenceCents > 0 ? "higher" : "lower"} than the card lines in the feed. Look for fees, interest or charges that haven't reached the feed, or a line in the wrong month.
            </InspectorNote>
          )}
          {recon.reconciledAtISO && <p className="register-hint">Reconciled {formatDateTime(recon.reconciledAtISO)}{recon.reconciledByName ? ` by ${recon.reconciledByName}` : ""}.</p>}
        </section>
      )}
      <section className="register-section">
        <h3 className="register-section__title">Statement</h3>
        {cards.length > 1 && (
          <Field label="Card">
            <Select value={form.cardId ?? ""} onChange={(cardId) => setForm({ ...form, cardId })} options={cards.map((card) => ({ value: card._id, label: `${card.nickname ?? card.issuer} ••${card.last4}` }))} disabled={!canWrite} />
          </Field>
        )}
        <FieldRow>
          <Field label="Period start" required><DatePicker value={form.periodStart ?? ""} onChange={(periodStart) => setForm({ ...form, periodStart })} disabled={!canWrite} /></Field>
          <Field label="Period end" required><DatePicker value={form.periodEnd ?? ""} onChange={(periodEnd) => setForm({ ...form, periodEnd })} disabled={!canWrite} /></Field>
        </FieldRow>
        <FieldRow>
          <MoneyField label="Previous balance" value={form.previous ?? ""} onChange={(previous) => setForm({ ...form, previous })} disabled={!canWrite} hint="Owed at the start of the period." />
          <MoneyField label="Statement balance" value={form.balance ?? ""} onChange={(balance) => setForm({ ...form, balance })} disabled={!canWrite} required hint="Owed at the end of the period." />
        </FieldRow>
        <FieldRow>
          <Field label="Statement date"><DatePicker value={form.statementDate ?? ""} onChange={(statementDate) => setForm({ ...form, statementDate })} disabled={!canWrite} /></Field>
          <Field label="Payment due"><DatePicker value={form.paymentDueDate ?? ""} onChange={(paymentDueDate) => setForm({ ...form, paymentDueDate })} disabled={!canWrite} /></Field>
        </FieldRow>
        <Field label="Statement document">
          <Select value={form.documentId ?? ""} onChange={(documentId) => setForm({ ...form, documentId })} options={documents.map((doc) => ({ value: doc._id, label: doc.title }))} searchable clearable clearLabel="None" placeholder="Choose a document" disabled={!canWrite} />
        </Field>
        <Field label="Notes"><textarea className="textarea" rows={2} value={form.notes ?? ""} onChange={(event) => setForm({ ...form, notes: event.target.value })} disabled={!canWrite} /></Field>
        {statement?.reconciledAtISO && <p className="register-hint">Changing the balances or period reopens a reconciled statement.</p>}
      </section>
    </Drawer>
  );
}
