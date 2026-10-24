import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { Field } from "../../components/ui";
import { formatDate } from "../../lib/format";
import {
  bcVacationTimeEntitlement,
  type PayrollVacationPeriodRecord,
  type PayrollVacationPeriodFields,
  type PayrollVacationRequestFields,
  type PayrollVacationRequestRecord,
} from "../../../shared/payrollLeave";
import {
  CheckInput,
  SourceForm,
  TextInput,
  formCheck,
  formOptional,
  formText,
} from "./PayrollSourceForms";
import { usePayrollPages } from "./payrollUi";
import {
  parseVacationHours,
  vacationHoursInput,
  vacationHoursLabel,
} from "./payrollLeaveUi";

type Employee = { _id: string; name: string; startDate: string };
export function VacationPeriodForm({
  societyId,
  employee,
  value,
  today,
  onSaved,
  onCancel,
}: {
  societyId: string;
  employee: Employee;
  value?: PayrollVacationPeriodRecord;
  today: string;
  onSaved: (id?: string) => void;
  onCancel: () => void;
}) {
  const save = useMutation(api.payrollLeave.savePeriod);
  const [serviceYear, setServiceYear] = useState(
      String(value?.serviceYear ?? 1),
    ),
    [weekly, setWeekly] = useState(
      value ? vacationHoursInput(value.normalWeeklyMinutes) : "",
    ),
    [daily, setDaily] = useState(
      value ? vacationHoursInput(value.normalDailyMinutes) : "",
    );
  let preview: ReturnType<typeof bcVacationTimeEntitlement> | undefined;
  try {
    preview = bcVacationTimeEntitlement(
      employee.startDate,
      Number(serviceYear),
      parseVacationHours(weekly, "Normal weekly time"),
    );
  } catch {
    /* The required fields and server validator explain incomplete inputs on save. */
  }
  return (
    <SourceForm
      title="Vacation entitlement"
      onCancel={onCancel}
      onSave={async (data) => {
        const fields: PayrollVacationPeriodFields = {
          serviceYear: Number(formText(data, "serviceYear")),
          provinceOfEmployment: "BC",
          normalWeeklyMinutes: parseVacationHours(
            formText(data, "weekly"),
            "Normal weekly time",
          ),
          normalDailyMinutes: parseVacationHours(
            formText(data, "daily"),
            "Normal daily time",
          ),
          openingThroughDate: formText(data, "openingThroughDate"),
          openingUsedMinutes: parseVacationHours(
            formText(data, "openingUsed"),
            "Opening used time",
          ),
          openingCarryoverMinutes: parseVacationHours(
            formText(data, "carryover"),
            "Opening carryover time",
          ),
          openingReviewed: formCheck(data, "openingReviewed"),
          openingEvidence: formText(data, "openingEvidence"),
          additionalEntitlementMinutes: parseVacationHours(
            formText(data, "additional"),
            "Additional contractual time",
          ),
          policyEvidence: formOptional(data, "policyEvidence"),
          notes: formOptional(data, "notes"),
        };
        const id = await save({
          societyId,
          employeeId: employee._id,
          ...(value ? { id: value._id } : {}),
          fields,
        });
        onSaved(typeof id === "string" ? id : undefined);
      }}
    >
      <p>
        {employee.name} · Employment began {formatDate(employee.startDate)}.
        B.C. entitlement follows completed service years: two weeks after one
        year and three weeks after five years.
      </p>
      <div className="form-grid">
        <Field
          label="Completed service year"
          hint="Year 1 is earned on the first employment anniversary."
        >
          <input
            className="input"
            name="serviceYear"
            type="number"
            min="1"
            max="100"
            required
            value={serviceYear}
            onChange={(event) => setServiceYear(event.target.value)}
          />
        </Field>
        <Field
          label="Normal weekly scheduled hours"
          hint="Use H:MM or an exact decimal such as 37:30 or 37.5."
        >
          <input
            className="input"
            name="weekly"
            required
            value={weekly}
            onChange={(event) => setWeekly(event.target.value)}
          />
        </Field>
        <Field
          label="Normal daily scheduled hours"
          hint="Reviewed actual schedule; used to display equivalent days."
        >
          <input
            className="input"
            name="daily"
            required
            value={daily}
            onChange={(event) => setDaily(event.target.value)}
          />
        </Field>
      </div>
      {preview && (
        <p role="status">
          Earned on {formatDate(preview.earnedOn)} · Take by{" "}
          {formatDate(preview.takeBy)} · Statutory time{" "}
          {vacationHoursLabel(preview.statutoryMinutes)} (
          {preview.statutoryWeeks} weeks).{" "}
          {preview.earnedOn > today
            ? "This is a planned future entitlement."
            : ""}
        </p>
      )}
      <div className="form-grid">
        <TextInput
          label="Opening history covers through"
          name="openingThroughDate"
          type="date"
          value={value?.openingThroughDate}
          required
          hint="Enter the actual date through which earlier leave is already included in this opening."
        />
        <TextInput
          label="Vacation already used in opening (hours)"
          name="openingUsed"
          value={vacationHoursInput(value?.openingUsedMinutes ?? 0)}
          required
        />
        <TextInput
          label="Reviewed carryover from untracked history (hours)"
          name="carryover"
          value={vacationHoursInput(value?.openingCarryoverMinutes ?? 0)}
          required
          hint="Keep separately tracked prior-period balances separate to prevent counting the same time twice."
        />
        <TextInput
          label="Additional contractual entitlement (hours)"
          name="additional"
          value={vacationHoursInput(value?.additionalEntitlementMinutes ?? 0)}
          required
        />
        <TextInput
          label="Opening balance evidence"
          name="openingEvidence"
          value={value?.openingEvidence}
          required
          hint="Record the reviewed prior usage or an explicit zero opening and its source."
        />
        <TextInput
          label="Additional entitlement / carryover policy evidence"
          name="policyEvidence"
          value={value?.policyEvidence}
          hint="Required when additional entitlement or carryover is entered."
        />
        <TextInput
          label="Vacation entitlement notes"
          name="notes"
          value={value?.notes}
        />
      </div>
      <CheckInput
        label="I reviewed complete opening vacation-time history, including any explicit zero balance"
        name="openingReviewed"
        checked={value?.openingReviewed}
      />
      <p className="muted">
        Vacation paid on each cheque still leaves the time entitlement in place.
        Schedule changes recalculate statutory time; saved absence records
        retain their exact minutes.
      </p>
    </SourceForm>
  );
}

type DayDraft = { date: string; hours: string; payrollWorkDayId: string };
type WorkRow = {
  _id: string;
  date: string;
  minutes: number;
  paidVacationMinutes?: number;
  holiday?: boolean;
  vacationRequestId?: string;
};
export function VacationRequestForm({
  societyId,
  employeeId,
  period,
  value,
  onSaved,
  onCancel,
}: {
  societyId: string;
  employeeId: string;
  period: PayrollVacationPeriodRecord;
  value?: PayrollVacationRequestRecord;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const save = useMutation(api.payrollLeave.saveRequest);
  const [days, setDays] = useState<DayDraft[]>(() =>
    value
      ? value.days.map((day) => ({
          date: day.date,
          hours: vacationHoursInput(day.minutes),
          payrollWorkDayId: day.payrollWorkDayId ?? "",
        }))
      : [
          {
            date: "",
            hours: vacationHoursInput(period.normalDailyMinutes),
            payrollWorkDayId: "",
          },
        ],
  );
  const dateSpan = useMemo(() => {
    const dates = days
      .map((day) => day.date)
      .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
      .sort();
    return dates.length
      ? { from: dates[0], to: dates[dates.length - 1] }
      : null;
  }, [days]);
  const work = usePayrollPages<WorkRow>(
    dateSpan
      ? { societyId, employeeId, collection: "work", ...dateSpan }
      : undefined,
    "Linkable vacation work records",
  );
  let total: number | undefined;
  try {
    total = days.reduce(
      (sum, day) => sum + parseVacationHours(day.hours, "Vacation date"),
      0,
    );
  } catch {
    /* Incomplete rows remain editable. */
  }
  return (
    <SourceForm
      title="Vacation request"
      onCancel={onCancel}
      onSave={async (data) => {
        const fields: PayrollVacationRequestFields = {
          label: formText(data, "label"),
          days: days.map((day, index) => ({
            date: day.date,
            minutes: parseVacationHours(
              day.hours,
              `Vacation date ${index + 1}`,
            ),
            ...(day.payrollWorkDayId
              ? { payrollWorkDayId: day.payrollWorkDayId }
              : {}),
          })),
          employeeRequestedShortPeriod: formCheck(data, "shortPeriod"),
          advanceAgreementConfirmed: formCheck(data, "advance"),
          statutoryHolidaysExcluded: formCheck(data, "holidaysExcluded"),
          evidence: formText(data, "evidence"),
          lateUseEvidence: formOptional(data, "lateUseEvidence"),
          notes: formOptional(data, "notes"),
        };
        await save({
          societyId,
          employeeId,
          periodId: period._id,
          ...(value ? { id: value._id } : {}),
          fields,
        });
        onSaved();
      }}
    >
      <p>
        Service year {period.serviceYear} · Earned {formatDate(period.earnedOn)}{" "}
        · Take by {formatDate(period.takeBy)}. Enter each actual vacation date
        and exact time.
      </p>
      <TextInput
        label="Vacation request label"
        name="label"
        value={value?.label}
        required
      />
      {days.map((day, index) => (
        <div className="payroll-leave__day" key={index}>
          <Field label={`Vacation date ${index + 1}`}>
            <input
              className="input"
              type="date"
              required
              value={day.date}
              onChange={(event) =>
                setDays((old) =>
                  old.map((row, i) =>
                    i === index
                      ? {
                          ...row,
                          date: event.target.value,
                          payrollWorkDayId: "",
                        }
                      : row,
                  ),
                )
              }
            />
          </Field>
          <Field
            label={`Vacation hours ${index + 1}`}
            hint="H:MM or a decimal representing whole minutes."
          >
            <input
              className="input"
              required
              value={day.hours}
              onChange={(event) =>
                setDays((old) =>
                  old.map((row, i) =>
                    i === index ? { ...row, hours: event.target.value } : row,
                  ),
                )
              }
            />
          </Field>
          <Field
            label={`Linked payroll work record ${index + 1}`}
            hint="Optional: link the same dated absence already entered in payroll."
          >
            <select
              className="input"
              value={day.payrollWorkDayId}
              disabled={!work.ready}
              onChange={(event) =>
                setDays((old) =>
                  old.map((row, i) =>
                    i === index
                      ? { ...row, payrollWorkDayId: event.target.value }
                      : row,
                  ),
                )
              }
            >
              <option value="">No linked work record</option>
              {work.rows
                .filter((row) => row.date === day.date)
                .map((row) => (
                  <option key={row._id} value={row._id}>
                    {formatDate(row.date)} · Vacation{" "}
                    {vacationHoursLabel(row.paidVacationMinutes ?? 0)}
                    {row.holiday ? " · statutory holiday review required" : ""}
                  </option>
                ))}
            </select>
          </Field>
          <button
            type="button"
            className="btn btn--sm"
            disabled={days.length === 1}
            onClick={() => setDays((old) => old.filter((_, i) => i !== index))}
          >
            Remove date {index + 1}
          </button>
        </div>
      ))}
      {work.loader}
      <button
        type="button"
        className="btn btn--sm"
        disabled={days.length >= 366}
        onClick={() =>
          setDays((old) => [
            ...old,
            {
              date: "",
              hours: vacationHoursInput(period.normalDailyMinutes),
              payrollWorkDayId: "",
            },
          ])
        }
      >
        Add vacation date
      </button>
      {total !== undefined && (
        <p role="status">
          Requested time: {vacationHoursLabel(total)} ({total} minutes).
        </p>
      )}
      <div className="form-grid">
        <TextInput
          label="Employee request / approval evidence"
          name="evidence"
          value={value?.evidence}
          required
        />
        <TextInput
          label="Evidence for use after the due date"
          name="lateUseEvidence"
          value={value?.lateUseEvidence}
          hint="Required for a retained record after the statutory use-by date; it does not extend that deadline."
        />
        <TextInput
          label="Vacation request notes"
          name="notes"
          value={value?.notes}
        />
      </div>
      <CheckInput
        label="Employee requested a vacation period shorter than one week"
        name="shortPeriod"
        checked={value?.employeeRequestedShortPeriod}
      />
      <CheckInput
        label="Advance vacation before the anniversary has an approved agreement"
        name="advance"
        checked={value?.advanceAgreementConfirmed}
      />
      <CheckInput
        label="Entitled statutory holidays are excluded from these vacation minutes"
        name="holidaysExcluded"
        checked={value?.statutoryHolidaysExcluded}
      />
      <p className="muted">
        This records absence time. Record the corresponding vacation pay in the
        existing payroll workflow when due.
      </p>
    </SourceForm>
  );
}
