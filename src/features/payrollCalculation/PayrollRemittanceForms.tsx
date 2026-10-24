import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Field } from "../../components/ui";
import { usePermissions } from "../../hooks/usePermissions";
import {
  REMITTANCE_CHANNELS,
  REMITTANCE_CHANNEL_LABELS,
  type RemittancePlan,
  type RemittancePlanFields,
  type RemittanceReadinessFields,
} from "../../../shared/payrollRemittance";
import {
  amountInput,
  payrollFailure,
  payrollMoney,
  PayrollMoneyField,
} from "./payrollUi";
import { useRemittancePages } from "./useRemittancePages";
const money = (n: number) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(
    n / 100,
  );
export function LegacyRemittanceAccountForm({
  societyId,
  obligation,
  onSaved,
  onCancel,
}: {
  societyId: string;
  obligation: {
    _id: string;
    periodStart: string;
    periodEnd: string;
    paidCents: number;
  };
  onSaved: () => void;
  onCancel: () => void;
}) {
  const confirm = useMutation(api.payrollRemittance.confirmLegacyAccount),
    [account, setAccount] = useState(""),
    [evidence, setEvidence] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await confirm({
        societyId,
        obligationId: obligation._id,
        payrollAccountNumber: account,
        evidence,
      });
      onSaved();
    } catch (cause) {
      setError(payrollFailure(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      aria-label="Historical CRA account confirmation"
      className="card payroll-calculator__panel"
      onSubmit={submit}
    >
      <h3>Confirm historical CRA payment account</h3>
      <p>
        The legacy obligation for {obligation.periodStart}–
        {obligation.periodEnd} records {money(obligation.paidCents)} paid
        without retaining its CRA RP account. Check the actual CRA statement or
        payment receipt. This confirmation preserves the existing amount and
        date, and cannot transfer payment to another account.
      </p>
      <Field label="Actual historical CRA RP account">
        <input
          className="input"
          required
          value={account}
          placeholder="123456789RP0001"
          onChange={(e) => setAccount(e.target.value)}
        />
      </Field>
      <Field label="Historical CRA account evidence">
        <textarea
          className="input"
          required
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
        />
      </Field>
      {error && <p role="alert">{error}</p>}
      <div className="payroll-calculator__actions">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel historical confirmation
        </button>
        <button className="btn btn--accent" disabled={busy}>
          {busy ? "Recording…" : "Confirm historical RP attribution"}
        </button>
      </div>
    </form>
  );
}
export function RemittancePlanForm({
  societyId,
  obligationId,
  initial,
  onSaved,
  onCancel,
}: {
  societyId: string;
  obligationId: string;
  initial?: RemittancePlan;
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const preview = useQuery(api.payrollRemittance.preview, {
      societyId,
      obligationId,
    }),
    save = useMutation(api.payrollRemittance.saveDraft),
    banks = useRemittancePages(societyId, "banks"),
    liabilities = useRemittancePages(societyId, "liabilities"),
    expenses = useRemittancePages(societyId, "expenses");
  const [bankAccountId, setBank] = useState(initial?.bankAccountId ?? ""),
    [amount, setAmount] = useState(
      initial ? amountInput(initial.amountCents) : "",
    ),
    [date, setDate] = useState(initial?.scheduledDate ?? ""),
    [channel, setChannel] = useState<RemittancePlanFields["channel"]>(
      initial?.channel ?? "financial_institution",
    ),
    [destination, setDestination] = useState(
      initial?.destinationReference ?? "",
    ),
    [liability, setLiability] = useState(initial?.liabilityAccountId ?? ""),
    [expense, setExpense] = useState(initial?.employerExpenseAccountId ?? ""),
    [notes, setNotes] = useState(initial?.notes ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !preview) return;
    setBusy(true);
    setError("");
    try {
      const id = await save({
        societyId,
        ...(initial
          ? { id: initial._id, expectedVersion: initial.version }
          : {}),
        fields: {
          obligationId,
          bankAccountId,
          amountCents: payrollMoney(
            amount || amountInput(preview.outstandingCents),
            "Payment amount",
          )!,
          scheduledDate: date || preview.dueDate,
          channel,
          destinationReference: destination,
          ...(liability ? { liabilityAccountId: liability } : {}),
          ...(expense ? { employerExpenseAccountId: expense } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
      });
      onSaved(id);
    } catch (cause) {
      setError(payrollFailure(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      aria-label="CRA remittance plan"
      className="card payroll-calculator__panel"
      onSubmit={submit}
    >
      <h3>{initial ? "Revise draft" : "Prepare remittance"}</h3>
      {!preview ? (
        <p>Loading actual payroll sources…</p>
      ) : (
        <>
          <p>
            Period {preview.periodStart}–{preview.periodEnd} · CRA account{" "}
            <strong>{preview.payrollAccountNumber}</strong>
          </p>
          <p>
            Actual CRA obligation {money(preview.amountDueCents)} · Already
            recorded {money(preview.paidCents)} · Outstanding{" "}
            {money(preview.outstandingCents)}
          </p>
          <p>
            Due {preview.dueDate} · Suggested preparation lead time:{" "}
            {preview.readiness.fields.leadBusinessDays} business days, earliest{" "}
            {preview.earliestSuggestedDate}. Review the chosen provider’s cutoff
            and actual CRA receipt date.
          </p>
          <div className="payroll-calculator__table-wrap">
            <table className="table">
              <caption>
                CRA source amounts from {preview.payRunIds.length} retained
                payroll runs
              </caption>
              <tbody>
                {Object.entries(
                  preview.components as Record<string, number>,
                ).map(([label, value]) => (
                  <tr key={label}>
                    <th scope="row">
                      {label.replace(/Cents$/, " ").replace(/([A-Z])/g, " $1")}
                    </th>
                    <td>{money(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.warnings.map((warning: string) => (
            <p key={warning} role="status">
              {warning}
            </p>
          ))}
        </>
      )}
      <div className="payroll-calculator__form-grid">
        <Field label="Remittance source bank">
          <select
            className="input"
            value={bankAccountId}
            required
            onChange={(e) => setBank(e.target.value)}
          >
            <option value="">Choose a CAD bank</option>
            {banks.rows
              .filter((r) => r.currency === "CAD")
              .map((r) => (
                <option key={r._id} value={r._id}>
                  {r.name} · {r.currency}
                </option>
              ))}
          </select>
        </Field>
        {banks.hasMore && (
          <button
            type="button"
            className="btn btn--sm"
            onClick={banks.loadMore}
          >
            Load more source banks
          </button>
        )}
        <PayrollMoneyField
          label="Planned remittance amount (CAD)"
          value={
            amount ||
            (!initial && preview ? amountInput(preview.outstandingCents) : "")
          }
          onChange={setAmount}
        />
        <Field label="Intended remittance date">
          <input
            className="input"
            type="date"
            required
            value={date || preview?.dueDate || ""}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Manual payment channel">
          <select
            className="input"
            value={channel}
            onChange={(e) => setChannel(e.target.value as typeof channel)}
          >
            {REMITTANCE_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {REMITTANCE_CHANNEL_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Exact CRA payee / destination reference"
          hint="Confirm the bank’s payroll payee for the assigned remitter category and the full 15-character RP account. Do not include bank credentials."
        >
          <input
            className="input"
            required
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          />
        </Field>
        <Field label="Source-deductions liability for posting">
          <select
            className="input"
            value={liability}
            onChange={(e) => setLiability(e.target.value)}
          >
            <option value="">No ledger posting configured</option>
            {liabilities.rows
              .filter((r) => r.currency === "CAD")
              .map((r) => (
                <option key={r._id} value={r._id}>
                  {r.name}
                </option>
              ))}
          </select>
        </Field>
        {liabilities.hasMore && (
          <button
            type="button"
            className="btn btn--sm"
            onClick={liabilities.loadMore}
          >
            Load more liability accounts
          </button>
        )}
        <Field label="Employer CPP / EI expense for cash basis">
          <select
            className="input"
            value={expense}
            onChange={(e) => setExpense(e.target.value)}
          >
            <option value="">No cash recognition configured</option>
            {expenses.rows
              .filter((r) => r.currency === "CAD")
              .map((r) => (
                <option key={r._id} value={r._id}>
                  {r.name}
                </option>
              ))}
          </select>
        </Field>
        {expenses.hasMore && (
          <button
            type="button"
            className="btn btn--sm"
            onClick={expenses.loadMore}
          >
            Load more expense accounts
          </button>
        )}
        <Field label="Remittance notes">
          <textarea
            className="input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
      </div>
      {channel === "cra_myba_pad" && (
        <p>
          Set up PAD yourself in CRA My Business Account. CRA requires at least
          five business days for first payment setup and changes;
          representatives cannot schedule PAD for a represented business. This
          plan does not create a PAD agreement.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="payroll-calculator__actions">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel preparation
        </button>
        <button className="btn btn--accent" disabled={busy || !preview}>
          {busy ? "Saving…" : "Save remittance draft"}
        </button>
      </div>
    </form>
  );
}
export function RemittanceReadinessForm({
  societyId,
  initial,
  onClose,
}: {
  societyId: string;
  initial: RemittanceReadinessFields;
  onClose: () => void;
}) {
  const permissions = usePermissions(),
    canReadSettings = permissions.loaded && permissions.can("settings:read"),
    save = useMutation(api.payrollRemittance.saveReadiness),
    credentials = useRemittancePages(
      societyId,
      "credentials",
      undefined,
      canReadSettings,
    ),
    [fields, setFields] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const update = <K extends keyof RemittanceReadinessFields>(
    key: K,
    value: RemittanceReadinessFields[K],
  ) => setFields((old) => ({ ...old, [key]: value }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await save({ societyId, fields });
      onClose();
    } catch (cause) {
      setError(payrollFailure(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      aria-label="Remittance automation readiness"
      className="card payroll-calculator__panel"
      onSubmit={submit}
    >
      <h3>Automation preparation</h3>
      <p>
        Retain reviewed setup and service requirements. A production payment
        connector is not installed; saving these checks cannot debit a bank
        account.
      </p>
      {(
        [
          ["rpRegistrationConfirmed", "Registered CRA RP account verified"],
          [
            "remitterCategoryConfirmed",
            "CRA remitter category and effective schedule verified",
          ],
          ["mandateConfirmed", "Actual bank / service mandate retained"],
          [
            "statusWebhookConfirmed",
            "Authenticated status callbacks or polling reviewed",
          ],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          <input
            type="checkbox"
            checked={fields[key]}
            onChange={(e) => update(key, e.target.checked)}
          />
          {label}
        </label>
      ))}
      <div className="payroll-calculator__form-grid">
        {(
          [
            ["mandateReference", "Mandate reference"],
            ["providerName", "Bank or approved service"],
            [
              "providerContractReference",
              "Supported service contract / CRA EDI onboarding reference",
            ],
            ["approvalPolicyReference", "Approval and release policy"],
            ["retryPolicyReference", "Idempotent retry / rejection policy"],
            ["timezone", "Payment timezone"],
          ] as const
        ).map(([key, label]) => (
          <Field key={key} label={label}>
            <input
              className="input"
              value={fields[key] ?? ""}
              onChange={(e) => update(key, e.target.value)}
            />
          </Field>
        ))}
        <Field
          label="Secure credential reference"
          hint="Store credentials in the access vault. Only this owned reference is retained here."
        >
          <select
            className="input"
            disabled={!canReadSettings}
            value={fields.credentialVaultItemId ?? ""}
            onChange={(e) =>
              update("credentialVaultItemId", e.target.value || undefined)
            }
          >
            <option value="">Not provisioned</option>
            {!canReadSettings && fields.credentialVaultItemId && (
              <option value={fields.credentialVaultItemId}>
                Existing secure reference retained
              </option>
            )}
            {credentials.rows
              .filter(
                (r) => r.status === "Active" && r.storageMode !== "not_stored",
              )
              .map((r) => (
                <option key={r._id} value={r._id}>
                  {r.name} · {r.service}
                </option>
              ))}
          </select>
        </Field>
        {!canReadSettings && (
          <p>
            Settings read permission is required to view or change secure
            credential references. The existing reference is retained.
          </p>
        )}
        {credentials.hasMore && (
          <button
            type="button"
            className="btn btn--sm"
            onClick={credentials.loadMore}
          >
            Load more secure references
          </button>
        )}
        <Field label="Processing lead business days">
          <input
            className="input"
            type="number"
            min="0"
            max="30"
            value={fields.leadBusinessDays}
            onChange={(e) => update("leadBusinessDays", Number(e.target.value))}
          />
        </Field>
        <Field label="Provider cutoff (local time)">
          <input
            className="input"
            type="time"
            value={fields.cutoffLocalTime ?? ""}
            onChange={(e) =>
              update("cutoffLocalTime", e.target.value || undefined)
            }
          />
        </Field>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="payroll-calculator__actions">
        <button className="btn" type="button" disabled={busy} onClick={onClose}>
          Cancel readiness
        </button>
        <button className="btn btn--accent" disabled={busy}>
          {busy ? "Saving…" : "Save readiness review"}
        </button>
      </div>
    </form>
  );
}
export function RemittanceSettlementForm({
  societyId,
  plan,
  onSaved,
  onCancel,
}: {
  societyId: string;
  plan: RemittancePlan;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const reconcile = useMutation(api.payrollRemittance.reconcilePayment),
    transactions = useRemittancePages(
      societyId,
      "transactions",
      plan.bankAccountId,
    ),
    [transactionId, setTransaction] = useState(""),
    [date, setDate] = useState(""),
    [amount, setAmount] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [evidence, setEvidence] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [post, setPost] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [key] = useState(() => crypto.randomUUID());
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await reconcile({
        societyId,
        id: plan._id,
        date,
        amountCents: payrollMoney(amount, "Actual payment amount")!,
        evidence,
        destinationConfirmed: confirmed,
        idempotencyKey: key,
        postToLedger: post,
        ...(transactionId ? { transactionId } : {}),
        ...(confirmation.trim()
          ? { craConfirmationNumber: confirmation.trim() }
          : {}),
      });
      onSaved();
    } catch (cause) {
      setError(payrollFailure(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      aria-label="Reconcile actual CRA payment"
      className="card payroll-calculator__panel"
      onSubmit={submit}
    >
      <h3>Reconcile actual payment</h3>
      <p>
        Record a settled outflow to CRA account{" "}
        <strong>{plan.source.payrollAccountNumber}</strong>, or an actual CRA
        payment receipt. A submission or scheduled PAD is not settlement. Bank
        settlement alone does not establish CRA’s legal receipt date.
      </p>
      <Field label="Actual source-bank outflow">
        <select
          className="input"
          value={transactionId}
          onChange={(e) => {
            setTransaction(e.target.value);
            const tx = transactions.rows.find((t) => t._id === e.target.value);
            if (tx) {
              setDate(tx.date);
              setAmount(amountInput(-tx.amountCents));
            }
          }}
        >
          <option value="">Use actual CRA receipt without a bank link</option>
          {transactions.rows
            .filter(
              (t) =>
                t.amountCents < 0 &&
                !t.matchedKind &&
                !t.matchedId &&
                !["pending", "rejected", "void"].includes(t.status),
            )
            .map((tx) => (
              <option key={tx._id} value={tx._id}>
                {tx.date} · {money(-tx.amountCents)} · {tx.description}
              </option>
            ))}
        </select>
      </Field>
      {transactions.hasMore && (
        <button
          type="button"
          className="btn btn--sm"
          onClick={transactions.loadMore}
        >
          Load more bank outflows
        </button>
      )}
      <PayrollMoneyField
        label="Actual settled amount (CAD)"
        value={amount}
        onChange={setAmount}
      />
      <Field label="Actual settlement / CRA receipt date">
        <input
          className="input"
          type="date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </Field>
      <Field
        label="Actual CRA payment confirmation"
        hint="Required when no posted bank outflow is linked. Do not enter a PAD schedule or export reference."
      >
        <input
          className="input"
          value={confirmation}
          required={!transactionId}
          onChange={(e) => setConfirmation(e.target.value)}
        />
      </Field>
      <Field label="Settlement evidence">
        <textarea
          className="input"
          required
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
        />
      </Field>
      <label>
        <input
          type="checkbox"
          required
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        I verified actual settlement to this exact CRA RP account and period
      </label>
      <label>
        <input
          type="checkbox"
          checked={post}
          disabled={!transactionId || !plan.liabilityAccountId}
          onChange={(e) => setPost(e.target.checked)}
        />
        Post the bank settlement and employer contribution cash recognition to
        the reviewed ledger accounts
      </label>
      <p>
        Partial payments retain the remaining amount. Posting replaces a
        supported bank backfill with a dated mirror; it does not create a second
        cash outflow.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="payroll-calculator__actions">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel reconciliation
        </button>
        <button className="btn btn--accent" disabled={busy}>
          {busy ? "Recording…" : "Record actual settlement"}
        </button>
      </div>
    </form>
  );
}
