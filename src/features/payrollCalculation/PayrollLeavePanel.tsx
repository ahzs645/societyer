import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { Field } from "../../components/ui";
import { StatTile } from "../../components/StatTile";
import { usePermissions } from "../../hooks/usePermissions";
import { triggerBlobDownload } from "../../lib/zip";
import { formatDate, formatDateTime } from "../../lib/format";
import {
  PAYROLL_VACATION_SOURCES,
  type PayrollVacationAudit,
  type PayrollVacationBalance,
  type PayrollVacationPeriodRecord,
  type PayrollVacationRequestRecord,
  type PayrollVacationStatus,
} from "../../../shared/payrollLeave";
import { payrollFailure, usePayrollPages } from "./payrollUi";
import { VacationPeriodForm, VacationRequestForm } from "./PayrollLeaveForms";
import { vacationHoursLabel, vacationTimeCsv } from "./payrollLeaveUi";
import { usePayrollLeavePages } from "./usePayrollLeavePages";
import "./payroll-leave.scss";

type Employee = {
  _id: string;
  name: string;
  startDate: string;
  endDate?: string;
};
const STATUS_LABELS: Record<PayrollVacationStatus, string> = {
  requested: "Requested",
  approved: "Approved",
  taken: "Taken",
  cancelled: "Cancelled",
  rejected: "Rejected",
};
function LeaveHistory({ events }: { events: PayrollVacationAudit[] }) {
  return (
    <details className="payroll-leave__history">
      <summary>Change history ({events.length})</summary>
      {events.length ? (
        <ol>
          {events.map((event, index) => (
            <li key={`${event.atISO}:${index}`}>
              <strong>{event.action.replaceAll("_", " ")}</strong> ·{" "}
              {formatDateTime(event.atISO)} · Previous version{" "}
              {event.previousVersion}
              {event.reason && <p>{event.reason}</p>}
            </li>
          ))}
        </ol>
      ) : (
        <p>No recorded changes.</p>
      )}
    </details>
  );
}
function LeaveRequestCard({
  societyId,
  record,
  today,
  canWrite,
  onEdit,
}: {
  societyId: string;
  record: PayrollVacationRequestRecord;
  today: string;
  canWrite: boolean;
  onEdit: () => void;
}) {
  const transition = useMutation(api.payrollLeave.transitionRequest),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function change(status: Exclude<PayrollVacationStatus, "requested">) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await transition({
        societyId,
        id: record._id,
        status,
        expectedVersion: record.version,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      setReason("");
    } catch (cause) {
      setError(payrollFailure(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article
      className="card payroll-calculator__panel payroll-leave__request"
      aria-label={`Vacation request: ${record.label}`}
    >
      <div className="payroll-calculator__heading">
        <div>
          <h4>{record.label}</h4>
          <p>
            {formatDate(record.startDate)}–{formatDate(record.endDate)} ·{" "}
            {vacationHoursLabel(record.minutes)}
          </p>
        </div>
        <strong>{STATUS_LABELS[record.status]}</strong>
      </div>
      <p>
        Version {record.version} · Request evidence: {record.evidence}
      </p>
      {record.lateUseEvidence && (
        <p>Late-use evidence: {record.lateUseEvidence}</p>
      )}
      {record.notes && <p>{record.notes}</p>}
      <div className="payroll-calculator__table-wrap">
        <table className="table">
          <caption>Recorded vacation dates</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Time</th>
              <th scope="col">Exact minutes</th>
              <th scope="col">Payroll work link</th>
            </tr>
          </thead>
          <tbody>
            {record.days.map((day) => (
              <tr key={day.date}>
                <td>{formatDate(day.date)}</td>
                <td>{vacationHoursLabel(day.minutes)}</td>
                <td>{day.minutes}</td>
                <td>
                  {day.payrollWorkDayId
                    ? "Linked same dated absence"
                    : "Unlinked"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <LeaveHistory events={record.history} />
      {!["cancelled", "rejected"].includes(record.status) && (
        <>
          <Field
            label={`Action reason for ${record.label}`}
            hint="Required for cancellation or rejection; retained in the change history."
          >
            <input
              className="input"
              value={reason}
              disabled={!canWrite || busy}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <div className="payroll-calculator__actions">
            {record.status === "requested" && (
              <>
                <button
                  type="button"
                  className="btn btn--sm"
                  disabled={!canWrite || busy}
                  onClick={onEdit}
                >
                  Edit requested leave
                </button>
                <button
                  type="button"
                  className="btn btn--sm"
                  disabled={!canWrite || busy}
                  onClick={() => void change("approved")}
                >
                  Approve leave
                </button>
                <button
                  type="button"
                  className="btn btn--sm"
                  disabled={!canWrite || busy}
                  onClick={() => void change("rejected")}
                >
                  Reject leave
                </button>
              </>
            )}
            {record.status === "approved" && (
              <button
                type="button"
                className="btn btn--sm"
                disabled={!canWrite || busy || record.endDate > today}
                onClick={() => void change("taken")}
              >
                Mark leave taken
              </button>
            )}
            <button
              type="button"
              className="btn btn--sm"
              disabled={!canWrite || busy}
              onClick={() => void change("cancelled")}
            >
              Cancel leave
            </button>
          </div>
          {record.status === "approved" && record.endDate > today && (
            <p className="muted">
              Leave can be marked taken after its last scheduled date.
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="payroll-calculator__blockers">
          {error}
        </p>
      )}
    </article>
  );
}
function exportLeaveCsv(
  employee: Employee,
  period: PayrollVacationPeriodRecord,
  balance: PayrollVacationBalance,
  requests: PayrollVacationRequestRecord[],
) {
  const rows: Array<Array<string | number | undefined>> = [
    ["Vacation time ledger"],
    ["Employee", employee.name],
    ["Employment start", period.employmentStartDate],
    ["Completed service year", period.serviceYear],
    ["Accrual start", period.accrualStart],
    ["Earned on", period.earnedOn],
    ["Take by", period.takeBy],
    ["As of", balance.asOf],
    ["Phase", balance.phase],
    ["Normal weekly minutes", period.normalWeeklyMinutes],
    ["Normal daily minutes", period.normalDailyMinutes],
    ["Statutory entitlement minutes", balance.statutoryMinutes],
    ["Additional contractual minutes", period.additionalEntitlementMinutes],
    ["Entitlement minutes", balance.entitlementMinutes],
    ["Carryover minutes", balance.carryoverMinutes],
    ["Opening through", period.openingThroughDate],
    ["Opening used minutes", balance.openingUsedMinutes],
    ["Taken minutes including opening", balance.takenMinutes],
    ["Approved minutes", balance.approvedMinutes],
    ["Requested minutes", balance.requestedMinutes],
    ["Remaining minutes", balance.remainingMinutes],
    ["Uncommitted minutes", balance.uncommittedMinutes],
    ["Opening evidence", period.openingEvidence],
    ["Policy evidence", period.policyEvidence],
    ...balance.warnings.map((warning) => ["Warning", warning]),
    [],
    [
      "Request",
      "Status",
      "Version",
      "Date",
      "Minutes",
      "Hours display",
      "Linked work record",
      "Request evidence",
      "Late-use evidence",
      "Short period requested",
      "Advance agreement",
      "Statutory holidays excluded",
    ],
  ];
  for (const request of requests)
    for (const day of request.days)
      rows.push([
        request.label,
        request.status,
        request.version,
        day.date,
        day.minutes,
        vacationHoursLabel(day.minutes),
        day.payrollWorkDayId,
        request.evidence,
        request.lateUseEvidence,
        String(request.employeeRequestedShortPeriod),
        String(request.advanceAgreementConfirmed),
        String(request.statutoryHolidaysExcluded),
      ]);
  rows.push(
    [],
    [
      "Audit scope",
      "Request",
      "When",
      "Action",
      "Reason",
      "Actor reference",
      "Previous version",
    ],
  );
  for (const event of period.history)
    rows.push([
      "Entitlement",
      "",
      event.atISO,
      event.action,
      event.reason,
      event.actorUserId,
      event.previousVersion,
    ]);
  for (const request of requests)
    for (const event of request.history)
      rows.push([
        "Request",
        request.label,
        event.atISO,
        event.action,
        event.reason,
        event.actorUserId,
        event.previousVersion,
      ]);
  triggerBlobDownload(
    new Blob([vacationTimeCsv(rows)], { type: "text/csv;charset=utf-8" }),
    `Vacation time ${employee.name} service year ${period.serviceYear}.csv`,
  );
}
function EmployeeLeaveWorkspace({
  societyId,
  employee,
  canWrite,
  canExport,
}: {
  societyId: string;
  employee: Employee;
  canWrite: boolean;
  canExport: boolean;
}) {
  const periods = usePayrollLeavePages<PayrollVacationPeriodRecord>(
      { societyId, employeeId: employee._id, collection: "periods" },
      "Vacation entitlement periods",
    ),
    [choice, setChoice] = useState(""),
    [editingPeriod, setEditingPeriod] = useState<
      PayrollVacationPeriodRecord | null | undefined
    >(),
    [editingRequest, setEditingRequest] = useState<
      PayrollVacationRequestRecord | null | undefined
    >();
  const selected =
    periods.rows.find((period) => period._id === choice) ?? periods.rows[0];
  const requests = usePayrollLeavePages<PayrollVacationRequestRecord>(
    selected
      ? {
          societyId,
          employeeId: employee._id,
          collection: "requests",
          periodId: selected._id,
        }
      : undefined,
    "Vacation request history",
  );
  const balance = requests.metadata?.balance ?? selected?.balance,
    today = periods.metadata?.today ?? new Date().toISOString().slice(0, 10),
    ready = periods.ready && requests.ready;
  const periodVersionChanged =
    editingPeriod &&
    periods.rows.find((row) => row._id === editingPeriod._id)?.version !==
      editingPeriod.version;
  return (
    <div className="form-stack">
      {periods.loader}
      {requests.loader}
      <div className="payroll-calculator__heading">
        <div>
          <h3>{employee.name}</h3>
          <p>
            Employment began {formatDate(employee.startDate)}
            {employee.endDate ? ` · Ended ${formatDate(employee.endDate)}` : ""}
          </p>
        </div>
        <button
          type="button"
          className="btn btn--accent"
          disabled={!canWrite || !periods.ready}
          onClick={() => setEditingPeriod(null)}
        >
          Add entitlement period
        </button>
      </div>
      {!ready && !periods.error && !requests.error && (
        <p role="status">
          Loading complete vacation balances and request history…
        </p>
      )}
      {editingPeriod !== undefined &&
        canWrite &&
        (periodVersionChanged ? (
          <p role="alert">
            This entitlement changed while you were editing.{" "}
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => setEditingPeriod(undefined)}
            >
              Close and review the current record
            </button>
          </p>
        ) : (
          <VacationPeriodForm
            key={
              editingPeriod
                ? `${editingPeriod._id}:${editingPeriod.version}`
                : "new"
            }
            societyId={societyId}
            employee={employee}
            value={editingPeriod ?? undefined}
            today={today}
            onCancel={() => setEditingPeriod(undefined)}
            onSaved={(id) => {
              setEditingPeriod(undefined);
              if (id) setChoice(id);
            }}
          />
        ))}
      {periods.ready && !periods.rows.length && (
        <p>
          No reviewed anniversary entitlement is recorded for this employee. Add
          the completed service year, actual schedule and opening history.
        </p>
      )}
      {selected && (
        <>
          <Field label="Vacation entitlement period">
            <select
              className="input"
              value={selected._id}
              disabled={!periods.ready}
              onChange={(event) => {
                setChoice(event.target.value);
                setEditingRequest(undefined);
              }}
            >
              {periods.rows.map((period) => (
                <option key={period._id} value={period._id}>
                  Service year {period.serviceYear} · Earned{" "}
                  {formatDate(period.earnedOn)} · Due{" "}
                  {formatDate(period.takeBy)}
                </option>
              ))}
            </select>
          </Field>
          {ready && balance && (
            <>
              <div className="payroll-calculator__heading">
                <p className="payroll-calculator__status">
                  {balance.phase === "before_entitlement"
                    ? "Planned entitlement before anniversary"
                    : balance.phase === "overdue"
                      ? "Overdue vacation remains due"
                      : "Earned vacation entitlement"}{" "}
                  · Take by {formatDate(balance.takeBy)}
                </p>
                <div className="payroll-calculator__actions">
                  <button
                    type="button"
                    className="btn btn--sm"
                    disabled={!canWrite}
                    onClick={() => setEditingPeriod(selected)}
                  >
                    Edit reviewed entitlement
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm"
                    disabled={!canExport || balance.complete !== true}
                    onClick={() =>
                      exportLeaveCsv(employee, selected, balance, requests.rows)
                    }
                  >
                    Export vacation time CSV
                  </button>
                </div>
              </div>
              <div className="stat-grid payroll-leave__stats">
                <StatTile
                  label="Entitlement time"
                  value={vacationHoursLabel(balance.entitlementMinutes)}
                  sub={`${balance.statutoryWeeks} statutory weeks plus reviewed contractual time`}
                />
                <StatTile
                  label="Opening carryover"
                  value={vacationHoursLabel(balance.carryoverMinutes)}
                />
                <StatTile
                  label="Taken time"
                  value={vacationHoursLabel(balance.takenMinutes)}
                  sub="Includes reviewed opening usage"
                />
                <StatTile
                  label="Approved time"
                  value={vacationHoursLabel(balance.approvedMinutes)}
                />
                <StatTile
                  label="Requested time"
                  value={vacationHoursLabel(balance.requestedMinutes)}
                  sub="Requested time is pending approval"
                />
                <StatTile
                  label="Remaining time"
                  value={vacationHoursLabel(balance.remainingMinutes)}
                  sub={`${balance.remainingDays.toLocaleString(undefined, { maximumFractionDigits: 3 })} normal days · ${balance.remainingWeeks.toLocaleString(undefined, { maximumFractionDigits: 3 })} normal weeks`}
                />
                <StatTile
                  label="Available after approved leave"
                  value={vacationHoursLabel(balance.uncommittedMinutes)}
                />
              </div>
              <div className="payroll-leave__details">
                <p>
                  Earned {formatDate(balance.earnedOn)} · Opening history
                  through {formatDate(selected.openingThroughDate)} · Normal
                  week {vacationHoursLabel(selected.normalWeeklyMinutes)} ·
                  Normal day {vacationHoursLabel(selected.normalDailyMinutes)}.
                </p>
                <p>Opening evidence: {selected.openingEvidence}</p>
                {selected.policyEvidence && (
                  <p>
                    Carryover / additional-time evidence:{" "}
                    {selected.policyEvidence}
                  </p>
                )}
                {selected.notes && <p>{selected.notes}</p>}
                <LeaveHistory events={selected.history} />
              </div>
              <div className="payroll-calculator__notice">
                {balance.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
              <div className="payroll-calculator__heading">
                <h3>Vacation requests and actual time taken</h3>
                <button
                  type="button"
                  className="btn btn--accent"
                  disabled={!canWrite}
                  onClick={() => setEditingRequest(null)}
                >
                  Add vacation request
                </button>
              </div>
              {editingRequest !== undefined && canWrite && (
                <VacationRequestForm
                  key={
                    editingRequest
                      ? `${editingRequest._id}:${editingRequest.version}`
                      : `new:${selected._id}`
                  }
                  societyId={societyId}
                  employeeId={employee._id}
                  period={selected}
                  value={editingRequest ?? undefined}
                  onCancel={() => setEditingRequest(undefined)}
                  onSaved={() => setEditingRequest(undefined)}
                />
              )}{" "}
              {!requests.rows.length && (
                <p>No dated vacation requests for this entitlement period.</p>
              )}
              {requests.rows.map((record) => (
                <LeaveRequestCard
                  key={record._id}
                  societyId={societyId}
                  record={record}
                  today={today}
                  canWrite={canWrite}
                  onEdit={() => setEditingRequest(record)}
                />
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
export function PayrollLeavePanel({ societyId }: { societyId: string }) {
  const permissions = usePermissions(),
    [employeeId, setEmployeeId] = useState("");
  const employees = usePayrollPages<Employee>(
    permissions.can("employees:read")
      ? { societyId, collection: "employees" }
      : undefined,
    "Vacation employee selection",
  );
  const employee = employees.rows.find((row) => row._id === employeeId);
  if (!permissions.can("employees:read"))
    return (
      <section aria-label="Vacation time">
        <h2>Vacation time</h2>
        <p role="alert">
          Employee read permission is required to view vacation-time records.
        </p>
      </section>
    );
  return (
    <section className="payroll-leave" aria-label="Vacation time">
      <h2>Vacation time</h2>
      <p>
        Review anniversary-based time entitlement, the employee’s actual
        schedule and dated absences. Vacation money remains in the payroll
        records.
      </p>
      {!permissions.can("financials:write") && (
        <p className="payroll-calculator__notice">
          Read-only vacation history. Finance write permission is required to
          change entitlement or leave status.
        </p>
      )}
      {employees.loader}
      <Field label="Vacation employee">
        <select
          className="input"
          value={employee?._id ?? ""}
          disabled={!employees.ready}
          onChange={(event) => setEmployeeId(event.target.value)}
        >
          <option value="">Select employee</option>
          {employees.rows.map((row) => (
            <option key={row._id} value={row._id}>
              {row.name}
            </option>
          ))}
        </select>
      </Field>
      {employees.ready && !employees.rows.length && (
        <p>
          Add an employee record with the actual employment start date before
          reviewing vacation entitlement.
        </p>
      )}
      {employee && (
        <EmployeeLeaveWorkspace
          key={`${societyId}:${employee._id}`}
          societyId={societyId}
          employee={employee}
          canWrite={permissions.can("financials:write")}
          canExport={permissions.can("exports:download")}
        />
      )}
      <details>
        <summary>Reviewed B.C. vacation-time sources</summary>
        <ul>
          {PAYROLL_VACATION_SOURCES.map((source) => (
            <li key={source.url}>
              <a href={source.url} target="_blank" rel="noreferrer">
                {source.title}
              </a>{" "}
              · Reviewed {source.reviewedOn}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
