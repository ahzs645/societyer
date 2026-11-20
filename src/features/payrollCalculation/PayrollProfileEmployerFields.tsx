import { useState } from "react";
import type { EmployeeProfileFields } from "../../../shared/payrollCalculation";
import { Field } from "../../components/ui";
import { Select } from "../../components/Select";
import {
  formCheck,
  formMoney,
  formNumber,
  formOptional,
  formText,
  MoneyInput,
  SelectInput,
  TextInput,
} from "./PayrollSourceForms";

export type PayrollEhtLocationChoice = {
  id: string;
  evidence: string;
  qualifying: boolean;
};
export function readPayrollProfileEmployerFields(
  data: FormData,
): Pick<
  EmployeeProfileFields,
  | "ehtLocationId"
  | "ehtAttributionBasis"
  | "ehtAttributionEvidence"
  | "employerOverrides"
> {
  const ehtLocationId = formOptional(data, "ehtLocationId"),
    ehtAttributionBasis = formOptional(data, "ehtAttributionBasis");
  if (ehtLocationId && !ehtAttributionBasis)
    throw new Error("Select the reviewed EHT location attribution basis.");
  return {
    ehtLocationId,
    ehtAttributionBasis: ehtLocationId
      ? (ehtAttributionBasis as EmployeeProfileFields["ehtAttributionBasis"])
      : undefined,
    ehtAttributionEvidence: ehtLocationId
      ? formText(data, "ehtAttributionEvidence")
      : undefined,
    employerOverrides: formCheck(data, "employerOverridesEnabled")
      ? {
          eiEmployerMultiplier: formNumber(
            data,
            "overrideEiEmployerMultiplier",
            true,
          ),
          reducedEiRateEvidence: formOptional(
            data,
            "overrideReducedEiRateEvidence",
          ),
          eiCoverageGroup: formOptional(data, "overrideEiCoverageGroup"),
          benefitsCentsPerPay: formMoney(
            data,
            "overrideBenefitsCentsPerPay",
            true,
          ),
          pensionPercent: formNumber(data, "overridePensionPercent", true),
          pensionBonusEligible:
            formOptional(data, "overridePensionBonusEligible") === "yes"
              ? true
              : formOptional(data, "overridePensionBonusEligible") === "no"
                ? false
                : undefined,
          benefitsAlreadyInEarningsCentsPerPay: formMoney(
            data,
            "overrideBenefitsAlreadyInEarningsCentsPerPay",
            true,
          ),
          pensionAlreadyInEarningsCentsPerPay: formMoney(
            data,
            "overridePensionAlreadyInEarningsCentsPerPay",
            true,
          ),
          evidence: formText(data, "employerOverrideEvidence"),
        }
      : undefined,
  };
}

export function PayrollProfileEmployerFields({
  current,
  locations,
  year,
}: {
  current?: EmployeeProfileFields;
  locations: readonly PayrollEhtLocationChoice[];
  year: number;
}) {
  const [enabled, setEnabled] = useState(!!current?.employerOverrides),
    [locationId, setLocationId] = useState(current?.ehtLocationId ?? ""),
    [attributionBasis, setAttributionBasis] = useState<
      NonNullable<EmployeeProfileFields["ehtAttributionBasis"]> | ""
    >(current?.ehtAttributionBasis ?? "");
  const overrides = current?.employerOverrides,
    choices = locations.filter((location) => location.qualifying);
  return (
    <>
      <fieldset className="payroll-calculator__fieldset">
        <legend>Employee employer-cost assumptions</legend>
        <p>
          Use actual approved EI coverage and employer benefits/pension for this
          employee. Blank override fields retain the reviewed employer defaults.
          Review inherited amounts before recording the employee’s evidence.
        </p>
        <label>
          <input
            type="checkbox"
            name="employerOverridesEnabled"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />{" "}
          Use reviewed employee-specific employer assumptions
        </label>
        {enabled && (
          <div className="payroll-calculator__form-grid">
            <TextInput
              label="EI employer multiplier override"
              name="overrideEiEmployerMultiplier"
              type="number"
              value={overrides?.eiEmployerMultiplier}
              hint="Enter the actual multiplier, including an explicit 1.4 for an employee outside the approved reduced-rate coverage."
            />
            <TextInput
              label="Approved reduced EI coverage group"
              name="overrideEiCoverageGroup"
              value={overrides?.eiCoverageGroup}
            />
            <TextInput
              label="Employee reduced EI rate evidence"
              name="overrideReducedEiRateEvidence"
              value={overrides?.reducedEiRateEvidence}
            />
            <MoneyInput
              label="Employee employer benefits per pay override"
              name="overrideBenefitsCentsPerPay"
              value={overrides?.benefitsCentsPerPay}
            />
            <TextInput
              label="Employee employer pension percent override"
              name="overridePensionPercent"
              type="number"
              value={overrides?.pensionPercent}
            />
            <SelectInput
              label="Employee pension plan includes actual bonus remuneration"
              name="overridePensionBonusEligible"
              value={
                overrides?.pensionBonusEligible === undefined
                  ? ""
                  : overrides.pensionBonusEligible
                    ? "yes"
                    : "no"
              }
              choices={[
                {
                  value: "yes",
                  label: "Yes — actual bonus remuneration is eligible",
                },
                {
                  value: "no",
                  label: "No — actual bonus remuneration is excluded",
                },
              ]}
              optional
              emptyLabel="Use reviewed employer plan / not yet confirmed"
            />
            <MoneyInput
              label="Employee benefits already in earnings per pay override"
              name="overrideBenefitsAlreadyInEarningsCentsPerPay"
              value={overrides?.benefitsAlreadyInEarningsCentsPerPay}
            />
            <MoneyInput
              label="Employee pension already in earnings per pay override"
              name="overridePensionAlreadyInEarningsCentsPerPay"
              value={overrides?.pensionAlreadyInEarningsCentsPerPay}
            />
            <TextInput
              label="Employee employer-cost review evidence"
              name="employerOverrideEvidence"
              value={overrides?.evidence}
              required
              hint="Reference the employee’s approved coverage, benefit/pension plan and reviewed inherited defaults."
            />
          </div>
        )}
      </fieldset>
      <fieldset className="payroll-calculator__fieldset">
        <legend>Qualifying EHT location attribution · {year}</legend>
        <p>
          Attribute this employee’s annual remuneration to the actual qualifying
          physical location under the reviewed B.C. rule. Grant, fund,
          department and program cost allocations remain separate from this
          location attribution.
        </p>
        <div className="payroll-calculator__form-grid">
          <Field label="Employee qualifying EHT location">
            <Select
              value={locationId}
              onChange={setLocationId}
              placeholder="Use applicable employer treatment"
              clearable
              clearLabel="Use applicable employer treatment"
              options={[
                ...(locationId &&
                !choices.some((location) => location.id === locationId)
                  ? [
                      {
                        value: locationId,
                        label: `Retained location needs review · ${locationId}`,
                      },
                    ]
                  : []),
                ...choices.map((location) => ({
                  value: location.id,
                  label: `${location.id} · ${location.evidence}`,
                })),
              ]}
            />
            <input type="hidden" name="ehtLocationId" value={locationId} />
          </Field>
          {locationId && (
            <>
              <Field label="EHT location attribution basis">
                <Select
                  value={attributionBasis}
                  onChange={setAttributionBasis}
                  placeholder="Select the reviewed attribution basis"
                  options={[
                    {
                      value: "primary_reporting",
                      label: "Primary physical reporting location",
                    },
                    {
                      value: "reasonable_allocation",
                      label: "Reviewed reasonable allocation to this location",
                    },
                  ]}
                />
                <input
                  type="hidden"
                  name="ehtAttributionBasis"
                  value={attributionBasis}
                />
              </Field>
              <TextInput
                label="EHT employee location attribution evidence"
                name="ehtAttributionEvidence"
                value={current?.ehtAttributionEvidence}
                required
                hint="Retain the actual primary work-location or reasonable attribution evidence for this annual remuneration."
              />
            </>
          )}
        </div>
        {!choices.length && (
          <p className="muted">
            No qualifying location definitions are saved for this year. Define
            actual qualified locations in Employer setup when that treatment
            applies.
          </p>
        )}
      </fieldset>
    </>
  );
}
