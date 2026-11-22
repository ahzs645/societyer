import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  payrollLocalTimestamp,
  payrollTimestampFromLocal,
} from "./payrollTime";
import { Banner, Field } from "../../components/ui";
import { Select } from "../../components/Select";
import type {
  CalculationInput,
  EarningCodeFields,
  EmployerSettingsFields,
  PayrollCalculationAdjustment,
} from "../../../shared/payrollCalculation";
import {
  amountInput,
  payrollFailure,
  payrollFields,
  payrollMoney,
  payrollNumber,
  usePayrollPages,
  type PayrollRow,
} from "./payrollUi";
import {
  formOptional,
  formText,
  pickerName,
  SelectInput,
  TextInput,
  type PayrollPickerRow,
} from "./PayrollSourceForms";
import { payrollScheduleSelection } from "./payrollSchedule";
import {
  PayrollVacationPayoutFields,
  vacationPayoutDrafts,
  readVacationPayoutDrafts,
} from "./PayrollVacationPayoutFields";
import {
  PayrollRunEmployerCostsFields,
  runCostDrafts,
  readRunCostDrafts,
} from "./PayrollRunEmployerCostsFields";
import { PayrollRuleEditionPicker } from "./PayrollRuleEditionPicker";

export type PayrollRecordSummary = {
  _id: string;
  status: string;
  version: number;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  runType: string;
  employeeIds: string[];
  totals?: { netCents: number; employerCostCents: number };
  blockerCount?: number;
};
type AdjustmentDraft = {
  employeeId: string;
  earningCodeId: string;
  date: string;
  amount: string;
  label: string;
  hours: string;
  rate: string;
};
export function PayrollRunForm({
  societyId,
  today,
  employees,
  codes,
  records,
  value,
  onPreview,
  onChanged,
  canWrite,
}: {
  societyId: string;
  today: string;
  employees: PayrollPickerRow[];
  codes: PayrollRow<EarningCodeFields>[];
  records: PayrollRecordSummary[];
  value?: CalculationInput;
  onPreview: (input: CalculationInput) => void;
  onChanged: () => void;
  canWrite: boolean;
}) {
  const [selected, setSelected] = useState<string[]>(value?.employeeIds ?? []),
    [adjustments, setAdjustments] = useState<AdjustmentDraft[]>(
      (value?.adjustments ?? []).map((row) => ({
        employeeId: row.employeeId,
        earningCodeId: row.earningCodeId,
        date: row.date,
        amount: amountInput(row.amountCents),
        label: row.label ?? "",
        hours: row.hours === undefined ? "" : String(row.hours),
        rate: amountInput(row.rateCents),
      })),
    ),
    [error, setError] = useState("");
  const [runType, setRunType] = useState<CalculationInput["runType"]>(
    value?.runType ?? "regular",
  );
  const [method, setMethod] = useState<CalculationInput["method"]>(
      value?.method ?? "option1",
    ),
    [ruleEditionId, setRuleEditionId] = useState<string | undefined>(
      value?.ruleEditionId,
    );
  const [vacationPayouts, setVacationPayouts] = useState(() =>
    vacationPayoutDrafts(value?.vacationPayouts),
  );
  const [runCosts, setRunCosts] = useState(() =>
    runCostDrafts(value?.employerCostOverrides),
  );
  const [payDate, setPayDate] = useState(value?.payDate ?? today),
    [regularPayDate, setRegularPayDate] = useState(value?.regularPayDate ?? "");
  const calendarYear = /^\d{4}-\d{2}-\d{2}$/.test(payDate)
    ? Number(payDate.slice(0, 4))
    : undefined;
  const calendars = usePayrollPages<PayrollRow<EmployerSettingsFields>>(
    calendarYear && calendarYear >= 2024 && calendarYear <= 2100
      ? { societyId, collection: "employer", year: calendarYear }
      : undefined,
    "Reviewed payment-year calendar",
  );
  const payDates =
    calendars.rows.find((row) => payrollFields(row)?.year === calendarYear)
      ?.payDates ?? [];
  const schedule = payrollScheduleSelection({
    payDate,
    runType,
    payDates,
    selectedDate: regularPayDate,
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      const data = new FormData(event.currentTarget);
      if (!selected.length) throw new Error("Select at least one employee.");
      if (schedule.required && !schedule.regularPayDate)
        throw new Error(
          "Select the applicable regular pay date from the saved reviewed annual calendar.",
        );
      if (schedule.showSelector && regularPayDate && !schedule.regularPayDate)
        throw new Error(
          "The retained regular pay date is no longer in the reviewed calendar. Select an available scheduled date.",
        );
      adjustments.forEach((row, index) => {
        if (!row.employeeId)
          throw new Error(`Select the employee for adjustment ${index + 1}.`);
        if (!row.earningCodeId)
          throw new Error(
            `Select the reviewed earning code for adjustment ${index + 1}.`,
          );
      });
      const rows: PayrollCalculationAdjustment[] = adjustments.map(
        (row, index) => ({
          employeeId: row.employeeId,
          earningCodeId: row.earningCodeId,
          date: row.date,
          amountCents: payrollMoney(row.amount, `Adjustment ${index + 1}`)!,
          label: row.label || undefined,
          hours: payrollNumber(
            row.hours,
            `Adjustment ${index + 1} hours`,
            true,
          ),
          rateCents: payrollMoney(
            row.rate,
            `Adjustment ${index + 1} rate`,
            true,
          ),
        }),
      );
      if (rows.some((row) => !selected.includes(row.employeeId)))
        throw new Error("Every adjustment must belong to a selected employee.");
      const input: CalculationInput = {
        periodStart: formText(data, "periodStart"),
        periodEnd: formText(data, "periodEnd"),
        payDate,
        regularPayDate: schedule.regularPayDate,
        runType,
        employeeIds: selected,
        method,
        ruleEditionId,
        adjustments: rows,
        vacationPayouts: readVacationPayoutDrafts(vacationPayouts, selected),
        employerCostOverrides: readRunCostDrafts(runCosts, selected),
        correctionOfId: formOptional(data, "correctionOfId"),
        termination:
          runType === "final"
            ? {
                at: payrollTimestampFromLocal(
                  formText(data, "terminationAt"),
                  value?.termination?.at,
                ),
                initiatedBy: formText(data, "initiatedBy") as
                  | "employer"
                  | "employee",
                paidAt: formOptional(data, "paidAt")
                  ? payrollTimestampFromLocal(
                      formText(data, "paidAt"),
                      value?.termination?.paidAt,
                    )
                  : undefined,
              }
            : undefined,
      };
      onPreview(input);
    } catch (cause) {
      setError(payrollFailure(cause));
    }
  }
  function patch(index: number, change: Partial<AdjustmentDraft>) {
    setAdjustments((old) =>
      old.map((row, i) => (i === index ? { ...row, ...change } : row)),
    );
  }
  const liveCodes = codes.filter((row) => payrollFields(row)?.active);
  return (
    <form
      className="card payroll-calculator__panel"
      aria-label="Payroll run inputs"
      onSubmit={submit}
      onChange={onChanged}
    >
      <div className="card__head">
        <h2 className="card__title">Calculate payroll</h2>
      </div>
      <div className="card__body">
        <p className="muted">
          Payment date selects the deduction year and official rule edition. Work
          dates select earnings rules. Preview does not record a payment.
        </p>
        {error && <Banner tone="danger">{error}</Banner>}
        <div className="payroll-calculator__form-grid payroll-calculator__form-grid--run">
          <TextInput
            label="Pay period start"
            name="periodStart"
            type="date"
            value={value?.periodStart ?? `${today.slice(0, 7)}-01`}
            required
          />
          <TextInput
            label="Pay period end"
            name="periodEnd"
            type="date"
            value={value?.periodEnd ?? today}
            required
          />
          <Field label="Payment date">
            <input
              className="input"
              name="payDate"
              type="date"
              required
              value={payDate}
              onChange={(event) => {
                setPayDate(event.target.value);
                setRegularPayDate("");
              }}
            />
          </Field>
          <Field label="Run type">
            <Select<CalculationInput["runType"]>
              value={runType}
              onChange={(value) => {
                setRunType(value);
                setRegularPayDate("");
                onChanged();
              }}
              options={(
                ["regular", "bonus", "off_cycle", "final", "correction"] as const
              ).map((kind) => ({ value: kind, label: kind.replaceAll("_", " ") }))}
            />
          </Field>
          <Field label="CRA calculation method">
            <Select<CalculationInput["method"]>
              value={method}
              onChange={(value) => {
                setMethod(value);
                onChanged();
              }}
              options={[
                { value: "option1", label: "Option 1 — annualized current pay" },
                { value: "option2", label: "Option 2 — cumulative average" },
              ]}
            />
          </Field>
          <SelectInput
            label="Correction of calculation"
            name="correctionOfId"
            value={value?.correctionOfId}
            optional
            onChange={onChanged}
            choices={[
              ...records
                .filter(
                  (row) =>
                    row.status === "finalized" || row.status === "reversed",
                )
                .map((row) => ({
                  value: row._id,
                  label: `${row.payDate} · ${row.runType} · ${row._id}`,
                })),
              ...(value?.correctionOfId &&
              !records.some((row) => row._id === value.correctionOfId)
                ? [
                    {
                      value: value.correctionOfId,
                      label: `Retained correction source · ${value.correctionOfId}`,
                    },
                  ]
                : []),
            ]}
          />
        </div>
        {calendars.loader}
        <PayrollRuleEditionPicker
          societyId={societyId}
          payDate={payDate}
          method={method}
          value={ruleEditionId}
          onChange={(id) => {
            setRuleEditionId(id);
            onChanged();
          }}
        />
        {schedule.showSelector && (
          <Field
            label="Applicable regular pay date"
            hint="Choose the scheduled cheque this early or off-cycle payment belongs to. The saved selection determines the CRA regular period number; it does not change the actual payment date."
          >
            <Select
              disabled={!calendars.ready}
              value={regularPayDate}
              onChange={(value) => {
                setRegularPayDate(value);
                onChanged();
              }}
              placeholder={
                schedule.required
                  ? "Choose the applicable scheduled pay date"
                  : "Automatic only when a prior regular period identifies it"
              }
              clearable={!schedule.required}
              clearLabel="Automatic only when a prior regular period identifies it"
              options={[
                ...(regularPayDate && !payDates.includes(regularPayDate)
                  ? [
                      {
                        value: regularPayDate,
                        label: `Retained date missing from current calendar · ${regularPayDate}`,
                      },
                    ]
                  : []),
                ...[...payDates].sort().map((date, index) => ({
                  value: date,
                  label: `${date} · regular pay ${index + 1} of ${payDates.length}`,
                })),
              ]}
            />
          </Field>
        )}
        {schedule.showSelector && calendars.ready && !payDates.length && (
          <Banner tone="danger">
            No reviewed annual calendar is saved for payment year{" "}
            {calendarYear ?? "selected"}. Configure the actual pay dates under
            Employer setup before selecting an applicable regular pay date.
          </Banner>
        )}
        {schedule.scheduled && (
          <p className="muted">
            Actual payment date is in the reviewed regular calendar; its scheduled
            period is selected automatically.
          </p>
        )}
        <fieldset className="payroll-calculator__fieldset">
          <legend>Employees in this run</legend>
          <div className="payroll-calculator__employee-picker">
            {employees.map((employee) => (
              <label key={employee._id}>
                <input
                  type="checkbox"
                  checked={selected.includes(employee._id)}
                  onChange={(e) =>
                    setSelected((old) =>
                      e.target.checked
                        ? [...old, employee._id]
                        : old.filter((id) => id !== employee._id),
                    )
                  }
                />{" "}
                {pickerName(employee)}
                {employee.status ? ` · ${employee.status}` : ""}
              </label>
            ))}
          </div>
          {!employees.length && (
            <p>
              Create an employee in the{" "}
              <Link to="/app/employees">employee directory</Link> before calculating.
            </p>
          )}
        </fieldset>
        {runType === "final" && (
          <fieldset className="payroll-calculator__fieldset">
            <legend>Final-pay timing</legend>
            <div className="payroll-calculator__form-grid">
              <TextInput
                label="Employment ended at"
                name="terminationAt"
                type="datetime-local"
                value={payrollLocalTimestamp(value?.termination?.at)}
                required
                hint={`Browser local timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}. The exact instant is retained, including seconds.`}
              />
              <SelectInput
                label="Termination initiated by"
                name="initiatedBy"
                value={value?.termination?.initiatedBy ?? "employer"}
                choices={["employer", "employee"]}
                onChange={onChanged}
              />
              <TextInput
                label="Final wages paid at"
                name="paidAt"
                type="datetime-local"
                value={payrollLocalTimestamp(value?.termination?.paidAt)}
              />
            </div>
          </fieldset>
        )}
        <PayrollVacationPayoutFields
          societyId={societyId}
          employees={employees.filter((employee) =>
            selected.includes(employee._id),
          )}
          rows={vacationPayouts}
          onChange={(rows) => {
            setVacationPayouts(rows);
            onChanged();
          }}
        />
        <PayrollRunEmployerCostsFields
          employees={employees.filter((employee) =>
            selected.includes(employee._id),
          )}
          rows={runCosts}
          onChange={(rows) => {
            setRunCosts(rows);
            onChanged();
          }}
        />
        <h3 className="payroll-calculator__subheading payroll-calculator__subheading--divided">
          Classified adjustments
        </h3>
        <p>
          Use reviewed earning codes for bonuses, taxable benefits,
          reimbursements, and other additions. Cash and taxable bases remain
          separate.
        </p>
        {adjustments.map((row, index) => (
          <fieldset key={index} className="payroll-calculator__fieldset">
            <legend>Adjustment {index + 1}</legend>
            <div className="payroll-calculator__form-grid">
              <Field label={`Adjustment ${index + 1} employee`}>
                <Select
                  value={row.employeeId}
                  onChange={(employeeId) => {
                    patch(index, { employeeId });
                    onChanged();
                  }}
                  placeholder="Select employee"
                  options={employees
                    .filter((employee) => selected.includes(employee._id))
                    .map((employee) => ({
                      value: employee._id,
                      label: pickerName(employee),
                    }))}
                />
              </Field>
              <Field label={`Adjustment ${index + 1} earning code`}>
                <Select
                  value={row.earningCodeId}
                  onChange={(earningCodeId) => {
                    patch(index, { earningCodeId });
                    onChanged();
                  }}
                  placeholder="Select reviewed code"
                  options={liveCodes.map((code) => ({
                    value: code._id,
                    label: `${payrollFields(code)?.code} · ${payrollFields(code)?.name}`,
                  }))}
                />
              </Field>
              {(
                [
                  ["date", "Date"],
                  ["amount", "Amount"],
                  ["label", "Label"],
                  ["hours", "Hours (optional)"],
                  ["rate", "Rate (optional)"],
                ] as const
              ).map(([key, label]) => (
                <Field
                  key={key}
                  label={`Adjustment ${index + 1} ${label.toLowerCase()}`}
                >
                  <input
                    className="input"
                    type={key === "date" ? "date" : "text"}
                    required={key === "date" || key === "amount"}
                    value={row[key]}
                    onChange={(e) => patch(index, { [key]: e.target.value })}
                  />
                </Field>
              ))}
            </div>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => {
                setAdjustments((old) => old.filter((_, i) => i !== index));
                onChanged();
              }}
            >
              Remove adjustment {index + 1}
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          className="btn btn--sm"
          disabled={!selected.length || !liveCodes.length || !canWrite}
          onClick={() => {
            setAdjustments((old) => [
              ...old,
              {
                employeeId: selected[0] ?? "",
                earningCodeId: liveCodes[0]?._id ?? "",
                date: today,
                amount: "",
                label: "",
                hours: "",
                rate: "",
              },
            ]);
            onChanged();
          }}
        >
          Add classified adjustment
        </button>
        {!liveCodes.length && (
          <p className="muted">
            Create a reviewed active earning code in Earning codes to add
            adjustments.
          </p>
        )}
        <div className="payroll-calculator__actions">
          <button
            className="btn btn--accent"
            disabled={
              !selected.length ||
              !canWrite ||
              !calendars.ready ||
              (schedule.required && !payDates.length)
            }
          >
            Preview calculation
          </button>
        </div>
      </div>
    </form>
  );
}
