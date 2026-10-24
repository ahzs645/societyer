import { useState } from "react";
import { Field } from "../../components/ui";
import type {
  PayrollVacationPeriodRecord,
  PayrollVacationRequestRecord,
} from "../../../shared/payrollLeave";
import { usePayrollLeavePages } from "./usePayrollLeavePages";

export function PayrollVacationRequestPicker({
  societyId,
  employeeId,
  onSelected,
  onCancel,
}: {
  societyId: string;
  employeeId: string;
  onSelected: (request: PayrollVacationRequestRecord) => void;
  onCancel: () => void;
}) {
  const [periodId, setPeriodId] = useState("");
  const periods = usePayrollLeavePages<PayrollVacationPeriodRecord>(
      { societyId, employeeId, collection: "periods" },
      "Vacation entitlement periods",
    ),
    requests = usePayrollLeavePages<PayrollVacationRequestRecord>(
      periodId
        ? { societyId, employeeId, collection: "requests", periodId }
        : undefined,
      "Approved vacation request sources",
    );
  const eligible = requests.rows.filter(
    (request) => request.status === "approved" || request.status === "taken",
  );
  return (
    <section
      className="payroll-calculator__notice"
      aria-label="Approved vacation request picker"
    >
      {periods.loader}
      {requests.loader}
      <Field label="Vacation entitlement period for payout">
        <select
          className="input"
          value={periodId}
          disabled={!periods.ready}
          onChange={(event) => setPeriodId(event.target.value)}
        >
          <option value="">Select the employee’s entitlement period</option>
          {periods.rows.map((period) => (
            <option key={period._id} value={period._id}>
              Service year {period.serviceYear} · earned {period.earnedOn} · use
              by {period.takeBy}
            </option>
          ))}
        </select>
      </Field>
      {!periods.ready && !periods.error && (
        <p role="status">Loading all vacation periods…</p>
      )}
      {periodId && !requests.ready && !requests.error && (
        <p role="status">Loading all request pages…</p>
      )}
      {periodId &&
        requests.ready &&
        eligible.map((request) => (
          <div key={request._id} className="payroll-calculator__record">
            <div>
              <strong>
                {request.label} · {request.status}
              </strong>
              <p>
                {request.startDate}–{request.endDate} · {request.minutes} exact
                minutes
              </p>
            </div>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => onSelected(request)}
            >
              Use request {request.label}
            </button>
          </div>
        ))}
      {periodId && requests.ready && !eligible.length && (
        <p>No approved or taken requests in this period.</p>
      )}
      <button type="button" className="btn btn--sm" onClick={onCancel}>
        Close vacation request picker
      </button>
    </section>
  );
}
