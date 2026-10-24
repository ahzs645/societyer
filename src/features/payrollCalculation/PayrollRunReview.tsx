import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import type {
  CalculationInput,
  PayrollCalculationPreview,
  PayrollCalculationRecord,
  PayrollPaymentMethod,
} from "../../../shared/payrollCalculation";
import { Money } from "../../components/Money";
import { Field } from "../../components/ui";
import { formatDate } from "../../lib/format";
import { PayrollCalculationResult } from "./PayrollCalculationResult";
import { PayrollRuleSnapshot } from "./PayrollRuleSnapshot";
import { PayrollStatementActions } from "./PayrollStatementActions";
import { PayrollEhtReconciliationPanel } from "./PayrollEhtReconciliationPanel";
import { payrollFailure, usePayrollPages } from "./payrollUi";
import {
  formCheck,
  formText,
  SelectInput,
  SourceForm,
  TextInput,
} from "./PayrollSourceForms";

const PAYMENT_METHODS: Record<PayrollPaymentMethod, string> = {
  bank_transfer: "Bank transfer",
  direct_deposit: "Direct deposit",
  cheque: "Cheque",
  cash: "Cash",
  other: "Other",
};

export function PayrollResultReview({
  societyId,
  result,
  frozen = false,
}: {
  societyId: string;
  result: PayrollCalculationPreview;
  frozen?: boolean;
}) {
  const deductionSchedule = result.employees.find(
    (employee) => employee.deductions,
  )?.deductions?.input;
  return (
    <section aria-label="Payroll results">
      {result.ruleEdition && (
        <PayrollRuleSnapshot value={result.ruleEdition} frozen={frozen} />
      )}
      {result.ehtReconciliation && (
        <PayrollEhtReconciliationPanel value={result.ehtReconciliation} />
      )}
      {result.blockers.length > 0 && (
        <div role="alert" className="payroll-calculator__blockers">
          <h2>Resolve before approval</h2>
          <ul>
            {result.blockers.map((blocker, index) => (
              <li key={index}>{blocker}</li>
            ))}
          </ul>
        </div>
      )}
      {result.warnings.length > 0 && (
        <div className="payroll-calculator__notice">
          <h2>Review warnings</h2>
          <ul>
            {result.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
      <section
        className="payroll-calculator__notice"
        aria-label="Scheduled payroll period evidence"
      >
        <strong>Applicable regular pay date:</strong>{" "}
        {result.input.regularPayDate
          ? formatDate(result.input.regularPayDate)
          : deductionSchedule
            ? "Automatic from the reviewed regular calendar or exact prior regular period"
            : "Not yet resolved"}
        {deductionSchedule && (
          <p>
            CRA regular period {deductionSchedule.periodNumber} of{" "}
            {deductionSchedule.payPeriodsPerYear}. Actual payment date:{" "}
            {formatDate(result.input.payDate)}.
          </p>
        )}
      </section>
      <p>
        <strong>Run totals:</strong> Cash{" "}
        <Money cents={result.totals.cashCents} currency="CAD" /> · Net{" "}
        <Money cents={result.totals.netCents} currency="CAD" /> · Full employer
        cost <Money cents={result.totals.employerCostCents} currency="CAD" />
      </p>
      {result.employees.map((employee) => (
        <div key={employee.employeeId}>
          {(employee.vacationBalanceComplete !== undefined ||
            result.input.vacationPayouts?.some(
              (payout) => payout.employeeId === employee.employeeId,
            )) && (
            <section
              className="payroll-calculator__notice"
              aria-label={`${employee.employeeName} vacation liability and payouts`}
            >
              <h3>Reviewed vacation pay · {employee.employeeName}</h3>
              <p>
                Server-derived prior vacation liability:{" "}
                {employee.vacationBalanceComplete === true &&
                employee.vacationBalanceBeforeCents !== undefined ? (
                  <Money
                    cents={employee.vacationBalanceBeforeCents}
                    currency="CAD"
                  />
                ) : (
                  "Unknown — review the complete monetary opening and prior payroll."
                )}
              </p>
              {result.input.vacationPayouts
                ?.filter((payout) => payout.employeeId === employee.employeeId)
                .map((payout, index) => (
                  <div key={index}>
                    <p>
                      <Money cents={payout.amountCents} currency="CAD" /> ·{" "}
                      {payout.treatment.replaceAll("_", " ")} ·{" "}
                      {payout.sourceReference}
                    </p>
                    <p>
                      Actual insurable hours:{" "}
                      {payout.insurableMinutes === undefined
                        ? "Unknown"
                        : (payout.insurableMinutes / 60).toLocaleString(
                            undefined,
                            { maximumFractionDigits: 6 },
                          )}
                      {payout.vacationRequestId
                        ? ` · Approved/taken request ${payout.vacationRequestId}`
                        : " · Reviewed manual source"}
                      .
                    </p>
                  </div>
                ))}
              {employee.priorVacationLiabilityReleasedCents !== undefined && (
                <p>
                  Prior liability released in this calculation:{" "}
                  <Money
                    cents={employee.priorVacationLiabilityReleasedCents}
                    currency="CAD"
                  />
                  .
                </p>
              )}
            </section>
          )}
          {result.input.employerCostOverrides
            ?.filter((override) => override.employeeId === employee.employeeId)
            .map((override, index) => (
              <details
                key={`run-cost:${index}`}
                className="payroll-calculator__notice"
              >
                <summary>
                  Retained actual employer-cost instruction ·{" "}
                  {employee.employeeName}
                </summary>
                <p>{override.evidence}</p>
                <dl className="payroll-calculator__amounts">
                  {(
                    [
                      ["Employer benefits", override.benefitsCents],
                      ["Employer pension", override.pensionCents],
                      [
                        "Benefits already in earnings",
                        override.benefitsAlreadyInEarningsCents,
                      ],
                      [
                        "Pension already in earnings",
                        override.pensionAlreadyInEarningsCents,
                      ],
                    ] as const
                  ).map(([label, amount]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>
                        {amount === undefined ? (
                          "Applicable server defaults"
                        ) : (
                          <Money cents={amount} currency="CAD" />
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
            ))}
          {employee.ehtLocationId && (
            <details className="payroll-calculator__notice">
              <summary>
                Retained EHT location attribution · {employee.employeeName}
              </summary>
              <p>
                {employee.ehtLocationId} ·{" "}
                {employee.ehtAttributionBasis?.replaceAll("_", " ")}
              </p>
              <p>{employee.ehtAttributionEvidence}</p>
            </details>
          )}
          {employee.earningsInput?.salary?.proration && (
            <details className="payroll-calculator__notice">
              <summary>
                Retained salary proration evidence · {employee.employeeName}
              </summary>
              <p>
                {employee.earningsInput.salary.proration.reviewed
                  ? "Reviewed"
                  : "Review required"}{" "}
                · {employee.earningsInput.salary.proration.basis} ·{" "}
                {employee.earningsInput.salary.proration.evidence}
              </p>
              <p>
                Covered period {formatDate(result.input.periodStart)}–
                {formatDate(result.input.periodEnd)}.
              </p>
            </details>
          )}
          {employee.statement ? (
            <>
              <PayrollCalculationResult
                statement={employee.statement}
                warnings={employee.warnings}
                blockers={employee.blockers}
                frozen={frozen}
              />
              <PayrollStatementActions
                societyId={societyId}
                statement={employee.statement}
              />
            </>
          ) : (
            <section
              className="card payroll-calculator__panel"
              aria-label={`${employee.employeeName} calculation blockers`}
            >
              <h2>{employee.employeeName}</h2>
              <p>
                Complete the required source assumptions before a calculated
                statement is available.
              </p>
              <ul>
                {employee.blockers.map((blocker, index) => (
                  <li key={index}>{blocker}</li>
                ))}
                {employee.warnings.map((warning, index) => (
                  <li key={`warning:${index}`}>{warning}</li>
                ))}
              </ul>
            </section>
          )}
          {employee.allocations && employee.allocations.length > 0 && (
            <section
              className="card payroll-calculator__panel"
              aria-label="Calculated employer cost allocations"
            >
              <h3>Employer cost allocations · {employee.employeeName}</h3>
              <div className="payroll-calculator__table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Allocation</th>
                      <th>Share</th>
                      <th>Fund / program / grant</th>
                      <th>Full cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employee.allocations.map((allocation, index) => (
                      <tr key={index}>
                        <th scope="row">{allocation.label}</th>
                        <td>{(allocation.shareBps / 100).toFixed(2)}%</td>
                        <td>
                          {[
                            allocation.fundRestrictionId,
                            allocation.programCode,
                            allocation.grantId,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "Unrestricted"}
                        </td>
                        <td>
                          <Money cents={allocation.totalCents} currency="CAD" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      ))}
      <details className="payroll-calculator__panel">
        <summary>Run rule editions and source fingerprint</summary>
        <p>
          {result.rules.editions.join(" · ") ||
            "No supported rule edition selected"}
        </p>
        <p className="payroll-calculator__fingerprint">
          {result.sourceFingerprint}
        </p>
        <ul>
          {result.rules.sources.map((source, index) => (
            <li key={index}>
              {/^https:\/\//.test(source) ? (
                <a href={source} target="_blank" rel="noopener noreferrer">
                  {source}
                </a>
              ) : (
                source
              )}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

export function PayrollPreview({
  societyId,
  input,
  draftId,
  canWrite,
  onSaved,
}: {
  societyId: string;
  input: CalculationInput;
  draftId?: string;
  canWrite: boolean;
  onSaved: (id: string) => void;
}) {
  const result = useQuery(api.payrollCalculation.preview, {
      societyId,
      input,
    }) as PayrollCalculationPreview | undefined,
    save = useMutation(api.payrollCalculation.saveDraft),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <section aria-label="Live payroll preview">
      {!result ? (
        <p role="status">Calculating from saved payroll sources…</p>
      ) : (
        <>
          <PayrollResultReview societyId={societyId} result={result} />
          {error && (
            <p role="alert" className="payroll-calculator__blockers">
              {error}
            </p>
          )}
          <button
            type="button"
            className="btn btn--accent"
            disabled={busy || !canWrite}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const id = await save({ societyId, id: draftId, input });
                onSaved(String(id));
              } catch (cause) {
                setError(payrollFailure(cause));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving payroll draft…" : "Save payroll draft"}
          </button>
          <p className="muted">
            Saving recomputes on the server. Drafts may retain blockers for
            later correction; approval requires complete supported inputs.
          </p>
        </>
      )}
    </section>
  );
}

type PaymentTransaction = {
  _id: string;
  date: string;
  description: string;
  amountCents: number;
  currency: string | null;
  status: string;
  matchedKind?: string;
  matchedId?: string;
  accountType?: string;
  accountName?: string;
};
function PayrollPaymentForm({
  societyId,
  record,
  today,
  onCancel,
}: {
  societyId: string;
  record: PayrollCalculationRecord;
  today: string;
  onCancel: () => void;
}) {
  const [from, setFrom] = useState(record.input.payDate),
    [to, setTo] = useState(
      today < record.input.payDate ? record.input.payDate : today,
    ),
    [paymentDate, setPaymentDate] = useState(today),
    transactions = usePayrollPages<PaymentTransaction>(
      /^\d{4}-\d{2}-\d{2}$/.test(from) &&
        /^\d{4}-\d{2}-\d{2}$/.test(to) &&
        from <= to
        ? { societyId, collection: "transactions", from, to }
        : undefined,
      "Recorded payroll bank payments",
    ),
    recordPayment = useMutation(api.payrollCalculation.recordPayment);
  return (
    <SourceForm
      title="Recorded payroll payment"
      onCancel={onCancel}
      onSave={async (data) => {
        await recordPayment({
          societyId,
          id: record._id,
          employeeId: formText(data, "employeeId") || undefined,
          transactionId: formText(data, "transactionId"),
          date: formText(data, "date"),
          reference: formText(data, "reference"),
          method: formText(data, "method"),
          payee: formText(data, "payee") || undefined,
          destinationReference:
            formText(data, "destinationReference") || undefined,
          idempotencyKey: `payroll-payment:${record._id}:${formText(data, "transactionId")}:${formText(data, "employeeId") || "all"}`,
          postToLedger: formCheck(data, "postToLedger"),
        });
        onCancel();
      }}
    >
      <p>
        Link an existing posted CAD bank outflow for the exact net amount. This
        records provenance; it does not initiate a deposit.
      </p>
      <div className="payroll-calculator__form-grid">
        <Field label="Bank payment search from">
          <input
            className="input"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="Bank payment search through">
          <input
            className="input"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
      </div>
      {transactions.loader}
      {!transactions.ready && (
        <p role="status">Loading complete bank payment window…</p>
      )}
      <div className="payroll-calculator__form-grid">
        <SelectInput
          label="Payment for"
          name="employeeId"
          value={
            record.payments?.length
              ? record.result.employees.find(
                  (employee) =>
                    !record.payments?.some(
                      (payment) => payment.employeeId === employee.employeeId,
                    ),
                )?.employeeId
              : ""
          }
          choices={[
            ...(!record.payments?.length
              ? [{ value: "", label: "Whole calculation" }]
              : []),
            ...record.result.employees
              .filter(
                (employee) =>
                  !record.payments?.some(
                    (payment) => payment.employeeId === employee.employeeId,
                  ),
              )
              .map((employee) => ({
                value: employee.employeeId,
                label: employee.employeeName,
              })),
          ]}
        />
        <Field label="Recorded bank outflow">
          <select
            className="input"
            name="transactionId"
            required
            disabled={!transactions.ready}
            onChange={(event) => {
              const transaction = transactions.rows.find(
                (row) => row._id === event.target.value,
              );
              if (transaction) setPaymentDate(transaction.date);
            }}
          >
            <option value="">Select a posted bank outflow</option>
            {transactions.rows
              .filter(
                (row) =>
                  row.amountCents < 0 &&
                  row.currency === "CAD" &&
                  (!row.accountType || row.accountType === "Bank") &&
                  (row.status === "posted" || row.status === "recorded") &&
                  !row.matchedKind &&
                  !row.matchedId,
              )
              .map((row) => (
                <option value={row._id} key={row._id}>
                  {row.date} · {row.accountName ? `${row.accountName} · ` : ""}
                  {row.description} · {(-row.amountCents / 100).toFixed(2)} CAD
                  {row.matchedKind ? ` · ${row.matchedKind}` : ""}
                </option>
              ))}
          </select>
        </Field>
        <Field
          label="Payment effective date"
          hint="Must match the selected bank transaction date."
        >
          <input
            className="input"
            name="date"
            type="date"
            value={paymentDate}
            required
            onChange={(event) => setPaymentDate(event.target.value)}
          />
        </Field>
        <TextInput label="Payment reference" name="reference" required />
        <Field label="Actual payment method">
          <select className="input" name="method" defaultValue="" required>
            <option value="">Choose the recorded payment method</option>
            {Object.entries(PAYMENT_METHODS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <TextInput
          label="Payment payee"
          name="payee"
          hint="Optional descriptive payee name."
        />
        <TextInput
          label="Payment destination reference"
          name="destinationReference"
          hint="A descriptive destination or masked account ending. Keep bank credentials out of this field."
        />
      </div>
      <label>
        <input type="checkbox" name="postToLedger" /> Post clearing journal
        using the saved accrual mappings
      </label>
      <p className="muted">
        With no employee selected, the bank outflow must equal the full run’s
        net pay before any individual settlement. Partial settlements are not
        inferred. The server verifies ownership, date, source currency, and
        prior links.
      </p>
    </SourceForm>
  );
}

export function PayrollSavedReview({
  societyId,
  id,
  today,
  canWrite,
  onEdit,
  onReplacement,
}: {
  societyId: string;
  id: string;
  today: string;
  canWrite: boolean;
  onEdit: (input: CalculationInput, id: string) => void;
  onReplacement: (input: CalculationInput) => void;
}) {
  const response = useQuery(api.payrollCalculation.workspace, {
      societyId,
      collection: "calculation",
      id,
    }) as { detail?: PayrollCalculationRecord | null } | undefined,
    approve = useMutation(api.payrollCalculation.approve),
    finalize = useMutation(api.payrollCalculation.finalize),
    reverse = useMutation(api.payrollCalculation.reverse);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [post, setPost] = useState(false),
    [reversing, setReversing] = useState(false),
    [payment, setPayment] = useState(false);
  async function action(operation: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
      setNotice(message);
    } catch (cause) {
      setError(payrollFailure(cause));
    } finally {
      setBusy(false);
    }
  }
  if (!response) return <p role="status">Loading frozen payroll record…</p>;
  const record = response.detail;
  if (!record)
    return (
      <p role="alert">
        This payroll calculation is unavailable in the current organization.
      </p>
    );
  const mutable = record.status === "draft",
    approved = record.status === "approved",
    finalized = record.status === "finalized",
    linkedPayments = record.payments ?? [],
    paidCents = linkedPayments.reduce(
      (sum, payment) => sum + payment.amountCents,
      0,
    );
  return (
    <section aria-label="Saved payroll calculation">
      <div className="payroll-calculator__heading">
        <div>
          <h2>Saved calculation · {formatDate(record.input.payDate)}</h2>
          <p>
            {record.status} · version {record.version} · {record._id}
          </p>
        </div>
        {mutable && (
          <button
            type="button"
            className="btn"
            disabled={!canWrite || busy}
            onClick={() => onEdit(record.input, record._id)}
          >
            Edit draft inputs
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="payroll-calculator__blockers">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="payroll-calculator__notice">
          {notice}
        </p>
      )}
      <PayrollResultReview
        societyId={societyId}
        result={record.result}
        frozen
      />
      {record.reversedDate && (
        <p className="payroll-calculator__notice">
          Reversed effective {formatDate(record.reversedDate)} ·{" "}
          {record.reversalReason}
        </p>
      )}
      <section
        className="card payroll-calculator__panel"
        aria-label="Payroll approval and records"
      >
        <h3>Approval and records</h3>
        <p>
          Review this concrete saved result before approval. Finalization
          creates the payroll register record and optional accrual journal.
          Payments and external filings are separate actions.
        </p>
        <div className="payroll-calculator__actions">
          {mutable && (
            <button
              type="button"
              className="btn btn--accent"
              disabled={
                !canWrite ||
                busy ||
                record.result.blockers.length > 0 ||
                record.result.employees.some(
                  (employee) => employee.blockers.length > 0,
                )
              }
              onClick={() =>
                void action(
                  () =>
                    approve({ societyId, id, expectedVersion: record.version }),
                  "Calculation approved. Review the saved result before finalization.",
                )
              }
            >
              Approve calculation
            </button>
          )}
          {approved && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={post}
                  onChange={(e) => setPost(e.target.checked)}
                  disabled={!canWrite || busy}
                />{" "}
                Post balanced accrual journal
              </label>
              <button
                type="button"
                className="btn btn--accent"
                disabled={!canWrite || busy}
                onClick={() =>
                  void action(
                    () =>
                      finalize({
                        societyId,
                        id,
                        idempotencyKey: `payroll-finalize:${id}:v${record.version}`,
                        postToLedger: post,
                      }),
                    "Payroll finalized. No deposit or external filing was initiated.",
                  )
                }
              >
                Finalize calculation
              </button>
            </>
          )}
          {finalized && (
            <>
              <button
                type="button"
                className="btn"
                disabled={
                  !canWrite ||
                  busy ||
                  paidCents >= record.result.totals.netCents
                }
                onClick={() => setPayment(true)}
              >
                Link recorded bank payment
              </button>
              <button
                type="button"
                className="btn"
                disabled={!canWrite || busy}
                onClick={() => setReversing(true)}
              >
                Reverse finalized calculation
              </button>
            </>
          )}
          {(finalized || record.status === "reversed") && (
            <button
              type="button"
              className="btn"
              disabled={!canWrite || busy}
              onClick={() =>
                onReplacement({
                  ...record.input,
                  runType: "correction",
                  correctionOfId: record._id,
                })
              }
            >
              Create correction draft
            </button>
          )}
        </div>
        {record.payRunId && (
          <p>
            Recorded pay run: {record.payRunId} ·{" "}
            <a href="/app/payroll">Open payroll register</a>
          </p>
        )}
        {record.journalEntryIds?.length ? (
          <details>
            <summary>Retained journal references</summary>
            <ul>
              {record.journalEntryIds.map((entry) => (
                <li key={entry}>{entry}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>
      {linkedPayments.length > 0 && (
        <section
          className="card payroll-calculator__panel"
          aria-label="Recorded payroll payments"
        >
          <h3>Recorded bank payment provenance</h3>
          <p>
            Linked net pay <Money cents={paidCents} currency="CAD" /> · Unlinked
            net pay{" "}
            <Money
              cents={Math.max(0, record.result.totals.netCents - paidCents)}
              currency="CAD"
            />
            .
          </p>
          <div className="payroll-calculator__table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Effective date</th>
                  <th>For</th>
                  <th>Net amount</th>
                  <th>Reference</th>
                  <th>Method / destination</th>
                  <th>Bank transaction / clearing journal</th>
                </tr>
              </thead>
              <tbody>
                {linkedPayments.map((payment) => (
                  <tr key={payment.key}>
                    <td>{formatDate(payment.date)}</td>
                    <td>
                      {payment.employeeId
                        ? (record.result.employees.find(
                            (employee) =>
                              employee.employeeId === payment.employeeId,
                          )?.employeeName ?? payment.employeeId)
                        : "Whole calculation"}
                    </td>
                    <td>
                      <Money cents={payment.amountCents} currency="CAD" />
                    </td>
                    <td>{payment.reference}</td>
                    <td>
                      {payment.method
                        ? PAYMENT_METHODS[payment.method]
                        : "Method unknown"}
                      {payment.payee && <small>{payment.payee}</small>}
                      {payment.destinationReference && (
                        <small>{payment.destinationReference}</small>
                      )}
                    </td>
                    <td>
                      {payment.transactionId}
                      {payment.journalEntryId && (
                        <small>{payment.journalEntryId}</small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <a href="/app/financials">Open financial transactions</a>
        </section>
      )}
      {reversing && finalized && canWrite && (
        <SourceForm
          title="Payroll reversal"
          onCancel={() => setReversing(false)}
          onSave={async (data) => {
            await reverse({
              societyId,
              id,
              date: formText(data, "date"),
              reason: formText(data, "reason"),
              idempotencyKey: `payroll-reverse:${id}:${formText(data, "date")}`,
            });
            setReversing(false);
            setNotice("Dated reversal retained with the original snapshot.");
          }}
        >
          <p>
            The original record remains retained. The server checks open books
            and subsequent employee year-to-date dependencies.
          </p>
          <TextInput
            label="Reversal effective date"
            name="date"
            type="date"
            value={today}
            required
          />
          <TextInput label="Reversal reason" name="reason" required />
        </SourceForm>
      )}
      {payment && finalized && canWrite && (
        <PayrollPaymentForm
          societyId={societyId}
          record={record}
          today={today}
          onCancel={() => setPayment(false)}
        />
      )}
    </section>
  );
}
