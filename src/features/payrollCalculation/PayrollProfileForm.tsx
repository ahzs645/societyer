import { lazy, Suspense, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { Field, Drawer } from "../../components/ui";
import type { EmployeeProfileFields } from "../../../shared/payrollCalculation";
import type { PayrollCostAllocation } from "../../../shared/payrollEarnings";
import { payrollFields, type PayrollRow } from "./payrollUi";
import {
  CheckInput,
  EmployeeInput,
  formCheck,
  formMoney,
  formNumber,
  formOptional,
  formText,
  MoneyInput,
  pickerName,
  SelectInput,
  SourceForm,
  TextInput,
  type PayrollPickerRow,
} from "./PayrollSourceForms";
import {
  PayrollProfileEmployerFields,
  readPayrollProfileEmployerFields,
  type PayrollEhtLocationChoice,
} from "./PayrollProfileEmployerFields";
const PayrollTd1ImportPanel = lazy(() =>
  import("./PayrollTd1ImportPanel").then((module) => ({
    default: module.PayrollTd1ImportPanel,
  })),
);

const DEDUCTIONS: Array<
  [keyof NonNullable<EmployeeProfileFields["deductions"]>, string]
> = [
  ["registeredPlanCents", "Registered plan per pay"],
  ["unionDuesCents", "Union dues per pay"],
  ["maintenanceCents", "Maintenance per pay"],
  ["bonusRegisteredPlanCents", "Registered plan on bonus"],
  ["otherCashCents", "Other cash deductions per pay"],
  ["authorizedAnnualDeductionCents", "Authorized annual deduction"],
  ["annualZoneDeductionCents", "Annual zone deduction"],
  ["annualFederalCreditCents", "Annual federal credit"],
  ["annualProvincialCreditCents", "Annual provincial credit"],
];
type Election = NonNullable<EmployeeProfileFields["cpp"]["elections"]>[number];
type Disability = NonNullable<
  EmployeeProfileFields["cpp"]["disabilityPeriods"]
>[number];
export function PayrollProfileForm({
  societyId,
  today,
  employees,
  funds,
  grants,
  ehtLocations,
  employerYear,
  value,
  onSaved,
  onCancel,
}: {
  societyId: string;
  today: string;
  employees: PayrollPickerRow[];
  funds: PayrollPickerRow[];
  grants: PayrollPickerRow[];
  ehtLocations: readonly PayrollEhtLocationChoice[];
  employerYear: number;
  value?: PayrollRow<EmployeeProfileFields>;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const save = useMutation(api.payrollCalculation.saveProfile),
    current = payrollFields(value);
  const [td1EmployeeId, setTd1EmployeeId] = useState<string | null>(null),
    [td1Applied, setTd1Applied] = useState(false);
  const [elections, setElections] = useState<Election[]>(
      current?.cpp.elections ?? [],
    ),
    [disability, setDisability] = useState<Disability[]>(
      current?.cpp.disabilityPeriods ?? [],
    ),
    [allocations, setAllocations] = useState<PayrollCostAllocation[]>(
      current?.fundingAllocations ?? [],
    ),
    [compensation, setCompensation] = useState<
      EmployeeProfileFields["compensation"]
    >(current?.compensation ?? "hourly"),
    [salaryProrationReviewed, setSalaryProrationReviewed] = useState(
      current?.salaryProration?.reviewed ?? false,
    );
  async function onSave(data: FormData) {
    const normalWeeklyMinutes = formNumber(data, "normalWeeklyHours")! * 60,
      averageWeeklyMinutes = formNumber(data, "averageWeeklyHours")! * 60;
    if (
      !Number.isInteger(normalWeeklyMinutes) ||
      !Number.isInteger(averageWeeklyMinutes)
    )
      throw new Error("Weekly hours must resolve to whole minutes.");
    if (
      allocations.length &&
      allocations.reduce((sum, row) => sum + row.shareBps, 0) !== 10000
    )
      throw new Error(
        "Funding allocation percentages must total exactly 100%.",
      );
    const fields: EmployeeProfileFields = {
      ...readPayrollProfileEmployerFields(data),
      effectiveFrom: formText(data, "effectiveFrom"),
      effectiveTo: formOptional(data, "effectiveTo"),
      provinceOfEmployment: formText(
        data,
        "provinceOfEmployment",
      ).toUpperCase(),
      employmentKind: formText(
        data,
        "employmentKind",
      ) as EmployeeProfileFields["employmentKind"],
      compensation: formText(
        data,
        "compensation",
      ) as EmployeeProfileFields["compensation"],
      salaryProration:
        compensation !== "hourly" &&
        (salaryProrationReviewed || formText(data, "salaryProrationEvidence"))
          ? {
              basis: "calendar_days",
              reviewed: salaryProrationReviewed,
              evidence: formText(data, "salaryProrationEvidence"),
            }
          : undefined,
      rateCents: formMoney(data, "rateCents")!,
      normalWeeklyMinutes,
      averageWeeklyMinutes,
      policy: "ordinary_bc",
      restPeriodsConfirmed: formCheck(data, "restPeriodsConfirmed"),
      historyCompleteFrom: formText(data, "historyCompleteFrom"),
      historyCompleteThrough: formText(data, "historyCompleteThrough"),
      ytdConfirmed: formCheck(data, "ytdConfirmed"),
      vacationMode: formText(
        data,
        "vacationMode",
      ) as EmployeeProfileFields["vacationMode"],
      vacationRatePercent: formNumber(data, "vacationRatePercent", true),
      vacationEachChequeAgreementConfirmed: formCheck(
        data,
        "vacationEachChequeAgreementConfirmed",
      ),
      td1: {
        ...Object.fromEntries(
          [
            "federalMultipleEmployers",
            "provincialMultipleEmployers",
            "federalTaxExempt",
            "provincialTaxExempt",
          ].map((key) => [
            key,
            formOptional(data, key) === "yes"
              ? true
              : formOptional(data, key) === "no"
                ? false
                : undefined,
          ]),
        ),
        confirmed: formCheck(data, "td1Confirmed"),
        declarationReference: formText(data, "declarationReference"),
        federalClaimCents: formMoney(data, "federalClaimCents", true),
        provincialClaimCents: formMoney(data, "provincialClaimCents", true),
        multipleEmployers: formCheck(data, "multipleEmployers"),
        additionalTaxCents: formMoney(data, "additionalTaxCents", true),
        taxExempt: formCheck(data, "taxExempt"),
      },
      cpp: {
        exempt: formCheck(data, "cppExempt"),
        exemptionReason: formOptional(data, "cppExemptionReason"),
        evidenceReference: formOptional(data, "cppEvidence"),
        elections,
        disabilityPeriods: disability,
      },
      eiExempt: formCheck(data, "eiExempt"),
      eiExemptionEvidence: formOptional(data, "eiExemptionEvidence"),
      deductions: Object.fromEntries(
        DEDUCTIONS.map(([key]) => [key, formMoney(data, key, true)]),
      ),
      notes: formOptional(data, "notes"),
      portalUserId: current?.portalUserId,
      fundingAllocations: allocations.length ? allocations : undefined,
      fifthYearVacationReconciliation: formCheck(data, "fifthYearEnabled")
        ? {
            fifthYearGrossWagesCents: formMoney(
              data,
              "fifthYearGrossWagesCents",
            )!,
            vacationAlreadyAccruedCents: formMoney(
              data,
              "fifthYearAlreadyAccruedCents",
              true,
            ),
            vacationAlreadyPaidCents: formMoney(
              data,
              "fifthYearAlreadyPaidCents",
            )!,
            previousVacationRatePercent: formNumber(
              data,
              "fifthYearPreviousRate",
            )!,
            reviewed: formCheck(data, "fifthYearReviewed"),
            evidence: formText(data, "fifthYearEvidence"),
          }
        : undefined,
    };
    await save({
      societyId,
      id: value?._id,
      employeeId: formText(data, "employeeId"),
      fields,
    });
    onSaved();
  }
  function allocation(index: number, patch: Partial<PayrollCostAllocation>) {
    setAllocations((old) =>
      old.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }
  return (
    <SourceForm title="Employee profile" onSave={onSave} onCancel={onCancel}>
      <p>
        This records employer-reviewed payroll instructions. Province of
        employment is independent of the employee’s residential province. Native
        earnings coverage currently supports ordinary B.C. policy; other
        employment policies produce blockers. Keep the employee’s actual start
        date and birth date up to date in the employee directory for tenure and
        CPP eligibility.
      </p>
      <div className="payroll-calculator__form-grid">
        <EmployeeInput employees={employees} employeeId={value?.employeeId} />
        <TextInput
          label="Profile effective from"
          name="effectiveFrom"
          type="date"
          value={current?.effectiveFrom ?? today}
          required
        />
        <TextInput
          label="Profile effective to"
          name="effectiveTo"
          type="date"
          value={current?.effectiveTo}
        />
        <SelectInput
          label="Province of employment"
          name="provinceOfEmployment"
          value={current?.provinceOfEmployment ?? "BC"}
          choices={[
            "BC",
            "AB",
            "SK",
            "MB",
            "ON",
            "QC",
            "NB",
            "NS",
            "PE",
            "NL",
            "YT",
            "NT",
            "NU",
          ]}
        />
        <SelectInput
          label="Employment policy"
          name="employmentKind"
          value={current?.employmentKind ?? "ordinary"}
          choices={[
            "ordinary",
            "commission",
            "pension",
            "nonresident",
            "quebec_transfer",
          ]}
        />
        <Field label="Compensation basis">
          <select
            className="input"
            name="compensation"
            value={compensation}
            onChange={(event) =>
              setCompensation(
                event.target.value as EmployeeProfileFields["compensation"],
              )
            }
          >
            {["hourly", "monthly", "annual"].map((basis) => (
              <option key={basis} value={basis}>
                {basis}
              </option>
            ))}
          </select>
        </Field>
        <MoneyInput
          label="Hourly rate or salary for selected basis"
          name="rateCents"
          value={current?.rateCents}
        />
        <TextInput
          label="Normal weekly hours"
          name="normalWeeklyHours"
          type="number"
          value={current ? current.normalWeeklyMinutes / 60 : undefined}
          required
        />
        <TextInput
          label="Average weekly hours"
          name="averageWeeklyHours"
          type="number"
          value={current ? current.averageWeeklyMinutes / 60 : undefined}
          required
        />
        <TextInput
          label="Complete work history from"
          name="historyCompleteFrom"
          type="date"
          value={current?.historyCompleteFrom}
          required
        />
        <TextInput
          label="Complete work history through"
          name="historyCompleteThrough"
          type="date"
          value={current?.historyCompleteThrough}
          required
        />
        <CheckInput
          label="Daily and weekly rest periods reviewed"
          name="restPeriodsConfirmed"
          checked={current?.restPeriodsConfirmed}
        />
        <CheckInput
          label="Year-to-date history is complete for this legal employer"
          name="ytdConfirmed"
          checked={current?.ytdConfirmed}
        />
        <SelectInput
          label="Vacation treatment"
          name="vacationMode"
          value={current?.vacationMode ?? "accrue"}
          choices={[
            { value: "accrue", label: "Accrue vacation" },
            { value: "pay_each_cheque", label: "Pay vacation each cheque" },
          ]}
        />
        <TextInput
          label="Vacation rate percent override"
          name="vacationRatePercent"
          type="number"
          value={current?.vacationRatePercent}
          hint="Leave blank to use the source-backed tenure minimum."
        />
        <CheckInput
          label="Written agreement to pay vacation each cheque confirmed"
          name="vacationEachChequeAgreementConfirmed"
          checked={current?.vacationEachChequeAgreementConfirmed}
        />
      </div>
      {compensation !== "hourly" && (
        <fieldset className="payroll-calculator__fieldset">
          <legend>Partial salary periods</legend>
          <p>
            Short final periods and mid-period employment need the reviewed
            contract’s proration basis. Calendar-day proration uses active days
            over the normal full salary period; other contract methods require
            separate review.
          </p>
          <label>
            <input
              type="checkbox"
              name="salaryProrationReviewed"
              checked={salaryProrationReviewed}
              onChange={(event) =>
                setSalaryProrationReviewed(event.target.checked)
              }
            />{" "}
            Contract uses calendar-day proration for partial salary periods
          </label>
          <TextInput
            label="Salary proration evidence"
            name="salaryProrationEvidence"
            value={current?.salaryProration?.evidence}
            required={salaryProrationReviewed}
            hint="Reference the reviewed employment contract and calendar-day proration agreement."
          />
        </fieldset>
      )}
      <PayrollProfileEmployerFields
        current={current}
        locations={ehtLocations}
        year={employerYear}
      />
      <details>
        <summary>Fifth-year vacation reconciliation</summary>
        <p>
          If this period crosses the five-year anniversary, review the complete
          fifth-year wages and vacation already paid. The engine blocks an
          unreviewed crossing and applies the supported accrued or cash
          treatment.
        </p>
        <CheckInput
          label="Include fifth-year vacation reconciliation"
          name="fifthYearEnabled"
          checked={!!current?.fifthYearVacationReconciliation}
        />
        <div className="payroll-calculator__form-grid">
          <MoneyInput
            label="Complete fifth-year gross wages"
            name="fifthYearGrossWagesCents"
            value={
              current?.fifthYearVacationReconciliation?.fifthYearGrossWagesCents
            }
          />
          <MoneyInput
            label="Vacation already paid for fifth year"
            name="fifthYearAlreadyPaidCents"
            value={
              current?.fifthYearVacationReconciliation?.vacationAlreadyPaidCents
            }
          />
          <MoneyInput
            label="Unpaid fifth-year vacation already accrued"
            name="fifthYearAlreadyAccruedCents"
            value={
              current?.fifthYearVacationReconciliation
                ?.vacationAlreadyAccruedCents
            }
            hint="Enter the existing unpaid fifth-year liability, including explicit zero in accrue mode. It is separate from vacation already paid."
          />
          <TextInput
            label="Previous vacation rate percent"
            name="fifthYearPreviousRate"
            type="number"
            value={
              current?.fifthYearVacationReconciliation
                ?.previousVacationRatePercent
            }
          />
          <TextInput
            label="Fifth-year reconciliation evidence"
            name="fifthYearEvidence"
            value={current?.fifthYearVacationReconciliation?.evidence}
          />
          <CheckInput
            label="Fifth-year wages and prior vacation payments reviewed"
            name="fifthYearReviewed"
            checked={current?.fifthYearVacationReconciliation?.reviewed}
          />
        </div>
      </details>
      <h3>Employer-recorded TD1 evidence</h3>
      <button
        type="button"
        className="btn btn--sm"
        onClick={(event) => {
          const form = event.currentTarget.closest("form");
          const selected = form
            ? new FormData(form).get("employeeId")
            : undefined;
          if (typeof selected === "string" && selected)
            setTd1EmployeeId(selected);
        }}
      >
        Import reviewed federal and BC TD1
      </button>
      {td1Applied && (
        <p role="status">
          Reviewed TD1 declarations were saved for the selected employee and
          resolve by payroll payment date. These manual profile fields remain
          the fallback for dates without a matching reviewed declaration.
        </p>
      )}
      {td1EmployeeId &&
        typeof document !== "undefined" &&
        createPortal(
          <Drawer
            open
            onClose={() => setTd1EmployeeId(null)}
            title="Review employee TD1 declarations"
            size="wide"
          >
            <Suspense fallback={<p role="status">Loading local TD1 review…</p>}>
              <PayrollTd1ImportPanel
                societyId={societyId}
                employeeId={td1EmployeeId}
                onApplied={() => setTd1Applied(true)}
              />
            </Suspense>
          </Drawer>,
          document.body,
        )}
      <p>
        Leave claim amounts blank only to use the reviewed basic claim for the
        applicable rule edition. These controls record a declaration already
        obtained; they do not certify an employee submission.
      </p>
      <div className="payroll-calculator__form-grid">
        <CheckInput
          label="Current TD1 declaration reviewed and confirmed"
          name="td1Confirmed"
          checked={current?.td1.confirmed}
        />
        <TextInput
          label="TD1 declaration reference"
          name="declarationReference"
          value={current?.td1.declarationReference}
        />
        <MoneyInput
          label="Federal TD1 claim amount"
          name="federalClaimCents"
          value={current?.td1.federalClaimCents}
        />
        <MoneyInput
          label="Provincial TD1 claim amount"
          name="provincialClaimCents"
          value={current?.td1.provincialClaimCents}
        />
        <CheckInput
          label="Multiple employers on TD1"
          name="multipleEmployers"
          checked={current?.td1.multipleEmployers}
        />
        <MoneyInput
          label="Additional income tax each pay"
          name="additionalTaxCents"
          value={current?.td1.additionalTaxCents}
        />
        <CheckInput
          label="TD1 tax exemption declared"
          name="taxExempt"
          checked={current?.td1.taxExempt}
        />
      </div>
      <details>
        <summary>Independent federal and BC TD1 instructions</summary>
        <p>
          Use each jurisdiction’s actual reviewed declaration when the
          instructions differ. A blank choice uses the shared profile
          instruction above.
        </p>
        <div className="payroll-calculator__form-grid">
          {(
            [
              [
                "federalMultipleEmployers",
                "Federal concurrent-employer instruction",
              ],
              [
                "provincialMultipleEmployers",
                "BC concurrent-employer instruction",
              ],
              ["federalTaxExempt", "Federal income below claims instruction"],
              ["provincialTaxExempt", "BC income below claims instruction"],
            ] as const
          ).map(([key, label]) => (
            <Field key={key} label={label}>
              <select
                className="input"
                name={key}
                defaultValue={
                  current?.td1[key] === undefined
                    ? ""
                    : current.td1[key]
                      ? "yes"
                      : "no"
                }
              >
                <option value="">Use shared profile instruction</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </Field>
          ))}
        </div>
      </details>
      <h3>CPP and EI evidence</h3>
      <p>
        A blanket CPP exemption flag blocks ordinary native calculation for
        review. Actual age, CPT30 elections and disability periods must use the
        employee birth date and effective dated evidence below.
      </p>
      <div className="payroll-calculator__form-grid">
        <CheckInput
          label="CPP exempt"
          name="cppExempt"
          checked={current?.cpp.exempt}
        />
        <TextInput
          label="CPP exemption reason"
          name="cppExemptionReason"
          value={current?.cpp.exemptionReason}
        />
        <TextInput
          label="CPP exemption evidence reference"
          name="cppEvidence"
          value={current?.cpp.evidenceReference}
        />
        <CheckInput
          label="EI exempt"
          name="eiExempt"
          checked={current?.eiExempt}
        />
        <TextInput
          label="EI exemption evidence"
          name="eiExemptionEvidence"
          value={current?.eiExemptionEvidence}
        />
      </div>
      <h4>CPP stop/restart elections</h4>
      {elections.map((row, index) => (
        <fieldset className="payroll-calculator__fieldset" key={index}>
          <legend>CPP election {index + 1}</legend>
          <div className="payroll-calculator__form-grid">
            <Field label={`Election ${index + 1} action`}>
              <select
                className="input"
                value={row.action}
                onChange={(e) =>
                  setElections((old) =>
                    old.map((r, i) =>
                      i === index
                        ? { ...r, action: e.target.value as Election["action"] }
                        : r,
                    ),
                  )
                }
              >
                <option value="stop">Stop</option>
                <option value="restart">Restart</option>
              </select>
            </Field>
            <Field label={`Election ${index + 1} received date`}>
              <input
                className="input"
                type="date"
                required
                value={row.receivedDate}
                onChange={(e) =>
                  setElections((old) =>
                    old.map((r, i) =>
                      i === index ? { ...r, receivedDate: e.target.value } : r,
                    ),
                  )
                }
              />
            </Field>
            <Field label={`Election ${index + 1} evidence`}>
              <input
                className="input"
                required
                value={row.evidence}
                onChange={(e) =>
                  setElections((old) =>
                    old.map((r, i) =>
                      i === index ? { ...r, evidence: e.target.value } : r,
                    ),
                  )
                }
              />
            </Field>
            <label>
              <input
                type="checkbox"
                checked={row.retirementPensionConfirmed}
                onChange={(e) =>
                  setElections((old) =>
                    old.map((r, i) =>
                      i === index
                        ? { ...r, retirementPensionConfirmed: e.target.checked }
                        : r,
                    ),
                  )
                }
              />{" "}
              Retirement pension receipt confirmed
            </label>
          </div>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() =>
              setElections((old) => old.filter((_, i) => i !== index))
            }
          >
            Remove election {index + 1}
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="btn btn--sm"
        onClick={() =>
          setElections((old) => [
            ...old,
            {
              action: "stop",
              receivedDate: "",
              retirementPensionConfirmed: false,
              evidence: "",
            },
          ])
        }
      >
        Add CPP election
      </button>
      <h4>CPP disability periods</h4>
      {disability.map((row, index) => (
        <fieldset className="payroll-calculator__fieldset" key={index}>
          <legend>Disability period {index + 1}</legend>
          <div className="payroll-calculator__form-grid">
            {(
              [
                ["consideredDisabledDate", "Considered disabled from"],
                ["noLongerDisabledDate", "No longer disabled from"],
                ["evidence", "Disability evidence"],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={`${label} ${index + 1}`}>
                <input
                  className="input"
                  type={key === "evidence" ? "text" : "date"}
                  required={key !== "noLongerDisabledDate"}
                  value={row[key] ?? ""}
                  onChange={(e) =>
                    setDisability((old) =>
                      old.map((r, i) =>
                        i === index
                          ? { ...r, [key]: e.target.value || undefined }
                          : r,
                      ),
                    )
                  }
                />
              </Field>
            ))}
          </div>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() =>
              setDisability((old) => old.filter((_, i) => i !== index))
            }
          >
            Remove disability period {index + 1}
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="btn btn--sm"
        onClick={() =>
          setDisability((old) => [
            ...old,
            { consideredDisabledDate: "", evidence: "" },
          ])
        }
      >
        Add disability period
      </button>
      <details>
        <summary>Other authorized deductions and credits</summary>
        <div className="payroll-calculator__form-grid">
          {DEDUCTIONS.map(([key, label]) => (
            <MoneyInput
              key={key}
              label={label}
              name={key}
              value={current?.deductions?.[key]}
            />
          ))}
        </div>
      </details>
      <h3>Employer cost funding allocations</h3>
      <p>
        Optional allocations split full employer cost. Shares must total 100%;
        allocated cents retain the exact total.
      </p>
      {allocations.map((row, index) => (
        <fieldset key={index} className="payroll-calculator__fieldset">
          <legend>Funding allocation {index + 1}</legend>
          <div className="payroll-calculator__form-grid">
            <Field label={`Allocation ${index + 1} label`}>
              <input
                className="input"
                value={row.label}
                required
                onChange={(e) => allocation(index, { label: e.target.value })}
              />
            </Field>
            <Field label={`Allocation ${index + 1} percentage`}>
              <input
                className="input"
                type="number"
                min="0"
                max="100"
                step="0.01"
                required
                value={row.shareBps / 100}
                onChange={(e) =>
                  allocation(index, {
                    shareBps: Math.round(Number(e.target.value) * 100),
                  })
                }
              />
            </Field>
            <Field label={`Allocation ${index + 1} fund restriction`}>
              <select
                className="input"
                value={row.fundRestrictionId ?? ""}
                onChange={(e) =>
                  allocation(index, {
                    fundRestrictionId: e.target.value || undefined,
                  })
                }
              >
                <option value="">None</option>
                {funds.map((fund) => (
                  <option key={fund._id} value={fund._id}>
                    {pickerName(fund)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={`Allocation ${index + 1} grant`}>
              <select
                className="input"
                value={row.grantId ?? ""}
                onChange={(e) =>
                  allocation(index, { grantId: e.target.value || undefined })
                }
              >
                <option value="">None</option>
                {grants.map((grant) => (
                  <option key={grant._id} value={grant._id}>
                    {pickerName(grant)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={`Allocation ${index + 1} program code`}>
              <input
                className="input"
                value={row.programCode ?? ""}
                onChange={(e) =>
                  allocation(index, {
                    programCode: e.target.value || undefined,
                  })
                }
              />
            </Field>
          </div>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() =>
              setAllocations((old) => old.filter((_, i) => i !== index))
            }
          >
            Remove allocation {index + 1}
          </button>
        </fieldset>
      ))}
      <p>
        Allocated:{" "}
        {(
          allocations.reduce((sum, row) => sum + row.shareBps, 0) / 100
        ).toFixed(2)}
        %
      </p>
      <button
        type="button"
        className="btn btn--sm"
        onClick={() =>
          setAllocations((old) => [
            ...old,
            { label: "", shareBps: old.length ? 0 : 10000 },
          ])
        }
      >
        Add funding allocation
      </button>
      <TextInput label="Profile notes" name="notes" value={current?.notes} />
    </SourceForm>
  );
}
