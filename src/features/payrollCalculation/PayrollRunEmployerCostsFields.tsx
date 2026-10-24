import { Field } from "../../components/ui";
import type { CalculationInput } from "../../../shared/payrollCalculation";
import { amountInput, payrollMoney } from "./payrollUi";
import { pickerName, type PayrollPickerRow } from "./PayrollSourceForms";

const FIELDS = [
  ["benefitsCents", "Employer benefits"],
  ["pensionCents", "Employer pension"],
  ["benefitsAlreadyInEarningsCents", "Benefits already in earnings"],
  ["pensionAlreadyInEarningsCents", "Pension already in earnings"],
] as const;
type AmountKey = (typeof FIELDS)[number][0];
export type PayrollRunCostDraft = {
  employeeId: string;
  evidence: string;
} & Record<AmountKey, string>;
export const runCostDrafts = (
  value: CalculationInput["employerCostOverrides"],
): PayrollRunCostDraft[] =>
  (value ?? []).map((row) => ({
    employeeId: row.employeeId,
    evidence: row.evidence,
    benefitsCents: amountInput(row.benefitsCents),
    pensionCents: amountInput(row.pensionCents),
    benefitsAlreadyInEarningsCents: amountInput(
      row.benefitsAlreadyInEarningsCents,
    ),
    pensionAlreadyInEarningsCents: amountInput(
      row.pensionAlreadyInEarningsCents,
    ),
  }));
export function readRunCostDrafts(
  rows: PayrollRunCostDraft[],
  selected: string[],
): CalculationInput["employerCostOverrides"] {
  const seen = new Set<string>();
  return rows.length
    ? rows.map((row) => {
        if (!selected.includes(row.employeeId))
          throw new Error(
            "Each employer-cost override must belong to a selected employee.",
          );
        if (seen.has(row.employeeId))
          throw new Error(
            "Record one employer-cost override per employee in this run.",
          );
        seen.add(row.employeeId);
        if (!row.evidence.trim())
          throw new Error(
            "Retain the reviewed actual employer-cost evidence for this run.",
          );
        return {
          employeeId: row.employeeId,
          evidence: row.evidence.trim(),
          ...Object.fromEntries(
            FIELDS.map(([key, label]) => [
              key,
              payrollMoney(row[key], label, true),
            ]),
          ),
        };
      })
    : undefined;
}
export function PayrollRunEmployerCostsFields({
  employees,
  rows,
  onChange,
}: {
  employees: PayrollPickerRow[];
  rows: PayrollRunCostDraft[];
  onChange: (rows: PayrollRunCostDraft[]) => void;
}) {
  function patch(index: number, value: Partial<PayrollRunCostDraft>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...value } : row)));
  }
  return (
    <details>
      <summary>Actual employer costs for this run</summary>
      <p>
        Use reviewed amounts when this run differs from the employer or employee
        defaults. Recurring benefits are not automatically charged a second time
        for a bonus or adjustment. Blank fields retain the applicable
        server-calculated amount; explicit zero is retained.
      </p>
      {rows.map((row, index) => (
        <fieldset className="payroll-calculator__fieldset" key={index}>
          <legend>Run employer-cost override {index + 1}</legend>
          <div className="payroll-calculator__form-grid">
            <Field label={`Run cost ${index + 1} employee`}>
              <select
                className="input"
                required
                value={row.employeeId}
                onChange={(event) =>
                  patch(index, { employeeId: event.target.value,evidence:"" })
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
            {FIELDS.map(([key, label]) => (
              <Field
                key={key}
                label={`Run cost ${index + 1} ${label.toLowerCase()}`}
              >
                <input
                  className="input"
                  inputMode="decimal"
                  value={row[key]}
                  onChange={(event) =>
                    patch(index, { [key]: event.target.value })
                  }
                />
              </Field>
            ))}
            <Field label={`Run cost ${index + 1} review evidence`}>
              <input
                className="input"
                required
                value={row.evidence}
                onChange={(event) =>
                  patch(index, { evidence: event.target.value })
                }
              />
            </Field>
          </div>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          >
            Remove run employer-cost override {index + 1}
          </button>
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
              evidence: "",
              benefitsCents: "",
              pensionCents: "",
              benefitsAlreadyInEarningsCents: "",
              pensionAlreadyInEarningsCents: "",
            },
          ])
        }
      >
        Add actual run employer costs
      </button>
    </details>
  );
}
