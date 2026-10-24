import { lazy, Suspense, useState } from "react";
import { Field } from "../../components/ui";
import type { CalculationInput } from "../../../shared/payrollCalculation";
import { amountInput, payrollMoney, payrollNumber } from "./payrollUi";
import { pickerName, type PayrollPickerRow } from "./PayrollSourceForms";

const RequestPicker = lazy(() =>
  import("./PayrollVacationRequestPicker").then((module) => ({
    default: module.PayrollVacationRequestPicker,
  })),
);
export type PayrollVacationPayoutDraft = {
  employeeId: string;
  amount: string;
  sourceReference: string;
  treatment: "vacation_leave" | "unused_cashout";
  hours: string;
  vacationRequestId: string;
  requestLabel: string;
};
export function vacationPayoutDrafts(
  value: CalculationInput["vacationPayouts"],
): PayrollVacationPayoutDraft[] {
  return (value ?? []).map((row) => ({
    employeeId: row.employeeId,
    amount: amountInput(row.amountCents),
    sourceReference: row.sourceReference,
    treatment: row.treatment,
    hours:
      row.insurableMinutes === undefined
        ? ""
        : String(row.insurableMinutes / 60),
    vacationRequestId: row.vacationRequestId ?? "",
    requestLabel: row.vacationRequestId
      ? "Retained approved/taken request"
      : "",
  }));
}
export function readVacationPayoutDrafts(
  rows: PayrollVacationPayoutDraft[],
  selected: string[],
): CalculationInput["vacationPayouts"] {
  return rows.length
    ? rows.map((row, index) => {
        if (!selected.includes(row.employeeId))
          throw new Error(
            `Vacation payout ${index + 1} must belong to a selected employee.`,
          );
        const amountCents = payrollMoney(
          row.amount,
          `Vacation payout ${index + 1}`,
        )!;
        if (amountCents <= 0)
          throw new Error("A vacation payout must be greater than zero.");
        if (!row.sourceReference.trim())
          throw new Error(
            "Record the reviewed prior vacation-liability source reference.",
          );
        const hours = payrollNumber(
            row.hours,
            `Vacation payout ${index + 1} actual insurable hours`,
            true,
          ),
          insurableMinutes =
            hours === undefined ? undefined : Math.round(hours * 60);
        if (
          hours !== undefined &&
          Math.abs(hours * 60 - insurableMinutes!) > 1e-7
        )
          throw new Error(
            "Vacation insurable hours must resolve to whole minutes.",
          );
        return {
          employeeId: row.employeeId,
          amountCents,
          sourceReference: row.sourceReference.trim(),
          treatment: row.treatment,
          insurableMinutes,
          vacationRequestId: row.vacationRequestId || undefined,
        };
      })
    : undefined;
}
export function PayrollVacationPayoutFields({
  societyId,
  employees,
  rows,
  onChange,
}: {
  societyId: string;
  employees: PayrollPickerRow[];
  rows: PayrollVacationPayoutDraft[];
  onChange: (rows: PayrollVacationPayoutDraft[]) => void;
}) {
  const [picking, setPicking] = useState<number | null>(null);
  function patch(index: number, change: Partial<PayrollVacationPayoutDraft>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...change } : row)));
  }
  return (
    <section aria-label="Accrued vacation payouts">
      <h3>Release prior accrued vacation pay</h3>
      <p>
        Use this reviewed payout to release an actual prior vacation-pay
        liability. The server checks the available balance and records the
        liability release once. An ordinary vacation earning adjustment does not
        establish a prior liability.
      </p>
      {rows.map((row, index) => (
        <fieldset key={index} className="payroll-calculator__fieldset">
          <legend>Vacation payout {index + 1}</legend>
          <div className="payroll-calculator__form-grid">
            <Field label={`Vacation payout ${index + 1} employee`}>
              <select
                className="input"
                required
                value={row.employeeId}
                onChange={(event) =>
                  patch(index, {
                    employeeId: event.target.value,
                    sourceReference:"",
                    hours:"",
                    vacationRequestId: "",
                    requestLabel: "",
                  })
                }
              >
                <option value="">Select employee</option>
                {employees.map((employee) => (
                  <option key={employee._id} value={employee._id}>
                    {pickerName(employee)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={`Vacation payout ${index + 1} amount`}>
              <input
                className="input"
                inputMode="decimal"
                required
                value={row.amount}
                onChange={(event) =>
                  patch(index, { amount: event.target.value })
                }
              />
            </Field>
            <Field label={`Vacation payout ${index + 1} treatment`}>
              <select
                className="input"
                value={row.treatment}
                onChange={(event) =>
                  patch(index, {
                    treatment: event.target
                      .value as PayrollVacationPayoutDraft["treatment"],
                    ...(event.target.value === "unused_cashout"
                      ? { vacationRequestId: "", requestLabel: "", hours: "" }
                      : {}),
                  })
                }
              >
                <option value="vacation_leave">
                  Payment for actual vacation leave
                </option>
                <option value="unused_cashout">
                  Reviewed unused vacation cashout
                </option>
              </select>
            </Field>
            <Field
              label={`Vacation payout ${index + 1} source reference`}
              hint="Reference the reviewed prior accrual ledger and approved payout."
            >
              <input
                className="input"
                required
                value={row.sourceReference}
                onChange={(event) =>
                  patch(index, { sourceReference: event.target.value })
                }
              />
            </Field>
            <Field
              label={`Vacation payout ${index + 1} actual insurable hours`}
              hint="Use actual reviewed leave hours, not an amount divided by an assumed wage."
            >
              <input
                className="input"
                inputMode="decimal"
                value={row.hours}
                onChange={(event) =>
                  patch(index, { hours: event.target.value })
                }
              />
            </Field>
          </div>
          {row.vacationRequestId && (
            <p>
              Linked request: {row.requestLabel} · {row.vacationRequestId}{" "}
              <button
                type="button"
                className="btn btn--sm"
                onClick={() =>
                  patch(index, { vacationRequestId: "", requestLabel: "" })
                }
              >
                Unlink payout request {index + 1}
              </button>
            </p>
          )}
          <div className="payroll-calculator__actions">
            <button
              type="button"
              className="btn btn--sm"
              disabled={!row.employeeId || row.treatment !== "vacation_leave"}
              onClick={() => setPicking(index)}
            >
              Link approved vacation request {index + 1}
            </button>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => {
                onChange(rows.filter((_, i) => i !== index));
                setPicking(null);
              }}
            >
              Remove vacation payout {index + 1}
            </button>
          </div>
          {picking === index && (
            <Suspense
              fallback={
                <p role="status">Loading approved vacation requests…</p>
              }
            >
              <RequestPicker
                societyId={societyId}
                employeeId={row.employeeId}
                onCancel={() => setPicking(null)}
                onSelected={(request) => {
                  patch(index, {
                    vacationRequestId: request._id,
                    requestLabel: request.label,
                    hours: String(request.minutes / 60),
                    treatment: "vacation_leave",
                  });
                  setPicking(null);
                }}
              />
            </Suspense>
          )}
        </fieldset>
      ))}
      <button
        type="button"
        className="btn btn--sm"
        disabled={!employees.length}
        onClick={() =>
          onChange([
            ...rows,
            {
              employeeId: employees[0]?._id ?? "",
              amount: "",
              sourceReference: "",
              treatment: "vacation_leave",
              hours: "",
              vacationRequestId: "",
              requestLabel: "",
            },
          ])
        }
      >
        Add accrued vacation payout
      </button>
      <p className="muted">
        Vacation time and vacation pay retain their separate records. Link an
        approved or taken request when available, or retain a reviewed manual
        source reference.
      </p>
    </section>
  );
}
